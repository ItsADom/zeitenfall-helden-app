// Virtual table (VTT) persistence — board load/create, tokens, tiles/
// highlights/overlays/images, and per-viewer fog redaction. See
// docs/concepts/virtual-table.md, "Realtime design". Initiative is still
// inert (Phase 10 in the current plan numbering).
import { cellKey, decodeCellSet, encodeCellSet, overlayCell, tokenCells } from 'shared';
import type { LabelOverlayData } from 'shared';
import { db } from './db.js';
import { hasPortrait } from './characterData.js';

/**
 * Who's asking. The one thing every board access/redaction decision needs —
 * see boardAccess.ts (edit rights) and the redaction helpers below (fog/
 * hidden-token visibility). Owned here rather than in boardAccess.ts because
 * emitBoardChange-adjacent code (redactSnapshotForViewer et al.) needs it too
 * and boardAccess.ts already imports FROM board.ts, not the other way round.
 */
export interface BoardViewer {
  userId: number;
  isGm: boolean;
}

export interface BoardRow {
  id: number;
  groupId: number;
  cols: number;
  rows: number;
  tilesJson: string;
  highlightsJson: string;
  fogJson: string;
  seed: number;
  permTiles: string;
  permLabels: string;
  permTokens: string;
  permImages: string;
  permMove: string;
  round: number;
  turnIndex: number;
  rev: number;
  updatedAt: number;
}

const BOARD_COLS = `id, group_id AS groupId, cols, rows, tiles_json AS tilesJson, highlights_json AS highlightsJson, fog_json AS fogJson,
  seed, perm_tiles AS permTiles, perm_labels AS permLabels, perm_tokens AS permTokens,
  perm_images AS permImages, perm_move AS permMove, round, turn_index AS turnIndex, rev, updated_at AS updatedAt`;

/** One board per room — settled with the developer, enforced by a unique index on group_id. */
export function getBoard(groupId: number): BoardRow | undefined {
  return db.prepare(`SELECT ${BOARD_COLS} FROM boards WHERE group_id = ?`).get(groupId) as BoardRow | undefined;
}

export function getBoardById(boardId: number): BoardRow | undefined {
  return db.prepare(`SELECT ${BOARD_COLS} FROM boards WHERE id = ?`).get(boardId) as BoardRow | undefined;
}

/** Creates the room's board on first use — same idempotent-nachziehen shape as instantiateGroupTabs. */
export function getOrCreateBoard(groupId: number): BoardRow {
  const existing = getBoard(groupId);
  if (existing) return existing;
  db.prepare('INSERT INTO boards (group_id, updated_at) VALUES (?, ?)').run(groupId, Date.now());
  return getBoard(groupId)!;
}

export interface BoardTokenRow {
  id: number;
  boardId: number;
  kind: string;
  characterId: number | null;
  ownerUserId: number | null;
  name: string;
  color: string;
  icon: string;
  x: number;
  y: number;
  size: number;
  /** Range ring around the token, in Schritt — 0 = none. See the column comment in db.ts. */
  radius: number;
  /** Ring colour+opacity, #rrggbb(aa) — independent of `color` (the token itself). */
  radiusColor: string;
  hidden: boolean;
  statuses: string[];
  cover: string;
  coverAsset: string | null;
  /** Computed here from the linked character, never stored on the row itself. */
  portrait: boolean;
  sort: number;
}

const TOKEN_COLS = `id, board_id AS boardId, kind, character_id AS characterId, owner_user_id AS ownerUserId,
  name, color, icon, x, y, size, radius, radius_color AS radiusColor, hidden, statuses, cover, cover_asset AS coverAsset, sort`;

function toToken(
  r: Omit<BoardTokenRow, 'hidden' | 'statuses' | 'portrait'> & { hidden: number; statuses: string },
): BoardTokenRow {
  return {
    ...r,
    hidden: !!r.hidden,
    statuses: JSON.parse(r.statuses || '[]'),
    portrait: r.characterId != null && hasPortrait(r.characterId),
  };
}

export function loadTokens(boardId: number): BoardTokenRow[] {
  const rows = db.prepare(`SELECT ${TOKEN_COLS} FROM board_tokens WHERE board_id = ? ORDER BY sort, id`).all(boardId) as Parameters<
    typeof toToken
  >[0][];
  return rows.map(toToken);
}

export function getToken(tokenId: number): BoardTokenRow | undefined {
  const row = db.prepare(`SELECT ${TOKEN_COLS} FROM board_tokens WHERE id = ?`).get(tokenId) as Parameters<typeof toToken>[0] | undefined;
  return row && toToken(row);
}

function bumpRev(boardId: number): void {
  db.prepare('UPDATE boards SET rev = rev + 1, updated_at = ? WHERE id = ?').run(Date.now(), boardId);
}

export interface CreateTokenInput {
  kind: 'character' | 'marker';
  characterId: number | null;
  ownerUserId: number | null;
  name: string;
  color: string;
  icon: string;
  x: number;
  y: number;
  size: number;
}

export function createToken(boardId: number, input: CreateTokenInput): BoardTokenRow {
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM board_tokens WHERE board_id = ?').get(boardId) as { n: number })
    .n;
  const info = db
    .prepare(
      `INSERT INTO board_tokens (board_id, kind, character_id, owner_user_id, name, color, icon, x, y, size, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(boardId, input.kind, input.characterId, input.ownerUserId, input.name, input.color, input.icon, input.x, input.y, input.size, sort);
  bumpRev(boardId);
  return getToken(info.lastInsertRowid as number)!;
}

export interface TokenPatch {
  name?: string;
  color?: string;
  icon?: string;
  hidden?: boolean;
  statuses?: string[];
  cover?: string;
  size?: number;
  radius?: number;
  radiusColor?: string;
}

/** Everything about a token except its position — see moveToken below for that. */
export function updateToken(tokenId: number, patch: TokenPatch): BoardTokenRow | undefined {
  const existing = getToken(tokenId);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE board_tokens SET name = ?, color = ?, icon = ?, hidden = ?, statuses = ?, cover = ?, size = ?, radius = ?, radius_color = ? WHERE id = ?`,
  ).run(
    next.name,
    next.color,
    next.icon,
    next.hidden ? 1 : 0,
    JSON.stringify(next.statuses),
    next.cover,
    next.size,
    next.radius,
    next.radiusColor,
    tokenId,
  );
  bumpRev(existing.boardId);
  return getToken(tokenId);
}

/**
 * Position only, called once per drag (the client renders the whole drag
 * locally and sends just the dropped-at position — see VirtualTable.tsx) —
 * cheap enough to bump `rev` like every other persisted board mutation.
 * `boardId` comes from the caller's own lookup of the token (ws.ts already
 * has it for the rights check) rather than a second query here.
 */
export function moveToken(tokenId: number, boardId: number, x: number, y: number): void {
  db.prepare('UPDATE board_tokens SET x = ?, y = ? WHERE id = ?').run(x, y, tokenId);
  bumpRev(boardId);
}

export function deleteToken(tokenId: number): BoardTokenRow | undefined {
  const existing = getToken(tokenId);
  if (!existing) return undefined;
  db.prepare('DELETE FROM board_tokens WHERE id = ?').run(tokenId);
  bumpRev(existing.boardId);
  return existing;
}

/**
 * Merges a delta into `tiles_json` — never a whole-map replace (see the
 * plan's "Tile and fog writes are deltas" — once fog exists, a player's tile
 * map already has the fogged cells stripped out, so accepting a full save
 * from them would erase what the GM painted underneath). `value === ''`
 * erases that cell back to unpainted (deletes the key) rather than storing
 * an empty string, so the sparse map stays sparse.
 */
export function paintTiles(boardId: number, cells: Record<string, string>): void {
  const board = getBoardById(boardId)!;
  const tiles = JSON.parse(board.tilesJson || '{}') as Record<string, string>;
  for (const [key, value] of Object.entries(cells)) {
    if (value === '') delete tiles[key];
    else tiles[key] = value;
  }
  db.prepare('UPDATE boards SET tiles_json = ? WHERE id = ?').run(JSON.stringify(tiles), boardId);
  bumpRev(boardId);
}

/**
 * Same delta-merge as paintTiles, but for `highlights_json` — a separate
 * layer (GM tinting, see the column comment in db.ts) so erasing a highlight
 * never touches the tile underneath.
 */
export function paintHighlights(boardId: number, cells: Record<string, string>): void {
  const board = getBoardById(boardId)!;
  const highlights = JSON.parse(board.highlightsJson || '{}') as Record<string, string>;
  for (const [key, value] of Object.entries(cells)) {
    if (value === '') delete highlights[key];
    else highlights[key] = value;
  }
  db.prepare('UPDATE boards SET highlights_json = ? WHERE id = ?').run(JSON.stringify(highlights), boardId);
  bumpRev(boardId);
}

// --- Fog of war — per-viewer redaction ------------------------------------
//
// The guarantee: a player's client never receives hidden tile/token/label
// state. The GM always sees everything (checked first in every helper
// below). There is no per-player fog — one board has one mask, shared by
// every non-GM viewer alike, so redaction only ever branches on
// `viewer.isGm`, never on WHICH player.

export function fogSet(board: BoardRow): Set<string> {
  return decodeCellSet(JSON.parse(board.fogJson || '[]') as string[]);
}

/** Drops any key present in `fog` — the tile/highlight redaction for every non-GM payload. GM sees everything unfiltered. */
export function redactCells(cells: Record<string, string>, fog: Set<string>, viewer: BoardViewer): Record<string, string> {
  if (viewer.isGm || fog.size === 0) return cells;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cells)) {
    if (!fog.has(key)) out[key] = value;
  }
  return out;
}

/** Invisible to a non-GM viewer if flagged `hidden`, or if any cell it occupies is fogged. */
export function tokenVisibleTo(token: BoardTokenRow, fog: Set<string>, viewer: BoardViewer): boolean {
  if (viewer.isGm) return true;
  if (token.hidden) return false;
  return !tokenCells(token).some((c) => fog.has(cellKey(c.x, c.y)));
}

/**
 * Invisible to a non-GM viewer if the cell it sits on is fogged — this is
 * the "GM plans maps secretly" case: a text label has no `hidden` flag of
 * its own (unlike a token), fog IS the only way to keep one from players.
 */
export function labelVisibleTo(data: LabelOverlayData, fog: Set<string>, viewer: BoardViewer): boolean {
  if (viewer.isGm) return true;
  const cell = overlayCell(data);
  return !fog.has(cellKey(cell.x, cell.y));
}

/** Measure shapes are NOT redacted by fog — settled with the developer: they're an in-play tool, not a secret-planning annotation like a label. */
export function overlayVisibleTo(overlay: BoardOverlayRow, fog: Set<string>, viewer: BoardViewer): boolean {
  if (overlay.kind !== 'label') return true;
  return labelVisibleTo(overlay.data as LabelOverlayData, fog, viewer);
}

export function redactImages(images: BoardImageRow[], viewer: BoardViewer): BoardImageRow[] {
  if (viewer.isGm) return images;
  return images.filter((i) => !i.hidden);
}

/**
 * The full board state, redacted for one viewer — used by the REST snapshot
 * (initial load, and every reconnect refetch on a `rev` gap, per the plan).
 * GM gets the input back untouched.
 */
export function redactSnapshotForViewer(snapshot: BoardSnapshot, viewer: BoardViewer): BoardSnapshot {
  if (viewer.isGm) return snapshot;
  const fog = fogSet(snapshot.board);
  const tiles = redactCells(JSON.parse(snapshot.board.tilesJson || '{}') as Record<string, string>, fog, viewer);
  const highlights = redactCells(JSON.parse(snapshot.board.highlightsJson || '{}') as Record<string, string>, fog, viewer);
  return {
    ...snapshot,
    board: { ...snapshot.board, tilesJson: JSON.stringify(tiles), highlightsJson: JSON.stringify(highlights) },
    tokens: snapshot.tokens.filter((t) => tokenVisibleTo(t, fog, viewer)),
    overlays: snapshot.overlays.filter((o) => overlayVisibleTo(o, fog, viewer)),
    images: redactImages(snapshot.images, viewer),
  };
}

export interface SetFogResult {
  board: BoardRow;
  /** Cell keys that flipped from fogged to clear — ws.ts uses this to push players the tiles/tokens/labels newly uncovered there. */
  revealedCells: string[];
  /** Cell keys that flipped from clear to fogged — ws.ts uses this to tell players about tokens/labels that just vanished from view. */
  hiddenCells: string[];
}

/**
 * Merges a fog delta — `true` hides a cell, `false` reveals it — never a
 * whole-mask replace, same "deltas only" reasoning as paintTiles. Only keys
 * that actually CHANGE state end up in revealedCells/hiddenCells: re-hiding
 * an already-fogged cell is a no-op, not a re-reveal.
 */
export function setFog(boardId: number, delta: Record<string, boolean>): SetFogResult {
  const board = getBoardById(boardId)!;
  const fog = fogSet(board);
  const revealedCells: string[] = [];
  const hiddenCells: string[] = [];
  for (const [key, wantHidden] of Object.entries(delta)) {
    const wasHidden = fog.has(key);
    if (wantHidden && !wasHidden) {
      fog.add(key);
      hiddenCells.push(key);
    } else if (!wantHidden && wasHidden) {
      fog.delete(key);
      revealedCells.push(key);
    }
  }
  db.prepare('UPDATE boards SET fog_json = ? WHERE id = ?').run(JSON.stringify(encodeCellSet(fog)), boardId);
  bumpRev(boardId);
  return { board: getBoardById(boardId)!, revealedCells, hiddenCells };
}

export type BoardSettingsPatch = Partial<
  Pick<BoardRow, 'permTiles' | 'permLabels' | 'permTokens' | 'permImages' | 'permMove'>
>;

export function updateBoardSettings(boardId: number, patch: BoardSettingsPatch): BoardRow {
  const current = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as Record<string, unknown>;
  const next = {
    permTiles: patch.permTiles ?? (current.perm_tiles as string),
    permLabels: patch.permLabels ?? (current.perm_labels as string),
    permTokens: patch.permTokens ?? (current.perm_tokens as string),
    permImages: patch.permImages ?? (current.perm_images as string),
    permMove: patch.permMove ?? (current.perm_move as string),
  };
  db.prepare('UPDATE boards SET perm_tiles = ?, perm_labels = ?, perm_tokens = ?, perm_images = ?, perm_move = ? WHERE id = ?').run(
    next.permTiles,
    next.permLabels,
    next.permTokens,
    next.permImages,
    next.permMove,
    boardId,
  );
  bumpRev(boardId);
  return getBoardById(boardId)!;
}

export interface BoardOverlayRow {
  id: number;
  boardId: number;
  kind: string;
  data: unknown;
  hidden: boolean;
}

export function loadOverlays(boardId: number): BoardOverlayRow[] {
  const rows = db
    .prepare(`SELECT id, board_id AS boardId, kind, data_json AS dataJson, hidden FROM board_overlays WHERE board_id = ?`)
    .all(boardId) as { id: number; boardId: number; kind: string; dataJson: string; hidden: number }[];
  return rows.map((r) => ({ id: r.id, boardId: r.boardId, kind: r.kind, data: JSON.parse(r.dataJson || '{}'), hidden: !!r.hidden }));
}

export function getOverlay(overlayId: number): BoardOverlayRow | undefined {
  const row = db
    .prepare(`SELECT id, board_id AS boardId, kind, data_json AS dataJson, hidden FROM board_overlays WHERE id = ?`)
    .get(overlayId) as { id: number; boardId: number; kind: string; dataJson: string; hidden: number } | undefined;
  return row && { id: row.id, boardId: row.boardId, kind: row.kind, data: JSON.parse(row.dataJson || '{}'), hidden: !!row.hidden };
}

/** `data` is stored as-is — the caller (ws.ts) already validated its shape for `kind`. */
export function createOverlay(boardId: number, kind: string, data: unknown): BoardOverlayRow {
  const info = db
    .prepare(`INSERT INTO board_overlays (board_id, kind, data_json) VALUES (?, ?, ?)`)
    .run(boardId, kind, JSON.stringify(data));
  bumpRev(boardId);
  return getOverlay(info.lastInsertRowid as number)!;
}

/** Shallow-merges `patch` into the stored data — same shape as updateToken's patch. */
export function updateOverlay(overlayId: number, patch: Record<string, unknown>): BoardOverlayRow | undefined {
  const existing = getOverlay(overlayId);
  if (!existing) return undefined;
  const nextData = { ...(existing.data as Record<string, unknown>), ...patch };
  db.prepare(`UPDATE board_overlays SET data_json = ? WHERE id = ?`).run(JSON.stringify(nextData), overlayId);
  bumpRev(existing.boardId);
  return getOverlay(overlayId);
}

export function deleteOverlay(overlayId: number): BoardOverlayRow | undefined {
  const existing = getOverlay(overlayId);
  if (!existing) return undefined;
  db.prepare('DELETE FROM board_overlays WHERE id = ?').run(overlayId);
  bumpRev(existing.boardId);
  return existing;
}

export interface BoardImageRow {
  id: number;
  boardId: number;
  assetSlug: string;
  modus: 'objekt' | 'hintergrund';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  z: number;
  hidden: boolean;
}

function loadImages(boardId: number): BoardImageRow[] {
  const rows = db
    .prepare(
      `SELECT id, board_id AS boardId, asset_slug AS assetSlug, modus, x, y, w, h, rotation, opacity, z, hidden
       FROM board_images WHERE board_id = ? ORDER BY z, id`,
    )
    .all(boardId) as (Omit<BoardImageRow, 'hidden'> & { hidden: number })[];
  return rows.map((r) => ({ ...r, hidden: !!r.hidden }));
}

export interface BoardInitiativeRow {
  id: number;
  boardId: number;
  tokenId: number;
  value: number;
  rolled: boolean;
  done: boolean;
  deathCountdown: number | null;
}

function loadInitiative(boardId: number): BoardInitiativeRow[] {
  const rows = db
    .prepare(
      `SELECT id, board_id AS boardId, token_id AS tokenId, value, rolled, done, death_countdown AS deathCountdown
       FROM board_initiative WHERE board_id = ?`,
    )
    .all(boardId) as (Omit<BoardInitiativeRow, 'rolled' | 'done'> & { rolled: number; done: number })[];
  return rows.map((r) => ({ ...r, rolled: !!r.rolled, done: !!r.done }));
}

export interface BoardSnapshot {
  board: BoardRow;
  tokens: BoardTokenRow[];
  overlays: BoardOverlayRow[];
  images: BoardImageRow[];
  initiative: BoardInitiativeRow[];
}

/**
 * The full board state for a room, UNREDACTED — callers must run this
 * through redactSnapshotForViewer() before it reaches anyone but the GM (see
 * routes.ts's `/board` handler). Kept separate from redaction rather than
 * taking a viewer here, so `loadBoardSnapshot` stays the one place that
 * reads the DB and `redactSnapshotForViewer` stays pure and independently
 * testable.
 */
export function loadBoardSnapshot(groupId: number): BoardSnapshot {
  const board = getOrCreateBoard(groupId);
  return {
    board,
    tokens: loadTokens(board.id),
    overlays: loadOverlays(board.id),
    images: loadImages(board.id),
    initiative: loadInitiative(board.id),
  };
}
