// Virtual table (VTT) persistence — board load/create and the full snapshot.
// See docs/concepts/virtual-table.md. This phase is inert: nothing writes to
// these tables yet (no painting, no tokens), and the snapshot carries no
// per-viewer redaction — that structural piece (emitBoardChange) lands with
// fog of war, once there is something worth hiding.
import { db } from './db.js';

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
  sort: number;
}

function loadTokens(boardId: number): BoardTokenRow[] {
  const rows = db
    .prepare(
      `SELECT id, board_id AS boardId, kind, character_id AS characterId, owner_user_id AS ownerUserId,
         name, color, icon, x, y, size, hidden, statuses, cover, cover_asset AS coverAsset, sort
       FROM board_tokens WHERE board_id = ? ORDER BY sort, id`,
    )
    .all(boardId) as (Omit<BoardTokenRow, 'hidden' | 'statuses'> & { hidden: number; statuses: string })[];
  return rows.map((r) => ({ ...r, hidden: !!r.hidden, statuses: JSON.parse(r.statuses || '[]') }));
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
