
## Mid-Prio

- audit log on characters (on hold until community testing + feedback)
   - who changed what when
   - concept needed, so it doesn't get bloated with every edit

## Low-Prio

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
   - maybe clamp column widths to the minimum necessary in print for readability (debatable)
- mobile/tablet layout pass (most players are on PC — saved for later)
   - only one responsive breakpoint now; the tab bar and wide tables get awkward on narrow screens
- off-machine backup (blocked for now, no other disk or storage available)
   - the daily backups sit on the same disk as helden.db, so they don't survive disk loss
   - copy server/data/backups/ somewhere else regularly (external drive, cloud, second host)
- look-up lists
   - has to be worked on with the GM, currently no data for this
   - examples:
      - what attributes can be increased per weapon level
      - what attributes can be increased per spell level

## Optional

- add picture upload for character visualization
   - cutout editor on-page, if technically not too heavy
   - fixed format otherwise (with cutout from center)
   - optional: storage limit
