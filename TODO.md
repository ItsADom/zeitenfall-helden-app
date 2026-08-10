
## Betrieb / Deployment

- HTTPS operation (e.g. Cloudflare tunnel): start with `npm run start:secure`
  (sets SECURE_COOKIES=1 → session cookie over HTTPS only). For local
  http://localhost tests use `npm start`, otherwise login fails.

---

## Decisions (as of 2026-08-09)

Settled, so the items below can stay short:

- **Overcharging Energien**: the current value may sit ABOVE the maximum and
  stays there until spent (e.g. filtered Astralenergie). Not a second pool —
  the same value, just overfilled. The `+` button (healing) still clamps at the
  maximum; typing the number directly does not. Overfilling is the exception and
  may cost the deliberate gesture.
- **Read-only is the default — for everyone, not just the Spielleiter.**
  Editing is switched on deliberately. Exceptions: the **Übersicht** tab and the
  **side panel** stay editable always, because that is where the values live
  that move constantly during play.
- **Sidebar = variant B**: character page only, right-hand side, showing the
  live values. No app-wide layout rework; "Gruppen"/"Charaktere" remain pages in
  the top bar.
- **Special Energien** (Drachenkraft etc.) are added by the player: name +
  attribute formula + bonus. **Psyche** stays built in — every character has one,
  it is a system rule and not a personal power.
- **Magierstufe/Magiepunkte** do not belong with the Energien but with the
  Zauber rework (they hang off mage level and spells).

Deliberately deferred: what "Notizen" in the sidebar should be (per-character
scratchpad / pinned existing note sections / session log).

---

## High-Prio

### 1. Display mode — DONE (0.1.1)

Shipped: `components/displayMode.tsx` with three modes (`edit` / `readonly` /
`print`), read by `NumInput` and `TextInput` themselves. Read-only is the
default for everyone; Übersicht is the exception and stays live. Also closed
the empty free-text fields in print, the number-field spinner arrows, and the
leading 0 when typing.

What is worth keeping:

- **Everything editable runs through those two components.** That is why one
  provider can flip a whole sheet, and it is the lever to reach for whenever
  something must apply to every value at once.
- Structural buttons (`+ Zeile`, `Spalten`, `Löschen`, `+ Tab`, tab reordering,
  portrait, column widths) do NOT pass through them and need gating one by one.
  Collapsing deliberately stays available while read-only: it lives per device
  in localStorage and changes nothing about the character.
- Print came out empty because `TextInput` is an auto-growing `<textarea>` sized
  from `scrollHeight`, and the print root mounts while still hidden → height ~0.
  Static text has no such problem; there is no textarea left in the print tree.

Left open: Übersicht is still included in the printout (see Low-Prio).

### 2. Table handling — DONE (0.1.2)

Shipped: sticky table headers, sticky talent search, collapsing moved to the
heading. What is worth keeping from the way it went:

- **A table must not get its own scroll area.** The first attempt gave
  `.table-wrap` a `max-height` so a sticky `thead` had something to stick
  against. It worked, and it was wrong: with the pointer over a long table the
  page stopped scrolling until you had scrolled through the whole table. Do not
  reach for that again.
- The reason it was tempting: `overflow-x: auto` silently makes the box a
  scroll container in BOTH axes, so a sticky `thead` inside can only ever stick
  to the box, never to the page. The way out is to drop the wrapper's overflow
  entirely — which is only possible because `main` uses `overflow-x: clip`
  (clip cuts off without creating a scroll container; `hidden` would break it).
- The sticky offset is the sum of everything already stuck above: top bar, tab
  bar, and in the talent tab the search bar. None has a fixed height (the tab
  bar wraps to two rows), so each is measured into its own CSS variable by
  `components/stickyChrome.ts` and the stylesheet adds them with `calc()` —
  one variable per observer, so no observer depends on who measured first.
- `thead` sticks as a whole, not row by row. That is what makes the two-row
  Energien header work without hand-computed per-row offsets.

Left open on purpose:

- Below 700px a table wider than the page would be cut off by `main`'s clip, so
  there it keeps its own horizontal scroller and the header falls back to
  sticking within the table. Fold this into the narrow-screen layout pass.
- The panels on Übersicht and Heldenbrief (Attribute, Basiswerte, Energien,
  Geld) still do not collapse at all — they never did. Only the trigger moved;
  nothing gained collapsing that lacked it. Decide separately whether they
  should.
- Talent categories lost their remembered collapsed state once, because the key
  moved from `talc:cat:*` into the shared `tbl-zu:*` space.

### 3. Navigation & sidebar — DONE (0.1.4)

Concept settled 2026-08-09. Sequence it as (a) nav split first, then (b) the
sidebar — the sidebar's "always editable" behaviour is already unblocked by the
shipped display mode. Both shipped; only the Notizen slot stays deferred.

Also shipped alongside: the whole sheet header (name/player/group + the
edit/read toggle) now sticks below the top bar while scrolling — a fourth
measured-height layer (`--charhead-h`) added to the sticky chain in
`stickyChrome.ts`.

#### 3a. Navigation — DONE

Shipped: `Dashboard.tsx` removed, replaced by `Charaktere.tsx` + `Gruppen.tsx`
(both via the shared `useOverview` hook), plus a `Profil.tsx` page carrying the
moved „Passwort ändern". Top bar now: wordmark · Charaktere · Gruppen ·
„Kataloge & Nutzer" (GM, route still `/verwaltung`, Admin `<h1>` relabelled) ·
Änderungen · … · theme · user-name (→ `/profil`) · logout. `/` and unknown
routes redirect to `/charaktere`. Profil also lets users change their own
**Anzeigename** (new `PUT /api/me/displayName`, refreshes the top bar). The
wordmark „Heldenverwaltung" is a non-clickable placeholder until a striking
name is found.

- Split `Dashboard.tsx` into two pages: **Charaktere** (`/charaktere`) and
  **Gruppen** (`/gruppen`), each reusing `/api/overview` (already returns both
  arrays) — no server work. GM sees "Alle …", players "Meine …", as today.
- Top bar: wordmark (→ home) · Charaktere · Gruppen · **Kataloge & Nutzer**
  (GM; renamed from "Verwaltung" to clear the clash with the "Heldenverwaltung"
  wordmark) · Änderungen · … · theme · user-name (→ profile) · logout.
  - The route stays `/verwaltung` internally; only the label changes.
- `/` redirects to `/charaktere`.
- Move **Passwort ändern** off the (now split) list pages into a small profile
  page reached by clicking the user-name in the top bar.

#### 3b. Sidebar (variant B) — DONE

Shipped: `CharacterSidebar.tsx`, a sticky right column in a new two-column
`.char-body` (content + sidebar) below the sticky header/tabs. Rendered only in
the `access === 'edit'` branch (group members on the read-only summary never get
it) and inside `.screen-only` (hidden in print). Collapsible via
`useCollapsed('sidebar')` — collapsed it shrinks to a 34px rail. Reflows
full-width below the content at ≤1100px (position static there). `AktuellFeld`
and `gesamtDublonen` were extracted for reuse. Contents: Energien + Psyche
(AlwaysEditable steppers), read-only Attribute grid (8 codes) and money total.
Notizen slot still deferred (see below).

Follow-up (2026-08-09): energy pools shortened to LP/AUS/ASP and laid out as a
2×2 grid (sidebar widened to 300px). The **Übersicht tab was removed entirely**
— the Heldenbrief already carries every value it duplicated (editable) and the
sidebar carries the daily-use subset. `Uebersicht.tsx` deleted, `Heldenbrief` is
now the only fixed tab and the default landing tab, tab-order tests updated.

Render polish (2026-08-09): native number-spin arrows hidden (values were being
clipped); each energy head is a single centred „LP · X %" line over a centred
stepper; Geld total centred. Theme colours brought in — accent sigil on block
headings, accent pool labels + Geld total + sidebar title. Attribute values are
now compact boxed stat-tiles in a 4×2 grid (no wasted gap). The sidebar width is
**user-adjustable**: drag the left edge, persisted in `localStorage` and clamped
to 240–520px, ignored on narrow reflow and when collapsed (via a `--sidebar-w`
CSS var so the media query still wins).

#### 3b. Sidebar (variant B)

Sticky right-hand column on the character page ONLY. Edit-access only (group
members on the read-only summary don't get it). Hidden in print. Collapsible —
which also soaks up the wide-screen whitespace complained about below. On narrow
screens it reflows below the content for now; the proper drawer/stack is part of
the deferred layout pass.

Contents — two kinds:
- **Editable live pools** (always editable, even in read-only mode, via the
  existing `AlwaysEditable` — same rule as the Übersicht tab):
  - Energien (LE / AUS / AsE): current value with the −/amount/+ stepper, max,
    depletion colour.
  - Psyche: current / max.
- **Read-only quick-reference readouts** (glance values, not edited here):
  - Attribute Max — the eight attribute values. Called constantly for rolls, so they
    belong in the always-visible sidebar; editing them stays on the Heldenbrief.
  - Geld — total in Dublonen only. Actual coin editing stays on Übersicht/Geld.
- **Notizen** — deferred slot (per-character scratchpad vs pinned notes vs
  session log still undecided); leave room, build later.

Implementation note: the energy stepper (`AktuellFeld`) and the energy/psyche
computation currently live inside `Uebersicht.tsx`. Extract them into a shared
component the sidebar and Übersicht both use. Overlap with Übersicht is
intentional (Übersicht = full overview, sidebar = always-on subset); whether
Übersicht later slims down is a separate call.

### 4. Energien

- Allow overcharging: drop `max` from the current-value fields
  (`Heldenbrief.tsx`, `Uebersicht.tsx`) and extend `depletionClass` with an
  "above maximum" state, so an overfilled value reads as deliberately special
  instead of looking like a typo. `+` still clamps, typing does not (see
  Decisions).
- Move Psyche out of "Stufe & Punkte" into the Energien table. On the Übersicht
  it already appears there as a fourth row.
  - **Waiting on the Spielleiter**: formula + racial bonus.
- Special Energien addable by the player: name + attribute formula + bonus, as
  additional rows of the same table. The expression parser for this exists —
  `parseProbeExpr` in `shared/src/rules.ts` already evaluates "MU+IN+CH" for the
  probe columns. Also need something to note special rules connected to them.

### 5. Inventory & equipment

Concept settled 2026-08-09 (decisions below are the player's). Today everything
peripheral (Inventar, Ausrüstung, Proviant…) is a generic dynamic table seeded
from `shared/src/sections.ts`; `maximaleLast`/`gGewicht` exist in `rules.ts` but
aggregate nothing. Replace the scattered tables for these with ONE structured
item store and derive everything from it.

Decisions:
- **Unified item model.** One item store per character (dedicated table, like
  talents/languages — NOT a dynamic section). Each item: `name`, `anzahl`,
  `eGewicht` (per unit), `kategorie`, `location` (inventory / in-a-container /
  worn-on-a-body-zone / on-animal), optional container flag + capacity, `notiz`.
  Weight totals, category grouping and worn equipment all derive from this list.
- **Weight unit = kg**, decimals allowed (e.g. 0.5). Line weight = anzahl ×
  eGewicht. `maximaleLast` = `(KO+KK)×2×1.5` is treated as the kg limit (flag if
  that formula should change now that it is user-visible — e.g. Riloana = 42 kg).
- **Load meter counts all items EXCEPT worn-on-a-body-zone** (and, by extension,
  anything on an animal/mount — not on the character). Over the limit → red
  "over" state, same visual language as low energy. No penalty math, no GM input.
- **Categories are a per-character editable list** (add / rename / remove);
  renaming updates its items. Items pick a category from that list.
- **No data loss on migration** (a top-ranking rule): every migration maps known
  fields and folds any unmapped/custom column into the item's `notiz` as
  `Label: value`. Nothing a player typed is ever silently dropped. See the
  `helden-app-datenverlust-vermeiden` memory.

#### 5a. Structured Inventar (categories + weight) — first stage — DONE

Shipped: `shared/src/items.ts` (Item model + `itemGewicht`/`getrageneLast`/
`lastInfo`, tested), server `char_items` + `char_item_categories` tables with
load/save + PUT routes, and a built-in **Inventar** tab (`client/src/tabs/
Inventar.tsx`): items grouped by category with per-group weight subtotals, a
carried-load meter (`Σ / maximaleLast kg`) that turns red when overloaded, and
per-character category management (add/rename/remove). `Inventar` is now a
built-in movable tab (`MOVABLE_BUILTIN_TAB_KEYS`), replacing the dynamic one.
One-time migration (`migrateInventarToItems`, PRAGMA user_version=3) moved every
character's dynamic Inventar rows into the store — unmapped columns folded into
the item note (verified on Riloana: 46 items, custom columns preserved). Load
meter counts all non-worn items; unit kg with decimals.

- Built-in **Inventar** tab (replaces the dynamic one): items grouped by
  category, each group with a weight subtotal, plus a **carried-load meter**
  (`Σ / maximaleLast kg`) at the top with the over-limit warning state.
- Per-character category management (add/rename/remove).
- Normal edit/read gate (inventory edits are deliberate — NOT always-editable
  like the sidebar pools). The load total may later surface in the sidebar as a
  read-only glance value.
- Migrate existing dynamic `inventar` rows (`kategorie/name/anzahl/eGewicht/
  notiz`) into the store; retire the old dynamic Inventar tab. Custom columns →
  folded into `notiz` per the no-data-loss rule.

#### 5b. Worn equipment & containers (drag & drop) — second stage — DONE

Concept reworked with the player 2026-08-10: **Ausrüstung is a worn-gear tracer,
NOT a mirror of the inventory.** An item's `location` decides which tab shows it
(no equipment flag):

- **Ausrüstung** (`client/src/tabs/Ausruestung.tsx`): body zones (worn) · a
  „nicht getragen"-Bank · Tier · a Behälter-strip (storage bags as drop targets).
  A **quick-access** worn container (belt) shows its contents nested inline under
  its zone. Shows the **highest worn RS** (no summing). Body zones (signed off):
  Kopf/Hals/Brust/Rücken · seitengetrennte Arm/Hand/Bein · Gürtel/Füße — a zone
  is a LIST, not a single slot.
- **Inventar** (`client/src/tabs/Inventar.tsx`): only what's INSIDE storage
  containers, grouped per bag (+ füllung/Kapazität/Reduktion), plus a „Zu
  Ausrüstung" drop area (→ Bank) and a loose group that exists ONLY to catch
  migrated items — new characters don't create loose items (goods go in a bag or
  on the body). Category management dropped; categories now only sub-group the
  loose migration bucket.
- **Locations:** getragen (zone) · bench · tier · behaelter (containerUid) ·
  inventar (top-level carried: your bags + the loose migration bucket).
- **Containers** carry `containerArt` (quick=Ausrüstung-inline / storage=Inventar),
  `kapazitaet` (kg), and `gewichtsreduktion` % — 100 % = contents don't count
  toward carried load (bag of holding, e.g. Raskir's Erztasche: own 5 kg counts,
  its 1000 kg of contents don't).

What is worth keeping:

- **Items carry a stable `uid`**: saving is a whole-list DELETE+INSERT that
  reassigns the DB `id`, so `containerUid` references the uid. `saveItems`
  regenerates missing/duplicate uids and normalises zone/containerUid to location.
- Load rule: worn/bench/tier don't count; loose counts full; container contents
  count × (1 − reduction %). `effektiverRs` = max rs among worn.
- Migration `migrateAusruestungToItems` (`user_version=4`): belt-with-slots →
  quick worn container; bags → storage carried; Kleidungen → bench; Tier →
  tier; Proviant/unknown → loose. `__faecher`/`__inhalt` → real container +
  contents. Unmapped columns → note (no data loss). Verified on the Aug-7 backup:
  char 6 → Gürtel=quick(4), Umhängetasche/Erztasche=storage(60/1000 kg).

⚠️ **Live-DB recovery needed (2026-08-10):** a running dev server auto-migrated
`helden.db` to `user_version=4` with an INTERIM (wrong) version of the migration
(belts as storage, no bench, source tabs deleted). Because uv is already 4 the
corrected migration won't re-run. Clean recovery: stop the server, restore
`data/backups/helden-2026-08-07.db` (uv=1, source tabs intact) over
`data/helden.db`, restart → the corrected migration runs. Trade-off: loses any
character changes made after the Aug-7 backup.

Deferred (noted here): **armor-material catalogue** — a GM-editable material→RS
list (like talents/languages) so a piece picks a material and shows its RS. For
now RS is a manual per-piece number. Also accepted simplification: an item's load
follows its own `location`, so a container placed on the animal still has its
contents counted as carried — revisit only if it bites.

### 6. Zauber

- Complete rework of the Zauber tab: a dedicated tab instead of dynamic tables,
  while staying highly adjustable.
- **Needs a requirements session with the Spielleiter first.** "Dedicated tab"
  and "highly adjustable" pull against each other; that is not answerable from
  the code.

#### 6a. Magierstufe & Magiepunkte

Ships WITH the Zauber rework, not on its own — it needs the reworked tab's fixed
numeric `stufe`/`komplexität` fields. This is the calculable spine; the free-form
"how the spell tab looks" part stays the GM-session question above. Full rules in
the `magierstufe-magiepunkte-regeln` memory (source: GM doc Magierlevel.docx).

A derived-and-displayed feature, never interactive: the app computes and shows,
a human ascends manually.

Data model:
- `magierstufe` — manually tracked integer on the character (0/none = not a mage,
  1–5 = rank). The only value a human edits. Lives with the other meta values.
- Per spell: `stufe` and `komplexität` as numbers (already present in Riloana's
  sections; the rework just formalises them as fixed fields).
- Magiepunkte and eligibility are computed live — no new storage.

Magiepunkte:
- Per spell `punkte = stufe × komplexität`, summed.
- Anti-padding cap on TRIVIAL spells only (`stufe == 1 AND komplexität == 1`):
  count at most `10 × (magierstufe − 1)` of them. Everything else — level-1
  spells with komplexität > 1, all higher spells — counts in full.
- Cap holds for everyone; at rank 1 it is 10×0 = 0. No special case needed: new
  characters start with 3 spells, which already satisfies the level-1 baseline
  (3 Magiepunkte), so "becoming a mage" needs no app logic.

Eligibility (checks the NEXT rank only, `magierstufe + 1` — matches one-step
manual ascension and sidesteps the cap's circular dependency, since points use
the current rank's cap). All six conditions of that row must hold:

| Stufe | Körperbeh. | Selbstbeh. | Magiekunde | Kryptografie | Psyche | Magiepunkte |
|---|---|---|---|---|---|---|
| 2 | 20 | 20 | 20 | 10 | 80% | 16 |
| 3 | 40 | 40 | 40 | 20 | 90% | 34 |
| 4 | 60 | 60 | 60 | 40 | 100% | 60 |
| 5 | 80 | 80 | 80 | 80 | 100% | 120 |

- Four talent TaWs read from catalog talents Körperbeherrschung,
  Selbstbeherrschung, Magiekunde, Kryptografie (match by name — rename risk
  accepted as negligible). Psyche % already exists (`psycheProzent`). Magiepunkte
  from above.
- Always show a PROGRESS readout toward the next rank, not just a pass/fail
  banner: e.g. "Kryptografie 18/20 · Magiepunkte 28/34 · Psyche 88/90%". When all
  six clear: "Charakter erfüllt die Voraussetzungen für Magierstufe X." No button,
  no auto-bump.
- Show a small "X of Y trivial spells counted" note so the cap is legible.

Per-level operational reference (static table in shared/, current rank shown as a
read-only panel in the Zauber tab):
- ASP usable per round: 5 / 10 / 15 / 20 / 30
- Exhaustion above: 20 / 25 / 30 / 40 / 80 ASP
- Overcharge lethal above: +20 / +30 / +40 / +60 / +150 over max — feeds the
  already-shipped overcharge display: its "above maximum" AsE state turns from
  special to DANGER once the overfill passes this rank's line.
- Spell-level cap: 5 / 7 / 10 / 10 / 10

Boundaries:
- Filtering (own-element AsE increase) is a SEPARATE future concept, not this —
  do not conflate with overcharge.
- Only the overcharge danger-line spills outside the Zauber tab; everything else
  (rank field, Magiepunkte, eligibility, reference panel) lives in it.

Dependency: the four talents must exist in the catalog under those names.

---

## Mid-Prio

- Skip no-op saves: `saveSection` / `saveDynRows` do a full DELETE+INSERT even
  when nothing changed. Add a server-side empty-diff check in front.
  `saveSection` (`server/src/characterData.ts`) is the single choke point
  everything runs through — and it is the SAME diff the audit log below needs.
  Build once, use twice; afterwards the audit log is only a small addition.
- Audit log on characters (on hold until community testing + feedback)
   - who changed what when. Concept to build when it comes off hold:
      - Storage: SEPARATE SQLite file (helden-audit.db), NOT in helden.db —
        backup.ts copies the whole file × KEEP, so history stays out of those
        backups. Denormalize actor_name into each row (no cross-file FK).
      - Diff, don't snapshot: in saveSection compare payload vs current DB, log
        only changed fields (old→new); empty diff → skip (doubles as the no-op
        write skipper above).
      - Coalesce: within ~5 min, same (character_id, actor, section, field) →
        UPDATE new_val + ts, keep original old_val. Keeps audit size independent
        of the debounce.
      - Granularity: scalar sections (bio/meta/attributes/baseValues/resources)
        field-level diffs; list/dyn sections COARSE only ('section X: +a/-b/~c
        Zeilen') — rows are positional (DELETE+INSERT), so per-cell diffing is
        noisy.
      - Fat values: numbers keep both; free text > ~120 chars truncate /
        '[geändert]'.
      - Hook: saveSection is the single choke point (thread actor = req.user.id).
        Also saveVisibility, dyn-row saves, portrait set/delete, GM char
        rename/reassign/delete. Skip catalog/admin edits.
      - Schema: audit_log(id, character_id, actor_id, actor_name, ts, section,
        field NULL=coarse, old_val, new_val), index (character_id, ts DESC).
      - Retention: prune > ~90 days (or cap N per char) on the existing backup
        timer.
      - Optional: read-only 'Verlauf' panel per char (GM sees all, owner sees
        own).

---

## Low-Prio

- damage values and effects for ammunition
- color themes — mostly done (0.1.3)
  - DONE: every regional theme now has a light AND dark variant, on two axes
    (`data-theme` colour × `data-mode`). Schattenlande stays dark-only. Theme
    picker gained a light/dark slider and an animation on/off slider. Default
    follows the OS (`prefers-color-scheme` / `prefers-reduced-motion`) until the
    user chooses. Structure: shared dark-chrome block + per-theme dark accents,
    see the "Dunkelmodus" section in styles.css.
  - still open: default theme that is more neutral than Khôm (red)
  - still open: contrast audit per theme, especially the functional tones
    (warn/crit/computed) — they have to stay readable. The five dark accent
    palettes were eyeballed, not measured; worth a proper WCAG pass.
- print/PDF — what is left after the display mode. Already handled by the
  display mode (High-Prio 1): empty free-text fields, visible spinner arrows.
  What remains:
   - Übersicht should NOT be printed — drop it from the print tab list (one
     `.filter()` in `Character.tsx`). Small immediate win.
   - tables break across pages mid-section — add break-inside handling / keep
     sections together / repeat table headers
   - Talente and Waffen tables get cut off at the sides, even in landscape — too
     wide; needs print-specific narrower columns / smaller font / scaling /
     wrapping. Gets considerably easier with static text instead of `textarea`,
     because text wraps where an input does not.
   - Sprachen has rendering issues (investigate)
   - maybe clamp column widths to the minimum necessary in print for readability
- mobile/tablet and general layout pass (most players are on PC — saved for
  later)
   - only one responsive breakpoint now; the tab bar and wide tables get awkward
     on narrow screens
   - too much whitespace on wide screens (16:9 already has much unused space) —
     the sidebar from High-Prio 3 takes exactly that space
- look-up lists
   - has to be worked on with the GM, currently no data for this
   - examples:
      - what attributes can be increased per weapon level
      - what attributes can be increased per spell level
   - this has to be separated from the catalogues — different kind of list
- catalogue for "Liturgien" (has to wait until the catalogue content is
  finished)
   - spells need to be selectable as a Liturgie, then select from a fixed list
     of corresponding skills
- Person data is a bit unstructured. needs a little rework

---

## Optional

- portrait follow-ups: on-page cutout editor (choose the crop instead of
  auto-center); show the portrait in the group summary view too
