
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

- More pages in the top bar: "Gruppen" and "Charaktere". At heart this is
  splitting `Dashboard.tsx` — that page already renders both lists from
  `/api/overview`, no server work needed.
- Rename "Heldenverwaltung" (the brand link in `App.tsx`) — the name currently
  collides with "Verwaltung" (`/verwaltung`, Spielleiter only).
- Sidebar (variant B): character page only, right-hand side, showing the live
  values (Energien, Psyche, money) — always editable, even when the sheet is in
  read-only mode. Must come AFTER the display mode, because "always editable" is
  only defined against it.
  - "Notizen" content: deferred, see the open question above.
  - Side effect: the sidebar fills exactly the space complained about below
    under "too much whitespace on wide screens". On narrow screens it is the
    other way round — there it needs a drawer (layout pass).

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
  probe columns.

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
- Automatic calculation of Magierstufe and Magiepunkte (moved here — they hang
  off mage level and spells, not off the Energien).
- **Needs a requirements session with the Spielleiter first.** "Dedicated tab"
  and "highly adjustable" pull against each other; that is not answerable from
  the code.

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
