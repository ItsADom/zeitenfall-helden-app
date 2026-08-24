# Virtual table (VTT) — implementation plan

> ## Progress (2026-08-24, end of session): Phases 1–3 done, Phase 4 designed but not coded
>
> **Committed on `feature/virtual-table`:** Phase 1 (Event-Gruppen player page),
> Phase 2 (`CharSheetProvider` extraction, verified live), Phase 3 (shared board
> math + the five board tables + the inert snapshot endpoint, verified live). All
> typecheck clean, `npm test -w shared` green (406 tests). See each phase's own
> commit message for what was verified and how.
>
> **Phase 4 (page shell) has NOT been started as real code.** What exists instead
> is a static, interactive mockup —
> `docs/concepts/virtual-table-mockup/Tisch.html` (built from `tisch-vorlage.html`
> by `tisch-bauen.mjs`, which also embeds the real texture set; re-run it after
> editing the template) — with a GM/Spieler view toggle and a light/dark toggle,
> used to settle the quick-panel design before writing the real page. Serve it
> with the `vtt-mockup` entry in `.claude/launch.json` (`npx serve` on port 8420,
> gitignored so it won't appear after a fresh clone — recreate the entry if
> needed) rather than opening it via `file://`, which the preview tooling only
> renders as a static snapshot (JS runs, but screenshots go stale).
>
> **Settled for the real Phase 4 build**, checked against the actual components
> rather than guessed:
> - **Player's quick panel is the real `CharacterSidebar.tsx`**, extended with two
>   new sections it doesn't have today: **Kampf** (one-tap AT/PA/BL/FK + Ausweichen
>   roll chips) and **Zustände** (active status badges spelled out, not just the
>   map token's tiny icon). Its existing Pools/Attribute/Geld/Notiz stay — dropping
>   Notiz for the VTT context, if wanted, is a still-open call, not decided.
> - **GM's quick panel is a new, narrower rendering of `GroupOverview.tsx`'s
>   per-character card**, reusing its real data/components rather than inventing
>   parallel UI. Confirmed in scope: name+owner, **all vitals** (`vitals[]` already
>   includes LE/AUS/ASP/Psyche/every Spezialenergie the character uses/
>   Schicksalspunkte — nothing extra to compute), Wund/Tod threshold chips, tag
>   chips, the GM-only note (`GmNoteField`, reused as-is), `RequestProbePicker`.
>   Confirmed OUT of scope: portrait, Stufe, the SP-reset button, attribute chips,
>   pinned-talent chips — stay on the real overview page. There is no "SL-Wurf"
>   button — that was a mockup invention; the one real request affordance is
>   `RequestProbePicker`.
> - **Todesschwelle countdown moved off the sidebar entirely** — it's a small
>   badge floating above the dying token on the map itself (GM always; the owning
>   player too, once fog/redaction exists — not independently demoable with one
>   identity in the static mockup, but same `owner_user_id` check used everywhere
>   else).
> - **Both side columns (quick panel, chat) stay width-draggable** — same
>   `side-resize`/`side-expand` idiom `CharacterSidebar`/`DicePanel` already use —
>   specifically so a GM whose roster card runs long can drag the panel wider
>   rather than the card getting cramped. Chip rows (vitals, tags) wrap onto new
>   lines; the panel scrolls vertically only, never sideways.
>
> **Next action, if you're picking this up fresh:** build the real
> `client/src/pages/VirtualTable.tsx` (routes `/gruppe/:id/tisch`,
> `/event/:id/tisch`), the layout shell per the CSS/layout section below, and wire
> in `CharacterSidebar`/a new compact `GroupOverview`-derived component per the
> settled scope above. No tokens, no painting yet — that's Phases 5–6.

> ## Status: building on `feature/virtual-table`, off `develop`
>
> **2026-08-24, second revisit — the room-identity phase is gone.** This plan's
> original "decision that grows the scope" assumed Event-Gruppen lived in a
> separate `temp_groups` table with their own id space, which would have forced
> a `group_feed` rebuild and a generalised `RoomKind`/`RoomKey` layer before any
> board code could be written. That assumption is now false: commit `be5a995`
> ("Event-Gruppen get full chat/dice-dock parity with real groups") merged event
> groups into the real `groups` table behind an `is_temp` flag, *before* this plan
> was first written against a branch that had it merged but not yet accounted
> for. Checked directly against `server/src/db.ts`:
> - `groups` carries `is_temp INTEGER NOT NULL DEFAULT 0`; an event group is a row
>   in the same table, same autoincrement id space, as a permanent group.
> - `group_feed.group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE`
>   already covers both kinds. **No rebuild, no `room_kind` column, nothing to
>   migrate** — chat and dice already work identically for event groups.
> - The WS room map, `SocketMeta.groupId`, and the three roll registries
>   (`coopPools`, `pendingRolls`, `groupRolls`) are all already keyed by this one
>   shared id space. Nothing to generalise there either.
> - Membership resolution already handles both: `isGroupMember` (exclusive,
>   permanent) and `isTempGroupMember` (additive, via `temp_group_members`) are
>   OR'd into `isRoomMember` / `charBelongsToRoom`, reused identically by REST
>   (`routes.ts`) and WS (`ws.ts`).
>
> **What is real and still needs building:** there is no player-facing route for
> an event group today — only the GM's `/event/:id/uebersicht` and the shared dice
> dock. Permanent groups have `/gruppe/:id` (`Group.tsx`); event groups have no
> equivalent page at all. That gap is now folded into Phase 1 directly, sized
> correctly: a route and an entry point, not a data-model migration.
>
> Everything else below — the texture and autotiling work, the images-on-the-table
> design, fog of war, tokens, initiative — was written independently of the room
> question and is unaffected. Superseded text from the 2026-08-24 first revisit
> (the room-identity data model, the `group_feed` rebuild, `shared/src/room.ts`)
> has been removed rather than kept as a crossed-out appendix, to avoid the exact
> staleness trap this plan was warned about twice already.
>
> **Prior revisit (2026-08-24, first pass), still valid:** `feature/dice-rolls-chat`
> and `feature/wiki` are merged into `develop` **and released** (`0.6.0`, `0.7`,
> `0.7.1`). `docs/concepts/VTT-concept.md` was a stale duplicate and has been
> deleted; `TODO.md` points here only. New scope agreed at that revisit: textured
> tiles with autotiled transitions, and placeable images on the table — both
> described below, and since prototyped with real CC0 textures
> (`docs/concepts/virtual-table-mockup/Texturen.html`).

## Visual reference (early, not final)

A first-pass mockup exists showing the page shell this plan describes: quick
panel · map · docked chat, a GM view next to a player's to show the fog-of-war
asymmetry (opaque "Unerforscht" for players vs. semi-transparent for the GM,
with a hidden token that never reaches the player's view at all), the
initiative strip with a Todesschwelle countdown, and the per-board Karten-Rechte
panel from the edit-rights decision.

**It is a rough layout pass, not a design to build from.** Colors, spacing,
iconography and the map's decorative tokens (tile/fog hues) are first guesses —
matched to the app's real light/dark palette (see below) but not reviewed as a
design. It also predates the texture decision, so its flat-colour tiles no longer
represent the intended look. Expect this to change.

- Source: `docs/concepts/virtual-table-mockup/` (`Main.dc.html`,
  `PlayerView.dc.html`, `canvas.json`) — plain HTML/CSS, readable without
  tooling.
- It follows the app's actual `:root` tokens for light mode and the real
  `:root[data-mode='dark']` + Khôm/rot dark-mode values from `styles.css`,
  switching with the viewer's system preference. The map-specific decorative
  tokens (`--map-*`, `--tile-*`, `--fog-*`) don't exist in the app yet and are
  this mockup's own invention, chosen to sit alongside the existing
  warn/crit/over semantic tones rather than add new hues.

## Context

The app manages characters for a house pen-&-paper system. Dice and chat shipped
a per-room WebSocket feed carrying chat and server-authoritative rolls, rendered
in a floating dock.

This feature extends that into a **virtual table** — a shared, live battle map
per play group. It is the app's first spatial, continuously-updating shared
surface, and the first that must filter *map* state per viewer (fog of war).

The ground was prepared: the docked panel was built so any page can call
`useDicePanel()` and reuse the same connection and `FeedEntryView`, and
`DicePanelProvider` already carries `hidden`/`setHidden` specifically so a
dedicated page can suppress the dock. The chat half of this feature is therefore
additive, not a rework.

`TODO.md` notes that a group is streaming their sessions, which raises the
priority of this work.

## Decisions settled with the developer

| Question | Decision |
|---|---|
| Map source | **Tile painting** with **textures**, plus **placeable images**. See both sections below. |
| Tile fills | **Texture *or* flat colour per cell.** Flat colour stays — blocking out a room quickly shouldn't require choosing art. |
| Texture source | **A bundled CC0 set** shipped as static files (ambientCG / Poly Haven style), reviewed by the developer before it lands. Not uploads, not `helden-assets.db`. |
| Texture transitions | **Full autotiling** — materials blend at their borders instead of meeting at a hard grid edge. Achieved through geometry, not authored edge art; see "Autotiling". |
| Images on the table | **In scope.** Place a picture, move/scale/rotate it; optionally set it to **Hintergrund**, which makes it non-interactive (locked, below the tokens). Aimed at maps built in dedicated mapping tools and at player homes. |
| Background ≠ backdrop | A „Hintergrund" image is **not stretched across the board**. It keeps its own footprint and is simply non-interactive by the usual means. The old reserved single `bg_image_id` column is therefore **dropped** in favour of a real image table. |
| Fog over images | **Cosmetic only.** An image blob cannot be redacted per cell without decoding it, and the server has no image library by design. The strict no-leak guarantee covers **tiles and tokens**; images are shipped whole. Accepted knowingly — these images are player homes and prepared maps, not the hidden half of a dungeon. |
| Grid | **Square**, 1 cell = **1 Schritt**. |
| Boards | **One board per room** (no multiple scenes). |
| Fog of war | **In scope.** Hidden tile and token state must never reach a player's client. |
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

### Event-Gruppen: already solved, mostly

"Event-Gruppen should of course have their own chat and table rooms" sounds like
it reaches into the chat feature's foundations, and the first pass of this plan
treated it that way — a `RoomKind`/`RoomKey` layer, a `group_feed` rebuild, three
registries switched from a numeric id to a token. **None of that is needed.**
`groups.is_temp` already makes an event group a normal row in the normal table,
so `group_id` — everywhere it already appears, unchanged — addresses both kinds.
Chat and dice already work for Event-Gruppen today, in production.

**What's actually missing is a player entry point.** `Group.tsx` gives permanent
groups a room page at `/gruppe/:id`; there is no `/event/:id` equivalent, so a
player in an event group can reach chat only through the floating dock's room
picker, never a page. Since the virtual table is exactly the kind of full-page
surface that page would anchor, building it is folded into this plan's first
phase rather than kept as a separate ticket — a player needs somewhere to land
before there's a board for them to look at.

Membership for both kinds is already unified and reusable as-is: `isGroupMember`
(exclusive, via `characters.group_id`) and `isTempGroupMember` (additive, via
`temp_group_members`, joined through character ownership since that table holds
character ids, not user ids) are OR'd into `isRoomMember` /
`charBelongsToRoom`, used identically by REST (`routes.ts:150-168`) and WS
(`ws.ts:204,218-226`). The board's access checks reuse this directly; nothing new
is required at the membership layer.

---

## Data model

### Board tables — `server/src/db.ts`

`group_id` is enough — no `room_kind`, no second FK, no rebuild of anything. An
event group is a `groups` row like any other, so `ON DELETE CASCADE` on this one
column already covers a deleted event group cleanly.

```sql
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  cols INTEGER NOT NULL DEFAULT 40,
  rows INTEGER NOT NULL DEFAULT 30,
  tiles_json TEXT NOT NULL DEFAULT '{}',  -- sparse painted cells, see "Tile values"
  fog_json  TEXT NOT NULL DEFAULT '[]',   -- sparse HIDDEN cells (empty = nothing hidden)
  seed INTEGER NOT NULL DEFAULT 0,        -- per-board render seed: texture variation + edge noise
  -- GM-configurable usage rights, 'gm' | 'all'. Measuring is always 'all' and
  -- fog is always 'gm', so neither gets a column — they are not negotiable.
  perm_tiles  TEXT NOT NULL DEFAULT 'gm',
  perm_labels TEXT NOT NULL DEFAULT 'gm',
  perm_tokens TEXT NOT NULL DEFAULT 'gm',   -- create/delete tokens
  perm_images TEXT NOT NULL DEFAULT 'gm',   -- place/move/delete images
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
  cover_asset TEXT,                       -- reserved: uploaded cover art (asset slug), NULL in v1
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_overlays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- 'label' | 'measure'
  data_json TEXT NOT NULL DEFAULT '{}',   -- text/anchor, or shape+origin+radius
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  asset_slug TEXT NOT NULL,               -- lives in helden-assets.db, owner ('board', board_id)
  modus TEXT NOT NULL DEFAULT 'objekt',   -- 'objekt' | 'hintergrund' (= locked, non-interactive)
  x REAL NOT NULL DEFAULT 0,              -- board coordinates, in CELLS, top-left
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 1,              -- footprint in cells — never "the whole board"
  h REAL NOT NULL DEFAULT 1,
  rotation REAL NOT NULL DEFAULT 0,       -- degrees
  opacity REAL NOT NULL DEFAULT 1,
  z INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0       -- GM-only: withheld from players entirely
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

### Tile values — one tagged string per cell

`tiles_json` maps a cell key to a **tagged string**, so a cell is exactly one
thing and the parser is one function:

| Value | Meaning |
|---|---|
| `#8b2635` | flat colour |
| `t:gras` | a built-in texture, key from the catalogue |
| `a:<slug>` | reserved — a GM-uploaded texture, not built in v1 |

`parseTileValue()` lives in `shared/src/board.ts` next to the cell-key helpers.
No migration cost exists for any of this: no board has ever been created.

Tiles and fog are JSON columns following the `group_feed.roll_json` precedent
(complex sub-object, type lives in `shared/`). Sizing check: a 40×30 board is
1200 cells; a fully painted `{"12,7":"t:gras", …}` is ~20 KB, and real boards are
sparse. Cap board size at 100×100 so the worst case stays bounded. Tokens,
overlays, images and initiative get real tables because they are individually
updated, need FKs, and are few.

### The texture catalogue — `shared/src/boardTiles.ts`

A frozen list, same shape and same reasoning as the status catalogue: swapping
artwork later is a rendering change, not a migration.

```ts
export interface TileMaterial {
  key: string;       // 'gras' — what gets stored, never the filename
  label: string;     // „Gras" — UI, German
  gruppe: string;    // „Boden" | „Wasser" | „Wand" … — picker grouping
  datei?: string;    // 'gras.jpg' under client/public/tiles/; absent = generated
  prio: number;      // autotile layering, see below
  kante: 'hart' | 'natuerlich';   // how this material meets its neighbours
}
```

**`kante` belongs to the material, not to the board.** A brick wall has straight
lines; grass does not. So the edge treatment is a property each material carries,
not a global switch — anything built or laid (Ziegel, Fliesen, Steinboden,
Holzdielen, Bretter, Teppich) meets its neighbours on the grid, and only grown or
poured material (Gras, Moos, Erde, Sand, Schnee, Fels, Wasser, Lava) is allowed to
fray. Getting this wrong is immediately visible: a masonry wall with a noisy
outline reads as broken, not as natural.

**The files are static assets under `client/public/tiles/`, not
`helden-assets.db`.** That is a deliberate simplification with a concrete payoff:
the built-in set never participates in the cross-database delete problem, so no
board-delete path has to remember it. Only *uploaded* images do — and those are
the `board_images` table, which does have to remember it.

**The set exists** — it is not a proposal any more. Thirteen CC0 textures were
pulled from Poly Haven and ambientCG, downscaled to **256×256 JPEG (q82)** with
wrap-around edge sampling so tileability survives the resize, and committed at
**184 KB for the whole set**. Origin and asset id per file are recorded in
`client/public/tiles/QUELLEN.md`. Only the materials actually painted on a board
get fetched.

| | |
|---|---|
| Poly Haven | Sand, Erde, Gras, Waldboden, Schnee, Fels, Steinboden, Fliesen, Ziegel, Holzdielen, Bretter, Teppich |
| ambientCG | Lava |
| generated | Wasser tief, Wasser seicht |

**Water is deliberately generated, not photographed.** The CC0 libraries have no
usable top-down water surface — searching them for "water" returns ice and
surface stains — and a photograph of still water tiles visibly badly, because
repetition is most obvious on a featureless surface. The generated ripple is
seamless by construction and costs no file.

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
  inline SVG, in keeping with the app's existing inline-SVG use). `cover_asset`
  is reserved so an uploaded image can take over later without touching the token
  rows.

The catalogue lives in `shared/src/boardStatus.ts` as a plain frozen list
(`{ key, label, emoji }`).

### Persisted vs ephemeral

| State | Where | Why |
|---|---|---|
| Board, tiles, fog, tokens, overlays, images, initiative, round | SQLite | Survives a session; the whole point of prep. |
| **In-flight drag positions** (tokens *and* images) | Broadcast only, **never** a DB write per event | better-sqlite3 is synchronous and single-writer; a write per pointermove would block the event loop. Server re-broadcasts immediately, debounces the DB write ~150 ms per object, and force-flushes on drop. |
| Per-user camera (pan/zoom) | Client `localStorage` | Purely personal; no reason to involve the server. |
| "Center all on my view" | One-shot broadcast | An event, not state. |
| Autotile geometry, texture variation | Derived on the client from `tiles_json` + `boards.seed` | Never stored, never sent. Same input ⇒ same picture on every client. |

---

## Textures and autotiling

The point of textures is that a painted map should read as terrain, not as a
spreadsheet with coloured cells. Two things stand between a seamless texture and
that: visible repetition, and hard grid-aligned borders between materials.

### Rendering

One `<pattern patternUnits="userSpaceOnUse" width="1" height="1">` per **used**
material in `<defs>`; the cells of a material merge into a single `<path>` filled
with `url(#tex-gras)`. Node count is therefore O(distinct materials), not
O(painted cells) — which is the same argument that chose SVG over canvas in the
first place. Flat-colour cells work identically with a plain fill.

### Repetition — anchored to the board, not the cell

The first prototype pass tried per-cell rotation: hash `(x, y, board.seed)` to one
of four 90°-rotated copies of the texture. **The prototype showed this was wrong**
— a seamless texture is already continuous across a cell border, and rotating
individual cells *breaks* that continuity instead of hiding the repeat: grain,
brick courses and blade direction all turn at every rotated boundary, and the
result reads as patchwork rather than terrain. Measured as colour discontinuity at
a cell border vs. inside a cell (1.0 = invisible): rotated floorboards measured
1.56, the same board with rotation off measured 0.94.

**Fix that was kept:** the pattern is anchored to **board coordinates**, not cell
coordinates — one image spans several cells (`felder`, default 3 in the
prototype) rather than one. Continuity holds everywhere and the repeat period
grows with the span, at zero storage cost either way. It is also the physically
correct model: the source photographs are 2–4 m of ground, and a cell is one
Schritt, so a multi-cell span is closer to true scale than a per-cell tile ever
was. A coarse, board-wide `feTurbulence` shading layer (unrelated to the cell
grid, blended `multiply`) further breaks up whatever regularity is left, without
touching the texture itself.

Per-cell rotation is not deleted from the prototype — it stays as the labelled,
switched-off comparison (`Drehung je Zelle`), because it is the concrete argument
for why the anchored approach is the one to build.

### Autotiling without edge art

Classic 47-tile bitmasking needs an authored transition sheet per material — or
per material *pair* — and CC0 seamless textures do not come with those. So the
transitions come from **geometry** instead:

1. Every material carries a **`prio`** (Wasser < Sand < Erde < Gras < Moos <
   Stein …). Layers render bottom-up by priority.
2. Each material's cells become **one mask**, and the transition is produced *in
   the mask* rather than in the artwork: blur the cell shape, then threshold the
   alpha hard. That single step outsets the region by a fraction of a cell and
   rounds its corners. Outer corners, inner corners, single-cell islands and
   diagonal touches all fall out of it — **every pair of materials works without
   anyone drawing anything.**
3. For a material whose `kante` is `natuerlich`, an `feTurbulence` +
   `feDisplacementMap` sits between blur and threshold, seeded from `boards.seed`
   so every client draws the identical boundary. A `hart` material skips the
   filter entirely and renders pixel-identical to a plain grid edge.
4. **The processed mask is then unioned with the original cells**
   (`feComposite operator="over"` against `SourceGraphic`). Without this the
   displacement pulls the mask inward in places, and where two neighbouring
   materials both retreat from their shared border the page background shows
   through as a hairline gap. With it the edge can only ever move *outward*, so
   every painted cell is guaranteed covered by at least its own material.

**This replaces the marching-squares `cellSetOutline`.** The prototype was built
to test the outline-path approach and found the mask does the same job with no
path math at all — which removes the most test-heavy function from the shared
workspace. `cellSetOutline` is dropped from `shared/src/board.ts` below.

Measured in the prototype (`docs/concepts/virtual-table-mockup/Texturen.html`),
rasterised and pixel-sampled rather than eyeballed:

| | result |
|---|---|
| `hart` material vs. a plain grid edge | **0.00 px deviation** — dead straight |
| `natuerlich` material | **+2.5 % area**, growing outward only |
| background bleed-through, all combinations | **0 pixels** (159 without the union) |

**Risk, stated up front:** a displacement filter over a 100×100 board may be too
slow, especially while dragging. Step 2 alone already looks far better than a hard
edge and is cheap, so step 3 stays behind a flag that can be turned off per
client, and **this is not "done" until it has been measured in a browser on a
large, densely painted board.** The fray amplitude is one constant
(`feDisplacementMap scale`) if it wants to be stronger or calmer.

### Theming — the map is exempt

Textures do not follow the app's six colour worlds, and nothing tries to make them.
**Settled with the developer: the colour mode is irrelevant to the tiles.** Only
the *chrome* is themed — grid lines, fog, labels, selection, range highlight, the
tool palette. The map reads as a map inside a themed shell, and the light/dark
check that every other visual change owes applies to the chrome, not to the
terrain.

---

## Images on the table

Two modes, one table:

- **`objekt`** — a prop on the map: drag, scale, rotate, z-order. Sits above the
  tiles and below the tokens.
- **`hintergrund`** — the same picture, made non-interactive: locked position, no
  hit-testing, drawn below the tile layer. **It keeps its own footprint; it is not
  stretched across the board.** This is what a group's home built in a mapping
  tool becomes.

**Grid alignment** is computed, not eyeballed. `masse.ts` already reads the real
pixel dimensions server-side at upload without decoding the image, and mapping
tools export at a known pixel-per-cell. So the placement dialog offers „Pixel pro
Feld" and derives `w`/`h` in cells from that; free-scaling with a snap-to-grid
toggle stays available for everything else.

**Assets.** `OwnerTyp` in `server/src/assets/store.ts` gains `'board'`, and the
images live in `helden-assets.db` like every other blob. **SQLite has no
cross-database CASCADE**, so per CLAUDE.md:

- deleting a board calls `loescheAssetsFuer('board', boardId)` by hand;
- deleting one image calls `loescheAsset(slug)` by hand;
- `fegeVerwaisteAssets('board', lebendeBoardIds)` joins the weekly sweeper in
  `assets/sweep.ts` — as the safety net for what gets missed, never as the
  mechanism.

Deleting a *room* deletes its board by FK cascade **inside `helden.db` only**, so
the room-delete path is a third place that must call the asset cleanup. That is
the single easiest thing to get wrong in this feature after fog.

**Rights** follow the same shape as everything else: `perm_images`, default „nur
Spielleitung", enforced server-side in `boardAccess.ts`.

### Fog over images is cosmetic — stated plainly

The fog guarantee — *hidden state never reaches a player's client* — holds for
**tiles and tokens**, which are per-cell and can be withheld. An image is a
single blob spanning many cells and cannot be cut without decoding it, and the
server has no image library **by design**: `masse.ts` reads only headers ("nur
die Kopfdaten werden gelesen, nie das Bild dekodiert"). Adding one to slice
images into fog-sized chunks would buy a native dependency and chunk-boundary
artefacts for a case the developer explicitly called unimportant — these images
are player homes and prepared maps.

So: **an image under fog is drawn under the fog, but its bytes are in the
player's payload.** The one all-or-nothing escape hatch is `board_images.hidden`,
which withholds the image from players entirely — that is the mechanism for a
prepared map section the GM wants to reveal later. The GM's image dialog says so
in as many words, because a GM who *believes* fog hides an image would be wrong
in a way that only shows up in someone's network tab.

---

## Realtime design

**Extend the existing socket, don't add a second one.** A parallel channel would
duplicate auth, heartbeat, reconnect and rate limiting, and give a client two
connections whose ordering could not be reasoned about.

Concretely, in `server/src/ws.ts`:

1. **No path or key change needed.** The upgrade path stays `/ws/groups/:id`, the
   `rooms` map stays keyed by the plain numeric id, `SocketMeta.groupId` is
   untouched — an event group is already just a `groups.id` like any other. Board
   messages ride the same socket and the same room membership as chat.
2. **The existing `broadcast()` is typed to `FeedEntry` and hard-wired to
   `canSeeFeedEntry`.** It gains a builder-based sibling:
   `broadcastBuilt(key, build: (viewer: SocketMeta) => ServerToClientMessage | null)`
   — returning `null` means "this viewer gets nothing". The feed keeps its exact
   current behaviour by passing a builder that consults `canSeeFeedEntry`; board
   messages pass one that consults the fog/hidden redaction.
   **Naming, and it matters:** `broadcastToRoom` is *already taken* at
   [ws.ts:140](server/src/ws.ts:140) and means "unfiltered, to everyone in the
   group". Two different visibility semantics under one name is precisely how a
   fog leak gets written by accident, so the new function does not take that name
   — and the old one is worth renaming to `broadcastUngefiltert` while touching
   the file anyway.
3. New message types on the existing unions in `shared/src/diceProtocol.ts` (or a
   sibling `boardProtocol.ts` re-exported from the same barrel, to keep the dice
   file focused): `board.move`, `board.token.*`, `board.tiles`, `board.fog`,
   `board.overlay.*`, `board.image.*`, `board.initiative.*`, `board.round.*`,
   `board.view.center`. Every client→server message keeps the existing `reqId` +
   `ack`/`error` shape.

**Fog of war is the hard part, and it is structural.** The guarantee is "a
player's client never receives hidden tile or token state", so redaction cannot
live in the renderer. All board mutations funnel through one `emitBoardChange()`
in `server/src/board.ts` which computes a *per-viewer* payload:

- **the `fog` set itself is public** — players receive which cells are fogged and
  render them opaque, so the unexplored area reads as unexplored instead of as
  empty floor. The GM renders the same cells semi-transparent, reading the map
  underneath while seeing exactly what is withheld. Only the GM may *change* it;
- cells listed in `fog` are omitted from a player's tile payload entirely;
- tokens with `hidden=1`, or standing on a fogged cell, are omitted for players;
- images with `hidden=1` are omitted for players; images merely *under* fog are
  not (see above);
- consequently, moving a token into fog sends players a `board.token.remove` while
  the GM gets a `board.token.update`. Revealing fog sends players the newly
  visible tiles *and* tokens.

There is an exact precedent in this codebase and it should be read before
`emitBoardChange()` is written: the wiki's GM-only regions are stripped
server-side (`verbergeGmBloecke`) on the reasoning that a client which merely
declined to render them would still have shipped the text.

**Tile and fog writes are deltas, never full-map replaces.** This is the inverse
lesson from the same wiki work — *never send a redacted version and then accept it
back as a write*. A player whose `perm_tiles` is `'all'` holds a tile map with the
fogged cells stripped out, so accepting a whole-map save from them would erase
everything the GM painted under fog: the no-data-loss rule, applied to somebody
else's map. The client sends only the cells it actually touched. **Not optional.**

**Drag conflicts and resync.** Token and image moves are last-write-wins — with a
handful of players around one table, locking is ceremony nobody needs; the loser
sees the object snap, which is self-correcting. Client throttles pointermove
broadcasts to ~20/s and renders its own drag optimistically, ignoring echoes of
its own moves while a drag is active. Every board message carries the board's
`rev`; a client that sees a gap refetches the full snapshot. On reconnect the
client fetches the snapshot and buffers live pushes until it lands — the same race
fix `DicePanelProvider` already uses for the feed (`liveBufferRef` + merge).

---

## Server module layout

| File | Responsibility |
|---|---|
| `server/src/board.ts` (new) | Load/mutate board state, `emitBoardChange()` per-viewer redaction, the debounced position writer, and the asset cleanup calls on every delete path. Membership itself is not reimplemented here — it calls the existing `isRoomMember`/`charBelongsToRoom`. |
| `server/src/boardAccess.ts` (new) | The one place board rights are decided: `canPaint`, `canLabel`, `canEditTokens`, `canMoveToken`, `canEditImages`, each reading the board's `perm_*` setting (`'gm'` ⇒ `viewer.isGm`, `'all'` ⇒ any room member, via `isRoomMember`). `canEditFog` is hard-coded to `viewer.isGm` — deliberately not a setting, since a player able to lift fog defeats the point. There is no `canSeeFog`: the mask is public, only its *contents* are redacted. `owner_user_id` on the token is recorded but unused in v1; it is what a future "own token only" mode would read. |
| `server/src/ws.ts` | The broadcast rename above, and the new `board.*` cases in the existing `switch`. No path or key changes — see "Realtime design". |
| `server/src/feed.ts` | Untouched. |

REST (in `server/src/routes.ts`, guards composed as the file already does — the
existing `isRoomMember`/`isGm` checks, not a new membership layer):

```
GET  /api/groups/:id/board                -- full snapshot, already redacted for the viewer
POST /api/groups/:id/board/images         -- upload, guarded by perm_images
```

`/groups/mine` and `/groups/:id/feed` already serve both group kinds and need no
change.

Everything else mutating goes over WS, so there is one ordering domain and one
place that broadcasts. The image upload is REST because it carries bytes.

---

## Shared pure logic (gets vitest coverage)

`shared/src/board.ts` — no I/O, following the `shared/src/dice.ts` precedent:

- `cellKey(x,y)` / `parseCellKey`, `encodeCellSet` / `decodeCellSet` (sparse).
- `parseTileValue(raw)` — `#rrggbb` | `t:<key>` | `a:<slug>`, tolerant of junk.
- `gridDistance(a, b)` — **Chebyshev**: `max(|dx|, |dy|)`, so a diagonal step costs
  1 Schritt and a movement range renders as a square. Settled.
- `tokenCells(token)` for `size > 1`.
- `shapeCells(shape)` — which cells a circle / rectangle covers, for range
  highlighting. **The cone is deliberately excluded**: per the developer it may
  stay *visual only*, drawn as a true geometric wedge without cell-accurate
  coverage.
- `initiativeOrder(entries)` — value descending, stable tiebreak.
- `canAdvanceRound(entries)` — every entry `done`.
- `advanceRound(state)` — bumps the round, clears `done`, ticks every active
  `death_countdown`, and reports which reached 0.
- `deathCountdown(lp, todesschwelle, current)` — the state machine: `lp <= 0` and
  no counter ⇒ start at `todesschwelle`; `lp > 0` ⇒ clear; otherwise unchanged.

**No autotile function lives here.** The prototype found the SVG mask pipeline
(blur → threshold → union, per material, keyed by its `kante`) does the whole job
declaratively — no outline math, no per-cell variant to precompute. That work is
all in the client's SVG generation, not in shared pure logic; see "Autotiling
without edge art" above.

`shared/src/boardTiles.ts`, `shared/src/boardStatus.ts` — the frozen catalogues.
Data, not logic, so they need no tests beyond key uniqueness.

`shared/test/board.test.ts` — Chebyshev distance (symmetry, pure diagonal costing
the same as pure straight, the case that would fail under Euclidean), sparse
encode round-trip, tile-value parsing, `shapeCells` for circle and rectangle,
initiative ties, round advance blocked until all done, countdown
start/tick/clear/death, and `size>1` cell coverage.

Initiative rolling itself stays server-side (`server/src/dice.ts` `rollDie(6)` +
`computeBaseValues(...).ini.ergebnis`), matching the standing rule that the
client never supplies a number.

---

## Client architecture

**New page** `client/src/pages/VirtualTable.tsx`, routes added to `App.tsx`:
`/gruppe/:id/tisch` and `/event/:id/tisch`. Entry points: a link on `Group.tsx`
beside the existing "Spielleiter-Übersicht →", one on `GroupOverview.tsx`, and one
from the event-group list in Verwaltung.

**Render the map as SVG, not canvas.** Tokens need portraits (`<image>`), status
badges, text labels, and hit-testing for drag — all free in SVG through ordinary
DOM events and React's declarative rendering. Textures are `<pattern>` fills and
the autotile blend is a mask plus filter, which are likewise native. Canvas would
mean hand-rolling hit-testing, image loading and a redraw loop for a board that
changes on events, not on frames. `BannerFx.tsx` is canvas because it animates
continuously; this does not.

**Layer order**, bottom to top: Hintergrund-Bilder → tile layers (by material
`prio`, each with its blend mask) → grid lines → Objekt-Bilder (by `z`) →
labels and measurements → tokens with badges and covers → fog → interaction
chrome (selection, range highlight, drag ghost). Grid lines are a CSS background
on the viewport, not thousands of nodes.

**Pan/zoom** via the `<svg>` `viewBox` (crisper than a CSS transform, and keeps
board coordinates as the only coordinate system). Panning uses the repo's pointer
idiom — `onPointerDown` → `pointermove`/`pointerup` on `window` → a class on
`document.body` — the same shape as `CharacterSidebar.startResize`. No HTML5
drag-and-drop anywhere, consistent with the rest of the app.

**Board state is fetched keyed by room, and this is the bug the wiki page view
shipped twice.** Async state read during render must carry the identity of what it
describes; clearing it in an effect is too late, because the render that read it
has already returned. So the board response and the room key it answers live in
**one** state object, derived during render
(`geladen?.schluessel === schluessel ? geladen : null`), and every fetch keyed on a
route parameter gets a `let aktuell = true` guard whose cleanup drops the answer.
The reconnect-snapshot flow is the same shape.

**Tool palette.** One mode selector over the map — pan (default), paint, fog,
measure (ruler / circle / cone / rectangle), label, token, image. Each tool the
viewer lacks rights for is simply absent, and the server re-checks anyway; the
palette is convenience, never the enforcement. Measure is always present for
everyone. The paint tool opens a picker grouped by `gruppe` showing texture
swatches and the flat-colour row, with brush size and a rectangle fill.

**Board settings** (GM only): board size and the five `perm_*` toggles as plain
„Spielleitung / Alle" selects. Fog is not in this panel — it has no toggle by
design.

**"Center all on my view"** broadcasts `board.view.center {x, y, zoom}`; receivers
ease their `viewBox` to it. Available to everyone, not just the GM — it is a small
table and socially self-regulating.

**Chat column**: the page calls `setHidden(true)` on mount / `false` on unmount so
the floating dock does not double up (exactly what that flag was added for), and
`selectRoom({kind, id})` so the feed matches the board. The column reuses
`useDicePanel()` and `FeedEntryView`; the feed+input body of `DicePanel.tsx` is
extracted into a shared `FeedColumn` component used by both the dock and the page,
so there is one chat UI rather than two that drift.

---

## The `CharacterSidebar` reuse problem

This is the largest refactor risk after room identity, so it gets its own early
phase.

`CharacterSidebar` imports `useChar` from `pages/Character`, and every
subcomponent uses it. `CharCtx` lives inside `pages/Character.tsx` together with
the loader and the debounced autosave.

The context value is actually small and self-contained —
`{ charId, data, catalogs, update, rollCtx, requestCtx }` — and the autosave is a
tidy unit: a `dirty` Set, a 1500 ms timer, and a `flush()` that PUTs per section.

**Extract them into `client/src/components/charSheet.tsx`**, exporting
`<CharSheetProvider charId>` and `useChar()`. It owns loading, catalogs, `update`,
`flush`, `rollCtx`/`requestCtx` and `saveState`.

Stays in `Character.tsx`: tabs and tab order, print mode, the "Ansehen als" dev
preview, the edit toggle, name editing, table widths, scroll memory, and the
sticky-height refs. Those are page concerns, not sheet-data concerns.

`Character.tsx` re-exports `useChar` so the dozen importing files need no churn.
The VTT's quick panel then mounts
`<CharSheetProvider charId={myCharId}><CharacterSidebar/></CharSheetProvider>` —
always the viewer's own character, so always `access === 'edit'` and none of the
`?asUser=`/summary complexity comes along.

*Rejected alternative:* building a slimmed-down VTT-only panel. It would duplicate
the pool math, the `AktuellFeld` save path and the attribute roll wiring — three
places to keep in sync with the sheet, for a panel meant to be the same panel.

---

## CSS / layout

One new section in `client/src/styles.css`, tokens only (`--panel`, `--border`,
`--accent`, …) so all six colour worlds and dark mode work without extra rules.
The map surface itself is the documented exception — see "Theming" above.

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

**A sticky VTT toolbar is not done when its own rule is written.** Every `calc()`
for something sticking below it needs the new term, including rules shared with
pages that never render the toolbar (`.talent-search`, `.table-wrap table.sheet
thead`). Adding the term there is safe because an unset variable falls back to
`0px`. Related: `--tabs-h` also falls back to `0px` and every `.tabs` bar is
measured — the VTT page has no tab bar and must not inherit a guessed offset.

Small screens: below ~900 px the side columns become overlay drawers instead of
columns, so the map keeps the full width.

---

## Phases

Each is independently committable and ends in something demoable. Risk is
front-loaded: the phase that touches existing, released code comes first.

0. **Branch** `feature/virtual-table` off `develop` — done. This is large and
   touches released code — CLAUDE.md's "isolate risky/large work" exception
   applies.
1. **Event-Gruppen get a player page.** `/event/:id`, the `Group.tsx`-shaped
   counterpart to the existing permanent-group room page, reusing
   `isRoomMember`/`charBelongsToRoom` as-is. This is the one real gap the second
   revisit found — everything else about room identity was already solved by
   `be5a995`. Small and low-risk; it touches one new route, not shipped
   internals. **Ships: event-group players have somewhere to land.** No map yet.
2. **`CharSheetProvider` extraction.** Pure refactor, verified against the
   untouched character sheet. No new UI at all.
3. **Shared board math + schema.** `shared/src/board.ts` + tests, board tables
   (`group_id` only, no room-kind columns), snapshot endpoint. Inert — no
   user-facing change.
4. **Page shell.** Route, full-bleed layout, empty grid, pan/zoom, the fixed chat
   column, the quick panel. No tokens, no painting.
5. **Tokens.** Create/move/delete, status badges and covers, live sync, and
   `boardAccess.ts` with the `perm_*` checks plus the GM settings panel. Character
   tokens pull name and portrait; markers are ad hoc.
6. **Tile painting, flat colour, and the texture catalogue.** Painting, delta
   writes, the picker. The texture set itself, the per-material `kante`, the
   board-anchored pattern span and the coarse shading layer are already prototyped
   and reviewed (`docs/concepts/virtual-table-mockup/Texturen.html`) — this phase
   wires the reviewed rendering into the real page rather than designing it fresh.
7. **Autotiling.** The mask pipeline (blur → optional turbulence → hard threshold
   → union with the source cells) from the prototype, per material `kante`. Ends
   with a measured perf check on a dense 100×100 board in both colour modes —
   the prototype's numbers are from small boards.
8. **Labels and measurement shapes** (persistent and movable). Cone ships
   visual-only unless cell coverage falls out easily.
9. **Images on the table.** `board_images`, upload with `OwnerTyp 'board'`, the
   „Pixel pro Feld" alignment dialog, object vs Hintergrund, `perm_images`, and —
   in the same commit, not a follow-up — every asset cleanup path plus the sweeper
   entry.
10. **Fog of war.** Per-viewer redaction through `emitBoardChange()`, and the
    explicit „Bilder sind für Spieler ladbar" note in the GM's image dialog.
11. **Initiative and rounds.** Player-rolled `Basis + 1W6`, GM-typed monster
    values, the "done" checkbox gating round advance, the Todesschwelle countdown.
12. **"Center all on my view"** and polish.
13. **Changelog + TODO.** Fold the player-facing notes into the newest unversioned
    changelog entry and prune the virtual-table sketch from `TODO.md`. Mark GM-only
    bits with „(Spielleiter)". **No version number** — that is the developer's call,
    though a feature this size is a `0.X.0` recommendation.

---

## Verification

- `npm test -w shared` after phases 1, 3, 7 and 11 — the pure logic lives there and
  is the only workspace with a runner.
- Browser verification needs **two logged-in users at once**, and `localhost` and
  `[::1]` are separate cookie jars — so GM at `http://localhost:5173`, player at
  `http://[::1]:5173`, one role per origin. Seeds: `npm run seed` (GM
  `spielleiter`/`spielleiter`), `npm run seed:testuser` (`testspieler`/`test1234`),
  `npm run seed:dummy` for load. **Never reset `helden.db`** — it holds the
  persistent test accounts.
- Per phase:
  - **1** — as a player in an event group, reach `/event/:id` and see chat/dice
    work exactly as on a permanent group's `/gruppe/:id`; confirm a non-member
    (not in `temp_group_members`, not the GM) is redirected. This is verifying an
    already-shared code path in a new place, not new membership logic.
  - **2** — the sheet must behave identically: autosave, roll buttons, print,
    "Ansehen als".
  - **4** — pan/zoom in two browsers, confirm the dock is hidden and the column
    chat still works.
  - **5** — drag in one browser, watch it move in the other; check the server does
    not write per pointermove (log or count); flip each `perm_*` to `gm` and
    confirm the player's tool disappears **and** that a hand-sent WS message is
    still rejected — the palette is not the enforcement.
  - **6/7** — a dense 100×100 board, both colour modes: frame timing while panning
    and while painting, with the turbulence flag on and off. Confirm two clients
    render identical boundaries from the same `seed`.
  - **9** — upload an image, delete it, confirm the row in `helden-assets.db` is
    gone; then delete the whole board and confirm the same; then delete the *room*
    and confirm it again — that is the path most likely to leak blobs.
  - **10** — the decisive test: as a player, inspect the WebSocket frames and the
    snapshot response and confirm the fog mask *does* arrive while **no tile colour
    or token under it arrives at all** — not merely that they are not drawn. Move a
    GM token under fog and confirm the player's payload loses it. Confirm a
    `hidden=1` image never arrives. Then the data-loss half: with `perm_tiles` set
    to „Alle", have the player paint a cell next to a fogged region and confirm the
    GM's hidden tiles are still there afterwards.
  - **11** — round advance blocked until every box is ticked; drop a character to
    0 LP and watch the countdown tick and clear on healing.
- Clean up test artefacts afterwards (boards, uploaded images, any test event
  group) — they are visible to real players otherwise.
- Leave the dev servers running when done.

---

## Cautions carried into the build

- **Fog is the phase most likely to leak.** Its verification step is not "the
  hidden thing isn't drawn" but "the hidden thing is not in the payload". A
  visual-only check is a failed check — the more so now that players legitimately
  receive the fog mask, which makes a leak of its *contents* easier to overlook.
- **Images are the phase most likely to orphan blobs.** Three delete paths (image,
  board, room), no cross-database CASCADE, and a sweeper that must stay a net.
- **Autotiling is the phase most likely to be slow.** Ship the cheap half first and
  measure before adding the filter.
- **A derived column added by `ALTER TABLE` is filled with its DEFAULT, not with
  the right answer.** All the tables here are new, so their defaults are correct
  from the start — but if a derived column is ever added to one of them later, it
  needs a boot-time re-derive next to `indexNachziehen()`. A `user_version` step
  would catch neither a rollback nor a restore from an older backup.
- **Reserved, not designed for:** `cover_asset` (token cover art), `a:<slug>` tile
  values (GM-uploaded textures), `owner_user_id` (a future "own token only" mode).
  Everything else is genuinely unplanned.

## Still open

- **Which status keys.** Settled as "fine for now" — vergiftet, betäubt, liegend,
  brennend, blind, stumm, gelähmt, gesegnet, unsichtbar, plus the covers *tot* and
  *bewusstlos*. One frozen array, so additions are a later pass.
- **Which textures.** The starting list above is a proposal; the developer reviews
  the actual files before Phase 6 lands.
- **The autotile outset distance and rounding radius** are visual constants to be
  tuned against the real texture set, not decided on paper.
