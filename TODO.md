
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

### 3. Navigation & sidebar

Concept settled 2026-08-09. Sequence it as (a) nav split first, then (b) the
sidebar — the sidebar's "always editable" behaviour is already unblocked by the
shipped display mode.

#### 3a. Navigation — DONE

Shipped: `Dashboard.tsx` removed, replaced by `Charaktere.tsx` + `Gruppen.tsx`
(both via the shared `useOverview` hook), plus a `Profil.tsx` page carrying the
moved „Passwort ändern". Top bar now: wordmark · Charaktere · Gruppen ·
„Kataloge & Nutzer" (GM, route still `/verwaltung`, Admin `<h1>` relabelled) ·
Änderungen · … · theme · user-name (→ `/profil`) · logout. `/` and unknown
routes redirect to `/charaktere`.

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

- Weight and capacity calculation. `maximaleLast` and `gGewicht` are already in
  `shared/src/rules.ts` — nothing aggregates them.
- Inventory with real, editable categories instead of yet another dynamic table
  (today `kategorie` is a free text column in `shared/src/sections.ts`).
- Worn vs. generally available equipment as a "per body part" selection with
  drag & drop (was Mid-Prio; belongs here and comes as the second stage). The
  container/slot mechanics of the dynamic sections (`DYN_CONTAINER_KEY`,
  `readSlots`) are essentially a prototype of it already.

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
