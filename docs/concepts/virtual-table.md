# Virtual table (VTT) — implementation plan

> ## ⚠ This plan is NOT ready to build from
>
> It was written against `feature/dice-rolls-chat` while **two** feature branches
> were still unmerged, and it only accounts for one of them. It **must be revisited
> once `develop` is up to date**, and that revisit happens *before* the first line
> of code, not during.
>
> The virtual table merges **after** dice/chat — that ordering is settled.
>
> **Unmerged at time of writing (2026-08-19):**
> `feature/dice-rolls-chat` (33 commits ahead of `develop`) — this plan is built on
> it and its facts were verified against it. `feature/wiki` (20 ahead) — **this plan
> does NOT account for it**, and it carries constraints that change parts of the
> design; see "What `feature/wiki` changes" below.
>
> **Revisit checklist:**
> 1. Re-read `server/src/ws.ts`, `server/src/feed.ts` and
>    `client/src/components/dice/DicePanelProvider.tsx` against this plan's
>    "verified facts" — all of it was read off a branch that has since merged and
>    may have been amended on the way in.
> 2. Re-read the merged `CLAUDE.md`. It is the union of both branches' versions and
>    is longer than either; the wiki branch alone added 63 lines of constraints.
> 3. Work through "What `feature/wiki` changes" and fold each item into the body of
>    this plan properly, rather than leaving it as an appendix.
> 4. Decide the `group_feed` question (rebuild vs. plain `CREATE TABLE`) on the
>    facts at that time — it turns on whether dice/chat has been *released*, not
>    merely merged.
> 5. Check whether `TODO.md`'s virtual-table sketch (`TODO.md:225-254` on the dice
>    branch) has been pruned or moved on, and whether dice/chat got a version.
> 6. Confirm the settled decisions below still reflect what you want.
>
> Treat unchecked items as blockers. A plan this size that silently goes stale is
> worse than no plan, because it reads as authoritative.

## Context

The app manages characters for a house DSA-inspired pen-&-paper system. The
`feature/dice-rolls-chat` branch just added its first real-time surface: a
per-group WebSocket feed carrying chat and server-authoritative dice rolls,
rendered in a floating dock.

This feature extends that into a **virtual table** — a shared, live battle map
per play group. It is the app's first spatial, continuously-updating shared
surface, and the first that must filter *map* state per viewer (fog of war).

The ground was prepared: `TODO.md:228-236` records that the docked panel was
built so any page can call `useDicePanel()` and reuse the same connection and
`FeedEntryView`, and `DicePanelProvider` already carries `hidden`/`setHidden`
specifically so a dedicated page can suppress the dock. The chat half of this
feature is therefore additive, not a rework.

## Decisions settled with the developer

| Question | Decision |
|---|---|
| Map source | **Tile painting** (GM colors cells). No image upload in v1, but the model leaves room for a backdrop later without a migration. |
| Grid | **Square**, 1 cell = **1 Schritt**. |
| Boards | **One board per room** (no multiple scenes). |
| Fog of war | **In scope.** Hidden state must never reach a player's client. |
| Monster tokens | **Pure markers** — name + color/icon + status icons. No HP, no stats, no bestiary. |
| Initiative | Players **roll their own**: `Initiative-Basis + 1W6`, server-rolled. |
| Monsters in initiative | GM **adds a monster token to the initiative table and sets its value manually**. |
| Round advance | Per-combatant "done" checkbox; the round **cannot advance** until all are checked. |
| Todesschwelle | At **LP ≤ 0** a counter starts at the character's Todesschwelle and ticks **−1 per round**; 0 = death. Healing above 0 clears it. |
| Move rights | **Anyone in the room may move any token.** With the GM-configurable rights below this stops being a code default and becomes `perm_move`, shipped set to „Alle" — so tightening it later is a setting, not a change. |
| Rooms | **Event-Gruppen get their own chat room *and* board**, alongside permanent groups. |
| Diagonals | **Chebyshev — a diagonal step costs 1 Schritt.** Movement range renders as a square. |
| Edit rights | **The GM configures them per board** ("some groups may edit the map, some may not"). Measuring is always open to everyone; **only the GM may set fog**. |
| Fog visibility | **Players see *where* the fog is, not what's under it.** Opaque for players, semi-transparent for the GM. |
| Statuses | **Fixed built-in set, emoji** for now — but the model must leave room for **token-covering images later** (e.g. a blood splatter over a dead enemy), which is a different kind of thing than a corner badge. |
| Measure shapes | **Ruler, circle, cone and rectangle.** The **cone may be visual-only** if cell-accurate coverage on a square grid proves fiddly. |

### The decision that grows the scope

"Event-Gruppen should of course have their own chat and table rooms" reaches back
into the **already-shipped** chat feature. Today room identity *is* a permanent
group id, in four places: the WS path (`/ws/groups/:id`), the room map key,
`group_feed.group_id` (a real FK, `NOT NULL`), and `GET /api/groups/mine`. Event
groups also have a different membership shape — `temp_group_members` holds
**character** ids, not user ids, so "is this user in this room" must be derived
through character ownership.

So the work starts with a **room-identity phase** that generalises the existing
chat from "group id" to "room = (kind, id)". It is independently valuable (event
groups get chat and dice) and independently committable.

---

## Data model

### Room identity — `shared/src/room.ts` (new)

```ts
export type RoomKind = 'group' | 'event';
export interface RoomKey { kind: RoomKind; id: number }
export function roomToken(key: RoomKey): string;      // "group:12" — map keys, localStorage
export function parseRoomToken(raw: string): RoomKey | null;
```

### `group_feed` — rebuild, or just change the schema

`group_id` is `NOT NULL` with an FK to `groups`, so an event room can't reuse it.
**Which route to take depends on whether dice/chat has been *released to
production* by the time this work starts** — not on whether it has been merged:

- **If the VTT lands before dice/chat is deployed**, production has no `group_feed`
  table at all yet, and the only databases carrying one are dev machines holding
  test data that gets wiped anyway. Then the honest move is to **edit the
  `CREATE TABLE` in `db.ts` directly** and write no migration. Nothing to preserve,
  no rebuild, no risk.
- **If dice/chat is live first** (the likely case, given no implementation is
  planned soon), real chat history exists and the table needs the rebuild below.

Write the rebuild only in the second case — carrying a migration for a state no
database was ever in is its own kind of debt. Rebuild uses the repo's established
pattern, the `characters` rebuild at [db.ts:586](server/src/db.ts:586), inside a
transaction, verified afterwards with `PRAGMA foreign_key_check`:

```sql
room_kind     TEXT NOT NULL DEFAULT 'group',           -- 'group' | 'event'
group_id      INTEGER REFERENCES groups(id) ON DELETE CASCADE,       -- now nullable
temp_group_id INTEGER REFERENCES temp_groups(id) ON DELETE CASCADE,  -- new
-- exactly one of the two is set; everything else unchanged
CREATE INDEX idx_group_feed_room ON group_feed(room_kind, group_id, temp_group_id, id);
```

Two nullable FK columns rather than one generic `room_id` **keeps `ON DELETE
CASCADE` working for both kinds** — a generic id column would have to drop the
FKs and rely on manual cleanup, which is exactly the kind of silent-orphan risk
CLAUDE.md's data-loss rule exists to avoid. Existing rows migrate to
`room_kind='group'` with `group_id` untouched: no row is rewritten in content.

### Board tables — `server/src/db.ts`

```sql
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_kind TEXT NOT NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  temp_group_id INTEGER REFERENCES temp_groups(id) ON DELETE CASCADE,
  cols INTEGER NOT NULL DEFAULT 40,
  rows INTEGER NOT NULL DEFAULT 30,
  bg_image_id INTEGER,                    -- reserved for the later backdrop, always NULL in v1
  tiles_json TEXT NOT NULL DEFAULT '{}',  -- sparse painted cells
  fog_json  TEXT NOT NULL DEFAULT '[]',   -- sparse HIDDEN cells (empty = nothing hidden)
  -- GM-configurable usage rights, 'gm' | 'all'. Measuring is always 'all' and
  -- fog is always 'gm', so neither gets a column — they are not negotiable.
  perm_tiles  TEXT NOT NULL DEFAULT 'gm',
  perm_labels TEXT NOT NULL DEFAULT 'gm',
  perm_tokens TEXT NOT NULL DEFAULT 'gm',   -- create/delete tokens
  perm_move   TEXT NOT NULL DEFAULT 'all',  -- move tokens; 'all' = the settled default
  round INTEGER NOT NULL DEFAULT 0,
  turn_index INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0,         -- monotonic; clients detect gaps and refetch
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- 'character' | 'marker'
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- for the future rights check
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 1,        -- cells across
  hidden INTEGER NOT NULL DEFAULT 0,      -- GM-only token
  statuses TEXT NOT NULL DEFAULT '[]',    -- corner badges: array of status keys
  cover TEXT NOT NULL DEFAULT '',         -- full-token overlay, one at a time ('' = none)
  cover_image_id INTEGER,                 -- reserved: uploaded cover art, always NULL in v1
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_overlays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- 'label' | 'measure'
  data_json TEXT NOT NULL DEFAULT '{}',   -- text/anchor, or shape+origin+radius
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_initiative (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  token_id INTEGER NOT NULL REFERENCES board_tokens(id) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 0,
  rolled INTEGER NOT NULL DEFAULT 0,      -- 1 = player-rolled, 0 = GM-typed
  done INTEGER NOT NULL DEFAULT 0,
  death_countdown INTEGER                 -- NULL = not dying; else rounds left
);
```

### Statuses vs covers — two different things

The developer wants emoji badges now and **token-covering images later** ("some
blood streams to show a dead enemy"). Those are not the same feature and must not
share a slot:

- **Badges** (`statuses`) are several at once, small, in the token's corners:
  vergiftet, betäubt, liegend, brennend, blind, gesegnet… Stored as an array of
  **keys**, never as the emoji itself, so the rendering can change without
  rewriting stored data.
- **A cover** (`cover`) is at most one, drawn *over* the whole token: dead,
  unconscious. In v1 it renders from a built-in set (a blood splatter can be
  inline SVG, in keeping with the app's existing inline-SVG use). `cover_image_id`
  is reserved so an uploaded image can take over later — the same BLOB-in-SQLite
  route portraits already use — without touching the token rows.

The catalogue itself lives in `shared/src/boardStatus.ts` as a plain frozen list
(`{ key, label, emoji }`), which is what makes "swap emoji for artwork later" a
rendering change rather than a migration.

Tiles and fog are JSON columns following the `group_feed.roll_json` precedent
(complex sub-object, type lives in `shared/`). Sizing check: a 40×30 board is
1200 cells; a fully painted `{"12,7":"#8b2635", …}` is ~20 KB, and real boards
are sparse. Cap board size at 100×100 so the worst case stays bounded. Tokens,
overlays and initiative get real tables because they are individually updated,
need FKs, and are few.

### Persisted vs ephemeral

| State | Where | Why |
|---|---|---|
| Board, tiles, fog, tokens, overlays, initiative, round | SQLite | Survives a session; the whole point of prep. |
| **In-flight drag positions** | Broadcast only, **never** a DB write per event | better-sqlite3 is synchronous and single-writer; a write per pointermove would block the event loop. Server re-broadcasts immediately, debounces the DB write ~150 ms per token, and force-flushes on `token.drop`. |
| Per-user camera (pan/zoom) | Client `localStorage` | Purely personal; no reason to involve the server. |
| "Center all on my view" | One-shot broadcast | An event, not state. |

---

## Realtime design

**Extend the existing socket, don't add a second one.** A parallel channel would
duplicate auth, heartbeat, reconnect and rate limiting, and give a client two
connections whose ordering could not be reasoned about.

Concretely, in `server/src/ws.ts`:

1. The upgrade regex becomes `^/ws/rooms/(group|event)/(\d+)$`; `rooms` is keyed
   by `roomToken(key)` instead of a raw number; `SocketMeta` carries `RoomKey`.
2. **`broadcast()` is currently typed to `FeedEntry` and hard-wired to
   `canSeeFeedEntry`.** Generalise it to
   `broadcastToRoom(key, build: (viewer: SocketMeta) => ServerToClientMessage | null)`
   — returning `null` means "this viewer gets nothing". The feed keeps its exact
   current behaviour by passing a builder that consults `canSeeFeedEntry`; board
   messages pass one that consults the fog/hidden redaction. This preserves the
   "one visibility predicate, no `isGm` bypass" property of the feed while giving
   the board its own, different rule.
3. New message types on the existing unions in `shared/src/diceProtocol.ts` (or a
   sibling `boardProtocol.ts` re-exported from the same barrel, to keep the dice
   file focused): `board.move`, `board.token.*`, `board.tiles`, `board.fog`,
   `board.overlay.*`, `board.initiative.*`, `board.round.*`, `board.view.center`.
   Every client→server message keeps the existing `reqId` + `ack`/`error` shape.

**Fog of war is the hard part, and it is structural.** The guarantee is "a player's
client never receives hidden state", so redaction cannot live in the renderer. All
board mutations funnel through one `emitBoardChange()` in `server/src/board.ts`
which computes a *per-viewer* payload:

- **the `fog` set itself is public** — players receive which cells are fogged and
  render them opaque, so the unexplored area reads as unexplored instead of as
  empty floor. The GM renders the same cells semi-transparent, reading the map
  underneath while seeing exactly what is withheld. Only the GM may *change* it;
- cells listed in `fog` are omitted from a player's tile payload entirely;
- tokens with `hidden=1`, or standing on a fogged cell, are omitted for players;
- consequently, moving a token into fog sends players a `board.token.remove` while
  the GM gets a `board.token.update`. Revealing fog sends players the newly
  visible tiles *and* tokens.

That asymmetry is the price of the guarantee, and it is why fog gets its own
phase rather than being sprinkled through earlier ones.

**Tile and fog writes are deltas, never full-map replaces.** A player whose
`perm_tiles` is `'all'` holds a tile map with the fogged cells stripped out, so
accepting a whole-map save from them would erase everything the GM painted under
fog. The client sends only the cells it actually touched. See item 3 under "What
`feature/wiki` changes" — this is the same trap the wiki branch already hit once.

**Drag conflicts and resync.** Token moves are last-write-wins — with a handful of
players around one table, locking is ceremony nobody needs; the loser sees the
token snap, which is self-correcting. Client throttles pointermove broadcasts to
~20/s and renders its own drag optimistically, ignoring echoes of its own moves
while a drag is active. Every board message carries the board's `rev`; a client
that sees a gap refetches the full snapshot. On reconnect the client fetches the
snapshot and buffers live pushes until it lands — the same race fix
`DicePanelProvider` already uses for the feed (`liveBufferRef` + merge).

---

## Server module layout

| File | Responsibility |
|---|---|
| `server/src/rooms.ts` (new) | `roomExists`, `canJoinRoom(user, key)` (group: `isGm \|\| isGroupMember`; event: `isGm \|\| owns a character in the temp group`), `charForRoom(userId, key)`. The one place room membership is decided, for both REST and WS. |
| `server/src/board.ts` (new) | Load/mutate board state, `emitBoardChange()` per-viewer redaction, the debounced position writer. |
| `server/src/boardAccess.ts` (new) | The one place board rights are decided: `canPaint`, `canLabel`, `canEditTokens`, `canMoveToken`, each reading the board's `perm_*` setting (`'gm'` ⇒ `viewer.isGm`, `'all'` ⇒ any room member). `canEditFog` is hard-coded to `viewer.isGm` — deliberately not a setting, since a player able to lift fog defeats the point. There is no `canSeeFog`: the mask is public, only its *contents* are redacted. `owner_user_id` on the token is recorded but unused in v1; it is what a future "own token only" mode would read. |
| `server/src/ws.ts` | Room-key generalisation + the new `board.*` cases in the existing `switch`. |
| `server/src/feed.ts` | Room-key generalisation only; `canSeeFeedEntry` untouched. |

REST (in `server/src/routes.ts`, guards composed as the file already does):

```
GET  /api/rooms/mine                      -- replaces /groups/mine; groups + event groups
GET  /api/rooms/:kind/:id/board           -- full snapshot, already redacted for the viewer
GET  /api/rooms/:kind/:id/feed            -- replaces /groups/:id/feed
```

Everything mutating goes over WS, so there is one ordering domain and one place
that broadcasts.

---

## Shared pure logic (gets vitest coverage)

`shared/src/board.ts` — no I/O, following the `shared/src/dice.ts` precedent:

- `cellKey(x,y)` / `parseCellKey`, `encodeCellSet` / `decodeCellSet` (sparse).
- `gridDistance(a, b)` — **Chebyshev**: `max(|dx|, |dy|)`, so a diagonal step costs
  1 Schritt and a movement range renders as a square. Settled.
- `tokenCells(token)` for `size > 1`.
- `shapeCells(shape)` — which cells a circle / rectangle covers, for range
  highlighting. **The cone is deliberately excluded**: per the developer it may
  stay *visual only*, drawn as a true geometric wedge without cell-accurate
  coverage. If cell coverage for cones is wanted later it is an addition here,
  not a redesign.
- `initiativeOrder(entries)` — value descending, stable tiebreak.
- `canAdvanceRound(entries)` — every entry `done`.
- `advanceRound(state)` — bumps the round, clears `done`, ticks every active
  `death_countdown`, and reports which reached 0.
- `deathCountdown(lp, todesschwelle, current)` — the state machine: `lp <= 0` and
  no counter ⇒ start at `todesschwelle`; `lp > 0` ⇒ clear; otherwise unchanged.

`shared/src/boardStatus.ts` — the frozen badge/cover catalogue described above.
Data, not logic, so it needs no tests of its own beyond key uniqueness.

`shared/test/board.test.ts` — Chebyshev distance (symmetry, pure diagonal costing
the same as pure straight, the case that would fail under Euclidean), sparse
encode round-trip, `shapeCells` for circle and rectangle, initiative ties, round
advance blocked until all done, countdown start/tick/clear/death, and `size>1`
cell coverage.

Initiative rolling itself stays server-side (`server/src/dice.ts` `rollDie(6)` +
`computeBaseValues(...).ini.ergebnis`), matching the standing rule that the
client never supplies a number.

---

## Client architecture

**New page** `client/src/pages/VirtualTable.tsx`, routes added to
[App.tsx:139-156](client/src/App.tsx:139): `/gruppe/:id/tisch` and
`/event/:id/tisch`. Entry points: a link on `Group.tsx` beside the existing
"Spielleiter-Übersicht →" ([Group.tsx:110](client/src/pages/Group.tsx:110)), one
on `GroupOverview.tsx`, and one from the event-group list in Verwaltung.

**Render the map as SVG, not canvas.** Tokens need portraits (`<image>`), status
badges, text labels, and hit-testing for drag — all free in SVG through ordinary
DOM events and React's declarative rendering. Canvas would mean hand-rolling
hit-testing, image loading and a redraw loop for a board that changes on events,
not on frames. `BannerFx.tsx` is canvas because it animates continuously; this
does not. Painted cells are sparse, so only painted cells become elements — the
grid lines are a CSS background on the viewport, not thousands of nodes.

**Pan/zoom** via the `<svg>` `viewBox` (crisper than a CSS transform, and keeps
board coordinates as the only coordinate system). Panning uses the repo's pointer
idiom — `onPointerDown` → `pointermove`/`pointerup` on `window` → a class on
`document.body` — the same shape as `CharacterSidebar.startResize`. No HTML5
drag-and-drop anywhere, consistent with the rest of the app.

**Tool palette.** One mode selector over the map — pan (default), paint, fog,
measure (ruler / circle / cone / rectangle), label, token. Each tool the viewer
lacks rights for is simply absent, and the server re-checks anyway; the palette is
convenience, never the enforcement. Measure is always present for everyone.

**Board settings** (GM only): a small panel for board size, and the four
`perm_*` toggles as plain „Spielleitung / Alle" selects, so the GM can open map
editing to a trusted group and keep it closed for another. Fog is not in this
panel — it has no toggle by design.

**"Center all on my view"** broadcasts `board.view.center {x, y, zoom}`; receivers
ease their `viewBox` to it. Available to everyone, not just the GM — it is a small
table and socially self-regulating.

**Chat column**: the page calls `setHidden(true)` on mount / `false` on unmount so
the floating dock does not double up (exactly what that flag was added for), and
`selectRoom({kind, id})` so the feed matches the board. The column reuses
`useDicePanel()` and `FeedEntryView`; the feed+input body of
`DicePanel.tsx` is extracted into a shared `FeedColumn` component used by both the
dock and the page, so there is one chat UI rather than two that drift.

---

## The `CharacterSidebar` reuse problem

This is the largest refactor risk, so it gets its own early phase.

`CharacterSidebar` imports `useChar` from `pages/Character`, and every subcomponent
uses it. `CharCtx` lives inside `pages/Character.tsx` (702 lines) together with the
loader and the debounced autosave.

The context value is actually small and self-contained —
`{ charId, data, catalogs, update, rollCtx, requestCtx }`
([Character.tsx:133-151](client/src/pages/Character.tsx:133)) — and the autosave is
a tidy unit: a `dirty` Set, a 1500 ms timer, and a `flush()` that PUTs per section
([Character.tsx:293-354](client/src/pages/Character.tsx:293)).

**Extract them into `client/src/components/charSheet.tsx`**, exporting
`<CharSheetProvider charId>` and `useChar()`. It owns loading, catalogs, `update`,
`flush`, `rollCtx`/`requestCtx` and `saveState`.

Stays in `Character.tsx`: tabs and tab order, print mode, the "Ansehen als" dev
preview, the edit toggle, name editing, table widths, scroll memory, and the
sticky-height refs. Those are page concerns, not sheet-data concerns.

`Character.tsx` re-exports `useChar` so the dozen importing files need no churn.
The VTT's quick panel then mounts `<CharSheetProvider charId={myCharId}><CharacterSidebar/></CharSheetProvider>`
— always the viewer's own character, so always `access === 'edit'` and none of the
`?asUser=`/summary complexity comes along.

*Rejected alternative:* building a slimmed-down VTT-only panel. It would duplicate
the pool math, the `AktuellFeld` save path and the attribute roll wiring — three
places to keep in sync with the sheet, for a panel meant to be the same panel.

---

## CSS / layout

One new section in `client/src/styles.css`, tokens only (`--panel`, `--border`,
`--accent`, …) so all six colour worlds and dark mode work without extra rules.

Page shell: a flex row of `quick panel | map | chat`, both side columns collapsible
and width-draggable, reusing the `.side-resize` / `.side-expand` idiom and
`usePersistedState` keys already used by `CharacterSidebar` and `DicePanel`.

Full-bleed inside `main` (which has `padding: 20px var(--pad-x) 60px` and
`max-width: 2200px`) via negative margins — the same bridging trick the stylesheet
already documents for sticky bars. Height is `calc(100dvh - var(--topbar-h))`,
reading the measured variable rather than a hard-coded number, per CLAUDE.md.

**The map viewport uses `overflow: hidden`, never `overflow-x: auto`** — panning is
a `viewBox` change, not scrolling. So `main { overflow-x: clip }` and the
sticky-`thead` rule are untouched.

Small screens: below ~900 px the side columns become overlay drawers instead of
columns, so the map keeps the full width.

---

## Phases

Each is independently committable and ends in something demoable. Risk is
front-loaded: the two phases that touch existing, shipped code come first.

0. **Branch** `feature/virtual-table` off `develop`, after dice/chat has been
   merged there. This is large and touches shipped code — CLAUDE.md's "isolate
   risky/large work" exception applies.
1. **Room identity.** `shared/src/room.ts`, `server/src/rooms.ts`, the `group_feed`
   schema change (rebuild *or* a plain `CREATE TABLE` edit — see above), the WS
   path/key generalisation, `/api/rooms/mine` and `/rooms/:kind/:id/feed`,
   client room state. **Ships: Event-Gruppen get chat and dice.** No map yet.
2. **`CharSheetProvider` extraction.** Pure refactor, verified against the
   untouched character sheet. No new UI at all.
3. **Shared board math + schema.** `shared/src/board.ts` + tests, board tables,
   snapshot endpoint. Inert — no user-facing change.
4. **Page shell.** Route, full-bleed layout, empty grid, pan/zoom, the fixed chat
   column, the quick panel. No tokens, no painting.
5. **Tokens.** Create/move/delete, status badges and covers, live sync, and
   `boardAccess.ts` with the `perm_*` checks plus the GM settings panel. Character
   tokens pull name and portrait; markers are ad hoc.
6. **Tile painting, labels, measurement shapes** (persistent and movable). Cone
   ships visual-only unless cell coverage falls out easily.
7. **Fog of war.** Per-viewer redaction through `emitBoardChange()`.
8. **Initiative and rounds.** Player-rolled `Basis + 1W6`, GM-typed monster values,
   the "done" checkbox gating round advance, the Todesschwelle countdown.
9. **"Center all on my view"** and polish.
10. **Changelog + TODO.** Fold the player-facing notes into the newest unversioned
    changelog entry and prune the virtual-table sketch from `TODO.md:225-254`.
    Mark GM-only bits with „(Spielleiter)". **No version number** — that is the
    developer's call.

---

## Verification

- `npm test -w shared` after phases 1, 3 and 8 — the pure logic lives there and is
  the only workspace with a runner.
- Browser verification needs **two logged-in users at once**, and `localhost` and
  `[::1]` are separate cookie jars — so GM at `http://localhost:5173`, player at
  `http://[::1]:5173`, one role per origin. Seeds: `npm run seed` (GM
  `spielleiter`/`spielleiter`), `npm run seed:testuser` (`testspieler`/`test1234`),
  `npm run seed:dummy` for load.
- Per phase: **1** — post in an Event-Gruppe as a player, confirm a non-member sees
  nothing; if the rebuild route was taken, check `group_feed` row counts before and
  after. **2** — the sheet must behave identically:
  autosave, roll buttons, print, "Ansehen als". **4** — pan/zoom in two browsers,
  confirm the dock is hidden and the column chat still works. **5** — drag in one
  browser, watch it move in the other; check the server does not write per
  pointermove (log or count); flip each `perm_*` to `gm` and confirm the player's
  tool disappears **and** that a hand-sent WS message is still rejected — the
  palette is not the enforcement. **7** — the decisive test: as a player, inspect the
  WebSocket frames and the snapshot response and confirm the fog mask *does* arrive
  while **no tile colour or token under it arrives at all** — not merely that they
  are not drawn. Move a GM token under fog and confirm the player's payload loses
  it. Then the data-loss half: with `perm_tiles` set to „Alle", have the player
  paint a cell next to a fogged region and confirm the GM's hidden tiles are still
  there afterwards. **8** — round advance
  blocked until every box is ticked; drop a character to 0 LP and watch the
  countdown tick and clear on healing.
- Clean up test artefacts afterwards (feed rows, temp group memberships, boards) —
  they are visible to real players otherwise.

---

## What `feature/wiki` changes

Written after the fact, when switching branches revealed a second unmerged line of
work. **These are not folded into the body above** — doing that properly is part of
the revisit, because by then both branches will have merged and `CLAUDE.md` will be
their union.

1. **Images go in `helden-assets.db`, not `helden.db`.** The wiki branch split
   image blobs into a second database. So the reserved `bg_image_id` and
   `cover_image_id` point *there*, not at a new BLOB table beside `boards`. The
   consequence is sharper than it sounds: **SQLite has no cross-database CASCADE**,
   so deleting a board or a token must call `loescheAssetsFuer()` by hand. The
   weekly sweeper in `server/src/assets/sweep.ts` is a safety net for what gets
   missed, not the mechanism. Any VTT delete path is a new place to get this wrong.

2. **Fog of war has an exact precedent — use it.** The wiki's ` ```gm ` regions are
   stripped *server-side* before the response, on the reasoning that a client which
   merely declined to render them would still have shipped the text. That is the
   same principle this plan applies to fogged tiles and tokens, already proven in
   this codebase. Read `verbergeGmBloecke` before writing `emitBoardChange()`.

3. **…and the counterpart is a real hole in this plan.** The wiki branch also
   learned the inverse: *never send a redacted version and then accept it back as a
   write*. A player editing a page gets `[[gm:n]]` markers where GM regions stand,
   so their save restores the original — otherwise an ordinary edit silently
   deletes the GM's notes.
   **The same trap exists here and this plan walks straight into it.** With
   `perm_tiles = 'all'`, a player paints tiles while their client holds a tile map
   with the fogged cells *removed*. A save that ships the whole map would erase
   every tile the GM had painted under fog — the no-data-loss rule, applied to
   somebody else's map.
   **Fix, and it is not optional: every tile and fog write is a delta** — only the
   cells the author actually touched — never a full-map replace. Noted in the
   realtime section too.

4. **A sticky VTT toolbar is not done when its own rule is written.** Every
   `calc()` for something sticking below it needs the new term, including rules
   shared with pages that never render the toolbar. Adding the term is safe because
   an unset variable falls back to `0px`. Related: `--tabs-h` falls back to `0px`
   and every `.tabs` bar is measured — the VTT page has no tab bar and must not
   inherit a guessed offset.

5. **The board fetch is exactly the bug the wiki page view shipped twice.** Async
   state read during render must carry the identity of what it describes; clearing
   it in an effect is too late, because the render that read it has already
   returned. So the board response and the room key it answers live in **one** state
   object, derived during render (`geladen?.schluessel === schluessel ? geladen :
   null`), and every fetch keyed on a route parameter gets a `let aktuell = true`
   guard whose cleanup drops the answer. This plan's room-keyed board load and
   reconnect-snapshot flow are the same shape.

6. **Derived columns.** `boards` is a new table, so its `perm_*` defaults are
   correct from the start. But if any derived column is later added to an *existing*
   table, `ALTER TABLE` fills it with the DEFAULT rather than the right answer, and
   it needs a boot-time re-derive — a `user_version` step would not catch a rollback
   or an old-backup restore.

## Status of this plan

**Planning only — no implementation is scheduled**, and the gap before building is
open-ended. See the revisit checklist at the top of this file: it is a precondition,
not a suggestion.

Ordering is settled: `feature/dice-rolls-chat` merges into `develop` first, this
work then cuts `feature/virtual-table` off `develop`, and the virtual table merges
after dice/chat.

## Still open

- **Which status keys.** Settled as "fine for now" — vergiftet, betäubt, liegend,
  brennend, blind, stumm, gelähmt, gesegnet, unsichtbar, plus the covers *tot* and
  *bewusstlos*. It is one frozen array, so additions are a later pass if they turn
  out to be needed.

## Cautions carried into the build

- **Fog is the phase most likely to leak.** Its verification step is not "the
  hidden thing isn't drawn" but "the hidden thing is not in the payload". A
  visual-only check is a failed check — the more so now that players legitimately
  receive the fog mask, which makes a leak of its *contents* easier to overlook.
- **Reserved, not designed for:** `bg_image_id` (map backdrop), `cover_image_id`
  (token cover art), `owner_user_id` (a future "own token only" mode). Everything
  else under "more will follow" is genuinely unplanned.
