// The one place virtual-table board rights are decided (docs/concepts/
// virtual-table.md, "Server module layout"). Each function reads the board's
// own perm_* setting: 'gm' -> only the Spielleitung, 'all' -> any room member
// (isRoomMember, same membership check REST/WS already use everywhere else).
// canEditFog is intentionally NOT here as a perm_*-driven function — it's
// hard-coded to viewer.isGm below, because a player able to lift fog defeats
// the point. There is no canSeeFog: once fog exists the mask itself is public,
// only its contents are redacted (Phase 10).
import type { BoardRow, BoardViewer } from './board.js';
import { isRoomMember } from './routes.js';

export type { BoardViewer };

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
/**
 * Create/delete/edit a token (statuses, cover, hidden, name, color, icon,
 * size) — everything except moving it, see canMoveToken. `ownerUserId` is the
 * EXISTING token's owner (undefined at creation time, when there's no token
 * yet to own) — a player always has full control of their own character's
 * token regardless of `perm_tokens`, the same as the GM always does. This is
 * `board_tokens.owner_user_id`'s reason for existing (see its schema comment).
 */
export function canEditTokens(board: BoardRow, viewer: BoardViewer, groupId: number, ownerUserId?: number | null): boolean {
  if (ownerUserId != null && ownerUserId === viewer.userId) return true;
  return checkPerm(board.permTokens, viewer, groupId);
}
/** Only the position — settled default is 'all', so this stops being a code default and becomes a real setting. Same owner bypass as canEditTokens. */
export function canMoveToken(board: BoardRow, viewer: BoardViewer, groupId: number, ownerUserId?: number | null): boolean {
  if (ownerUserId != null && ownerUserId === viewer.userId) return true;
  return checkPerm(board.permMove, viewer, groupId);
}
export function canEditImages(board: BoardRow, viewer: BoardViewer, groupId: number): boolean {
  return checkPerm(board.permImages, viewer, groupId);
}
export function canEditFog(viewer: BoardViewer): boolean {
  return viewer.isGm;
}
/** Same hard-coded shape as canEditFog — tinting is a GM annotation tool, not a settable perm_*. */
export function canHighlightTiles(viewer: BoardViewer): boolean {
  return viewer.isGm;
}
/** Measuring is always 'all' by design (see the schema comment in db.ts) — not a perm_*, so not even checkPerm applies. Anyone dispatching a board.* message is already a verified room member. */
export function canMeasure(): boolean {
  return true;
}
/**
 * Adding/removing a roster entry, setting a marker/monster's Initiative-
 * Basis by hand, and starting/ending combat — hard-coded GM-only, same shape
 * as canEditFog: running combat isn't a delegable perm_*. Advancing the turn
 * pointer (board.turn.next) is NOT gated by this — the GM or the current
 * combatant's own owner may call it, same owner-bypass shape
 * (ownerUserId === viewer.userId) as canMoveToken, checked inline in ws.ts.
 */
export function canManageInitiative(viewer: BoardViewer): boolean {
  return viewer.isGm;
}
