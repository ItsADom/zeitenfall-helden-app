// Wire types for the virtual table's token/tile traffic — rides the SAME
// socket as diceProtocol.ts (see "Realtime design" in docs/concepts/
// virtual-table.md, "extend the existing socket, don't add a second one").
// Kept in its own file so the dice protocol stays focused; re-exported from
// the shared barrel and folded into ClientToServerMessage/ServerToClientMessage
// in diceProtocol.ts.

import type { CellCoord } from './board.js';

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
  /** Deterministic autotile noise seed (feTurbulence) — same input, same picture on every client. Never changes after creation. */
  seed: number;
  permTiles: BoardPerm;
  permLabels: BoardPerm;
  permTokens: BoardPerm;
  permImages: BoardPerm;
  permMove: BoardPerm;
  round: number;
  turnIndex: number;
  rev: number;
}

/** A persistent, movable text label anchored to a board position — see board_overlays.kind. */
export interface LabelOverlayData {
  x: number;
  y: number;
  text: string;
}

/**
 * Persistent, movable measure shapes — see "Measure shapes" in the plan.
 * None of these snap to the grid — same free, continuous positioning as a
 * token (settled with the developer during Phase 8 slice 3/3: a measure
 * shape's origin should follow the drag exactly, not jump to a cell
 * boundary/center). Ruler is `gridDistance` between two points; circle/
 * rectangle/cone are all rendered as true geometry (circle, rect, pie
 * wedge) rather than a unioned set of highlighted cells — `shared/src/
 * board.ts`'s `shapeCells`/`MeasureShape` stay available for a future
 * cell-coverage LOOKUP (e.g. "which tokens are inside this template"), just
 * not for how the shape is drawn. `spread` is the cone's full opening angle
 * in degrees, per-shape rather than a fixed constant — different effects
 * have different length/width ratios. `label`/`color` are both optional and
 * per-shape (never a board default) — a GM naming/coloring "Feuerball" vs.
 * "Kegelangriff" so several shapes on the table stay tellable apart; unset
 * means the plain default look every shape had before this existed.
 */
export type MeasureOverlayData =
  | { kind: 'ruler'; from: CellCoord; to: CellCoord; label?: string; color?: string }
  | { kind: 'circle'; origin: CellCoord; radius: number; label?: string; color?: string }
  | { kind: 'rectangle'; from: CellCoord; to: CellCoord; label?: string; color?: string }
  | { kind: 'cone'; origin: CellCoord; angle: number; length: number; spread: number; label?: string; color?: string };

/** board_overlays row — a discriminated union so `data`'s shape follows `kind`. */
export type BoardOverlay =
  | { id: number; boardId: number; kind: 'label'; data: LabelOverlayData; hidden: boolean }
  | { id: number; boardId: number; kind: 'measure'; data: MeasureOverlayData; hidden: boolean };

/**
 * board_initiative row — one per token in the current combat's roster.
 * Nobody clicks a "roll" button: the whole roster rolls together, ini_basis +
 * a FRESH 1W6 (never cumulative), at combat start and again every time the
 * turn pointer wraps past the last combatant — see `nextTurn()`/
 * `activeTurnOrder()`/`tickDeathCountdowns()` in shared/src/board.ts.
 * `iniBasis` is GM-typed for a marker/monster token; for a character token
 * it's ignored and recomputed live from the sheet at every roll instead, so
 * it always reflects the sheet's current Initiative-Basis. `value` is that
 * round's rolled total (0 before the first roll). `activeThisRound` is false
 * for a fresh mid-combat addition — it sits in the roster unrolled until the
 * NEXT round's mass reroll rather than being spliced into the round already
 * in progress. `deathCountdown` is null while the token isn't dying.
 */
export interface BoardInitiative {
  id: number;
  boardId: number;
  tokenId: number;
  iniBasis: number;
  value: number;
  activeThisRound: boolean;
  deathCountdown: number | null;
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
  /** Range ring around the token, in Schritt — 0 = none. AOE/torch/vision, moves with the token. */
  radius: number;
  /** Ring colour+opacity, #rrggbb(aa) — independent of `color` (the token itself). */
  radiusColor: string;
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
      patch: Partial<Pick<BoardToken, 'name' | 'color' | 'icon' | 'hidden' | 'statuses' | 'cover' | 'size' | 'radius' | 'radiusColor'>>;
    }
  // One message per drag, sent on release — the client renders the whole
  // drag locally and never broadcasts a live position (settled with the
  // developer: nobody needs to watch a token travel, only where it lands).
  | { type: 'board.token.move'; reqId: string; tokenId: number; x: number; y: number; final?: boolean }
  | { type: 'board.token.delete'; reqId: string; tokenId: number }
  // GM only. Fog/measuring aren't here — fog has no toggle by design, measuring is always 'all'.
  | {
      type: 'board.settings.update';
      reqId: string;
      patch: Partial<Pick<BoardSettings, 'permTiles' | 'permLabels' | 'permTokens' | 'permImages' | 'permMove'>>;
    }
  // Painting a stroke/brush/rectangle — client accumulates cells locally
  // (same "one message on release" shape as a token drag, see above) and
  // sends only the cells it actually touched, never a whole-map replace (see
  // "Tile and fog writes are deltas" in the plan — a player's tile map has
  // fogged cells already stripped once fog exists, so a whole-map save from
  // them would erase what's hidden underneath). Each value is a tagged
  // string per parseTileValue in shared/src/board.ts; '' erases that cell
  // back to unpainted.
  | { type: 'board.tiles.paint'; reqId: string; cells: Record<string, string> }
  // Same delta shape as board.tiles.paint, but for the highlight/tint layer
  // (highlights_json) — a GM-only overlay ABOVE the tile, kept as a separate
  // key so erasing a highlight never touches the tile underneath. Only ever
  // colour values ('' or #rrggbb(aa)), never a texture/asset tag.
  | { type: 'board.highlights.paint'; reqId: string; cells: Record<string, string> }
  | { type: 'board.overlay.create'; reqId: string; kind: 'label'; data: LabelOverlayData }
  // A measure shape is created whole (drag-to-size on the client, one
  // message on release — same "render locally, sync once" shape as
  // everything else that drags) rather than via a patch-based update
  // afterward; see board.overlay.update below for why edits still exist.
  | { type: 'board.overlay.create'; reqId: string; kind: 'measure'; data: MeasureOverlayData }
  // One message carries both a drag's dropped-at position AND a text edit —
  // labels have a single permission (perm_labels), unlike tokens' move/edit
  // split, so there is no reason for two message types. Same "render the
  // drag locally, sync once on release" shape as a token move. Reused for
  // measure shapes too — dragging one to reposition/resize sends its whole
  // new `data` as the patch (a measure shape has no field that survives a
  // drag the way a label's text does, so there's nothing to merge).
  | { type: 'board.overlay.update'; reqId: string; overlayId: number; patch: Partial<LabelOverlayData> | MeasureOverlayData }
  | { type: 'board.overlay.delete'; reqId: string; overlayId: number }
  // GM only (canEditFog — hard-coded, not a perm_*). Delta cells, same "never
  // a whole-map replace" shape as board.tiles.paint: true = hide this cell,
  // false = reveal it. The fog MASK itself is public (every viewer gets the
  // same board.fog.updated broadcast unfiltered) — only its CONTENTS are
  // redacted, which is why revealing a cell separately triggers synthetic
  // board.tiles.painted/board.highlights.painted/board.token.created/
  // board.overlay.created messages to players for whatever was hiding there
  // (see "Realtime design" in the plan and emitBoardChange in server/src/
  // ws.ts) — those aren't part of this message's own payload.
  | { type: 'board.fog.set'; reqId: string; cells: Record<string, boolean> }
  // Initiative and rounds (Phase 10, turn-pointer design). Roster
  // add/remove/setBasis and starting/ending combat are GM-only
  // (canManageInitiative — hard-coded, same shape as canEditFog: running
  // combat is not a delegable perm_*). Advancing the turn pointer
  // (board.turn.next) is the one exception — the GM OR the current
  // combatant's own owner may call it, same owner-bypass shape as
  // canMoveToken, so a player can pass their own turn without waiting on the
  // GM. Nobody ever sends a rolled value — every roll (combat start, and
  // every round wrap) is server-computed: Initiative-Basis (live from the
  // sheet for a character, `board.initiative.setBasis` for a marker/monster)
  // plus a fresh 1W6, never cumulative.
  | { type: 'board.initiative.add'; reqId: string; tokenId: number }
  | { type: 'board.initiative.remove'; reqId: string; tokenId: number }
  /** Marker/monster only — a character's basis always comes from its sheet and ignores this. */
  | { type: 'board.initiative.setBasis'; reqId: string; tokenId: number; basis: number }
  // Rolls everyone currently in the roster and begins round 1. Rejected if
  // the roster is empty or a combat is already running (round > 0).
  | { type: 'board.combat.start'; reqId: string }
  // Deletes the whole roster and resets round/turn back to 0 — ending combat
  // is a full reset, not a pause; the next board.combat.start begins fresh.
  | { type: 'board.combat.end'; reqId: string }
  // Advances the turn pointer. Past the last combatant in the CURRENT
  // round's active order, this instead bumps the round: re-rolls the whole
  // roster (including anyone added mid-round, who was sitting unrolled),
  // ticks death countdowns, and resets the pointer to the top.
  | { type: 'board.turn.next'; reqId: string };

export type BoardServerMessage =
  | { type: 'board.token.created'; token: BoardToken }
  | { type: 'board.token.updated'; token: BoardToken }
  | { type: 'board.token.deleted'; tokenId: number }
  | { type: 'board.settings.updated'; board: BoardSettings }
  | { type: 'board.tiles.painted'; cells: Record<string, string> }
  | { type: 'board.highlights.painted'; cells: Record<string, string> }
  | { type: 'board.overlay.created'; overlay: BoardOverlay }
  | { type: 'board.overlay.updated'; overlay: BoardOverlay }
  | { type: 'board.overlay.deleted'; overlayId: number }
  /** cellKey -> hidden? — the mask itself, same for every viewer (public per the fog design). */
  | { type: 'board.fog.updated'; cells: Record<string, boolean> }
  /**
   * The whole initiative roster PLUS round/turnIndex, per viewer, in one
   * message — same "full replace, not a delta" shape as board.settings.
   * updated, since the list is always short and round/turnIndex/the roster
   * change together on every mutation here (add/remove/setBasis/start/end/
   * next-turn all touch at least one of the three). Entries for a
   * hidden-from-this-viewer token are left out server-side (see
   * redactSnapshotForViewer/board.ts), same guarantee as tokens/labels.
   */
  | { type: 'board.initiative.updated'; round: number; turnIndex: number; entries: BoardInitiative[] };
