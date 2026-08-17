# Shapeshifting characters — design notes

Working notes from a build-then-revert pass (2026-08-17). Nothing here is
implemented — see TODO.md's `[sketch]` entry, which stays the source of
truth until this is settled with the GM. Kept as a separate file because the
data-model question turned out to need real back-and-forth, not a quick
concept paragraph.

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
