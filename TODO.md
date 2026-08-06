
## Mid-Prio

- quick damage/heal on the energies (Übersicht)
   - LE/AUS/ASE/Psyche: +/- steppers or an "apply ±X" field, so "took 7 damage" is one
     action instead of mental math and retyping the new Aktuell
- total wealth readout in the Geld panel
   - sum all coins + bank, converted up to Dublonen (gold); every step is 10 coins
     (10 Kreuzer = 1 Heller, 10 Heller = 1 Silbertaler, 10 Silbertaler = 1 Dublone)
   - pure computed readout, no data changes
- per-character JSON export/import
   - player can download their own character as a file and re-import it
   - self-serve backup next to the server-side dailies; also moves a character between instances
- session log for groups
   - dated "what happened this session" log alongside the group's Questlog/NPCs
- audit log on characters (on hold until community testing + feedback)
   - who changed what when
   - concept needed, so it doesn't get bloated with every edit

## Low-Prio

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
