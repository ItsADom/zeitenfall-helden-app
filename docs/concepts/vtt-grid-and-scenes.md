# VTT: bigger/configurable grid + multiple scenes per group

Implementation plan, agreed with the developer 2026-08-27. Covers the two
top-priority VTT items in sequence, as two separate commits.

## Context

Both items already have an agreed concept:
- **Bigger, GM-configurable drawing area** — [TODO.md](../../TODO.md), marked
  `[ready]`.
- **Multiple scenes per group** — [virtual-table.md](virtual-table.md)'s
  Phase 13, agreed 2026-08-25, explicitly "build after the table itself is
  finished" (it now is — Phase 12 images shipped, plus later polish already
  on `develop`). Confirmed via `git rev-list --left-right --count
  develop...feature/virtual-table` → `39 0`: every commit from
  `feature/virtual-table` is already in `develop`, so no branch merge is
  needed and this work continues directly on `develop`.

The developer answered the sequencing/shape/switch-visibility/initiative-scope
questions: drawing area first, full independent boards per scene, and (per
the concept doc, since they had no further preference) live-for-everyone
switching with a fade, per-scene initiative.

---

## Part A — GM-configurable grid size, decoupled from placement/viewport

### What's already true (found while reading the code, changes scope down)

- **Tokens and images already have NO server-side upper-bound clamp** on
  position (`server/src/ws.ts` `board.token.create`/`.move`,
  `board.image.create`/`.update` — only `Number.isFinite` + non-negative
  checks). Only **labels** actually clamp to `board.cols`/`board.rows`
  (`board.overlay.create` kind `'label'` at the `x > board.cols || y >
  board.rows` check, and `board.overlay.update`'s `Math.min(board.cols, …)`).
- The real reason a token/image/label can't be moved past the grid edge
  **today** is the **client-side** drag clamps in
  `client/src/pages/VirtualTable.tsx` (`onTokenPointerMove`,
  `onOverlayPointerMove`, `onImagePointerMove`, `placeMarker`, the clipboard
  paste offset) — every one of them does `Math.min(cols[-size], Math.max(0,
  …))`. These are what actually need to change for placement to feel
  decoupled.
- Pan/zoom range is tied to grid size via `clampCamera`'s `maxX/maxY =
  totalW/totalH - viewport`, where `totalW/totalH = cols/rows * CELL_PX`.
  `viewW/viewH` (the zoom-to-grid reference size) can stay as-is; only the
  **pan clamp bound** needs to grow to cover out-of-grid content.
- Three WS paint handlers (`board.tiles.paint`, `board.highlights.paint`,
  `board.fog.set`) cap a single message at a **hardcoded 10000 cells**,
  commented as "the largest ever allowed board (100×100)". A bigger board
  needs this to scale with the board, or a full-board fog/paint operation on
  a large board silently truncates.

### Changes

1. **Schema** (`server/src/db.ts`): no new columns needed — `cols`/`rows`
   already exist with `DEFAULT 40`/`30`. Just make them **writable** with a
   sanity ceiling (proposed: **min 5, max 300** per axis — flag for
   sign-off, no data to size this against per the concept doc itself).

2. **Server — `board.ts`**: extend `BoardSettingsPatch` (currently perm_*
   only, per `updateBoardSettings`) to accept `cols`/`rows`.

3. **Server — `ws.ts`**:
   - `board.settings.update`: accept `cols`/`rows` in the patch, clamp to
     `[5, 300]`, round to integers, GM-only (already is).
   - Relax the two label position clamps (`board.overlay.create`/`.update`)
     to match tokens/images exactly — drop the `> board.cols`/`> board.rows`
     ceiling, keep the `< 0`/`Number.isFinite` floor.
   - Leave `measurePoint` (ruler/circle/rectangle/cone endpoints) **clamped
     to cols/rows** — measure shapes are a tactical/grid-distance tool, not
     placed content that can be "stranded" by a shrink; decoupling it isn't
     asked for and would be scope creep. Flagging this call explicitly.
   - Replace the three `if (n >= 10000) break` paint/highlight/fog caps with
     `board.cols * board.rows` (self-scaling, same intent, no longer stale
     against a bigger board).

4. **Client — `VirtualTable.tsx`**:
   - `BoardSettingsPopover`: add a "Rastergröße" row with two small number
     inputs (cols/rows), local state, commit via `updateBoardSettings({cols,
     rows})` on blur/Enter (same as the existing perm rows call
     `updateBoardSettings` directly, just batched instead of per-keystroke).
   - Drop the upper-bound half of the clamps in `onTokenPointerMove`,
     `onOverlayPointerMove`, `onImagePointerMove`, `placeMarker`, and the
     token clipboard-paste offset — keep only `Math.max(0, …)`. This is what
     actually lets a drag continue past the grid edge into "ungridded space".
   - Leave the image-resize max (`onImageResizeMove`'s `Math.min(cols/rows,
     …)` on `w`/`h`) as a cap on an image's own **size**, not position — not
     part of the "stranded content" problem this task solves. Flagging this
     call too.
   - Add a `worldW`/`worldH` value: `Math.max(totalW, contentMaxX)` /
     `Math.max(totalH, contentMaxY)`, where `contentMaxX/Y` is a small
     `useMemo` over `tokens`/`images`/`overlays` positions (+ a couple of
     cells' padding). Feed `worldW/worldH` into `clampCamera`'s `maxX/maxY`
     computation instead of `totalW/totalH` (everything else — `viewW/viewH`,
     the grid-line rect, tile/fog masks — keeps using `totalW/totalH`
     unchanged, since those ARE the grid, not the pannable world). Net
     effect: a board whose content still fits inside the grid behaves
     byte-for-byte as today; only a shrink that stranded something, or a
     token dragged out past the edge, extends the pannable range to reach it.

### Verification

- Start the dev server, open the VTT as GM.
- Resize the grid smaller via the new popover fields while a token sits near
  the old edge → token stays visible/draggable, camera can still pan to it.
- Resize the grid larger (e.g. 40×30 → 120×90) → grid lines/paint/fog extend,
  existing content unchanged.
- Drag a token/label/image past the current grid edge → it keeps moving (no
  snap-back), camera pan range extends to follow.
- Flood-paint/fog a large board in one drag → no silent truncation.
- Check both light and dark mode for the new popover row.

---

## Part B — Multiple scenes per group

Implements [virtual-table.md](virtual-table.md)'s Phase 13 as already agreed:
named boards, one `active_board_id` per group, hard-coded GM-only management,
live-for-everyone switch with a client-side fade, full-snapshot broadcast so
nobody races a follow-up fetch, per-scene camera.

### Data model

- `server/src/db.ts`: add `boards.name TEXT NOT NULL DEFAULT ''` and
  `groups.active_board_id INTEGER REFERENCES boards(id) ON DELETE SET NULL`
  (both idempotent `ALTER TABLE` migrations, same `PRAGMA table_info` guard
  style already used for `highlights_json`/`radius` etc.). Drop the
  `UNIQUE` off `idx_boards_group_id` (fresh-install `CREATE TABLE` block AND
  a migration path for the existing dev DB): `DROP INDEX` the unique one,
  `CREATE INDEX` a plain one on `group_id` (still needed for `listScenes`).
- Migration backfill (single guarded block, ordered: add columns → backfill →
  drop/recreate index): for every existing board (at migration time still
  ≤1 per group, under the old constraint), name it `'Szene 1'` if unnamed and
  set its group's `active_board_id` to it.

### Server — `board.ts`

- `getBoard(groupId)` / `getOrCreateBoard(groupId)`: change to resolve
  through `groups.active_board_id` instead of `boards.group_id` uniqueness.
  This is the one load-bearing choke point — **every** other server
  call site (all ~25 `getOrCreateBoard(meta.groupId)` calls in `ws.ts`, the
  `GET /groups/:id/board` snapshot route, image upload/serve routes) keeps
  working unchanged, because they all just ask "the board for this group"
  and now transparently get "whichever board is currently active". Creation
  on first-ever access also names it (`'Szene 1'`) and sets
  `active_board_id`.
- New: `listBoardsForGroup(groupId)` (plain `SELECT … WHERE group_id = ?`,
  ordered by id) — doubles as `listScenes()`'s query AND fixes a real bug
  this change would otherwise introduce (see below).
- New: `createScene(groupId, name)`, `renameScene(boardId, name)`,
  `deleteScene(boardId)` (rejects deleting a group's last remaining board;
  if deleting the active one, first calls `setActiveScene` to the
  lowest-id remaining sibling; after the DB delete, calls
  `loescheAssetsFuer('board', boardId)` — the cross-database asset cleanup
  this codebase always needs for a board, per the existing pattern at
  `routes.ts`'s group-delete handlers), `setActiveScene(groupId, boardId)`
  (validates the board belongs to that group first).

### Bug this change surfaces (fix as part of this work)

`server/src/routes.ts`'s permanent- and temp-group delete handlers
(`DELETE /admin/groups/:id`, `DELETE /admin/temp-groups/:id`) currently do
`const board = getBoard(id); … loescheAssetsFuer('board', board.id)` —
correct today because a group has exactly one board, but once a group can
have several **scenes**, deleting the group would leak every non-active
scene's image assets in `helden-assets.db` (the rows cascade-delete fine in
`helden.db`, only the second database is missed — exactly the gap CLAUDE.md
flags). Fix: loop `listBoardsForGroup(id)` and call `loescheAssetsFuer` for
each. (`assets/sweep.ts`'s weekly sweeper already needs no change — it
already scans `SELECT id FROM boards` with no group-cardinality assumption.)

### Server — `boardAccess.ts`

Add `canManageScenes(viewer): boolean { return viewer.isGm; }` — same
hard-coded shape as `canEditFog`/`canManageInitiative` (prep work, not a
delegable `perm_*`, per the concept doc).

### Protocol — `shared/src/boardProtocol.ts`

- `BoardSettings`: add `name: string`.
- New client→server messages: `board.scene.list`, `board.scene.create {name}`,
  `board.scene.rename {boardId, name}`, `board.scene.delete {boardId}`,
  `board.scene.switch {boardId}` (all with `reqId`).
- New server→client messages:
  - `board.scene.list.result { scenes: {id, name, cols, rows}[] }` — sent
    **directly to the requester only** (not broadcast — only the GM ever
    opens the picker), in response to `list` and after every
    create/rename/delete so the client never needs a second round-trip.
  - `board.scene.switched` — broadcast to the whole group via the existing
    `broadcastBuilt` (per-viewer fog/hidden redaction, same as initial
    snapshot), carrying the **same full snapshot shape** `loadBoardSnapshot`
    already returns (board settings + tokens + tiles + highlights + overlays
    + fog + initiative + images) so every client can hydrate directly, no
    follow-up fetch.

### Server — `ws.ts`

Five new `case 'board.scene.*'` handlers, all gated by `canManageScenes`
except the redaction inside `switch`'s broadcast. `switch` validates the
target board belongs to `meta.groupId` before calling `setActiveScene`, then
broadcasts `board.scene.switched` built the same way the `GET
/groups/:id/board` route already builds a snapshot (reuse
`redactSnapshotForViewer(loadBoardSnapshot(groupId), viewer)` per viewer).

### Client — `DicePanelProvider.tsx`

- New state: `boardScenes: {id, name, cols, rows}[]`.
- New WS cases (same file/region as the existing `board.*` handlers ~line
  830-950): `board.scene.list.result` → `setBoardScenes`;
  `board.scene.switched` → call the same setters `hydrateBoard` already
  wraps (`setBoardSettings`/`setBoardTokens`/`setBoardTiles`/… — matching
  the local style of this handler block, which uses raw setters directly
  rather than routing through `hydrateBoard`).
- New actions (same shape as `updateBoardSettings` etc.): `listScenes()`,
  `createScene(name)`, `renameScene(boardId, name)`, `deleteScene(boardId)`,
  `switchScene(boardId)`.

### Client — `VirtualTable.tsx`

- New GM-only toolbar entry opening a flyout scene picker — **per the
  existing standing TODO rule** ("dropdowns/flyouts over inline button
  sprawl", same shape as `TilePicker`/`HighlightPicker`/
  `MeasureKindPicker`): list of scenes (name, cols×rows), click to switch,
  inline rename, delete (disabled/hidden for the last remaining scene), a
  "+ Neue Szene" input. Calls `listScenes()` on open.
  - UX call (not explicitly spelled out in the concept doc): creating a new
    scene immediately issues `switchScene` for it too, so the GM lands on
    the blank scene right away instead of having to switch to it manually
    afterward. Flagging this as an added judgment call, easy to drop if the
    developer would rather creation and switching stay fully separate.
- On `board.scene.switched`: play the ~250-300ms fade already specified
  (opacity transition on `.vtt-map-wrap`/`.vtt-map-svg`) around the state
  swap — CSS-only, no new server timing.
- Camera: change `usePersistedState<Camera>('vtt-camera:${groupId}', …)`'s
  key to `board.id` (falls back cleanly — a brand new key just starts
  centered) so each scene remembers its own pan/zoom independently.

### Verification

- Open the VTT as GM, open the new scene picker, create a second scene →
  switches to it live (fade), toolbar shows the new blank grid.
- Switch back to the first scene → tokens/fog/paint from before are intact,
  camera returns to where it was left on that scene.
- Open as a player in a second browser/tab → switching scenes as GM updates
  the player's view live too, with the same fade.
- Rename a scene, delete a non-active one, confirm the last remaining scene
  can't be deleted.
- Delete the whole group (admin/GM group-delete route) with 2+ scenes, each
  holding an uploaded image → confirm no orphaned rows survive in
  `helden-assets.db` (spot-check via the sweeper's query or by re-running the
  sweep) — this is the bug-fix half of this task.
- Check both light and dark mode for the new picker UI.
