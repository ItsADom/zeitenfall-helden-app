// Pure board math for the virtual table (VTT). No I/O — server orchestration
// (persistence, per-viewer fog redaction, WS broadcast) stays server-only,
// same split as shared/src/dice.ts. See docs/concepts/virtual-table.md for
// the design this implements.

export interface CellCoord {
  x: number;
  y: number;
}

/** "12,7" — used as the object key in tiles_json and the array entries in fog_json. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

const CELL_KEY_RE = /^(-?\d+),(-?\d+)$/;

export function parseCellKey(key: string): CellCoord | null {
  const m = CELL_KEY_RE.exec(key);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Sparse cell sets round-trip through JSON as a plain array — fog_json's actual shape. */
export function encodeCellSet(cells: Set<string>): string[] {
  return [...cells];
}

export function decodeCellSet(keys: string[]): Set<string> {
  return new Set(keys);
}

// --- Tile values -----------------------------------------------------------
//
// tiles_json maps a cell key to one tagged string, so a cell is exactly one
// thing and this is the one parser. Tolerant of junk: a cell whose value no
// longer matches any pattern (a removed texture key, a corrupted write) comes
// back null and the caller skips it rather than crashing the whole board.

export type TileValue =
  | { kind: 'color'; hex: string }
  | { kind: 'texture'; key: string }
  | { kind: 'asset'; slug: string }; // reserved — GM-uploaded textures, not built in v1

// 6 digits = opaque, 8 = with alpha (#rrggbbaa) — a plain CSS/SVG colour
// string either way, so no separate opacity field is needed anywhere else.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export function parseTileValue(raw: string): TileValue | null {
  if (HEX_COLOR_RE.test(raw)) return { kind: 'color', hex: raw };
  if (raw.startsWith('t:') && raw.length > 2) return { kind: 'texture', key: raw.slice(2) };
  if (raw.startsWith('a:') && raw.length > 2) return { kind: 'asset', slug: raw.slice(2) };
  return null;
}

// --- Distance and coverage --------------------------------------------------

/**
 * Chebyshev distance: max(|dx|, |dy|). Settled with the developer — a
 * diagonal step costs 1 Schritt, same as a straight one, so movement range
 * renders as a square rather than the diamond Euclidean/Manhattan would give.
 */
export function gridDistance(a: CellCoord, b: CellCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export interface TokenFootprint {
  x: number;
  y: number;
  /** Cells across; 1 = a single cell. (x, y) is the top-left cell. */
  size: number;
}

/**
 * The single cell a point-anchored overlay (a label) sits on — same
 * "integer is a grid line, not a cell center" convention as everything else
 * here. A label is created at its cell's center (x = cell.x + 0.5, see
 * VirtualTable.tsx), so flooring recovers that same cell.
 */
export function overlayCell(pos: CellCoord): CellCoord {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

/** Every cell a token of size > 1 occupies, anchored at its top-left cell. */
export function tokenCells(token: TokenFootprint): CellCoord[] {
  const size = Math.max(1, Math.round(token.size));
  const x0 = Math.floor(token.x);
  const y0 = Math.floor(token.y);
  const cells: CellCoord[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) cells.push({ x: x0 + dx, y: y0 + dy });
  }
  return cells;
}

// Coordinates throughout this module follow the same grid-line convention as
// TokenFootprint: an integer is a cell BOUNDARY, not a cell's center — token
// x=3 anchors cell 3, spanning continuous coordinates 3..4. So the center of
// cell (5,5) is the half-integer point (5.5, 5.5), not the integer corner
// (5,5), which sits on a grid line equidistant from four different cells.
export type MeasureShape =
  | { kind: 'circle'; origin: CellCoord; radius: number }
  | { kind: 'rectangle'; from: CellCoord; to: CellCoord };
// Ruler and cone aren't cell sets: a ruler is just gridDistance between two
// points, and the cone stays visual-only per the developer (a true geometric
// wedge, no cell-accurate coverage) — see "Autotiling without edge art" in
// the plan for the reasoning that generalises here too.

/**
 * Which cells a measure shape covers, for range highlighting. Circle coverage
 * is Euclidean distance from a cell's CENTER to the origin — an area-of-effect
 * template is a physical radius, not a movement cost, so it deliberately does
 * not reuse gridDistance's Chebyshev metric.
 */
export function shapeCells(shape: MeasureShape): CellCoord[] {
  if (shape.kind === 'rectangle') {
    const x0 = Math.min(shape.from.x, shape.to.x);
    const x1 = Math.max(shape.from.x, shape.to.x);
    const y0 = Math.min(shape.from.y, shape.to.y);
    const y1 = Math.max(shape.from.y, shape.to.y);
    const cells: CellCoord[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) cells.push({ x, y });
    }
    return cells;
  }
  const { origin, radius } = shape;
  const r = Math.max(0, radius);
  const cells: CellCoord[] = [];
  const xMin = Math.floor(origin.x - r);
  const xMax = Math.ceil(origin.x + r);
  const yMin = Math.floor(origin.y - r);
  const yMax = Math.ceil(origin.y + r);
  const r2 = r * r;
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x + 0.5 - origin.x;
      const dy = y + 0.5 - origin.y;
      if (dx * dx + dy * dy <= r2) cells.push({ x, y });
    }
  }
  return cells;
}

// --- Initiative and rounds ---------------------------------------------------
//
// Turn-pointer design (settled with the developer, revised from the earlier
// done-checkbox version): the whole roster re-rolls — ini_basis + a FRESH 1W6,
// never cumulative — at combat start and again every time the turn pointer
// wraps past the last combatant. A participant added mid-combat sits in the
// roster unrolled (`activeThisRound: false`) and simply waits for the next
// round's mass reroll rather than being spliced into the round already in
// progress. There is no "done" flag any more — whose turn it is is a single
// index into the sorted active order, and either the GM or that combatant's
// own owner can advance it.

export interface InitiativeEntry {
  tokenId: number;
  value: number;
  /** The Initiative-Basis actually rolled with this round — snapshotted at roll time, see the tiebreak in initiativeOrder(). */
  iniBasis: number;
  /** Rolled into the CURRENT round's turn order — false for a fresh add mid-round, true for everyone once a round (re)rolls. */
  activeThisRound: boolean;
  /** null = not dying; otherwise rounds left until death. */
  deathCountdown: number | null;
}

/**
 * Value descending; a tied value is broken by the higher Initiative-Basis
 * (settled with the developer). A genuine tie — same value AND same basis —
 * is not resolved here at all: the roller (server/src/board.ts) rerolls
 * exactly that subset until every value+basis pair is unique, so this sort
 * never actually has to fall back past the basis compare in practice. The
 * original-order fallback stays only as a last-resort safety net.
 */
export function initiativeOrder<T extends { value: number; iniBasis: number }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.value - a.entry.value || b.entry.iniBasis - a.entry.iniBasis || a.index - b.index)
    .map(({ entry }) => entry);
}

/** The subset of the roster that takes a turn this round, in turn order. */
export function activeTurnOrder<T extends InitiativeEntry>(entries: T[]): T[] {
  return initiativeOrder(entries.filter((e) => e.activeThisRound));
}

export interface NextTurnResult {
  turnIndex: number;
  /** true when advancing past the last combatant — the caller bumps the round and rerolls everyone instead of just moving the pointer. */
  wrapsRound: boolean;
}

/** Pure pointer math — the caller decides what a wrap actually DOES (reroll, tick, bump). */
export function nextTurn(turnIndex: number, activeCount: number): NextTurnResult {
  if (activeCount <= 0 || turnIndex + 1 >= activeCount) return { turnIndex: 0, wrapsRound: true };
  return { turnIndex: turnIndex + 1, wrapsRound: false };
}

/** Ticks every currently-active death countdown down by one; a countdown that isn't running is left alone. Called once per round wrap, never per turn. */
export function tickDeathCountdowns<T extends { tokenId: number; deathCountdown: number | null }>(
  entries: T[],
): { entries: T[]; died: number[] } {
  const died: number[] = [];
  const next = entries.map((entry) => {
    if (entry.deathCountdown == null) return entry;
    const deathCountdown = entry.deathCountdown - 1;
    if (deathCountdown <= 0) died.push(entry.tokenId);
    return { ...entry, deathCountdown };
  });
  return { entries: next, died };
}

/**
 * The Todesschwelle state machine: LP <= 0 with no counter running starts one
 * at the character's Todesschwelle; LP rising back above 0 clears it; any
 * other state (already dying, still healthy) is left unchanged — ticking is
 * tickDeathCountdowns's job, not this function's. Applied BEFORE the tick on
 * a round wrap, so a character who just dropped to/rose from 0 LP since the
 * last round is caught before the tick runs.
 */
export function deathCountdown(lp: number, todesschwelle: number, current: number | null): number | null {
  if (lp > 0) return null;
  if (current == null) return todesschwelle;
  return current;
}
