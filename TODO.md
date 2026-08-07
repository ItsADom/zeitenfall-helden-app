
## Betrieb / Deployment

- HTTPS-Betrieb (z. B. öffentlicher Cloudflare-Tunnel für eine Session):
  mit `npm run start:secure` starten — setzt SECURE_COOKIES=1, das
  Sitzungs-Cookie wird dann nur über HTTPS gesendet (routes.ts liest die Env-Var).
  NICHT für lokale http://localhost-Tests verwenden — dort würde das Cookie mit
  Secure-Flag nicht mitgeschickt und der Login schlägt fehl; dafür `npm start`.
  (start:secure nutzt cross-env, damit es auch unter Windows funktioniert.)

## Mid-Prio

- audit log on characters (on hold until community testing + feedback)
   - who changed what when
   - CONCEPT DECIDED (2026-08-07) — build when it comes off hold:
      - Storage: SEPARATE SQLite file (helden-audit.db), NOT in helden.db. Reason:
        backup.ts uses db.backup() on the whole file × KEEP copies; keeping history
        out of helden.db means it never multiplies across those backups (disk is the
        constrained resource). Denormalize actor_name into each row (no cross-file FK).
      - Diff, don't snapshot: in saveSection, compare incoming payload vs current DB
        state, log only changed fields (old→new). Empty diff → write nothing (this
        doubles as a no-op write skipper for the live data too).
      - Coalesce: before insert, if a recent row exists for the same
        (character_id, actor, section, field) within ~5 min, UPDATE its new_val + ts
        and keep the original old_val. Collapses debounced autosave spam into 1 row.
        Makes audit size independent of the debounce interval.
      - Granularity by section type:
         - scalar sections (bio, meta, attributes, baseValues, resources): field-level
           diffs (stable keys, cheap, high value).
         - list/dyn sections (talents, weapons, inventory, dyn tabs): COARSE events only
           — 'section X bearbeitet (+a/-b/~c Zeilen)'. Rows are positional arrays with no
           stable identity (DELETE+INSERT), so per-cell diffing is noisy + expensive.
      - Fat values: numbers keep both; free text > ~120 chars truncate or store
        '[geändert]'. It answers who/what-field/when, not full version-restore.
      - Hook point: saveSection is the single choke point (thread actor = req.user.id
        through it). Also log saveVisibility, dyn-row saves, portrait set/delete, and the
        GM char rename/reassign/delete. Skip catalog/admin edits (separate scope).
      - Schema sketch: audit_log(id, character_id, actor_id, actor_name, ts, section,
        field NULL=coarse, old_val, new_val), index (character_id, ts DESC).
      - Retention: prune > ~90 days (or cap N per char) on the existing backup timer.
      - Optional later: read-only 'Verlauf' panel per char (GM sees all, owner sees own).

- saving concept — optimization pass (findings 2026-08-07; low-risk, do alongside audit log)
   - (done 2026-08-07) debounce bumped 800ms/700ms -> 1500ms both paths
     (Character.tsx, Sektionen.tsx) to cut data usage — every flush is a WHOLE-section
     rewrite (saveSection / saveDynRows do DELETE + re-INSERT). NOTE: this widened the
     data-loss window to ~1.5s, so the beforeunload/unmount flush below is now more
     important, not less.
   - no-op saves still do the full DELETE+INSERT even when nothing changed. Add an
     empty-diff / unchanged check server-side to skip the write entirely (same check the
     audit log needs — build once, use for both).
   - client already sends only dirty sections (good, keep). GOOD: all server writes are
     wrapped in transactions; list rewrites are atomic. No change needed there.

## Low-Prio

- color themes + dark mode (ein Mechanismus deckt beides ab)
   - CONCEPT (2026-08-07):
      - Grundlage steht schon: styles.css definiert die ganze Palette als CSS-Variablen
        in :root. Ein Theme = ein benannter Satz Variablen-Overrides; alles was
        var(--…) nutzt, färbt sich automatisch um (reines CSS, kein React-Rerender).
      - Mechanik: Overrides über ein data-theme-Attribut am <html> scopen
        (:root[data-theme="wald"] { --accent: …; }). Umschalten = eine Zeile:
        document.documentElement.dataset.theme = 'wald'. Sofort, ohne Reload.
      - Auswahl merken: clientseitig via bestehendem usePersistedState('theme', …)
        (localStorage, pro Gerät — richtig für eine Anzeige-Präferenz, kein Server nötig).
        Später optional zusätzlich am Nutzerkonto spiegeln (geräteübergreifend).
      - Flash vermeiden: data-theme in einem winzigen Inline-Skript im <head> von
        client/index.html VOR dem React-Mount aus localStorage setzen.
      - (PHASE 1 — DONE 2026-08-07) Rest-Hardcodes in styles.css tokenisiert: ~14 neue
        :root-Variablen (--on-accent, --header-grad-a/-b, --panel-hi, --surface-head/
        -hover/-hover-strong/-sunken, --border-soft/-hover, --accent-disabled, --mastery,
        --error-text). Werte = bisheriger Stand, also optisch unverändert. Bewusst NICHT
        tokenisiert: Münzfarben (.coin-* sind feste Materialfarben) und der @media-print-
        Block (Druck bleibt hell/schwarz auf weiß, unabhängig vom Theme).
      - (PHASE 2 — DONE 2026-08-07) Mechanik + Auswahl gebaut: theme.ts (Registry +
        useTheme-Hook über usePersistedState), ThemePicker (Farb-Swatches in der
        Kopfleiste), data-theme am <html>, No-Flash-Inline-Skript in index.html.
        Inline-Style in Sektionen.tsx (ColumnEditor) auf var(--surface-sunken) gezogen.
      - (PHASE 3 — weitgehend DONE 2026-08-07) 5 Light-Themes + 1 Dark autoriert und
        live geprüft: Rot (Standard), Wald, Königsblau, Amethyst, Bronze, Nacht (dunkel).
        Nacht-Kontrast ok (heller Text auf dunklem Grund, > WCAG AA).
      - Rest/optional (offen):
         - Feinschliff der Theme-Farben nach echtem Blick am Tisch (reine Token-Werte
           in styles.css, leicht änderbar).
         - Kontrast-Audit je Theme, v. a. funktionale Töne (warn/crit/computed) — sind
           Signale, nicht Deko; müssen in jedem Theme lesbar bleiben.
         - optional: Default über @media (prefers-color-scheme: dark), solange keine
           explizite Wahl getroffen ist.
         - optional: Theme zusätzlich am Nutzerkonto spiegeln (geräteübergreifend).
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
   - this has to be separated from the catalgoues - different kind of list
- catalogue for "Liturgien" (has to wait until the catalogue-content ist finished)
   - spells need to be selectable as a Liturgie, then select from a fixed list of corresponding skills

## Optional

- (done) picture upload — portrait in the Person section; center-crop to a 512 JPEG,
  stored as a BLOB in char_portraits (rides along in the daily DB backups)
   - possible follow-ups: on-page cutout editor (choose the crop instead of auto-center);
     show the portrait in the group summary view too
