// Virtual table (VTT) persistence — board load/create, tokens, tiles/
// highlights/overlays/images, initiative/rounds, and per-viewer fog
// redaction. See docs/concepts/virtual-table.md, "Realtime design".
import {
  activeTurnOrder as activeTurnOrderPure,
  cellKey,
  computeBaseValues,
  decodeCellSet,
  deathCountdown as deathCountdownFor,
  encodeCellSet,
  initiativeOrder,
  nextTurn as nextTurnPure,
  overlayCell,
  tickDeathCountdowns as tickDeathCountdownsPure,
  tokenCells,
} from 'shared';
import type { LabelOverlayData } from 'shared';
import { db } from './db.js';
import { rollDie } from './dice.js';
import { hasPortrait, loadAttributes, loadBaseValueInputs, loadResources } from './characterData.js';

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
  const visibleTokenIds = new Set(snapshot.tokens.filter((t) => tokenVisibleTo(t, fog, viewer)).map((t) => t.id));
  return {
    ...snapshot,
    board: { ...snapshot.board, tilesJson: JSON.stringify(tiles), highlightsJson: JSON.stringify(highlights) },
    tokens: snapshot.tokens.filter((t) => visibleTokenIds.has(t.id)),
    overlays: snapshot.overlays.filter((o) => overlayVisibleTo(o, fog, viewer)),
    images: redactImages(snapshot.images, viewer),
    // Same guarantee as the token itself: an entry for a hidden-or-fogged
    // token must not reach a player, or its presence in the roster alone
    // would leak that the GM has that token in the fight.
    initiative: snapshot.initiative.filter((i) => visibleTokenIds.has(i.tokenId)),
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
  iniBasis: number;
  value: number;
  activeThisRound: boolean;
  roundOrder: number;
  rolledThisRound: boolean;
  deathCountdown: number | null;
}

const INITIATIVE_COLS = `id, board_id AS boardId, token_id AS tokenId, ini_basis AS iniBasis, value, active_this_round AS activeThisRound, round_order AS roundOrder, rolled_this_round AS rolledThisRound, death_countdown AS deathCountdown`;

function toInitiative(
  r: Omit<BoardInitiativeRow, 'activeThisRound' | 'rolledThisRound'> & { activeThisRound: number; rolledThisRound: number },
): BoardInitiativeRow {
  return { ...r, activeThisRound: !!r.activeThisRound, rolledThisRound: !!r.rolledThisRound };
}

export function loadInitiative(boardId: number): BoardInitiativeRow[] {
  const rows = db.prepare(`SELECT ${INITIATIVE_COLS} FROM board_initiative WHERE board_id = ?`).all(boardId) as Parameters<
    typeof toInitiative
  >[0][];
  return rows.map(toInitiative);
}

export function getInitiativeEntry(tokenId: number): BoardInitiativeRow | undefined {
  const row = db.prepare(`SELECT ${INITIATIVE_COLS} FROM board_initiative WHERE token_id = ?`).get(tokenId) as
    | Parameters<typeof toInitiative>[0]
    | undefined;
  return row && toInitiative(row);
}

/**
 * Attributes/resources/base values, straight from the character's own
 * sheet — never trust a client-supplied Initiative-Basis or LP. `lp` is the
 * `aktuell` field as typed on the sheet, same as `overviewForChars` in
 * characterData.ts reads it for the GM roster (not the capped/derived
 * `nutzbar`, which is a maximum, not a current value).
 */
function characterCombatStats(characterId: number): { iniBasis: number; lp: number; todesschwelle: number } {
  const attrs = loadAttributes(characterId);
  const baseValues = computeBaseValues(attrs, loadBaseValueInputs(characterId));
  const resources = loadResources(characterId);
  return { iniBasis: baseValues.ini.ergebnis, lp: resources.le.aktuell, todesschwelle: baseValues.todesschwelle.ergebnis };
}

/** A character's basis always comes live from its sheet; a marker/monster's is whatever the GM last typed via setInitiativeBasis. */
function iniBasisFor(token: BoardTokenRow, storedBasis: number): number {
  return token.characterId != null ? characterCombatStats(token.characterId).iniBasis : storedBasis;
}

/**
 * Rolls 1W6 per participant and resolves ties per the developer's rule: a
 * tied VALUE is broken by the higher basis (that's just sort order, handled
 * by initiativeOrder() — nothing to do here), but a tie in BOTH value and
 * basis is genuinely ambiguous, so exactly that subset rerolls together,
 * repeating until every value+basis pair in the whole group is unique. Two
 * participants with different bases can never collide into the same tied
 * group this way (their key differs by construction), so only the original
 * tied subset ever needs to be rechecked — not the whole roster.
 */
function rollResolvingTies(participants: { tokenId: number; basis: number }[]): Map<number, number> {
  const values = new Map<number, number>();
  for (const p of participants) values.set(p.tokenId, p.basis + rollDie(6));
  let pending = participants;
  while (true) {
    const groups = new Map<string, typeof participants>();
    for (const p of pending) {
      const key = `${values.get(p.tokenId)}:${p.basis}`;
      const group = groups.get(key);
      if (group) group.push(p);
      else groups.set(key, [p]);
    }
    const tied = [...groups.values()].filter((g) => g.length > 1).flat();
    if (tied.length === 0) break;
    for (const p of tied) values.set(p.tokenId, p.basis + rollDie(6));
    pending = tied;
  }
  return values;
}

/**
 * Adds a token to the roster. Before the first roll (round === 0) this is
 * always unrolled and simply waits for startCombat — `mode` is ignored, the
 * Normal/Überraschung choice is meaningless before there's a round in
 * progress to insert into. Mid-combat (round > 0), the GM's rule applies
 * immediately (see the module comment on InitiativeEntry in
 * shared/src/board.ts):
 *   - 'normal' (default): queued to act LAST this round — `round_order`
 *     past everyone currently active.
 *   - 'surprise': inserted to act NEXT, right now — `round_order` right
 *     after whoever is CURRENTLY acting, and every entry from there on
 *     shifts one slot later to make room. The interrupted combatant's turn
 *     is lost outright for this round, not resumed after (confirmed with
 *     the developer) — its `round_order` is unchanged, so it now simply
 *     sits before the new `turn_index`, i.e. "already gone".
 * Either way `value` stays 0 and `rolled_this_round` stays false — no roll
 * happens until the next mass reroll folds the entry into normal rotation.
 */
export function addInitiativeEntry(boardId: number, token: BoardTokenRow, mode: 'normal' | 'surprise' = 'normal'): BoardInitiativeRow {
  const existing = getInitiativeEntry(token.id);
  if (existing) return existing;
  const board = getBoardById(boardId)!;
  if (board.round <= 0) {
    db.prepare('INSERT INTO board_initiative (board_id, token_id) VALUES (?, ?)').run(boardId, token.id);
    bumpRev(boardId);
    return getInitiativeEntry(token.id)!;
  }
  const stats = token.characterId != null ? characterCombatStats(token.characterId) : null;
  const iniBasis = stats ? stats.iniBasis : 0;
  const deathCountdown = stats ? deathCountdownFor(stats.lp, stats.todesschwelle, null) : null;
  const active = activeTurnOrderPure(loadInitiative(boardId));
  const surprise = mode === 'surprise' && active.length > 0;
  let roundOrder: number;
  if (surprise) {
    const currentIdx = Math.min(board.turnIndex, active.length - 1);
    // Renumber densely FIRST, matching activeTurnOrder's own (tie-broken)
    // sort — comparing raw round_order values directly would misplace the
    // insert whenever two entries are still tied (e.g. legacy rows that
    // haven't rerolled since the round_order column was added, both
    // defaulting to 0): activeTurnOrder breaks that tie by original array
    // index, which a plain `round_order > current.roundOrder` doesn't know
    // about, so the wrong entry could end up "shifted" and the new one land
    // in the wrong slot. Once every position is a distinct 0..N-1 rank,
    // "shift everything after the current index" is unambiguous.
    const renumber = db.prepare('UPDATE board_initiative SET round_order = ? WHERE id = ?');
    active.forEach((e, i) => renumber.run(i, e.id));
    db.prepare('UPDATE board_initiative SET round_order = round_order + 1 WHERE board_id = ? AND active_this_round = 1 AND round_order > ?').run(
      boardId,
      currentIdx,
    );
    roundOrder = currentIdx + 1;
  } else {
    roundOrder = active.length > 0 ? Math.max(...active.map((e) => e.roundOrder)) + 1 : 0;
  }
  db.prepare(
    'INSERT INTO board_initiative (board_id, token_id, ini_basis, value, active_this_round, round_order, rolled_this_round, death_countdown) VALUES (?, ?, ?, 0, 1, ?, 0, ?)',
  ).run(boardId, token.id, iniBasis, roundOrder, deathCountdown);
  if (surprise) {
    // The new entry takes over as "current" the moment it slots in right
    // after the old one — see the derivation in the module comment.
    db.prepare('UPDATE boards SET turn_index = turn_index + 1, rev = rev + 1, updated_at = ? WHERE id = ?').run(Date.now(), boardId);
  } else {
    bumpRev(boardId);
  }
  // A surprise insert can itself land the pointer on a hidden token (the
  // ambusher IS the hidden monster) — same silent skip advanceTurn does, so
  // the insert never needs its own separate "now click Next" just to hide it.
  for (let guard = 0; guard < 200 && currentTurnHiddenFromPlayers(boardId); guard++) stepTurn(boardId);
  return getInitiativeEntry(token.id)!;
}

/**
 * Removing an ACTIVE combatant mid-round can leave `turn_index` pointing past
 * the (now shorter) active order — clamped here rather than left to point at
 * nothing. This does not try to preserve exactly whose turn it logically
 * still is (the small-table, self-correcting philosophy this codebase
 * already applies to drag conflicts) — the GM sorts out fairness by eye.
 */
export function removeInitiativeEntry(boardId: number, tokenId: number): void {
  db.prepare('DELETE FROM board_initiative WHERE token_id = ?').run(tokenId);
  const board = getBoardById(boardId)!;
  if (board.round > 0) {
    const activeCount = loadInitiative(boardId).filter((e) => e.activeThisRound).length;
    if (board.turnIndex >= activeCount) {
      db.prepare('UPDATE boards SET turn_index = ? WHERE id = ?').run(Math.max(0, activeCount - 1), boardId);
    }
  }
  bumpRev(boardId);
}

/** Marker/monster only in practice — harmless no-op on a character entry, since iniBasisFor() ignores the stored column for those. */
export function setInitiativeBasis(boardId: number, tokenId: number, basis: number): BoardInitiativeRow | undefined {
  db.prepare('UPDATE board_initiative SET ini_basis = ? WHERE token_id = ?').run(basis, tokenId);
  bumpRev(boardId);
  return getInitiativeEntry(tokenId);
}

export interface InitiativeRoundState {
  round: number;
  turnIndex: number;
  entries: BoardInitiativeRow[];
}

/**
 * The roll shared by startCombat and every round wrap in advanceTurn: basis +
 * a fresh 1W6 for everyone currently in the roster, ranked (value desc, then
 * basis, see initiativeOrder) into a fresh `round_order` — the field
 * activeTurnOrder actually sorts by (see the module comment on
 * InitiativeEntry in shared/src/board.ts). Also where `rolled_this_round`
 * goes back to true and any leftover Normal/Überraschung insert from the
 * round just ending folds into normal rotation, per the GM's rule ("ab
 * nächster Runde normal weiter") — nothing about a mid-round insert survives
 * past this point except its `iniBasis` and `deathCountdown`, same as any
 * other entry. `tick` runs the Todesschwelle countdown first — true on every
 * ROUND WRAP, false on the very first roll (startCombat), where there is
 * nothing yet to tick.
 */
function rollRoster(entries: BoardInitiativeRow[], tokensById: Map<number, BoardTokenRow>, tick: boolean): void {
  let rolling = entries;
  if (tick) {
    // A countdown that STARTS this wrap must not also be ticked this same
    // wrap — otherwise a fresh Todesschwelle of e.g. 4 would show 3 on the
    // very round it started, quietly shaving one round off (caught by the
    // developer testing Rina: a Todesschwelle of 4 has to mean 4 full rounds
    // downed — values 4,3,2,1 — before the tick that reaches 0 kills her, not
    // 3,2,1,0). So only entries already running BEFORE this wrap get ticked;
    // one freshly started here keeps its starting value untouched, and one
    // that just cleared (LP rose above 0) has nothing to tick anyway.
    const wasActive = new Set(entries.filter((e) => e.deathCountdown != null).map((e) => e.tokenId));
    const preStarted = entries.map((e) => {
      const token = tokensById.get(e.tokenId);
      if (!token || token.characterId == null) return e;
      const stats = characterCombatStats(token.characterId);
      return { ...e, deathCountdown: deathCountdownFor(stats.lp, stats.todesschwelle, e.deathCountdown) };
    });
    const tickedRaw = tickDeathCountdownsPure(preStarted);
    rolling = tickedRaw.entries.map((e, i) => (wasActive.has(e.tokenId) ? e : preStarted[i]));
  }
  const bases = new Map(rolling.map((e) => [e.tokenId, iniBasisFor(tokensById.get(e.tokenId)!, e.iniBasis)]));
  const values = rollResolvingTies(rolling.map((e) => ({ tokenId: e.tokenId, basis: bases.get(e.tokenId)! })));
  const ranked = initiativeOrder(rolling.map((e) => ({ tokenId: e.tokenId, value: values.get(e.tokenId)!, iniBasis: bases.get(e.tokenId)! })));
  const roundOrderByToken = new Map(ranked.map((e, i) => [e.tokenId, i]));
  const upd = db.prepare(
    'UPDATE board_initiative SET ini_basis = ?, value = ?, active_this_round = 1, round_order = ?, rolled_this_round = 1, death_countdown = ? WHERE id = ?',
  );
  for (const e of rolling) {
    const token = tokensById.get(e.tokenId);
    if (!token) continue;
    upd.run(bases.get(e.tokenId), values.get(e.tokenId), roundOrderByToken.get(e.tokenId), e.deathCountdown, e.id);
  }
}

/**
 * Rolls everyone currently in the roster and begins round 1 — the caller
 * (ws.ts) has already checked the roster isn't empty and that combat isn't
 * already running (round === 0).
 */
export function startCombat(boardId: number): InitiativeRoundState {
  const tokensById = new Map(loadTokens(boardId).map((t) => [t.id, t]));
  rollRoster(loadInitiative(boardId), tokensById, false);
  db.prepare('UPDATE boards SET round = 1, turn_index = 0, rev = rev + 1, updated_at = ? WHERE id = ?').run(Date.now(), boardId);
  return { round: 1, turnIndex: 0, entries: loadInitiative(boardId) };
}

/** Full reset — deletes the whole roster and zeroes round/turn. The next startCombat begins fresh, never resumes. */
export function endCombat(boardId: number): InitiativeRoundState {
  db.prepare('DELETE FROM board_initiative WHERE board_id = ?').run(boardId);
  db.prepare('UPDATE boards SET round = 0, turn_index = 0, rev = rev + 1, updated_at = ? WHERE id = ?').run(Date.now(), boardId);
  return { round: 0, turnIndex: 0, entries: [] };
}

/**
 * Bumps the turn pointer one step; past the last combatant in the CURRENT
 * round's active order this instead bumps the round — rerolling the whole
 * roster (rollRoster) rather than just moving the index. Pure DB mutation;
 * callers re-read whatever state they need afterward.
 */
function stepTurn(boardId: number): void {
  const board = getBoardById(boardId)!;
  const entries = loadInitiative(boardId);
  const activeCount = activeTurnOrderPure(entries).length;
  const next = nextTurnPure(board.turnIndex, activeCount);
  if (!next.wrapsRound) {
    db.prepare('UPDATE boards SET turn_index = ?, rev = rev + 1, updated_at = ? WHERE id = ?').run(next.turnIndex, Date.now(), boardId);
    return;
  }
  const tokensById = new Map(loadTokens(boardId).map((t) => [t.id, t]));
  rollRoster(entries, tokensById, true);
  db.prepare('UPDATE boards SET round = round + 1, turn_index = 0, rev = rev + 1, updated_at = ? WHERE id = ?').run(Date.now(), boardId);
}

/**
 * True while the CURRENT combatant is a token invisible to players (hidden,
 * or standing on a fogged cell — the fog design has no per-player fog, so
 * this is a single board-wide check, not per-viewer). Used to keep the
 * round pointer from ever visibly stalling on one (developer feedback — a
 * pause where nothing changes on a player's screen is itself a tell that
 * something is happening off-screen).
 */
function currentTurnHiddenFromPlayers(boardId: number): boolean {
  const board = getBoardById(boardId)!;
  const active = activeTurnOrderPure(loadInitiative(boardId));
  if (active.length === 0) return false;
  const current = active[Math.min(board.turnIndex, active.length - 1)];
  const token = getToken(current.tokenId);
  if (!token) return false;
  return !tokenVisibleTo(token, fogSet(board), { isGm: false, userId: 0 });
}

/**
 * Advances the turn pointer, then keeps advancing — silently, no further
 * client message needed — past anyone hidden from players. Capped so an
 * all-hidden roster (every combatant a secret monster) can't loop forever;
 * whoever it lands on after that many steps is simply left as current. The
 * caller (ws.ts) has already checked round > 0 and rights on the current
 * combatant.
 */
export function advanceTurn(boardId: number): InitiativeRoundState {
  stepTurn(boardId);
  for (let guard = 0; guard < 200 && currentTurnHiddenFromPlayers(boardId); guard++) stepTurn(boardId);
  const board = getBoardById(boardId)!;
  return { round: board.round, turnIndex: board.turnIndex, entries: loadInitiative(boardId) };
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
