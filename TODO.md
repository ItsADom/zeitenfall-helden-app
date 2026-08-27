# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English. Tasks inside a prio-category are not ordered by urgency.

Durable engineering rules (the scroll-container/sticky-offset/display-mode/no-
data-loss gotchas) now live in `CLAUDE.md`; run-book bits (HTTPS/secure cookies)
live in `README.md` / `DEPLOYMENT.md`.

## Readiness tags

Each open item is tagged: **[sketch]** = a raw idea + instructions; needs a
concept worked out (and sign-off) before building. Do not assume a sketch to be ready, because it looks trivial.
**[ready]** = concept agreed, can go straight to a build plan. Priority is the section (High/Mid/Low);
"on hold" / "blocked" notes stay inline and are a separate axis.

---

## Virtual table

- [ready] **Limit active measure shapes per player** (concept agreed): GM's
  concern is players drawing shapes for every possible spell area at once,
  cluttering the map with multi-colored shapes/labels. `board_overlays`
  (`server/src/db.ts:557-564`) currently has no owner concept at all — unlike
  `board_tokens.owner_user_id` — and `canMeasure()` (`server/src/boardAccess.ts`)
  is hard-coded `return true`, so today's measure shapes are fully anonymous
  and unlimited. **Decided:** add `owner_user_id` to `board_overlays` (set from
  `meta.userId` on create, mirroring the token pattern), one global cap of 3
  active measure shapes per player across all shape kinds (not per-kind), GM
  exempt/unlimited. On `board.overlay.create` (`server/src/ws.ts:~1590`),
  count the caller's existing measure overlays first; if at cap, reject the
  create (don't persist/broadcast) rather than auto-evicting the oldest.
  Client shows a toast/message on rejection (e.g. "Maximum von 3 Formen
  erreicht"). Deleting an existing shape is already unrestricted
  (`ws.ts:1662-1686`, no ownership gating), so a capped player can always free
  a slot themselves. `owner_user_id` needs to reach the client in the
  broadcast payload (`shared/src/boardProtocol.ts` `BoardOverlay`) so the
  client can track its own count too.

- [ready] **Round tracker for spell duration etc.** (concept agreed): a
  personal countdown, separate from the ordered initiative/turn list —
  "really just some possibility to separately track different
  round-sensitive data." The initiative system already separates *round*
  from *turn*: `boards.round` (`server/src/db.ts:519-520`) increments only
  when `nextTurn()` reports `wrapsRound` (`shared/src/board.ts:220`), inside
  `advanceTurn()` (`server/src/board.ts:820`) — the exact hook point for this
  feature, not per-combatant-turn. **Decided:** new `board_round_trackers`
  table (board-scoped, one row per timer: `board_id`, `creator_user_id`,
  `label`, `current_count`). Anyone (GM or player) can create one with a
  label and a starting count. Decrements by 1 automatically at the
  `advanceTurn()` round-wrap point, floors at 0 and stays visible there (no
  auto-removal). Owner can freely bump the count up or down at any time
  (covers recasting a spell to recharge its duration). **Decided: fully
  private** — this is personal record-keeping, not shared table state, so a
  tracker is never sent to any other viewer's connection, GM included (no
  `hidden` flag, no per-viewer visibility logic needed at all — simpler than
  first framed). Persisted in the DB (not localStorage) so it survives
  refresh/reconnect. Multiple independent trackers per player, no cap
  discussed/needed.

- [ready] **Wound tracking / count-display on VTT tokens** (concept agreed):
  not the existing LE resource — a separate house-rule wound mechanic.
  Confirmed rule: damage that hits/exceeds the character's Wundschwelle
  (`shared/src/rules.ts` `wundschwelle = ceil(KO/2)`) inflicts one small
  wound; damage at least double the Wundschwelle inflicts one big wound; two
  small wounds internally count as one big wound; three big-wound-
  equivalents means death. **Decided:** persists as real character state (not
  board/combat-scoped like the round tracker) — two new counters,
  `small_wounds`/`big_wounds`, stored with the character. **Decided:** purely
  manual entry — `+1`/`-1` buttons for each wound type (also covers healing),
  no automatic damage-number-to-wound-type math. **Decided:** editable by the
  token's owner and the GM (same population that can already edit/move that
  token). **Decided:** VTT-only for this round — displayed as a small badge/
  indicator on the character's token (visible to owner + GM only, following
  the same owner-bypass pattern already used for token edit permissions —
  extended here to a display filter rather than an edit check; today's
  redaction only ever branches on `isGm`, per `server/src/board.ts:277-279`,
  so this is a new per-owner visibility case). No character-sheet
  integration — some players keep their own separate paper tracker for wound
  count *and location*, which stays optional/out of scope; this feature only
  covers the count, on the table.

- [ready] **Bigger, GM-configurable drawing area** (concept agreed): the grid
  is currently hardcoded at 40×30 with no resize path anywhere at all
  (`server/src/db.ts:501-502`, plain `DEFAULT` columns, never updated).
  **Decided:** make `cols`/`rows` GM-configurable per board (e.g. in
  `BoardSettingsPopover`, `client/src/pages/VirtualTable.tsx:3926`), not just
  a bigger fixed constant. **Decided: decouple the grid from the pannable
  viewport** — grid bounds should only govern where grid-lines/fog/paint/
  cell-snapping apply, not where content is allowed to exist. Today
  `server/src/ws.ts:1575` rejects any token position with
  `x > board.cols || y > board.rows`, and the client's `clampCamera`/
  `totalW`/`totalH` (`VirtualTable.tsx:621-623`) tie pan bounds directly to
  `cols`/`rows` — both need to stop treating grid size as a hard placement/
  viewport boundary. This is what makes shrinking safe: a smaller grid never
  strands, hides, or deletes existing tokens/shapes/images — content beyond
  the new smaller grid simply sits in ungridded space, still fully visible
  and draggable, "out of bounds" only meaning "no grid there." **Open:** no
  hard cap on cols/rows decided — performance impact (grid-line rendering,
  pan/zoom math scaling with cols×rows) is hard to estimate in advance;
  leave unbounded for now (maybe a loose sanity ceiling against fat-fingered
  values) and revisit only if it turns out to matter in practice.

## User feedback

- [ready] **Percentage bonus for energies, and what "Filtern" actually is**
  (concept agreed — this also gives the Low-Prio "Filtern" sketch below its
  first real mechanic). Lore: Astralenergie is made of 8 base elements;
  filtering shifts a mage's elemental balance to boost efficiency with one
  element. The app doesn't track elements numerically, so the existing
  "overcharge" mechanism (any pool's `aktuell` may already sit above its
  computed max, freely typed, no clamp — `client/src/components/energie.ts`
  `overfilled()`/`poolClass()` → `res-over` styling, `AktuellFeld.tsx`) is
  reused as the *display*, but it isn't itself "Filtern" — filtering needs its
  own gating. **Decided:** AsE only (not LE/AUS). **Decided:** a new
  per-character stored value — "max Filterbonus %" — reflecting how well
  *that* character can filter (set directly, not derived from a formula).
  **Decided:** an all-or-nothing "gefiltert" toggle; when on, it raises AsE's
  effective/displayed max by that stored percentage, computed after the
  normal `computeResource()` result (i.e. a final multiplier, not baked into
  `mods`/`permanent`). **Decided:** triggering/ending is entirely manual — a
  player adds "Filtern" as an ordinary rollable ability/spell entry (same
  pattern as the special-checks catalog below) and rolls for it in the
  fiction; there's no in-app duration/expiry ("the point where a character
  stops counting as filtered isn't clearly set either"), so the toggle is
  just flipped off by the player/GM when the GM calls it.

- [ready] **Special checks catalog** (e.g. "Erinnern (KK+KK)") — **concept
  agreed, and this is new territory, not a hidden existing mechanism**: a
  repo-wide search turned up zero trace of any such check anywhere in code —
  today it only lives in GM memory/house-rules. **Decided:** a single
  GM-maintained global catalog (named check + formula), shown identically on
  every character's Talente tab as a shared, always-present reference section
  — not something each player adds/removes individually — and rollable
  directly from there like any other talent.

- [ready] **Dice formula overhaul** (concept agreed, several related asks
  bundled into one build): today three separate, inconsistent parsers handle
  formulas — `parseDiceExpression` (chat `/r`, `+`/`-` only, no `*`, rejects
  negative dice blocks; `shared/src/dice.ts:341-371`), `parseProbeExpr`
  (Talent/Zauber/Waffen Proben, `expr.split('+')` only;
  `shared/src/rules.ts:175-215`), and `evaluateEnergyFormula` (GM's
  Spezialenergien-Katalog only, already a full recursive-descent grammar with
  `+ - * / ()`; `rules.ts:332-460`). **Decided:** build one shared arithmetic
  grammar (generalizing `evaluateEnergyFormula`'s existing `+ - * / ()`
  approach) rather than patching each parser separately, so real calculations
  with brackets/order-of-operations become possible everywhere, not just a
  bolted-on `*`. **Decided:** for a dice block under multiplication, roll
  first, then apply the arithmetic to the rolled result (not "double the die
  count"). **Decided:** repeat-count syntax (e.g. rolling "2w6+8" three times
  in one command) — exact syntax shape still open (prefix/suffix, interaction
  with `#label`), but the *result* is settled: one grouped/summarized card,
  not three separate feed entries — similar in spirit to how group-check
  rolls already bundle. **Decided:** Attribut values in free-form chat
  dicecode (e.g. typing "MU") resolve against the sender's currently-selected
  character; with none selected (e.g. GM chat), left unavailable/literal —
  this needs a new resolution step before/instead of the raw expression
  parser, distinct from the existing named-Probe suggestion flow
  (`probeExprZahl`/`/api/characters/:id/probes`). The stale "check not found"
  warning sub-item is covered by the general stale-warning fix above.

- [sketch] **Favorites: add a text field** (partially agreed, partially
  still open): the "inherit the chosen visibility setting" half turned out to
  probably just be a symptom of the multi-tab chat desync — now fixed (see
  `usePersistedState` listening for the `storage` event) — so likely no
  further work needed there; worth re-checking with the reporting player now
  that it's live. The "allow to add text" half is still genuinely open —
  unclear whether it means a new separate note/description field alongside
  today's `label:expression` free text, or just letting the existing label
  itself hold more/richer text. **Needs another pass with the original
  requesting player** before this can go to `[ready]`.

- [ready] **Group ↔ player inventory, player ↔ player item transfer, and
  containers as a real, movable, worn concept** (concept agreed for the first
  two; houses is a much rougher sketch — see below). Confirmed starting
  point: **no group-level item storage exists at all today** — only
  `char_items`, strictly `character_id`-scoped, saved as a full delete+
  reinsert per character (`saveItems`, `characterData.ts:846-903`) with no
  per-item CRUD or cross-character transfer primitive of any kind.
   - **Decided: generalize item ownership.** Replace the hard `character_id`
     FK with an `owner_type`/`owner_id` pair (mirroring the pattern
     `assets/store.ts` already uses for images) — `'character'` or `'group'`
     for now, extensible to `'room'` later for houses.
   - **Decided: a new cross-owner move action** on any item chip (including
     containers) reassigns `owner_type`/`owner_id`. Moving a container moves
     every item whose `containerUid` points into it atomically, in the same
     operation — nothing gets orphaned.
   - **Decided: permission split.** Pulling an item *from* the shared group
     inventory is open to any group member. Sending is restricted to your
     own items — a player can give away or drop their own stuff, but can't
     reach into another player's personal inventory directly (that needs the
     GM, or that other player).
   - **Decided: no confirmation step** — a move happens outright, same as a
     normal drag-to-equip today.
   - **Decided: items in the group pool are weightless** for everyone's
     Traglast — nobody is personally hauling the shared stash.
   - **Decided:** on any owner change, position-specific fields (`location`,
     `zone`, `beidseitig`) reset to a safe default (`inventar`) rather than
     trying to preserve a worn-state that can't carry over to the new owner
     — no data is lost, just re-equip on arrival.
   - **New UI needed:** a "Gruppen-Inventar" section on `Group.tsx`, using
     the same specialized item-chip UI as `Ausruestung.tsx`/`Inventar.tsx`
     (not the generic `Sektionen` dynamic-table component, which can't
     represent weight/location/container relationships) — this is the "big
     overhaul of group page" the original note anticipated.
   - **[sketch] Houses** — much rougher than the above two: confirmed shared
     group property, subdivided into rooms, with containers inside rooms
     holding items ("all the stuff a real house has"). Structurally this
     would reuse the same `owner_type`/`owner_id` generalization (a
     lightweight `group_rooms` table, group-owned items optionally tagged
     with a `room_id`), but still open: can a group own multiple houses, who
     can create/name rooms, whether a room has any capacity/size concept.
     Needs its own concept pass before it's buildable — do not treat as
     `[ready]` just because the other two pieces in this entry are.

- [ready] **Containers: bench-exclusion must cascade to contents, plus expose
  weight/worn-state in the UI** (concept agreed after a few rounds — the
  actual house rule turned out to differ from the first read). Confirmed
  today: a container is just an `Item` with `istBehaelter: true`; its own
  `location` (`shared/src/items.ts`) is completely independent of whether it
  functions as a container. `zaehltZurLast()` (`items.ts:147-149`) already
  excludes `bench` for an item's own weight — that part is correct and needs
  no change. The actual bug: an item **inside** a container always counts
  toward Traglast based on its own `location` (`'behaelter'`), regardless of
  whether the *parent* container is benched — so a spare, unworn backpack's
  contents still fully count today, when they shouldn't.
   - **Decided: a container's weight-reduction discount to its contents is
     NOT conditional on being worn** — carried (`getragen`) or merely held/
     slung (`inventar`) make no difference, the discount always applies while
     the container is with the character. Only `bench` (genuinely not with
     you right now — the spare-backpack case) changes anything.
   - **Decided: the fix is a cascade, not a new gate.** When a container sits
     on the bench, its contents stop counting toward Traglast too (need to
     walk up the `containerUid` chain, not just check each item's own
     top-level `location`) — mirrors the `containerArt === 'quick'` branch's
     existing worn-check (`itemLastAnteil`, `items.ts:165-179`), generalized
     to also cover `containerArt === 'storage'` and to cascade through
     nesting rather than only checking one level.
   - **Decided: capacity/overfill checking stays location-independent** — a
     benched container can still be over-stuffed beyond what it can
     physically hold (e.g. its stated 120/60kg capacity); that check is
     separate from, and unaffected by, the Traglast-contribution fix above.
   - **Decided: containers get a real weight field in the UI.** `gewicht`
     already exists generically on `Item` and already applies to containers
     structurally, but no container-creation/edit UI exposes it
     (`AddContainerDialog`, `Inventar.tsx`'s container header) — containers
     are zero-weight today purely by UI omission, not a schema gap. Add the
     field where containers are actually created/edited.
   - Note: this pairs with the cross-owner move feature above — "make a
     container's `location` editable" doesn't require migrating storage
     containers into the worn/body-zone drag system; that's a separate,
     optional nicety, not a prerequisite for either fix here.

- [ready] **Investigate: are "confirmation" rolls independently random, or
  suspiciously correlated?** (developer feedback: "many 1s and 20s" observed
  across rolls that get confirmed together). This is a verification task, not
  a design decision. Dice rolls already use `crypto.randomInt`
  (`server/src/dice.ts:15,35`) — a proper CSPRNG, so a systemic bias is
  unlikely — but worth specifically checking whether the confirmation-roll
  code path draws a fresh, independent random value or accidentally
  derives/reuses the original roll's value. If nothing's found, this is
  likely gambler's-fallacy pattern-matching on a small sample, not a bug.

Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections above in a later pass. (Empty = all caught up.)

## High-Prio

- [ready] **VTT toolbar styling rule: dropdowns/flyouts over inline button
  sprawl.** `TilePicker`/`HighlightPicker` already open as a floating panel
  below the toolbar (`.vtt-tile-picker`, `position: absolute`) rather than as
  inline buttons — Messen's shape-kind picker (Lineal/Kreis/Rechteck/Kegel)
  briefly broke that convention as an inline row during Phase 8 slice 3/3 and
  has since been converted to the same flyout (`MeasureKindPicker`, reusing
  `.vtt-tile-picker`/`pickerOpen`). Write this down as a standing rule for
  every future VTT toolbar addition in `client/src/pages/VirtualTable.tsx`: a
  tool's sub-options open as a flyout anchored below the toolbar, never as
  additional always-visible buttons pushing the rest of the bar around — that
  growth also makes the toolbar's button positions shift underfoot, which
  broke a scripted/automated click sequence during testing. No further work
  needed right now beyond keeping to it; re-open only if a future tool
  reintroduces inline sub-buttons.

## Mid-Prio

- [sketch] **VTT: area-fill painting, not just cell-by-cell** (developer
  feedback, Phase 9). Bemalen/Hervorheben/Nebel all paint one cell per
  pointer-move step today (`startPaint`/`applyPaintCell` in
  `client/src/pages/VirtualTable.tsx`, shared by all three layers as of the
  fog tool). Not concepted yet: whether "whole area" means a drag-rectangle
  fill (like the rectangle measure shape's drag), a flood-fill from a clicked
  cell bounded by existing painted edges, or both as separate brush modes —
  needs a decision with the developer before building, plus how it interacts
  with the existing single-cell brush (replace it vs. an additional tool
  mode).
- [sketch] **Animal/pet companion sheets**: a character owning a trained animal
  or mount with its own small sheet (attributes, maybe a handful of
  talents/skills). Not concepted at all yet: how much a pet sheet shares with
  a full character sheet, how it's linked to its owner, whether it's a
  separate `characters` row or something lighter, is all still open.
   - topic is related to shapeshifting: a sheet that belongs to a specific character instead of being a standalone character
- [onHold] **Shapeshifting characters** (design notes at
  `docs/concepts/shapeshifting.md` — a build-then-revert pass surfaced real
  data-model disagreement with the GM, written up there instead of lost):
  a character that can shapeshift needs genuinely different values for
  almost everything (attributes, base values, possibly talents/abilities)
  per form — effectively a separate sheet per shape bundled under one
  character, not multiple independent characters. Still needs a concept
  pass with the GM (data model + how much duplicates vs. derives from a
  base sheet) before building.
- [ready] **Expanded bio page** (concept agreed): a dedicated route (e.g.
  `/charakter/:id/bio`), linked from the character sheet — deliberately outside
  the existing `char_tabs`/`char_sections` tab system, new territory for the app.
   - Background story via a markdown content editor: plain textarea for the
     markdown source + a write/preview toggle button rendering it (no rich-text
     editor library — matches the app's existing plain-textarea pattern, e.g.
     `sidebarNotiz` in `components/inputs.tsx`). Needs a markdown renderer added.
   - GM-only tagging: block-level for now — a marker wraps a whole
     paragraph/block as GM-only (e.g. a fenced ` ```gm ... ``` ` block), hidden
     from other players, always shown to the GM. Inline span-level tagging
     (mid-sentence) is a later idea, not built now.
   - Image gallery: new table for multiple images per character — separate from
     today's single-portrait `char_portraits` BLOB (`db.ts:257-262`, one row per
     character) — each image with an optional caption, reorderable, upload/delete;
     mirrors the existing portrait upload flow but many-of instead of one-of.
   - Existing `char_bio` fields (Heldenbrief) stay as they are, always public —
     the new markdown content is the only place with GM-only tagging.
   - Still open before a build plan: markdown library choice, where the markdown
     source is stored (new column/table), exact link/entry point from the sheet.
   - Images: `helden-assets.db` **already exists** — the wiki built it, keyed by
     `owner_type`/`owner_id` and generic from the start precisely so the bio
     gallery plugs in without a schema change. Use `assets/store.ts` with
     `owner_type='character'`, `rolle='galerie'`; the weekly backup schedule,
     the cleanup hook and the orphan sweeper are all in place. Note the catch it
     was built around: SQLite has no cross-database CASCADE, so any new delete
     path must call `loescheAssetsFuer()` by hand — the weekly sweeper is the
     safety net, not the mechanism.
   - The markup renderer also already exists and is shared, not wiki-private:
     `shared/src/wikiMarkup.ts` (source → typed AST) plus `client/src/wiki/
     Markup.tsx` (AST → React elements, no HTML string anywhere), including the
     ` ```gm ` block. The bio page should import those rather than grow a second
     parser — that was the whole reason they live in `shared`.
   - Still open: where the bio markdown source is stored (new column/table) and
     the exact link/entry point from the sheet. The library question is settled
     — there is no library, and the existing renderer is the answer.
- [ready] **Weapon tab rework**: Nahkampf-/Fernkampfwaffen live in a bespoke
  card-based tab (`client/src/tabs/WaffenNeu.tsx`, key `WaffenNeu`, shown as
  „Waffen" — one collapsible card per weapon, computed AT/PA/BL or FK probe
  shown next to the name in the collapsed head, full field grid on expand;
  follows the Ausrüstung item-chip pattern). Remaining:
   - `client/src/tabs/Waffen.tsx` (the retired generic-list tab, unreachable
     but still on disk) is dead code — safe to delete once nobody needs it
     for reference.
   - `Waffenloser Kampf`/`Kampfstile` (still the old generic `ListEditor`
     table inside `WaffenNeu.tsx`, unstyled as cards) still want their own
     card treatment eventually, same reasoning as the weapon rework itself.
   - `Pfeile-Bolzen` (Munition, same old-table situation) gets its own
     solution once the planned lookup catalogue exists (see „Look-up lists"
     below) — low priority, don't card-ify it first.
   - Weapon statuses (*Geschärft*, *Stumpf*, etc.) still need a concept — only
     the free-text `Besonderes`/Notiz fields capture them today.
   - [ready] **Structured min/max range for Fernkampf** (user feedback):
     `entfernung` (`WaffenNeu.tsx:520-522`, `sections.ts:92-93`) is a single
     freeform text field, historically hand-written like "10/20/30". Decided:
     replace it with structured numeric `reichweiteMin`/`reichweiteMax`
     fields rather than adding alongside. Migration must not silently drop
     existing values (no-data-loss rule) — for rows whose old `entfernung`
     text doesn't cleanly parse into two numbers, fold the original string
     into the row's `notiz` instead of discarding it.
   - [sketch] **Fold ammunition damage into the Fernkampf damage formula**
     (user feedback): every ranged weapon has its own `schaden` value today,
     but the ammunition actually loaded/used should add to it — currently
     nothing links the two, so a weapon's shown/computed damage ignores which
     ammo is equipped. Blocked on the **Ammunition** catalogue (Low-Prio,
     below) existing first, since there's no per-ammo damage value to pull in
     yet; once that catalogue has one, wire it into the Fernkampf damage
     calc (and presumably the collapsed-head Schaden display above). Needs a
     concept pass: how ammo gets selected/tracked per weapon (a field on the
     Fern row referencing the ammo catalogue? current stock/inventory-linked?),
     and how its damage combines with the weapon's own (added flat, or
     replaces part of the dice formula).
- [ready] **Editing dialogs for items/weapons/abilities, with item bonuses
  while worn** (user feedback; supersedes the old "reuse the item-creation
  Dialog for spells/abilities and weapons" note that used to live in
  Low-Prio). A full build plan for the items-only slice (data model, compute
  plumbing across all 7 call sites, UI layer, sequencing, verification) is
  written up and approved at `docs/concepts/item-bonus-while-worn.md` — start
  there before re-deriving anything below. Two things merged into one
  initiative because the second needs the first:
   - **Move item/weapon/ability editing into dialogs.** Today three tabs
     edit everything inline: `Ausruestung.tsx`'s `ItemChip` (drag/edit/delete
     on the chip itself), `Inventar.tsx`'s `AlwaysEditable` rows, and
     `WaffenNeu.tsx`'s expand-to-edit cards. Creation already uses the
     `Dialog.tsx`/`itemDialogs.tsx` pattern (fill fields before insert); this
     extends the same idea to *editing existing* rows.
     **Decided: hybrid, not a full replacement** — the highest-frequency
     actions (Anzahl bump, delete, drag-to-equip/reorder) stay inline on the
     chip/row exactly as today, since those happen constantly during play
     (using up arrows, equipping mid-combat). A "Bearbeiten" button opens a
     dialog for the structural fields (RS, Haltbarkeit, Notiz, and the new
     Bonus list below).
     **Decided: reuse, not duplicate** — `AddItemDialog` becomes
     dual-purpose, opening pre-filled for an existing item, matching the
     fill-before-insert pattern already established rather than adding a
     second component.
     **Decided: combined scope** — folds in weapons
     (`WaffenNeu.tsx`'s `emptyNahRow()`/`emptyFernRow()`, ~10+ fields each)
     and abilities (`AbilityManager.tsx`'s `emptyAbility()`) rather than
     doing items now and the other two later; each still needs its own field
     selection pass since none of the three shapes overlap.
   - **Item bonus while worn** (the feature that needed the room to grow):
     currently no equip-effect mechanism exists anywhere — the closest
     precedent, `effektiverRs()` (`shared/src/items.ts:168-170`), is
     hardcoded to pull only RS from worn items into one computed value.
     **Decided:** applies only while `location === 'getragen'` (worn — same
     condition `effektiverRs()` already uses, not merely carried somewhere
     in inventory).
     **Decided:** structured, not free-form — a target + amount pair,
     otherwise the app can't actually compute anything (a free-form field
     would just be a second `notiz`).
     **Decided:** an item can carry **multiple** bonuses at once (a
     repeatable list of target+amount rows) — this is exactly why it needs
     the dialog rather than an inline field.
     **Decided:** targets cover everything — attributes (MU..KK), TaW/AT/PA/
     BL (as an effective value layered on top of the stored one, the same
     non-destructive way `effektiverRs()` works — TaW/AT/PA/BL are raw
     player-entered numbers with no formula behind them, so there's nothing
     to feed a bonus into except the display value), and BaseValueKey/
     ResourceKey (LE/AU/AsE/etc.).
     **Decided:** same-target bonuses from multiple worn items **sum** (no
     single-highest cap the way RS has).
     **Decided:** the target picker is a grouped `<select><optgroup>` (by
     Attribut/Basiswert/Energie/Talent) — no new searchable-combobox
     component needed.
     **Plumbing plan (resolved):** attributes have a real choke point
     (`attrMax(attrs, code) = akt + mod`, `shared/src/rules.ts:15-18` — every
     downstream formula reads through it, so an attribute bonus ripples
     everywhere for free), but `computeResource`/`computeBaseValueBases` do
     not — they're called independently from 7 sites total, and not one
     shared assembler. **Client (3 sites, already solved by existing
     architecture):** `Heldenbrief.tsx`, `CharacterSidebar.tsx`, and
     `WaffenNeu.tsx` all read the same `data` object through one shared
     `CharCtx`/`useChar()` context (`Character.tsx:152`), and `data.items`
     already sits right next to `data.attributes`/`baseValues`/`resources`
     in that object — no new data-loading needed, `Heldenbrief.tsx` just
     needs to start destructuring `items` too. **Server (4 genuinely
     separate call sites, no shared assembler between them):** `saveSection`
     (`characterData.ts:1539`, clamps `aktuell` on a resources-section save),
     `buildSummary` (`characterData.ts:1740,1762`, the limited "summary" view
     another player sees), `overviewForChars` (`characterData.ts:1854,1874`,
     GM group-overview chips, one query per character in a loop), and
     `computeProbeForCharacter` (`diceSource.ts:133`, resolves a weapon probe
     for a dice roll — bypasses the `Item` model entirely today, reading
     `sec_waffenFernNeu`/`sec_waffenNahNeu` directly). None of these should
     be merged into one object — they're deliberately different access
     levels/purposes — but the fix at each is mechanically the same: add a
     `loadItems(charId)` call (already exists, used by `loadFullCharacter`
     at line 762) and apply the one new shared helper described below.
     Concretely: one new pure function next to `effektiverRs()` in
     `shared/src/items.ts` — `gatherWornItemBoni(items: Item[])` — filters to
     `location === 'getragen'` and sums each item's bonus rows by target into
     `{ attrs, baseValues, resources, talente }` buckets. At every call site,
     merge that result additively into the *ephemeral* input passed to
     `computeResource`/`computeBaseValueBases`/`attrMax` — never into the
     stored `mods`/`permanent`/`akt` values that get persisted, same
     non-destructive pattern `attrMax` already uses for `akt + mod`.
     `saveSection`'s clamp fix isn't scope creep — it's necessary: if item
     boni raise a resource's max and the clamp doesn't know that, a player
     wearing a bonus item gets `aktuell` silently clamped down wrong. GM
     overview's per-character loop already does one query per stat category
     per character; one more `loadItems()` per iteration follows the
     existing pattern, not a new class of problem. `diceSource.ts` matters
     most in practice (a bonus item making a weapon roll better) but also
     needs the most work — both the `loadItems()` addition and wiring the
     `talente` bucket onto the raw TaW/AT/PA/BL it currently pulls from the
     legacy section tables.
     **Target shape (recommendation, not yet locked):** attribute code /
     base-value key / resource key / a specific talent's TaW-or-AT/PA/BL are
     four different key-spaces with no shared type today — a small
     discriminated union (`{kind: 'attr'|'baseValue'|'resource'|'talent',
     code, talentField?}`) rather than one flat string enum.
     **Not the same mechanism as ammo damage:** checked and decoupled —
     "fold ammunition damage into the Fernkampf formula" (below, under
     Weapon tab rework) targets a weapon's own `schaden` dice-formula field,
     not an attr/baseValue/resource/talent target, so it doesn't share this
     bonus system despite looking similar on the surface. Left as its own
     separate item.
- [sketch] **Player-set structured bonuses for Vorteile/Nachteile/Titel/
  Professionsboni** (user feedback): these currently live in plain free-text
  dynamic-table sections under the locked "Vorteile & Nachteile" tab
  (`professionBoni`/`vorteile`/`nachteile`/`titel` section IDs,
  `characterData.ts:250`), and — unlike the 20+ perks — have **no fixed
  catalog**: a player types whatever advantage/disadvantage/title they want,
  so a lookup-table approach doesn't apply here. Instead, each row would get
  an optional structured effect the *player* sets themselves (pick a target
  from the same `attr | baseValue | resource | talent` union already planned
  for item bonuses, then type the amount), and the app applies it
  automatically from then on instead of the player doing the arithmetic by
  hand. Deliberately sequenced *after* the item-bonus-while-worn entry above:
  build that first, then generalize its aggregator (`wornBoni` etc. in
  `shared/src/items.ts`) to accept any bonus source, not just `Item[]`, rather
  than growing a second parallel plumbing path. Still open: which of the four
  sections actually get this (all four, or just vorteile/nachteile?), the UI
  for attaching a structured effect to a free-text dynamic-table row (a
  per-row dialog like the item one, or a new `DynColumn` type?), and whether a
  row gets one effect or a repeatable list like items do.
- [ready] **Graded (fortified) spells/skills** (user feedback, concept
  agreed): `Ability.stufe` (`shared/src/abilities.ts:30`) already caps at
  `ABILITY_STUFE_MAX = 10` (`:82`) — reaching that cap is meant to let the
  player create a fortified version of the same spell/skill, and this can
  happen twice (three grades total). **Decided:** no automation on granting —
  the player creates the new `Ability` entry themselves exactly like any
  other, same as today. **Decided:** a new `derivedFrom` field (an `Ability`
  `uid` reference, empty by default) drives the grade: unset = grade 1
  ("Basis"), set = one more than the referenced ability's own grade
  ("Aufgewertet" = 2, "Potenzial" = 3 — names supplied by the GM). Grade is
  **display-only**, shown next to the name — it does not feed the
  Stufe×Komplexität Magiepunkte formula or any other calculation. **Decided:**
  the picker only offers abilities of the same `magisch` value (spell derives
  from spell, skill from skill only) — same partition `zauberOf`/
  `faehigkeitenOf` already use (`abilities.ts:43-48`). **Decided:** the server
  enforces both the max-grade-3 rule and cycle prevention at save time (reject
  a `derivedFrom` that would push grade past 3, or that would loop back on
  itself) — `saveAbilities` (`characterData.ts:1107`) already has the same
  shape of per-save validation for the one-signatur-spell rule
  (`signaturVergeben`, `:1111`) and uid dedup (`seenUids`, `:1109`), so this
  follows the same pattern rather than adding a new validation style. Needs a
  build pass: `derivedFrom` on the `Ability` type + `char_abilities` column,
  a grade-computation helper (walk the chain, same file as `spellPunkte`/
  `istTrivial`), the derive-from picker in `AbilityManager.tsx`, and the
  grade label next to the ability name.
- [sketch] **20+ perk picker** — source PDF analysed and written up at
  `docs/concepts/perk-trees.md` (8 attribute trees, uniform 10/5/3/1/1 tier grid,
  no prerequisite edges, ~160 effects classified into 6 computable and 8
  display-only categories). Rules confirmed: pool = `attribut − 20`, one point
  per stage, stage values absolute (not cumulative), base attribute only
  (never `attrMax`), later columns need points *spent* not merely earned,
  Heldenkraft perks are a single pick granting one in-combat and one
  out-of-combat effect (not two picks). Half the perks target exactly the
  `attr | baseValue | resource | talent` union already designed for item
  bonuses, so this should be built *after* the item-bonus-while-worn entry
  below and reuse that plumbing rather than grow a second aggregator. Blocked
  on GM input before a catalog can be seeded: ~7 name conflicts between graphic
  and description list, a duplicate in the Konstitution tree, ambiguous stage
  counts, the missing `stufenfk` master list, and the Kampf/Anders split not
  yet written per Heldenkraft. Also needs a server-side reveal state — 34+/60
  perks are hidden until the GM unveils them, so they must not be sent, same
  rule as the wiki's ` ```gm ` regions.
- [ready] **Audit log on characters - RECHECK CONCEPT WITH DEVELOPER** (on hold until a stable 1.0, so it isn't touched on
  every system change). Concept to build when it comes off hold:
   - Storage: SEPARATE SQLite file (`helden-audit.db`), NOT in `helden.db` —
    `backup.ts` copies the whole file × KEEP, so history stays out of those
    backups. Denormalize `actor_name` into each row (no cross-file FK).
   - Diff, don't snapshot: in `saveSection` compare payload vs current DB, log only
    changed fields (old→new); empty diff → skip (doubles as the no-op skipper).
   - Coalesce: within ~5 min, same (character_id, actor, section, field) → UPDATE
    new_val + ts, keep original old_val. Keeps size independent of the debounce.
   - Granularity: scalar sections (bio/meta/attributes/baseValues/resources)
    field-level; list/dyn sections COARSE only ('section X: +a/-b/~c Zeilen') —
    rows are positional (DELETE+INSERT), so per-cell diffing is noisy.
   - Fat values: numbers keep both; free text > ~120 chars truncate / '[geändert]'.
   - Hook: `saveSection` (thread actor = `req.user.id`). Also `saveVisibility`,
    dyn-row saves, portrait set/delete, GM char rename/reassign/delete. Skip
    catalog/admin edits.
   - Schema: `audit_log(id, character_id, actor_id, actor_name, ts, section, field
    NULL=coarse, old_val, new_val)`, index (character_id, ts DESC).
   - Retention: prune > ~90 days (or cap N per char) on the existing backup timer.
   - Optional: read-only 'Verlauf' panel per char (GM sees all with user/character
    filters; owner sees own, character filter).

## Low-Prio

- [sketch] **VTT: a way to set a character token's own appearance (custom
  image/icon), not just fall back to initials** (developer feedback,
  Phase 10 initiative tracker). The initiative strip shows a real portrait
  for a character with one uploaded (`client/src/pages/VirtualTable.tsx`,
  `InitiativeStrip`'s `renderCard`), a dashed empty box otherwise — the
  two-letter initials monogram used elsewhere on the map (`initials()`) reads
  as stale/placeholder-ish for a token that's meant to represent a real
  character across a whole session. No design decided yet on what a token's
  own settable appearance would look like (a small icon picker? a distinct
  upload separate from the character's sheet portrait?) — needs a concept
  pass before building.
- [sketch] **VTT: GM's cursor gets stuck as the "grabbing" hand, even while
  hovering a token** (developer feedback, Phase 9 fog testing). The GM
  reported the cursor never returns to the token's own `pointer`/pan tool's
  `grab` cursor once something has been dragged — a player's session behaves
  correctly. `.vtt-map-wrap` sets `cursor: grab` / `:active { cursor: grabbing
  }` in `client/src/styles.css`; each token `<g>` overrides that to `pointer`
  inline (`client/src/pages/VirtualTable.tsx`), identically for every role —
  nothing in the code branches on `isGm` for this, so the asymmetry isn't
  obviously explained by a role-specific code path. Likely candidate: a
  stuck `:active` pseudo-class from a pointer-capture/mouseup mismatch during
  one of the GM-only paint/highlight/fog drags, but this is a live-browser
  cursor-rendering quirk that can't be diagnosed from network/DOM inspection
  (same class of problem as the color-swatch-reopen bug below — needs
  someone actually reproducing it live, cursor state included, before
  attempting a fix).
- [sketch] **Native colour swatch reopens on a second click instead of
  closing** (VTT, `ColorSwatchInput` in `client/src/pages/VirtualTable.tsx`,
  used by token colour/ring colour, the tile/highlight picker, and the
  measure-shape colour field): clicking a `<input type="color">` swatch
  while its native browser dialog is already open should close it, but the
  browser reopens it instead. Two fix attempts (a tracked "believed open"
  ref + `blur()`, then a `document.activeElement` check + `blur()`) both
  failed live testing — a native colour dialog isn't part of the DOM, so it
  can't be driven/observed by this session's automated browser tooling
  either, which made both attempts guesswork. Confirmed minor/cosmetic by
  the developer, not blocking. Whoever picks this up next needs to actually
  reproduce it live (real browser, real clicks) to see what's really
  happening before trying a third fix — or consider swapping to a custom
  (non-native) colour picker instead, which would sidestep the browser
  quirk entirely.
- [sketch] **VTT: show a token's current owner, and allow changing it on the
  fly** (developer feedback). `board_tokens.owner_user_id` already exists and
  is read for the owner-bypass in `canEditTokens`/`canMoveToken`
  (`server/src/boardAccess.ts`) and for the "GM or the current combatant's
  own owner may advance the turn" check in `ws.ts`, but nothing in the UI
  shows whose token it is, and it's set once at creation with no way to
  reassign it later (e.g. a marker created by the GM handed off to a
  player, or a player leaving the table). Needs a concept pass: where the
  owner shows (token editor? a label on hover?), who may change it
  (GM-only, or also the current owner handing it off?), and whether a
  character token's owner should even be independently settable or always
  implied by the character's `group_id`/player link.
- [sketch] **VTT: step-counting token-drag trail — built, wants a real live
  drag test.** Concept settled with the developer (straight king-move line
  from the drag's start cell, numbered 0/1/2/…; visible only to the person
  dragging; gone the instant the token is dropped) and implemented in
  `client/src/pages/VirtualTable.tsx` (`chebyshevPath`, `tokenTrailActive`/
  `trailElsRef`, wired into `startTokenDrag`/`onTokenPointerMove`/
  `onTokenPointerUp`). A CDP-driven drag confirmed the move itself still
  works with no console errors, but this session's automated tooling has no
  way to pause mid-drag for a screenshot, so the trail's actual on-screen
  numbering/positioning during a real drag hasn't been eyeballed yet —
  needs a live check before this counts as done.
- [sketch] **Potion charges** (user feedback): no charge concept exists
  today — the closest precedent is `Item.anzahl` (plain stack count).
  Decided: a charge is a portion/dose — potions come in three fixed sizes
  with a fixed charge count (klein = 1, mittel = 2, groß = 4), tracked as a
  current/max pair similar to the existing Haltbarkeit pattern, decrementing
  on use. Still open: how this interacts with `anzahl` when several
  identical potions are stacked — a single Item row's current/max charge
  pair can't represent "3 potions, each at a different remaining charge" any
  more than Haltbarkeit can today. Needs a concept pass on whether a
  partially-drunk potion has to split off the stack into its own row, or
  charges only make sense while `anzahl === 1`.
- [sketch] **Dice rolls and chat — dedicated chat page.** The core feature
  (Probe/expression rolls, crit confirmations, chat, visibility picker, GM +
  player requests, roll log, explicit room switching) shipped on
  `feature/dice-rolls-chat`; the rules/mechanics are documented in
  `docs/concepts/dice-rolls-and-chat.md`, not repeated here. Still open: a
  docked-only panel would collide with a possible future virtual-table
  feature, planned in `docs/concepts/virtual-table.md` (revisited 2026-08-24
  and ready to build from). Not a rework: any page can call
  `useDicePanel()` and read the same `feed`/`sendChat`/etc., so a dedicated
  full-page chat view is additive — reuses `FeedEntryView` for individual
  messages/rolls, no duplicate connection. **Settled:** that dedicated page
  does NOT also render the floating dock (`DicePanel.tsx`'s fixed widget) —
  showing the same feed twice on the same page would be redundant. **Also
  settled:** the great-roll overlay (`WichtigerWurfOverlay`) is mounted globally
  in `App.tsx` and covers whatever page is open, so a dedicated chat page must
  not try to own or duplicate it — it already works there. The overlay pulls its
  dice toward `.dice-dock`/`.dice-dock-tab` and falls back to the bottom-right
  corner when neither is on screen, which is exactly the case a dock-less chat
  page would create.
- [sketch] **Asset sweep: sanity-check before deleting** (`server/src/assets/sweep.ts`):
  `fegeVerwaisteBilder` treats every asset whose owner id isn't in `helden.db`
  as orphaned and deletes it from `helden-assets.db`. That's correct when both
  DBs are the real ones, but there's no cross-check that they actually belong
  together — point `HELDEN_DB` at an empty/wrong database while
  `HELDEN_ASSETS_DB` still points at the real one (e.g. a throwaway DB for a
  manual test, env misconfiguration) and the sweep reads "no owners exist" and
  wipes real assets on next startup. Bit the dev DB once already. Needs a
  cheap guard — e.g. skip the sweep (with a loud warning) if `helden.db` has
  suspiciously few rows in the owner tables relative to what's referenced in
  `helden-assets.db`, or a shared marker linking a DB pair together — exact
  approach still open.
- [sketch] **CSS tidy-up**: check for components than can be combined
 - less exclusive designs (e.g. section headers get rendered different, but are actually the same everywhere)
 - splitting CSS into more fitting files
   - good pre-work for the responsiveness-pass
- [sketch] **General tidy-up**: check code for unused elements and remove
- [ready] **Filtering** (own-element AsE increase): concept now agreed — see
  "Percentage bonus for energies, and what 'Filtern' actually is" under User
  feedback above. No longer a bare sketch.
- [sketch] **Armor-material catalogue**: a GM-editable material→RS list (like
  talents/languages) so a worn piece picks a material and shows its RS. Today RS is
  a manual per-piece number on the item.
- [sketch] **Ammunition**: damage values and effects (new catalogue). Once it
  has a per-ammo damage value, wire it into the Fernkampf damage formula (see
  „Fold ammunition damage into the Fernkampf damage formula" under the Weapon
  tab rework, Mid-Prio) — currently blocking that item.
  This feature will need the players to keep their own list of ammunitions and damage values for them, which then feeds the damage formula. ranged weapons then pick which ammunition is used.
  Ammunition can have bonus on AT too.
- [sketch] **A more neutral default theme** than Khôm (red) and more themes in general.
  - Andergast as colorless
  - Orkland dark green, Bornland lighter green
  - Efferdia light blue
- [ready] **Secret "chaos mode" easter egg** (concept agreed — gag, not a real
  theme): click the decorative `banner-fx` strip in the header (`App.tsx:99-103`
  — purely decorative today, `aria-hidden`, no click handler, spans every page;
  deliberately NOT the "Zeitenkompass" wordmark, which is a `Link to="/"` and
  would navigate/interrupt the click sequence) 5x fast (~1.5s window) to trigger
  a garish/clashing "chaos" color mode — a joke, not a real addition to `THEMES`
  in `theme.ts`. Timed: runs for a fixed short duration (~10–15s) then auto-
  reverts to whatever theme was active before, no persistence, no toggle-off needed.
  Not yet implemented — when it is, it needs to report itself to the easter-egg
  tracker below (same as any future egg), so build the trigger with that hook
  from the start rather than adding it after the fact.
- [ready] **Easter egg tracker** (concept agreed; visual reference at
  `docs/concepts/easter-egg-tracker.html`): a public page listing every
  easter egg that exists, who found it first, and when — first-finder-only,
  deliberately competitive/leaderboard in tone, visible to all players.
   - Generic across eggs so adding a new egg later is a code change only, no
     schema change: catalog table `easter_eggs(key, name, added_at)` (one row
     per egg, `key` a stable slug like `chaos-mode`), plus
     `easter_egg_finds(id, egg_key, user_id, found_at)` with
     `UNIQUE(egg_key, user_id)` — insert-or-ignore, so only the first trigger
     per (player, egg) sticks and later triggers are silently no-ops.
   - Each egg's trigger needs to call a small `POST /easter-eggs/:key/found`
     (or similar) when it fires — there's no other persistence today (chaos
     mode is 100% client-side), so this is new wiring on the egg itself, not
     just a new page reading existing data.
   - **Decided:** the list itself is a normal, always-reachable page — NOT an
     egg to find (considered, dropped: paradoxical to gate a "how many eggs
     have been found" page behind being found itself).
   - **Decided:** found eggs show name/description/finder/date, unveiled for
     everyone once triggered. Unfound eggs are NOT individually listed (no
     per-egg "???" row, no exact remaining count) — instead, a single trailing
     "???" line is appended to the list ONLY while at least one egg is still
     unfound, just to tease that more exist. That line disappears once every
     known egg has been found.
   - Still open before a build plan: exact route/entry point for the public
     page.
- [sketch] **Print / PDF follow-ups - PROBABLY OUTDATED**:
   - Tables break across pages mid-section — add break-inside handling / keep
    sections together / repeat table headers.
   - Talente and Waffen tables get cut off at the sides even in landscape — too
    wide; needs print-specific narrower columns / smaller font / scaling /
    wrapping (easier now that static text wraps where an input would not).
   - Sprachen has rendering issues (investigate).
   - Maybe clamp column widths to the minimum necessary in print for readability.
- [sketch] **Mobile/tablet & general layout + responsiveness pass - PROBABLY OUTDATED FINDINGS** (most players are on PC — saved for
  later): responsiveness and layout touch-up, testing across many resolutions,
  and splitting `styles.css` into smaller files for maintenance. The below-700px
  table scroller and the sidebar's narrow-screen reflow belong to this pass.
- [sketch] **Look-up lists** (needs GM data; none yet): e.g. which attributes can be raised
  per weapon level / per spell level. Separate from the catalogues — a different
  kind of list.
- [sketch] **Liturgien catalogue** (waits until the catalogue content is finished): read
  the character's priest level to unlock Liturgien accordingly. Priest-level
  requirements are still not fleshed out.
- [sketch] **Link spoken languages to their writing system** (user feedback):
  `Sprachen.tsx` treats languages and scripts as two entirely separate,
  unlinked catalogs (`kind: 'sprache' | 'schrift'`), rendered by the same
  generic `LanguageTable` and grouped by `familie` — no field anywhere says
  "spoken language X uses script Y". Needs a concept pass: a `schriftId` /
  default-script field on `sprache`-kind catalog rows (or a join table), plus
  how to surface it in the UI (sub-label on the Sprachen row, auto-suggest in
  the Schriften table, …).
- [sketch] **Spell creation table — theme it, make it feel less like a plain
  table** (user feedback): `AbilityManager.tsx`'s "Regeltabelle: Zauber
  erschaffen" panel (`SPELL_CREATION_ROWS`, ~line 12) renders as a plain
  `<table className="sheet">` (3 cols, 8 static rows) with none of the app's
  card/chip theming — unlike the rest of the same page's ability list, which
  already uses the `abil-row`/`abil-compact` card pattern, or `WaffenNeu.tsx`'s
  `.wpn-card` / `Ausruestung.tsx`'s `.item-chip` styling used elsewhere. Needs
  a concept pass: restyle as themed table variant, or restructure as cards
  (one per attribute row)?

## Unsorted ideas (treat all as [sketch])

- logically connect weapons and inventory
  - weapons should be real items, too, but they carry some extra information
  - e.g. reducing a weapons Haltbarkeit on Ausrüstung should also be mirrored on Waffen and vice versa
  - this lets the player carry the ewapon on Ausrüstung as a real entry, not a separate and unconnected copy

- FAQ - like a little manual or easy to miss features

- **Notifications** let players know, when things have changend (approved characters, new changelog entries [which include 'Demnächst' and 'Bekannte Fehler'])

- **drop `char_portraits`** — portraits now live in `helden-assets.db`; the old
  table was deliberately kept as a read fallback (copied, not moved) so a
  rollback onto older code still shows portraits. Once a release has gone by
  without needing one, delete the table and the fallback branches in
  `assets/portraits.ts`. Not before: it is the only copy an older build can see.

- **wiki: inline span-level GM tagging** — the wiki marks GM-only content at
  block level (a fenced ` ```gm ... ``` ` region). Marking a few words
  *mid-sentence* as GM-only is the open piece, and it is harder than it looks:
  the server strips GM regions from the response before sending, so an inline
  marker has to survive that removal without leaving a hole that reads as a
  typo. Same decision as the bio page's, and it should stay one decision for
  both.

- **wiki: Steckbriefe, dann Vorlagen** (concept settled, deliberately deferred —
  the navigation/category/redirect round shipped without it). Two steps, in this
  order, because the first is the visible half and carries none of the second's
  cost:
   - **Steckbrief block** — a ` ```infobox ` fence of `Schlüssel: Wert` lines,
     rendered as the floated box every Wikipedia article has. A parser node plus
     CSS; no reuse machinery, no staleness, no recursion.
   - **Transclusion** — `{{Vorlage:NSC|name=Alrik}}`, where a Vorlage is a page
     in a `vorlage` namespace (the `namensraum` column already carries one) whose
     text holds an infobox with `{{{name}}}` placeholders. Named parameters and
     defaults only; **no conditionals or parser functions** — that is where
     Wikipedia's template language becomes a programming language nobody can
     debug.
   - Two constraints that are not optional if this gets built: expansion happens
     **server-side on the read path, before the GM strip** (a Vorlage may contain
     a ` ```gm ` region, so the order is expand → strip, never the reverse), and
     it must **never touch the source the editor loads**, or the `[[gm:n]]`
     marker scheme breaks and a save writes the expanded text back.
   - The search index keeps storing the **unexpanded** source. Otherwise editing
     one Vorlage silently stales fifty pages' index entries (Wikipedia runs a job
     queue for exactly this) — and every NSC page would match „Rüstungsschutz"
     because the boilerplate says so.