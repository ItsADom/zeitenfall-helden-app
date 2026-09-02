# UI convention: dialogs vs. inline

Decided 2026-09-02. Not a feature, a standing convention for when new UI reaches
for `components/Dialog.tsx` versus staying inline on the page.

## Why

Content keeps growing (items, categories, and now houses/rooms on top). A page
that puts every control inline turns into a wall of buttons and forms. The app
already leans on dialogs for exactly this — `AddItemDialog`/`AddContainerDialog`,
the cross-owner item move picker, `CategoryManagerDialog` (both on `Group.tsx`
and `GroupOverview.tsx`), `AbilityLookupDialog`, `NeueSeiteDialog`,
`CommandsDialog` — this just names the pattern so it's a deliberate choice going
forward instead of a case-by-case call.

## The heuristic

**Frequent, primary actions stay inline. Secondary, configuration, or rare
actions go in a dialog.**

- Inline: the thing a player does constantly while playing — editing a stat,
  adding an item to their own inventory row, rolling a check. Wrapping these in
  a dialog just adds a click to something that should be a single interaction
  on the page.
- Dialog: setup/management work that happens occasionally — managing
  categories, moving an item between owners, picking from a lookup list,
  confirming a destructive action, editing something with enough fields that it
  would crowd the page. If a control would only be touched a handful of times
  per session, it's a dialog candidate.

When unsure, ask: would a player or GM want this open and visible the whole
time they're on this page? Yes → inline. No → dialog.

## How to build one

Always go through the shared `Dialog` (`client/src/components/Dialog.tsx`), not
a bespoke modal. It gives Escape-to-close, backdrop-click-to-close, and the
head/body/foot layout for free. Use `wide` only for content that doesn't fit
the default ~420px panel (a multi-column table is the usual reason).

**Checklist for every new dialog, so nothing gets relearned:**

- If the dialog contains a table meant to scroll inside the dialog rather than
  growing the dialog itself, `.table-wrap` needs **both** the `scroll-box`
  class **and** an inline `maxHeight` + `overflowY: 'auto'` — the class alone
  leaves it at `overflow: visible` and an ancestor (`.dialog-body`) ends up
  doing the real scrolling while the sticky `thead` stays anchored to
  `.table-wrap`, which never moves. `Admin.tsx`'s catalog table
  (`style={{ maxHeight: 420, overflowY: 'auto' }}` alongside the class) is the
  reference.
- Don't nest a second `Dialog` inside a `Dialog`. If an action from within a
  dialog needs its own dialog, close the first one first, or reconsider whether
  the inner action should be inline within the outer dialog's body instead.
- Editable fields inside a dialog still go through `NumInput`/`TextInput` like
  everywhere else, so display-mode gating keeps working.

## Non-goal

This is not a mandate to convert existing inline UI wholesale. Apply it to new
work; only revisit existing inline controls if they're independently getting
crowded.
