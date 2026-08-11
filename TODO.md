# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English.

## Operations

- HTTPS operation (e.g. Cloudflare tunnel): start with `npm run start:secure`
  (sets `SECURE_COOKIES=1` → session cookie over HTTPS only). For local
  http://localhost use `npm start`, otherwise login fails.

## Constraints & gotchas (don't relearn these)

- **A table must not get its own scroll area.** `overflow-x: auto` silently makes
  a box a scroll container in BOTH axes, so a sticky `thead` inside can only stick
  to the box, never the page. Tables drop their own overflow; this only works
  because `main` uses `overflow-x: clip` (clip cuts off without creating a scroll
  container; `hidden` would break it). Below 700px is the deliberate exception:
  the table keeps its own horizontal scroller and the header sticks within it.
- **Sticky offsets are measured, not hard-coded.** Each thing stuck at the top
  (top bar, sheet header, tab bar, talent search) writes its height into a CSS
  variable via `components/stickyChrome.ts`; the stylesheet sums them with
  `calc()`. One variable per observer, so none depends on who measured first.
- **Everything editable flows through `NumInput`/`TextInput`** (they read the
  display mode themselves), which is why one provider flips a whole sheet at once.
  Structural buttons (`+ Zeile`, columns, delete, tab reorder, portrait) do NOT
  pass through them and must be gated one by one.
- **No data loss on migration** (top-ranking rule): map known fields and fold any
  unmapped/custom column into the row's `notiz` as `Label: value`. See the
  `helden-app-datenverlust-vermeiden` memory.

## Decisions (settled — feed the open work below)

- **Overcharging Energien**: the current value may sit ABOVE the maximum and stays
  there until spent (e.g. filtered Astralenergie). Not a second pool — the same
  value, just overfilled. The `+` button (healing) still clamps at the maximum;
  typing the number directly does not.
- **Special Energien** (Drachenkraft etc.) are added by the player: name +
  attribute formula + bonus. **Psyche stays built in** — every character has one;
  it is a system rule, not a personal power.

---

## High-Prio

- more links throughout the app
 - item categories in Einstellungen should be accessable from the inventory
 - add section markers, so clicking on "Kategorien bearbeiten" in the inventory will directly scroll down to the categories

### 4. Energien

- **Overcharge display** (not built yet — `depletionClass` still only has
  `res-low`/`res-crit`): drop `max` from the current-value fields (`Heldenbrief`)
  and extend `depletionClass` with an "above maximum" state so an overfilled value
  reads as deliberately special, not a typo. `+` clamps, typing does not.
- **Move Psyche** out of "Stufe & Punkte" into the Energien table.
  - *Blocked on the Spielleiter*: formula + racial bonus.
- **Special Energien addable by the player**: name + attribute formula + bonus, as
  extra rows of the same table. `parseProbeExpr` in `shared/src/rules.ts` already
  evaluates "MU+IN+CH". The Einstellungen page is where these settings dock. Also
  needs a place to note the special rules attached to each.

## Mid-Prio

- **"Coming soon"**: add a dedicated section into the changelog that teases upcoming features
 - should always stay as the first (top-most) entry
- **Group overview page for GM**:
 - give the gm an exclusive screen where they can view all characters of a group and their most important stats
  - e.g. "Hat Gefahreninstinkt" or just add temporary notes
- **Group membership rework**: something like "Gruppe | Mitglieder | Hinzufügen…",
  where "Hinzufügen…" is a text field with auto-suggestion from the user list and
  an add button — several users addable at once, click a name or press Enter to
  stage them, then add.
- **Feedback / change requests from users**: an inbox for a dev user. Needs a
  Developer role; users can hold multiple roles; roles changeable on the admin
  dashboard.
- **Skip no-op saves**: `saveSection` / `saveDynRows` do a full DELETE+INSERT even
  when nothing changed. Add a server-side empty-diff check in front. `saveSection`
  (`server/src/characterData.ts`) is the single choke point — and it is the SAME
  diff the audit log needs. Build once, use twice.
- **Audit log on characters** (on hold until a stable 1.0, so it isn't touched on
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

- **Filtering** (own-element AsE increase): a SEPARATE future concept from
  overcharge — the character is filled with their own elemental energy → shown as
  an AsE increase. Not started; do not conflate with the overcharge display above.
- **Armor-material catalogue**: a GM-editable material→RS list (like
  talents/languages) so a worn piece picks a material and shows its RS. Today RS is
  a manual per-piece number on the item.
  - Accepted simplification (revisit only if it bites): an item's load follows its
    own `location`, so a container placed on the animal still has its contents
    counted as carried.
- **Ammunition**: damage values and effects (new catalogue).
- **A more neutral default theme** than Khôm (red).
- **Print / PDF follow-ups**:
  - Tables break across pages mid-section — add break-inside handling / keep
    sections together / repeat table headers.
  - Talente and Waffen tables get cut off at the sides even in landscape — too
    wide; needs print-specific narrower columns / smaller font / scaling /
    wrapping (easier now that static text wraps where an input would not).
  - Sprachen has rendering issues (investigate).
  - Maybe clamp column widths to the minimum necessary in print for readability.
- **Mobile/tablet & general layout pass - PROBABLY OUTDATED FINDINGS** (most players are on PC — saved for
  later): responsiveness and layout touch-up, testing across many resolutions,
  and splitting `styles.css` into smaller files for maintenance. The below-700px
  table scroller and the sidebar's narrow-screen reflow belong to this pass.
- **Look-up lists** (needs GM data; none yet): e.g. which attributes can be raised
  per weapon level / per spell level. Separate from the catalogues — a different
  kind of list.
- **Liturgien catalogue** (waits until the catalogue content is finished): read
  the character's priest level to unlock Liturgien accordingly. Priest-level
  requirements are still not fleshed out.
- **Portrait follow-ups**: on-page cutout editor (choose the crop instead of
  auto-center); show the portrait in the group summary view too.
