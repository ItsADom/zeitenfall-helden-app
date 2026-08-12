# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English.

Durable engineering rules (the scroll-container/sticky-offset/display-mode/no-
data-loss gotchas) now live in `CLAUDE.md`; run-book bits (HTTPS/secure cookies)
live in `README.md` / `DEPLOYMENT.md`.

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

- page refresh fired by re-focusing resets the scroll-state
 - disruptive behaviour that bings the user back to the top every time

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

- **Group overview page for GM**:
 - give the gm an exclusive screen where they can view all characters of a group and their most important stats
  - e.g. "Hat Gefahreninstinkt" or just add temporary notes
- **Skip no-op saves**: `saveSection` / `saveDynRows` do a full DELETE+INSERT even
  when nothing changed. Add a server-side empty-diff check in front. `saveSection`
  (`server/src/characterData.ts`) is the single choke point — and it is the SAME
  diff the audit log needs. Build once, use twice.
- **Audit log on characters - RECHECK CONCEPT WITH DEVELOPER** (on hold until a stable 1.0, so it isn't touched on
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

- **CSS tidy-up**: check for components than can be combined
 - less exclusive designs (e.g. section headers get rendered different, but are actually the same everywhere)
 - splitting CSS into more fitting files
  - good pre-work for the responsiveness-pass
- **General tidy-up**: check code for unused elements and remove
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
- **Print / PDF follow-ups - PROBABLY OUTDATED**:
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
