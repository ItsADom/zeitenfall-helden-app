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

- [ready] **Multiple scenes per group** (concept agreed 2026-08-25, full plan
  in `docs/concepts/virtual-table.md` Phase 13 — build after that plan
  itself, not from scratch here): a group gets several named boards to
  switch between (not one bigger shared canvas — that would still share one
  token set/fog/round counter across unrelated areas). **Data model:** drop
  `idx_boards_group_id`'s uniqueness, add `boards.name TEXT NOT NULL DEFAULT
  ''`; "current" scene is `groups.active_board_id INTEGER REFERENCES
  boards(id) ON DELETE SET NULL` (a FK, not a boolean flag on `boards` —
  ambiguous if two ever end up marked active). Migration: every existing
  group has exactly one board (today's unique constraint guaranteed it) — set
  `active_board_id` to it for all of them in the same pass that drops the
  constraint. `getOrCreateBoard` keeps auto-creating on first access, just
  also names it (e.g. „Szene 1") and sets it active. **Server (`board.ts`,
  next to the existing token/overlay CRUD):** `listScenes(groupId)`,
  `createScene(groupId, name)`, `renameScene(boardId, name)`,
  `deleteScene(boardId)`, `setActiveScene(groupId, boardId)`. Deleting the
  *active* scene auto-switches to another remaining one first (lowest id),
  then deletes; a group's last remaining scene cannot be deleted (same
  reasoning as a board always existing today). **Rights:** hard-coded
  GM-only, same shape as `canEditFog` — not a new `perm_*`, scene management
  is prep work, never a player case. **Realtime, decided live-for-the-room
  with a fade (not a GM-private-preview-then-present):** GM picks a scene
  from a GM-only toolbar picker (players never see it) →
  `board.scene.switch {reqId, boardId}` → server validates the id belongs to
  this group, calls `setActiveScene`, broadcasts `board.scene.switched`
  carrying a **full snapshot** of the new scene (board settings + tokens +
  tiles + highlights + overlays — same shape as the REST snapshot response),
  not just a bare id, so nobody races a follow-up REST fetch. Client plays a
  short fade-out on `.vtt-map-wrap`/`.vtt-map-svg` (~250–300 ms opacity
  transition), swaps in the new scene's state once faded, fades back in —
  purely a client-side CSS transition around the existing hydrate call.
  **Per-scene camera:** `usePersistedState`'s existing pan/zoom camera key
  (`vtt-camera:${groupId}` today) switches to keying by `boardId` instead, so
  each scene remembers its own last view independently. **Still open, low
  stakes:** `perm_*` columns live on `boards` already, so they're naturally
  per-scene at zero migration cost — whether a GM wants to reconfigure
  rights per scene or find that mildly annoying is untested, not worth
  designing around before it's felt.

## User feedback

- equipment presets
  - e.g. a set for leisure, a set for combat etc.
  - this could also need tracking for these items inside group inventories (needs dicsussion)

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

- [ready] **Image gallery for houses** (user feedback, concept agreed
  2026-09-03). Multiple images per house (floor plans, reference photos), not
  just one — reuses the existing generic `assets` table
  (`server/src/assets/store.ts`), which already supports several images per
  owner via `pos` (exactly a gallery) and is the same mechanism the wiki and
  portraits use. **New:** `OwnerTyp` value `'house'` (`store.ts:22`),
  `owner_id = group_houses.id` (that row already has a stable id —
  `docs/concepts/houses.md`'s `haus`/`raum` strings on `Item` stay untouched,
  this hangs off the suggestion-list row instead). No `gm_only` restriction:
  everyone uploads/sees/deletes, matching the flat, no-GM-gatekeeping
  permission model houses already have. Delete: call `loescheAssetsFuer
  ('house', id)` when a `group_houses` row is deleted or renamed away (same
  "any new delete path must call this by hand" rule as every other owner
  type, CLAUDE.md). UI: a small, unobtrusive icon button next to each house's
  header in `PoolInventory.tsx`'s house/room view, opening a gallery dialog
  (upload/view/delete) — reuse the wiki's upload flow (`skaliereBild`
  client-side resize, `Bilder.tsx` as the pattern to copy), not a new one.
Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections above in a later pass. (Empty = all caught up.)

## Mid-Prio

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
     THe actual statuses can be hardcoded, no need for settings.
     THe actual statuses can be hardcoded, no need for settings.
   - [ready] **Structured min/max range for Fernkampf** (user feedback):
     `entfernung` (`WaffenNeu.tsx:520-522`, `sections.ts:92-93`) is a single
     freeform text field, historically hand-written like "10/20/30". Decided:
     replace it with structured numeric `reichweiteMin`/`reichweiteMax`
     fields rather than adding alongside. Migration must not silently drop
     existing values (no-data-loss rule) — for rows whose old `entfernung`
     text doesn't cleanly parse into two numbers, fold the original string
     into the row's `notiz` instead of discarding it.
   - [ready] **Cosmetic grouping for non-unique weapon stacks** (user
     feedback, concept agreed 2026-09-03): throwing knives and the like get
     `Duplizieren`'d into several separate rows today because durability must
     stay independent per instance (`shared/src/items.ts:289-293` —
     `duplicateItem` exists specifically so two identical weapons can diverge
     in Haltbarkeit; `anzahl`-style stacking would collapse that to one
     shared state, which is wrong here). **Decided: display-only** — the data
     model doesn't change, still one `Item` row per instance. Group
     functionally-identical weapon instances (same stats, differing at most
     in Haltbarkeit) into one collapsed card in the reworked weapon tab,
     expandable to the individual instances underneath.
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
- [ready] **Editing dialog for abilities** (user feedback; supersedes
  the old "reuse the item-creation Dialog for spells/abilities and weapons"
  note that used to live in Low-Prio). The items half of this shipped —
  `AddItemDialog` (`client/src/components/itemDialogs.tsx`) is dual-purpose
  now, opening pre-filled for an existing item (click the chip/row on
  Ausrüstung or Inventar, in either read-only or edit mode), with
  Duplizieren/Löschen in its footer and a repeatable Boni-beim-Tragen list.
  Item bonuses while worn are fully wired end to end, including the server
  dice-roll path — see `docs/concepts/item-bonus-while-worn.md` for the build
  history; that's the precedent to copy for the remaining shape, not
  re-derive. **Weapons no longer need their own pass here** — weapons are
  now real `Item` rows (`waffenArt`/`waffenStats`), and `AddItemDialog`
  already has a complete `mode === 'waffe'` editor (stat rows, AT/PA/BL/
  damage fields) alongside its `allgemein`/`ausruestung` modes, so weapon
  structural editing already goes through the same dialog pattern this task
  was trying to reach. Only abilities are left:
   - **Move ability editing into the same dialog pattern.**
     `AbilityManager.tsx` still edits everything inline/on-card. **Decided:
     hybrid, not a full replacement** — the highest-frequency actions stay
     inline; a dialog handles the structural fields, same split already
     proven on items. `AbilityManager.tsx`'s `emptyAbility()` is a shape of
     its own with no overlap with the `Item` schema, so it needs its own
     field-selection pass rather than reusing `AddItemDialog` directly.
   - **Open: do abilities want an item-bonus-style effect list too?**
     Not decided. If yes, it's the same generalization the "Player-set
     structured bonuses" entry below already plans for Vorteile/Nachteile —
     do that generalization once, shared by both, rather than two parallel
     bonus mechanisms.
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
  hand. Item bonuses while worn (`docs/concepts/item-bonus-while-worn.md`)
  are built now, so this is unblocked: generalize its aggregator (`wornBoni`
  etc. in `shared/src/items.ts`) to accept any bonus source, not just
  `Item[]`, rather than growing a second parallel plumbing path. Still open: which of the four
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
  `attr | baseValue | resource | talent` union item bonuses while worn
  (`docs/concepts/item-bonus-while-worn.md`, built now) already use — reuse
  that plumbing (`StatBoni`/`wornBoni` in `shared/src/items.ts`, deliberately
  named apart from the item-only producer for exactly this reuse) rather than
  grow a second aggregator. Blocked
  on GM input before a catalog can be seeded: ~7 name conflicts between graphic
  and description list, a duplicate in the Konstitution tree, ambiguous stage
  counts, the missing `stufenfk` master list, and the Kampf/Anders split not
  yet written per Heldenkraft. Also needs a server-side reveal state — 34+/60
  perks are hidden until the GM unveils them, so they must not be sent, same
  rule as the wiki's ` ```gm ` regions.

## Low-Prio

- [sketch] **VTT: curated icon picker for marker/monster/NPC tokens** (developer
  feedback, Phase 10 initiative tracker; follow-up to the now-built character
  token image below). Decided: markers/monsters get ONLY whatever a curated
  icon set offers — no free-form upload like characters have (that stays
  character-only). Blocked on content: no icon set exists yet. Once art
  exists, same rendering hook as the character token image
  (`t.characterId != null && t.tokenImage` in `VirtualTable.tsx`'s token
  render — a marker branch would key off a chosen icon id instead) plus the
  `vtt-token-clip` clipPath already in place.
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
   - The "chaos mode" egg is built (`App.tsx`'s `handleBannerClick`, chaos
     palette in `styles.css`) and already calls a `reportEasterEggFound(key)`
     hook (`client/src/easterEggs.ts`) on trigger — today a no-op stub. This
     task's server piece is turning that stub into a real
     `POST /easter-eggs/:key/found`, not adding new wiring on the egg itself.
     **Currently disabled** (`CHAOS_MODE_ENABLED = false` in `App.tsx`) so
     nobody finds it while finds go untracked — flip that flag true once the
     tracker + real POST are live, as the last step of this task.
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

- FAQ - like a little manual or easy to miss features

- **Notifications** let players know, when things have changend (approved characters, new changelog entries [which include 'Demnächst' and 'Bekannte Fehler'])

- **drop `char_portraits`** — portraits now live in `helden-assets.db`; the old
  table was deliberately kept as a read fallback (copied, not moved) so a
  rollback onto older code still shows portraits. Once a release has gone by
  without needing one, delete the table and the fallback branches in
  `assets/portraits.ts`. Not before: it is the only copy an older build can see.

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