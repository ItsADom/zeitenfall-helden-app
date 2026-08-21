# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English. Tasks inside a prio-category are not ordered by urgency.

Durable engineering rules (the scroll-container/sticky-offset/display-mode/no-
data-loss gotchas) now live in `CLAUDE.md`; run-book bits (HTTPS/secure cookies)
live in `README.md` / `DEPLOYMENT.md`.

## Readiness tags

Each open item is tagged: **[sketch]** = a raw idea + my instructions; needs a
concept worked out (and sign-off) before building. **[ready]** = concept agreed,
can go straight to a build plan. Priority is the section (High/Mid/Low);
"on hold" / "blocked" notes stay inline and are a separate axis.

---

## User feedback

Refined and sorted below (concept pass done 2026-08-21). [sketch] still needs a
concept/design pass or open decisions; [ready] can go straight to a build plan.
New raw points still go in the inbox at the bottom of this section.

- [sketch] **Animal/pet companion sheets**: a character owning a trained animal
  or mount with its own small sheet (attributes, maybe a handful of
  talents/skills). Not concepted at all yet: how much a pet sheet shares with
  a full character sheet, how it's linked to its owner, whether it's a
  separate `characters` row or something lighter, is all still open. Surfaced
  as a "Demnächst" teaser (shared/src/changelog.ts) before any concept work
  started, so treat that teaser as aspirational, not a promise of shape.
- [ready] **Attribute-limit doesn't grip on direct entry** (bug, not reliably
  reproducible): the "limit" isn't a hard `max` on the field — `setAttr('akt', …)`
  in `Heldenbrief.tsx:135-148` computes `delta = v - attributes[code].akt` per
  keystroke (`NumInput` fires `onChange` on every keystroke, not just blur) and
  rejects if it exceeds the unused-point budget. Likely cause: a stale-closure
  race — two keystrokes fired in quick succession can both compute `delta`
  against the same pre-update `akt` before a re-render lands, letting a value
  through it should've rejected. Fix: make the check race-safe (derive current
  `akt` from a ref/latest value rather than the render closure) instead of
  relying on synchronous re-render timing.
- [ready] **Crit rule change: lone surviving 1 only crits on confirmation ≥10**:
  mirrors the existing 20-confirmation logic, just inverted for success/failure.
- [ready] **Chat highlights which attribute rolled a surviving 1/20**: the data
  gap is confirmed — `ComputedProbe` (`server/src/diceSource.ts:150`) only
  returns `{n, probeZahl, label}`; the per-attribute breakdown (`parts`, e.g.
  `['MU','KL','IN']`) is computed inside `talentProbeZahl`/`probeExprZahl` but
  discarded before it reaches the client. Fix: add `attrParts?: AttrRowCode[]`
  to `ComputedProbe`, thread it through the roll result into the persisted feed
  entry (`diceProtocol.ts`, `server/src/dice.ts`, `feed.ts`), then have
  `FeedEntryView` map `dieIndex → attrParts[dieIndex]` next to the existing
  `feed-die--20`/`feed-die--1` highlighting. `parseProbeExpr` already supports
  an arbitrary-length `+`-separated attribute list (not hardcoded to 3) and
  `ComputedProbe.n` is already a plain number, so this generalizes cleanly to
  spells with more than 3 dice.
- [ready] **Spell/talent suggestion list can't be scrolled past 8 matches**
  (a player with many "Licht…" spells can't reach the rest via `/r Licht`):
  root cause confirmed — `matches` in `DicePanel.tsx:123` is hard-capped at
  `MAX_SUGGESTIONS = 8` with a plain `.slice(0, 8)`, and `.dice-suggest`
  (`DicePanel.tsx:328`) isn't a scroll container at all, so anything past 8 is
  silently unreachable by mouse or arrow keys. Fix: make `.dice-suggest`
  scrollable (max-height + overflow-y), drop/raise the cap, keep the
  highlighted item scrolled into view on ArrowUp/Down.
- [ready] **Group-wide synchronized roll requests**: results only publish once
  everyone has rolled or passed. Concept settled — reuses the existing
  `roll.pending.request`/accept/decline mechanic (`diceProtocol.ts:146-148`),
  fanned out as one request per group member under a shared group-request id:
  - Each player's roll resolves immediately server-side on accept (same as
    today) — it's just withheld from the feed, not delayed, until the whole
    group has responded.
  - GM can force-reveal/cancel early if someone stalls (mirrors the existing
    single-request expiry).
  - A decline ("pass") shows as an explicit "passed" entry once revealed, not
    omitted.
  - "Whole group" means currently **connected** players only — it does not
    wait for someone who isn't online. Still open: whether the GM can target a
    subset instead of always the full connected group (default to full group
    unless that's wanted too).
- [ready] **Announce spending a Schicksalspunkt to chat**, plus a confirm
  hint-box when clicking the clover (safeguard against accidental clicks)
  before the spend is committed.
- [ready] **Chat input history needs full up/down navigation**: confirmed
  current state is much thinner than it looks — `lastRollCmdRef`
  (`DicePanel.tsx:95,223,241`) holds only the single most recent submitted
  text (command or chat), usable via ArrowUp only when the field is empty, no
  ArrowDown, no depth. Fix: replace the single ref with a small ring buffer of
  the last ~5 sent entries plus a history-cursor index — ArrowUp walks back
  through it, ArrowDown walks forward back to the empty draft (shell-history
  pattern).
- [ready] **Group portraits** in the group page and overview: same shape as
  character portraits (one image per group, same upload/replace/delete flow).
  Should go straight into `helden-assets.db` (`owner_type='group'`) rather than
  the legacy `char_portraits` BLOB table, since that table is slated for
  removal (see „drop `char_portraits`" below).
- [ready] **Erschwerung/Erleichterung: save on change, not just blur/Enter**:
  `ModifierPicker.tsx:42-53` currently commits on blur or Enter only. Fix:
  mirror `NumInput`'s `type()` pattern — call `onChange` on every keystroke
  (parsed/clamped as typed), keep local `draft` state for in-progress typing.

Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections above in a later pass. (Empty = all caught up.)

## High-Prio

### 4. Spezialenergien - full version

Light version shipped: a separate `special` list (name/max/aktuell) the player
edits in the Energien panel, mirrored as sidebar quick-edit chips and GM-overview
chips. Backend table `char_special_resources`. Open for the full version:

- [sketch] GM-provided ruleset instead of free-form: energies **selectable** by
  players from a data-list the app/GM supplies (name + attribute formula + bonus),
  with a place to note the special rules attached to each. `parseProbeExpr` in
  `shared/src/rules.ts` already evaluates "MU+IN+CH". The Einstellungen page is
  where these settings dock. Migrate existing free-form `special` rows into it
  without data loss.
- [ready] Make ASP itself optional — some characters have none (best done in the
  same pass).

## Mid-Prio

- [ready] **Catalog insert helper** (user feedback): the GM catalog admin
  (`CatalogPanel`, `Admin.tsx:17-116`) orders entries by a plain manual
  integer `sort` column; new entries are always appended at `sort: 9999`
  (`Admin.tsx:106`), and inserting one in the middle of the list today means
  hand-editing every row after it. Decided: keep the editable number, add an
  "insert before/after this row" action per row that computes the new value
  without a full manual renumber — a gap/fractional sort scheme so most
  inserts just land in the gap, falling back to a full renumber only once a
  gap is exhausted. Applies to the four `CatalogPanel`-based catalogs
  (talents, languages, tags/Merkmale, races) — currency's `sort` column
  exists in the schema but isn't exposed in that UI yet, worth wiring in at
  the same time.
- [ready] **Create equipment directly in the Ausrüstung tab** (user
  feedback): `Ausruestung.tsx` today has no creation UI at all — an item can
  only be created via `Inventar.tsx`'s `AddItemDialog` (which already has an
  "Ausrüstung" mode, `itemDialogs.tsx:25`) and then dragged over in two
  steps. Add a "+ Gegenstand" trigger in `Ausruestung.tsx` that opens the
  same dialog with `mode='ausruestung'` and `location: 'bench'` (Nicht
  getragen), so the new item lands unworn — same place an Inventar-created
  item ends up after being moved over — and the player still drags it to a
  body zone themselves.
- [sketch] **Race catalogue → live calculations (LE/AU/AsE/MR/AK)**: the race
  catalogue (`races_catalog`, ~66 races from the Rassenbrief) wires Geschwindigkeit
  (`gsBase`), Psyche (`meta.psycheBase`) and Resilienz (`baseValues.resilienzBase`)
  live already — picking a race locks those three cells to the race's value
  (editable again only via a different race pick; personal adjustment stays on the
  existing Mod./Bonus column). Still store-and-display only for the other five
  bonuses (LE/AU/AsE/MR/AK): they show as info text under the race picker but are
  NOT yet added into `computeResource`/`computeBaseValueBases` in
  `shared/src/rules.ts`. Deliberately deferred to avoid silently shifting every
  existing character's computed LE/AU/AsE/MR/AK in the same pass as introducing
  the catalogue.
- [sketch] **Shapeshifting characters** (design notes at
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
- [sketch] **Dice rolls and chat — dedicated chat page.** The core feature
  (Probe/expression rolls, crit confirmations, chat, visibility picker, GM +
  player requests, roll log, explicit room switching) shipped on
  `feature/dice-rolls-chat`; the rules/mechanics are documented in
  `docs/concepts/dice-rolls-and-chat.md`, not repeated here. Still open: a
  docked-only panel would collide with a possible future virtual-table
  feature, now sketched out in `docs/concepts/VTT-concept.md` and
  `docs/concepts/virtual-table.md`. Not a rework: any page can call
  `useDicePanel()` and read the same `feed`/`sendChat`/etc., so a dedicated
  full-page chat view is additive — reuses `FeedEntryView` for individual
  messages/rolls, no duplicate connection. **Settled:** that dedicated page
  does NOT also render the floating dock (`DicePanel.tsx`'s fixed widget) —
  showing the same feed twice on the same page would be redundant.
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

- [ready] **Note field on Talente** (user feedback): `CharTalent`
  (`shared/src/types.ts:220`) has no `notiz` field, and neither table
  renderer in `Talente.tsx` (`KampfTable`/`NormalTable`) has a notes column.
  Add `notiz: string`, extend the `EMPTY` default, add a column to both
  tables, reuse the existing `NoteField` component (`components/notes.tsx`)
  already used for item and weapon-row notes.
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
- [sketch] **Dice-dock backlog is unbounded in memory** (user feedback, checked
  and deprioritized): server-side is already fine — `loadFeedPage`
  (`server/src/feed.ts:144`) is cursor-paginated against the `(group_id, id)`
  index (`server/src/db.ts:381`) in bounded batches, cost doesn't grow with
  total history. `DicePanelProvider`'s `feed` array itself never trims, though
  — every `loadMore()` page and every live `feed.append` over the websocket
  just accumulates for as long as the tab stays open (a page reload resets it
  to the newest 30). Assessed as low risk: a long combat-heavy session
  realistically produces a few hundred entries, which React/the DOM handle
  fine in a small side panel — virtualization only starts to matter in the
  thousands, which needs either an extreme marathon session without reload or
  deliberate "Ältere Nachrichten laden" spam. Not worth building a cap/
  virtualization for now; revisit if it's ever actually reported as slow.
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
- [sketch] **Filtering** (own-element AsE increase): a SEPARATE future concept from
  overcharge — the character is filled with their own elemental energy → shown as
  an AsE increase. Not started; do not conflate with the overcharge display above.
- [sketch] **Armor-material catalogue**: a GM-editable material→RS list (like
  talents/languages) so a worn piece picks a material and shows its RS. Today RS is
  a manual per-piece number on the item.
- [sketch] **Ammunition**: damage values and effects (new catalogue). Once it
  has a per-ammo damage value, wire it into the Fernkampf damage formula (see
  „Fold ammunition damage into the Fernkampf damage formula" under the Weapon
  tab rework, Mid-Prio) — currently blocking that item.
  This feature will need the players to keep their own list of ammunitions and damage values for them, which then feeds the damage formula. ranged weapons then pick which ammunition is used.
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
- [sketch] **Portrait follow-ups**: on-page cutout editor (choose the crop instead of
  auto-center). click image to view bigger (check for storage usage)
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
- [ready] **New-tab category picker** (concept agreed — convenience seeding only):
  right now creating a tab (character sheet via Einstellungen `addTab`, and group
  tabs via the group page's `+ Tab` button) just gives an empty "Neuer Tab" with
  no content. Offer the same table/notepad choice that already exists one level
  down for sections (`Sektionen.tsx` `addSection('table' | 'notes')`) at tab-
  creation time instead: "Tabelle" / "Notizfeld" / "Leer" pre-seeds the new tab
  with one starter section of that type (or none). Purely a convenience default —
  the tab behaves like any other afterward, sections of either type can still be
  freely added/removed. Applies to both character tabs and group tabs.

## Unsorted ideas (treat all as [sketch])

- logcally connect weapons and inventory
  - weapons should be real items, too. they just carry some extra information.
  - e.g. reducing a weapons Haltbarkeit on Ausrüstung should also be mirrored on Waffen

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

- **wiki: Beobachtungsliste — decided AGAINST for now.** A per-page watchlist
  duplicates what the „N Änderungen seit deinem letzten Besuch" badge already
  does for a group this size. Revisit only if notifications land; that sketch is
  its proper home.

- **Discord feedback → TODO scan** (concept agreed; needs bot setup before build)
   - A local CLI script (like the changelog test flags) reads the feedback
     **forum channel** via a real Discord **Bot** (not the existing webhook —
     webhooks can't read). Needs a bot token + channel ID as env vars, the
     **Message Content Intent** enabled, and View Channel + Read Message History
     on the channel.
   - Per forum post: pull the **starter message only** + a reply count (threads
     get chatty; the starter is the actual feedback).
   - A per-thread **watermark** state file (gitignored, `thread_id → last-seen
     msg id`) so re-runs only surface new posts; abbruchsicher like the changelog
     mirror.
   - Writes into a **fenced, marked section** of TODO.md
     (`<!-- DISCORD-FEEDBACK:START/END -->`), each item carrying its thread/msg
     id in an HTML comment so re-scans never duplicate and items can be safely
     deleted once promoted. Raw passthrough — **no LLM in the script** (no added
     cost); refinement into real tasks happens in a normal coding session.

