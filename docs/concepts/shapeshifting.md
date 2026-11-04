# Shapeshifting characters — design notes

Working notes from a build-then-revert pass (2026-08-17). Nothing here is
implemented — see TODO.md's `[sketch]` entry, which stays the source of
truth until this is settled with the GM. Kept as a separate file because the
data-model question turned out to need real back-and-forth, not a quick
concept paragraph.

**The section "Revised direction (2026-11-04)" directly below supersedes the
open questions at the bottom of this file. The history sections after it
(first build, options A/B/C) are kept as background.**

## Revised direction (2026-11-04)

Decisions from the developer:

- **Completely separate sheets.** A form is a full sheet of its own, nothing
  derived from a base sheet (matches the GM's original stance).
- **Only the owning player changes which form is *active*.**
- **GM and player can both *view and edit* any form without making it
  active.** "Active" is what the rest of the app sees (VTT token, group
  roster, GM overview, feed, rolls). "Open in the editor" is a separate,
  explicit choice, e.g. a form switcher in the sheet header. The id resolver
  therefore has two inputs: default = the active form, override = the form
  being viewed.
- **Creating a form asks what to carry over** (dialog): a list of the sheet's
  tabs, each optionally *copied* once or *kept synchronous*.
  - Inventory is pre-selected and greyed out: it stays shared anyway.
  - GM notes always belong to the character, are not in the list, and stay
    shared.
- **Display:** a small chip directly under the character name, without
  making the bar taller. First version: just append the form name behind the
  character name.

### What "stays / synchronous" means for the data model

Think of every piece of sheet data as having a **scope**: *identity* (keyed on
the base character id, same for all forms) or *sheet* (keyed on the form's own
`characters` row). Inventory and GM notes are identity-scoped permanently.
"Keep synchronous" for another tab (final model, see the build plan below)
makes that form's tab **follow the base form**: the form has no rows of its
own for it and reads and writes the base form's rows, in both directions
(one set of rows, not two lists kept in step). "Copy once" duplicates the
rows into the new form and leaves them sheet-scoped. This keeps "completely
separate" true by default, and sync is an explicit, visible opt-in, not
derivation.

**The base form is the source of truth.** It is the `characters` row itself:
it can never be deleted on its own (deleting it deletes the character), it
never links to anything, and sync always means "this form follows the base".
Forms can be deleted; deleting the active form falls back to the base.
Known limitation: two forms cannot share a list that the base does not have
(e.g. Bär and Wolf sharing "Tier-Talente" while Mensch has its own). A hidden
pool row would allow that; it can be added later without breaking the model.

Consequences found while checking the current code (2026-11-04):

- Items already carry `owner_type`/`owner_id` (shared-inventories concept), so
  inventory staying shared means: items keep `owner_id = base character id`,
  which needs no change at all. Equipment presets and `item_move_log`
  reference those ids and keep working.
- But item *bonuses while worn* and equipment presets then apply to whichever
  form is active/viewed. Open question below.
- `char_items` has no DB cascade any more; form deletion must go through the
  same manual cleanup path as character deletion (plus `loescheAssetsFuer()`
  for the form's portrait).
- VTT tokens, group membership, feed author, `temp_group_members`, chat name
  and rolls all keep pointing at the **base** id; only the content routes
  (52 `/characters/:id` routes in `routes.ts`) need the id resolver, ideally
  one `router.param`-style step, not 52 edits.
- Tab list: Heldenbrief (always first, never syncable, it IS the sheet),
  Talente, Sprachen, Waffen, Ausrüstung/Inventar (fixed: shared), Zauber &
  Fähigkeiten, plus the player's custom tabs (`char_tabs`). Check the
  per-tab domains against the tables list below before building; "Waffen" in
  particular is items + `char_item_weapon_stats`, i.e. inventory-owned.

### Still open

Decided (2026-11-04):

- Only the owning player creates, renames and deletes forms.
- Rolls and chat suggestions always come from the **active** form, never from
  a form that is merely being viewed. So roll buttons on a viewed non-active
  sheet must be disabled or hidden (to be settled in the UI pass).
- Worn-item bonuses and equipment presets across forms: **deliberately left
  open for later.** Until then, items stay shared and their bonuses apply to
  whichever form is active.

- **Un-sync is per form and per tab:** "Entkoppeln" on one form's tab gives
  that form a snapshot of the shared data as its own copy; the other forms
  stay linked, nothing is lost. Resolver rule per tab: shared by default if
  the tab is flagged synchronous and this form has not detached it, else the
  form's own rows.
- **Re-link is non-destructive.** "Wieder verknüpfen" only flips the flag
  back; the form's own copy is not deleted but goes dormant (its rows stay,
  the resolver ignores them while linked; writes go to the shared rows, so
  the dormant copy stays frozen). The confirmation names what is being put
  aside ("Deine eigene Bär-Liste (12 Einträge) wird zurückgelegt, nicht
  gelöscht"). Detaching again, while a dormant copy exists, offers two
  choices: resume the earlier own copy, or take a fresh snapshot of the
  shared data (which replaces the dormant copy). The opposite direction, a
  form's own copy becoming the shared data for all forms, is deliberately
  not offered: it would overwrite what the other forms see. Dormant rows are
  removed by the normal form-deletion cleanup. Cost: a little hidden data
  that can surprise someone who forgot it, hence the entry count in the
  dialog. Re-link can be cut from v1 without changing the table layout.

Open:

1. Reuse for companion/pet sheets: see below.

### Relation to companion/pet sheets (TODO `[sketch]`)

Same machinery, different knobs: a hidden `characters` row marked in a side
table and attached to an owner, content routes resolved through one id
resolver, scope flags for anything shared. Differences to decide then: pets
are **concurrently present** (several at once, own VTT token, maybe own
initiative entry), where forms are mutually exclusive; so the pet link must
not be "one active at a time". Build the resolver and the side table so they
can serve both.

## Build plan (drafted 2026-11-04)

**Status 2026-11-04: phase 1 is built** (forms without sync, steps 1-7), verified
end to end against a disposable copy of the dev DB: a scripted API run (create
copy/blank form, view and edit a non-active form, wounds per sheet, Schicksalspunkte
never overwritten by a form save, switch active, rename, delete incl. fallback, base
not deletable, listings exclude forms, display-name suffix), an orphan-row check
after delete and after a server reboot with a live form, and the browser flow in
both color modes. Phase 2 and 3 are open. Phase 1 deviations and findings:

- A boot-time repair in `db.ts` ("every character has exactly one bank pouch")
  walked all `characters` rows and gave every form its own bank pouch on the
  next start. It now skips forms. **Any future boot-time loop over `characters`
  must exclude `character_forms`.**
- The id helpers live in `characterData.ts` (`identityOf`, `activeSheetId`,
  `isForm`, `NOT_A_FORM`, `displayName`); `server/src/sheets.ts` holds the
  lifecycle. Routes resolve the sheet with `sheetOr400(req, res, char)`
  (`?sheet=`, default active; group members only ever see the active sheet).
- Only the sheet-scoped routes take the sheet id; items, pouches, item
  categories, equipment presets, tags, GM notes, Schicksalspunkte, theme and
  chat name keep using the character id.
- A new form can be a copy of the base form's sheet (Heldenbrief and tabs, once)
  or blank. Portrait and token image are not copied (per sheet, as decided).
- Display name: the form label is appended only while a non-base form is
  *active* (lists, roster, VTT token name); the sheet header shows the *viewed*
  form's label.
- Rolls, the dice/probe routes, VTT token stats and the GM overview all read the
  active sheet; the roll buttons disappear on a viewed but inactive sheet.

**Status 2026-11-04: phase 2 is built** (steps 8-11), verified like phase 1 (a scripted
API run covering the carry-over plan, sync in both directions for talents and a custom
tab, detach, non-destructive re-link, resume vs. fresh snapshot, base deleting a followed
tab, plus the browser flow). The pure rules (`shared/src/sheetDomains.ts`, 12 tests) are
the resolver, the plan normalizer and `detachAction`. Deviations and findings:

- Domains are `heldenbrief` (copy or skip only), `talente`, `sprachen`, `waffen` (only
  the two Waffen-tab lists `waffenlos`/`kampfstile`; weapons themselves are items and
  stay shared), `faehigkeiten` (abilities and their lists, behind both the Zauber and
  Fähigkeiten tabs), plus each custom tab.
- Storage: `sheet_domain_mode(character_id, domain, mode)` (no row = own), and
  `char_tabs.source_tab_id` / `linked` for custom tabs. The source tab is kept after
  detaching, so any tab that came from the base can be linked again. Every loader and
  saver of a domain resolves through `dataOwner(sheetId, domain)`; custom tabs resolve
  through `loadDynTabs`, `sectionBelongsTo`, `resolveTabTarget` (new sections on a
  linked tab land on the base tab).
- A tab's title stays the form's own (not shared); only sections and rows are shared.
- Skipping the locked tab (Vorteile & Nachteile) in the dialog still creates it empty.
- New forms start with zero wounds (a copy of the base meta no longer carries them).
- If the base deletes a tab a form follows, the form keeps a copy as its own tab (any
  dormant own sections stay next to it).
- Re-link when the form has no own entries links immediately; otherwise the dialog names
  the number of entries being put aside. Detach with a dormant copy asks: resume it or
  take a fresh snapshot.
- UI: the create dialog is a table (per part: copy, keep in sync, leave empty), the
  per-form "Geteilte Teile" list in the dialog manages detach and link, and a banner
  "Gemeinsam mit Grundform" with Entkoppeln sits above a linked tab.

Step 12 (export/import and backup with forms) checked 2026-11-04, no changes needed. The
client export takes the viewed sheet's data, so linked parts appear as if own (including the
shared items and money). Importing both the Bär form (talents, languages and a custom tab
linked) and the base as the GM produced plain characters: no forms, no links, and every
section, tab (names, sections, rows), tab order, item, pouch and ability round-trips
identically; deleting the imports left no orphan rows. The nightly backup (SQLite online
backup of the whole file) keeps forms, domain modes, tab links and the active form; a server
started on the restored copy loads the form with its links intact (integrity check ok, no
foreign key violations).

There is no server-side automated test layer: the checks above were scripted runs
against a disposable DB copy, not committed tests. The gaps found after phase 1 are
closed by the afterwork items below.

Grounding facts from the code: content routes follow one pattern,
`getChar(Number(req.params.id))` then `characterAccess(...)` then data by
`char.id`, so one choke point changes, not 52 routes. Character deletion runs
by hand in `routes.ts` (assets, then items). Existing tests are pure
functions in `shared/test`, so the "which rows does this form read" rule goes
into `shared` as a pure function with tests. `characters.active_form_id`
NULL means "base is active", which is already right for every existing
character: no boot-time re-derive is needed.

### Data model

```
character_forms   (character_id PK → characters, base_character_id, label, position)
characters        + active_form_id (NULL = base)   + base_form_label
sheet_domain_mode (character_id, domain, mode)     -- 'linked' | 'own'; forms only
```

Resolver: for a form and a domain, `mode = 'linked'` reads the base form's
rows, otherwise the form's own rows. The base form is always its own rows.
Domains: `heldenbrief`, `talente`, `sprachen`, `faehigkeiten` (abilities and
lists), and one per custom tab. Linked custom tabs: the form's `char_tabs`
row carries a reference to the base's tab; title and content come from the
base tab, tab order and position stay per sheet.

Scope by data:

| Scope | What |
|---|---|
| Character (identity) | items incl. weapons, pouches/money, GM notes, tags, name, group, owner, theme, chat name, dice shortcuts, **Schicksalspunkte** |
| Sheet (per form) | Heldenbrief, talents, languages, abilities, custom tabs, **wounds**, portrait and token image, tab order, table widths, visibility flags |

Schicksalspunkte and wounds both sit in `char_meta` today. Schicksalspunkte
values live on the base row only and every form's loaded `meta` shows them
from there; `saveSection('meta')` ignores those two columns for forms. The
`/schicksalspunkte` route always uses the base id; `/wounds` and the VTT
marker's wound counter use the active sheet. The GM's Schicksalspunkte reset
also zeroes wounds and must therefore cover every form's row.

### Phase 1: forms without sync (shippable on its own)

1. Domain table: assign every `char_*` table to a domain and a scope (check
   the table above against `db.ts`).
2. Migration: `character_forms`, `active_form_id`, `base_form_label`. Test on
   a disposable copy of the dev DB, never the real one.
3. `sheetFor(req, baseChar)`: reads an optional `?sheet=<formId>`, checks it
   belongs to this base, defaults to the active form. Access is still decided
   on the base row. Content routes use the sheet id; the rest of the app
   keeps using the base id and the active form.
4. Audit every `FROM characters` listing and add the one "not in
   `character_forms`" filter.
5. Lifecycle endpoints, owner only: create (full copy of the current sheet,
   reusing the `loadFullCharacter`/`importFullCharacter` plumbing), switch
   active, rename, delete. Delete runs through the manual path
   (`loescheAssetsFuer`, the form's own rows); deleting a character also
   deletes all its forms.
6. Resolve base to active form wherever the base id is displayed:
   `buildSummary`, VTT token image and portrait, group overview.
7. Client: form switcher in the sheet header (viewing), a separate
   "aktivieren" action, name suffix on sheet, roster, chips and token label,
   roll buttons disabled on a viewed but inactive sheet, `?sheet=` through
   `charSheet.tsx` load and `flush()`.

### Phase 2: carry-over dialog, sync, detach and re-link

8. The pure resolver in `shared` with tests (linked, own, dormant, base).
9. Create-form dialog: tab list, per tab copy or sync; inventory greyed out
   and pre-selected; GM notes not listed. Heldenbrief is copy-only.
10. Detach (snapshot as own copy), re-link (own copy goes dormant), and the
    two-choice dialog on re-detach. A linked tab shows a hint („Gemeinsam mit
    Grundform").
11. Custom tabs: a form's tab can reference the base tab. If the base deletes
    a tab that forms follow, each linked form keeps a snapshot as its own tab.
    Per-tab menu entry „Mit Grundform verknüpfen" for tabs that came from a
    carry-over (a tab the form created itself has no counterpart). New base
    tabs are not pushed to existing forms; a form can copy them over.

### Phase 3: wrap-up

12. Check export/import and backup.
13. Verify in the browser as `testspieler`, light and dark mode, with
    Playwright from a scratch directory (form switch, viewed inactive form,
    synced tab edited from both forms).
14. Prune the TODO entries, draft the changelog under feature sections (no
    em-dashes). Recommend a minor bump, but never assign a version.

### Afterwork (small gap fixes, after phase 2; they don't touch its tables)

**Status 2026-11-04: built and verified in the browser (both color modes).**

15. Einstellungen page and ability workshop take the viewed sheet (`?sheet=`) from the
    sheet's links, so tabs, tab order, visibility, attribute points and abilities of a
    non-active form can be managed; both pages' back links return to that sheet. Einstellungen
    shows "Bogen: <name>" when the character has forms (theme, chat name and dice shortcuts
    stay per character).
16. Roll and feed entries carry the active form (author name at post time: the feed, group
    rolls, coop pools, the dock's "als ..." line, the VTT token name). Not changed: the
    GM's "SL-Wurf" member picker, which is keyed by user and shows the plain name.
17. On the sheet header the viewed form shows as a chip next to the name, vertically
    centered beside the name block (in flow, so nothing overflows the header background;
    height measured identical with and without). A first version put it under the name,
    absolutely positioned, and it clipped out of the header background. Lists, roster and
    token names still append the form name, since a chip would make those single-line
    labels taller.

Phases 1 and 2 should be separate commits and ideally separate releases:
sync is the riskiest part, and phase 1's layout supports adding it later.

## Where this started

GM's initial answer: a shapeshifter character just gets the ability to own
**multiple complete character sheets**, with a way to say which one is
currently "in play." No partial derivation, no per-field spec of what
changes between forms — the player fills each form in fully, independently.
Chosen specifically because the alternative (deciding which fields
derive from a base sheet vs. which are overridden) would require the GM to
enumerate a full ruleset for what a transformation changes, which they
don't want to commit to up front.

## What got built (and why it was reverted)

First attempt: each form was a full, independent row in the `characters`
table, linked to its "base" via a self-referencing `shapeshift_of` column,
with `active_form_id` on the base saying which form is live and
`group_id` physically moved between rows on switch.

This worked, but every place that lists characters (the player's own
"Meine Charaktere", the GM's character-management table, the group roster,
the GM-overview chip cards, the dashboard) had to be taught, one by one,
to notice and hide the non-active forms, resolve a "base name" for display,
and so on. A stale link to a dormant form also needed a redirect-to-active
hack since a dormant form is a real, independently-addressable row.

The root problem, as the developer put it: **forms were being modeled as
true characters when they aren't — they're exchangeable sheets under one
character.** The friction was a symptom of that, not of any individual
missing filter/join.

## What's actually in a character (for reference)

Everything below hangs off `characters(id)` via `character_id`, cascading:

| Table | Holds |
|---|---|
| `char_bio` | Person tab: age, appearance, race/culture/profession, sidebar note |
| `char_meta` | Level, AP, karma, ruf, psyche |
| `char_attributes` | 8 attribute rows |
| `char_base_values` | ~12 derived values (AT/PA/BL/INI/…) |
| `char_resources` | LE/AU/AsE |
| `char_special_resources`, `char_attr_extern` | Free-form extra energy pools / bonus points |
| `char_talents`, `char_languages`, `char_tags` | Learned talents / languages / GM traits |
| `char_pouches` + `char_pouch_coins` | Money |
| `char_tabs` + `char_sections` + `char_section_rows` | Player-defined custom tabs/tables |
| `char_items` + `char_item_categories` | Inventory |
| `char_abilities` + `char_ability_lists` | Spells & abilities |
| `char_portraits`, `character_tab_order`, `character_table_widths`, `character_visibility` | Portrait, tab order, column widths, group-visibility flags |

A "character" is this whole pile, addressed by one id. The GM's "complete
independent sheet" ask means a form needs its own copy of essentially all
of it — which is exactly why modeling a form as a real character row (reusing
every existing table/route/computation untouched) is cheap to build. The
part that was expensive was making that row **stop acting like** a listable,
independently-addressable character everywhere else.

## Options considered

**A. Separate `characters` rows, self-referencing (what was built).**
Cheapest to build, reuses everything — but "is this a form" logic ends up
scattered across every listing query, plus a redirect hack for stale links
to a dormant form's id. Reverted for this reason.

**B. JSON-snapshot sheets.** One real `characters` row per identity;
alternate forms stored as JSON blobs in a new table (`character_sheets`),
built on top of the existing `loadFullCharacter`/`importFullCharacter`
functions (already used by the character export/import feature — they
already serialize "everything about a character" into one object). Switching
= dump current live tables into the blob you're leaving, load the target
blob into the live tables. Simpler schema (one new table, no changes to
existing ones) but switching becomes a heavier dump-and-reload operation,
and blobs are opaque to any future feature that wants to query across
forms.

**C. A form-membership side table (leaning towards this one).**
```
character_forms (
  character_id      INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  base_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  label             TEXT NOT NULL DEFAULT ''
)
```
A form is *still* a real `characters` row underneath (so every existing
table/route/computation keeps working completely unchanged for its content —
same cheapness as option A) but a row in `character_forms` marks it as "not
a real independent character, hide it, here's whose form it is and what
it's called." Every listing query gets exactly one added filter (exclude ids
present in `character_forms`) instead of scattered ad-hoc logic. The sheet's
URL becomes the *base* character's id permanently — a form's id is never
exposed as a navigable route, so there's nothing to redirect away from.
Switching is a single `UPDATE characters SET active_form_id = ?` on the base
row (no `group_id` shuffling between rows — group/owner/theme/name live
permanently on the base only).

Cost: every route that currently reads/writes character data by the URL's
`:id` (sections, visibility, table-widths, items, abilities, pouches, name —
a few dozen call sites in `server/src/routes.ts`) needs to resolve "the id
whose data is actually live" (`char.active_form_id ?? char.id`) instead of
using the URL id directly. Mechanical but touches most of that file.

## Open questions to settle with the GM before building

- Does the GM's "complete independent sheet, no derivation" stance extend to
  *everything* in the table above (bio, inventory, tabs, GM notes, portrait),
  or just the stats (attributes/baseValues/resources/talents/abilities)?
  This came up when discussing whether talents/abilities differ per form —
  "that's exactly the point where the developer and the GM are going apart."
  Whatever the answer, option C doesn't require deciding this up front (a
  form gets a full copy of everything by construction) — the split only
  matters if the GM wants some fields to visibly stay pinned to the identity
  rather than duplicated per form.
- Naming: forms get a short label (e.g. "Bär") shown as subtext next to the
  character's real name ("Theo _Bär_"), not a full independent name. Confirm
  this reads right in practice, especially on the GM's chip-based group
  overview.
- Whether a partial-shift model (only *some* values change) is wanted at
  all, ever — explicitly out of scope so far ("we didn't even consider
  characters being able to just partly shift forms, which is a completely
  different and more complex topic").
