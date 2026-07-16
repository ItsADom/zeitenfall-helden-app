
## Mid-Prio

- audit log on characters
   - who changed what when
   - concept needed, so it doesn't get bloated with every edit
- making container items on "Ausrüstung" expandable
   - e.g. weapon belt with 4 slots, these 4 slots can be filled with items that are carried
- text fields need breaks after a certain length, so you they expand down instead of scrolling sideways
- Heldenbrief: rename the Energien table headers
   - "Ergebnis" needs a clearer name — it is the currently usable max value
   - the column currently called "Max" is a hard cap that limits how high "Ergebnis" can ever get
   - both names should make that relationship obvious at a glance
   - note: the Übersicht shows the same value as "Ergebnis" and has to follow

## Low-Prio

- off-machine backup
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
