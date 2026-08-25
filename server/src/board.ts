// Virtual table (VTT) persistence — board load/create, tokens, and the full
// snapshot. See docs/concepts/virtual-table.md. Tiles/fog/overlays/images/
// initiative are still inert (Phases 6-11) — this phase is tokens only. The
// snapshot (and every token broadcast) carries NO per-viewer redaction yet:
// a `hidden` token goes out to every viewer including players. That
// structural piece (emitBoardChange) lands with fog of war (Phase 10), once
// there is something worth actually hiding rather than just marking.
import { db } from './db.js';
import { hasPortrait } from './characterData.js';

export interface BoardRow {
  id: number;
  groupId: number;
  cols: number;
  rows: number;
  tilesJson: string;
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

const BOARD_COLS = `id, group_id AS groupId, cols, rows, tiles_json AS tilesJson, fog_json AS fogJson,
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
  hidden: boolean;
  statuses: string[];
  cover: string;
  coverAsset: string | null;
  /** Computed here from the linked character, never stored on the row itself. */
  portrait: boolean;
  sort: number;
}

const TOKEN_COLS = `id, board_id AS boardId, kind, character_id AS characterId, owner_user_id AS ownerUserId,
  name, color, icon, x, y, size, hidden, statuses, cover, cover_asset AS coverAsset, sort`;

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

function loadTokens(boardId: number): BoardTokenRow[] {
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
}

/** Everything about a token except its position — see moveToken below for that. */
export function updateToken(tokenId: number, patch: TokenPatch): BoardTokenRow | undefined {
  const existing = getToken(tokenId);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE board_tokens SET name = ?, color = ?, icon = ?, hidden = ?, statuses = ?, cover = ?, size = ? WHERE id = ?`,
  ).run(next.name, next.color, next.icon, next.hidden ? 1 : 0, JSON.stringify(next.statuses), next.cover, next.size, tokenId);
  bumpRev(existing.boardId);
  return getToken(tokenId);
}

/**
 * Position only — deliberately its own statement (no rev bump, see ws.ts's
 * debounced writer): a drag fires many of these, and every persisted board
 * message already carries `rev` for gap detection, which a live position
 * isn't structural enough to need bumping for.
 */
export function moveToken(tokenId: number, x: number, y: number): void {
  db.prepare('UPDATE board_tokens SET x = ?, y = ? WHERE id = ?').run(x, y, tokenId);
}

export function deleteToken(tokenId: number): BoardTokenRow | undefined {
  const existing = getToken(tokenId);
  if (!existing) return undefined;
  db.prepare('DELETE FROM board_tokens WHERE id = ?').run(tokenId);
  bumpRev(existing.boardId);
  return existing;
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

function loadOverlays(boardId: number): BoardOverlayRow[] {
  const rows = db
    .prepare(`SELECT id, board_id AS boardId, kind, data_json AS dataJson, hidden FROM board_overlays WHERE board_id = ?`)
    .all(boardId) as { id: number; boardId: number; kind: string; dataJson: string; hidden: number }[];
  return rows.map((r) => ({ id: r.id, boardId: r.boardId, kind: r.kind, data: JSON.parse(r.dataJson || '{}'), hidden: !!r.hidden }));
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
 * The full board state for a room, unredacted. Fine for now because nothing
 * populates fog/hidden tokens/hidden images yet — the per-viewer redaction
 * this will need once painting and fog exist is a structural piece
 * (emitBoardChange, see the plan's "Realtime design"), not a filter to bolt
 * on here later.
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
