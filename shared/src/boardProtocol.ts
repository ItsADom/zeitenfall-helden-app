// Wire types for the virtual table's token traffic — rides the SAME socket
// as diceProtocol.ts (see "Realtime design" in docs/concepts/virtual-table.md,
// "extend the existing socket, don't add a second one"). Kept in its own file
// so the dice protocol stays focused; re-exported from the shared barrel and
// folded into ClientToServerMessage/ServerToClientMessage in diceProtocol.ts.

export type BoardPerm = 'gm' | 'all';

/**
 * The subset of `boards` a client needs — cols/rows to size the grid, the
 * five `perm_*` rights (fog/measuring aren't columns at all, see the schema
 * comment in the plan), and `rev` for future gap-detection. Tiles/fog stay
 * server/board.ts-only until painting/fog actually ship (Phases 6/10) — no
 * point typing wire fields nothing sends yet.
 */
export interface BoardSettings {
  id: number;
  groupId: number;
  cols: number;
  rows: number;
  permTiles: BoardPerm;
  permLabels: BoardPerm;
  permTokens: BoardPerm;
  permImages: BoardPerm;
  permMove: BoardPerm;
  round: number;
  turnIndex: number;
  rev: number;
}

export type TokenKind = 'character' | 'marker';

export interface BoardToken {
  id: number;
  boardId: number;
  kind: TokenKind;
  characterId: number | null;
  ownerUserId: number | null;
  name: string;
  color: string;
  icon: string;
  x: number;
  y: number;
  size: number;
  /** GM-only token — Phase 5 does NOT redact this over the wire yet (see ws.ts); that structural piece lands with fog (Phase 10). */
  hidden: boolean;
  /** Corner badges — keys into BOARD_STATUSES, never the emoji itself. */
  statuses: string[];
  /** At most one, drawn over the whole token — key into BOARD_COVERS, '' = none. */
  cover: string;
  /** Computed at read time from the linked character, never stored on the token row. */
  portrait: boolean;
  sort: number;
}

export type BoardClientMessage =
  // kind: 'character' needs characterId (server pulls name/portrait itself —
  // never trust a client-supplied name for someone else's character); kind:
  // 'marker' takes name/color/icon as typed, ad hoc.
  | {
      type: 'board.token.create';
      reqId: string;
      kind: TokenKind;
      characterId?: number;
      name?: string;
      color?: string;
      icon?: string;
      x: number;
      y: number;
      size?: number;
    }
  // Everything about a token except its position — perm_tokens governs this
  // (create/delete/edit), perm_move governs only board.token.move below.
  | {
      type: 'board.token.update';
      reqId: string;
      tokenId: number;
      patch: Partial<Pick<BoardToken, 'name' | 'color' | 'icon' | 'hidden' | 'statuses' | 'cover' | 'size'>>;
    }
  // `final: true` on pointerup — the server writes immediately instead of
  // waiting out its debounce (see board.ts's moveDebounce). Every message in
  // between is a live, throttled (~20/s client-side) broadcast-only position.
  | { type: 'board.token.move'; reqId: string; tokenId: number; x: number; y: number; final?: boolean }
  | { type: 'board.token.delete'; reqId: string; tokenId: number }
  // GM only. Fog/measuring aren't here — fog has no toggle by design, measuring is always 'all'.
  | {
      type: 'board.settings.update';
      reqId: string;
      patch: Partial<Pick<BoardSettings, 'permTiles' | 'permLabels' | 'permTokens' | 'permImages' | 'permMove'>>;
    };

export type BoardServerMessage =
  | { type: 'board.token.created'; token: BoardToken }
  // Also used for a live drag broadcast — the server re-broadcasts every
  // board.token.move immediately regardless of its own write debounce (see
  // "Drag conflicts and resync" in the plan), so a receiver treats every
  // board.token.updated the same whether it came from a drag or a real edit.
  | { type: 'board.token.updated'; token: BoardToken }
  | { type: 'board.token.deleted'; tokenId: number }
  | { type: 'board.settings.updated'; board: BoardSettings };
