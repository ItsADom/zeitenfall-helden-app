# Virtual table (VTT) — implementation plan

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
| Move rights | **Anyone in the room may move any token** — but through a single server-side chokepoint, with an owner recorded per token, so restricting it later is a small change. |
| Rooms | **Event-Gruppen get their own chat room *and* board**, alongside permanent groups. |

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

### `group_feed` rebuild

`group_id` is `NOT NULL` with an FK to `groups`, so an event room can't reuse it.
Rebuild the table using the repo's established pattern — the `characters` rebuild
at [db.ts:586](server/src/db.ts:586), inside a transaction, verified afterwards
with `PRAGMA foreign_key_check`:

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
  statuses TEXT NOT NULL DEFAULT '[]',
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

- cells listed in `fog` are omitted from a player's tile payload entirely;
- tokens with `hidden=1`, or standing on a fogged cell, are omitted for players;
- consequently, moving a token into fog sends players a `board.token.remove` while
  the GM gets a `board.token.update`. Revealing fog sends players the newly
  visible tiles *and* tokens.

That asymmetry is the price of the guarantee, and it is why fog gets its own
phase rather than being sprinkled through earlier ones.

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
| `server/src/boardAccess.ts` (new) | **`canMoveToken(viewer, token)` — today `return true` for any room member.** The single chokepoint the developer asked to keep open; `owner_user_id` is already recorded per token, so restricting it later is editing one function. Also `canEditBoard` (GM-only: tiles, fog, board size). |
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
- `gridDistance(a, b)` — **Chebyshev** on a square grid (a diagonal step costs 1
  Schritt). *Flagged below as a rules detail worth confirming.*
- `tokenCells(token)` for `size > 1`.
- `initiativeOrder(entries)` — value descending, stable tiebreak.
- `canAdvanceRound(entries)` — every entry `done`.
- `advanceRound(state)` — bumps the round, clears `done`, ticks every active
  `death_countdown`, and reports which reached 0.
- `deathCountdown(lp, todesschwelle, current)` — the state machine: `lp <= 0` and
  no counter ⇒ start at `todesschwelle`; `lp > 0` ⇒ clear; otherwise unchanged.

`shared/test/board.test.ts` — distance symmetry and diagonals, sparse encode
round-trip, initiative ties, round advance blocked until all done, countdown
start/tick/clear/death, and `size>1` cell coverage.

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

0. **Branch.** This is large and touches shipped code — CLAUDE.md's "isolate
   risky/large work" exception applies. See the note under Open questions about
   *what* to branch from.
1. **Room identity.** `shared/src/room.ts`, `server/src/rooms.ts`, the `group_feed`
   rebuild, the WS path/key generalisation, `/api/rooms/mine` and `/rooms/:kind/:id/feed`,
   client room state. **Ships: Event-Gruppen get chat and dice.** No map yet.
2. **`CharSheetProvider` extraction.** Pure refactor, verified against the
   untouched character sheet. No new UI at all.
3. **Shared board math + schema.** `shared/src/board.ts` + tests, board tables,
   snapshot endpoint. Inert — no user-facing change.
4. **Page shell.** Route, full-bleed layout, empty grid, pan/zoom, the fixed chat
   column, the quick panel. No tokens, no painting.
5. **Tokens.** Create/move/delete, statuses, live sync, the `canMoveToken`
   chokepoint. Character tokens pull name and portrait; markers are ad hoc.
6. **Tile painting, labels, measurement shapes** (including persistent, movable
   measurements).
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
  nothing, confirm existing group chat history still renders after the rebuild
  (check row counts before/after). **2** — the sheet must behave identically:
  autosave, roll buttons, print, "Ansehen als". **4** — pan/zoom in two browsers,
  confirm the dock is hidden and the column chat still works. **5** — drag in one
  browser, watch it move in the other; check the server does not write per
  pointermove (log or count). **7** — the decisive test: as a player, inspect the
  WebSocket frames and the snapshot response and confirm **no hidden tile or token
  data arrives at all**, not merely that it is not drawn. **8** — round advance
  blocked until every box is ticked; drop a character to 0 LP and watch the
  countdown tick and clear on healing.
- Clean up test artefacts afterwards (feed rows, temp group memberships, boards) —
  they are visible to real players otherwise.

---

## Open questions / flagged trade-offs

1. **What to branch from.** The VTT builds directly on the unmerged
   `feature/dice-rolls-chat`. Cleanest is to merge that into `develop` first and
   branch `feature/virtual-table` off `develop`; otherwise this branches off the
   feature branch and inherits its merge. **Merging is your call, not mine** — say
   which you want and I will start there.
2. **Diagonal distance.** I default to Chebyshev (a diagonal step costs 1 Schritt)
   because it is the common square-grid convention, but this is a rules question
   for your system, not a technical one. If diagonals cost more, it is a one-line
   change in `gridDistance` plus a test.
3. **Phase 1 touches shipped code.** The `group_feed` rebuild is safe and follows
   the existing precedent, but it rewrites a table holding real chat history. I
   would take a manual DB copy before running it the first time, on top of the
   daily backup.
4. **Statuses have no data model yet.** There is no condition/Zustand system in the
   app; `tags_catalog` ("Merkmale") is the nearest thing. I plan a small fixed set
   of status icons stored per token — say so if you would rather they come from a
   GM-editable catalogue, which would be a Verwaltung addition.
5. **"More will follow"** — the model reserves `bg_image_id` for a backdrop and
   records `owner_user_id` per token for movement rights, but I have not designed
   for anything else unnamed.
