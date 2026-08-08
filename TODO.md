
## Betrieb / Deployment

- HTTPS-Betrieb (z. B. Cloudflare-Tunnel): mit `npm run start:secure` starten
  (setzt SECURE_COOKIES=1 → Sitzungs-Cookie nur über HTTPS). Für lokale
  http://localhost-Tests `npm start`, sonst schlägt der Login fehl.

## High-Prio

- overcharging of Energien
- talent search bar always visible, even when scrolled
- make table headers stay visible, while the table is rendered
- make complete tables collapsible
  - partly done, but instead of "Einklappen" make the sigil clickable
- weight and capacity calculation in inventory
  - inventory with editable categories, not another dynamic table
- always visible side bar with relevant stats and notes
  - side bar navigiation to "Gruppen", "Charaktere"
- more pages at the top-bar
   - "Gruppen" showing the user's groups
   - "Charaktere" showing the user's characters
   - "Heldenverwaltung" needs renaming. something that reflects the showing of every group and characters
- mobile/tablet and general layout pass (most players are on PC — saved for later)
   - only one responsive breakpoint now; the tab bar and wide tables get awkward on narrow screens
   - too much whitespace on wide screens (16:9 already has much unused space)
- read-only view for role Spielleiter
- Psyche has a calculation + racial bonus (needs to be implemented) and does not belong in "Stufe & Punkte"
- no place for special Energien like "Drachenkraft" or similar
  - need a concept for that
- complete rework of the Zauber tab
  - should be a dedicated tab, not just dynamic tables
  - still needs to be highly adjustable
- automatic calculation for Magierstufe and Magiepunkte

## Mid-Prio

- audit log on characters (on hold until community testing + feedback)
   - who changed what when. Concept to build when it comes off hold:
      - Storage: SEPARATE SQLite file (helden-audit.db), NOT in helden.db — backup.ts
        copies the whole file × KEEP, so history stays out of those backups. Denormalize
        actor_name into each row (no cross-file FK).
      - Diff, don't snapshot: in saveSection compare payload vs current DB, log only
        changed fields (old→new); empty diff → skip (doubles as no-op write skipper).
      - Coalesce: within ~5 min, same (character_id, actor, section, field) → UPDATE
        new_val + ts, keep original old_val. Keeps audit size independent of the debounce.
      - Granularity: scalar sections (bio/meta/attributes/baseValues/resources) field-level
        diffs; list/dyn sections COARSE only ('section X: +a/-b/~c Zeilen') — rows are
        positional (DELETE+INSERT), so per-cell diffing is noisy.
      - Fat values: numbers keep both; free text > ~120 chars truncate / '[geändert]'.
      - Hook: saveSection is the single choke point (thread actor = req.user.id). Also
        saveVisibility, dyn-row saves, portrait set/delete, GM char rename/reassign/delete.
        Skip catalog/admin edits.
      - Schema: audit_log(id, character_id, actor_id, actor_name, ts, section,
        field NULL=coarse, old_val, new_val), index (character_id, ts DESC).
      - Retention: prune > ~90 days (or cap N per char) on the existing backup timer.
      - Optional: read-only 'Verlauf' panel per char (GM sees all, owner sees own).
- worn equipment and general available equipment as a "per body part" selection with drag&drop to decide what is worn
- skip no-op saves: saveSection / saveDynRows do a full DELETE+INSERT even when nothing
  changed. Add a server-side empty-diff check to skip the write — same diff the audit log
  needs, so build once and use for both.

## Low-Prio

- damage values and effects for ammunition
- color themes — optional polish
  - default theme that is more neutral than Khôm (red)
  - Kontrast-Audit je Theme, v. a. funktionale Töne (warn/crit/computed) — müssen lesbar bleiben.
  - optional: Default über @media (prefers-color-scheme: dark), solange keine Wahl getroffen.
- print/PDF optimization (basic version works — je Tab eine Seite; these are refinements)
   - free-text inputs print EMPTY (only the labels show): Person/bio details, Ausrüstung,
     Inventar, Zauber/Fähigkeiten, Vorteile — everywhere TextInput is used. Plain <input>
     (e.g. the Gürtel slot fields) prints fine.
     - likely root cause: TextInput is an auto-growing <textarea> whose height is set in a
       useLayoutEffect from scrollHeight; the print-root mounts while display:none, so
       scrollHeight is 0 → height collapses to ~2px and the text is clipped. Fix idea: give
       textareas auto/content height in print, recompute on print, or render static text.
   - tables break across pages mid-section — ugly; add break-inside handling / keep sections
     together / repeat table headers
   - number-input spinner arrows are visible — hide them in print
   - Übersicht should NOT be printed — drop it from the print tab list
   - Talente and Waffen tables get cut off at the sides, even in landscape — too wide; needs
     print-specific narrower columns / smaller font / scaling / wrapping
   - Sprachen has rendering issues (investigate)
   - maybe clamp column widths to the minimum necessary in print for readability
- look-up lists
   - has to be worked on with the GM, currently no data for this
   - examples:
      - what attributes can be increased per weapon level
      - what attributes can be increased per spell level
   - this has to be separated from the catalgoues - different kind of list
- catalogue for "Liturgien" (has to wait until the catalogue-content is finished)
   - spells need to be selectable as a Liturgie, then select from a fixed list of corresponding skills
- when entering a number, the 0 stays so you cant just start typing your value
  - maybe delete zeroes in front
- Person data is a bit unstructured. needs a little rework

## Optional

- portrait follow-ups: on-page cutout editor (choose the crop instead of auto-center);
  show the portrait in the group summary view too
