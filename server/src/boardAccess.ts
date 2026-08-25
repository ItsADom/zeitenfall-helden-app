// The one place virtual-table board rights are decided (docs/concepts/
// virtual-table.md, "Server module layout"). Each function reads the board's
// own perm_* setting: 'gm' -> only the Spielleitung, 'all' -> any room member
// (isRoomMember, same membership check REST/WS already use everywhere else).
// canEditFog is intentionally NOT here as a perm_*-driven function — it's
// hard-coded to viewer.isGm below, because a player able to lift fog defeats
// the point. There is no canSeeFog: once fog exists the mask itself is public,
// only its contents are redacted (Phase 10).
import type { BoardRow } from './board.js';
import { isRoomMember } from './routes.js';

export interface BoardViewer {
  userId: number;
  isGm: boolean;
}

function checkPerm(perm: string, viewer: BoardViewer, groupId: number): boolean {
  if (viewer.isGm) return true;
  if (perm === 'all') return isRoomMember(viewer.userId, groupId);
  return false;
}

export function canPaint(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permTiles, viewer, groupId);
}
export function canLabel(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permLabels, viewer, groupId);
}
/** Create/delete/edit a token (statuses, cover, hidden, name, color, icon, size) — everything except moving it, see canMoveToken. */
export function canEditTokens(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permTokens, viewer, groupId);
}
/** Only the position — settled default is 'all', so this stops being a code default and becomes a real setting. */
export function canMoveToken(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permMove, viewer, groupId);
}
export function canEditImages(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permImages, viewer, groupId);
}
export function canEditFog(viewer: BoardViewer): boolean {
  return viewer.isGm;
}
