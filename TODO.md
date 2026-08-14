# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English. Tasks inside a prio-category are not ordered by urgency.

Durable engineering rules (the scroll-container/sticky-offset/display-mode/no-
data-loss gotchas) now live in `CLAUDE.md`; run-book bits (HTTPS/secure cookies)
live in `README.md` / `DEPLOYMENT.md`.

## Readiness tags

Each open item is tagged: **[sketch]** = a raw idea + my instructions; needs a
concept worked out (and sign-off) before building. **[ready]** = concept agreed,
can go straight to a build plan. Priority is the section (High/Mid/Low);
"on hold" / "blocked" notes stay inline and are a separate axis.

## Decisions (settled — feed the open work below)

- **Special Energien** (Drachenkraft etc.) are added by the player: name +
  attribute formula + bonus. **Psyche stays built in** — every character has one;
  it is a system rule, not a personal power.

---

## User feedback

Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections below in a later pass. (Empty = all caught up.)

## High-Prio

### 4. Spezialenergien - full version

Light version shipped: a separate `special` list (name/max/aktuell) the player
edits in the Energien panel, mirrored as sidebar quick-edit chips and GM-overview
chips. Backend table `char_special_resources`. Open for the full version:

- [sketch] GM-provided ruleset instead of free-form: energies **selectable** by
  players from a data-list the app/GM supplies (name + attribute formula + bonus),
  with a place to note the special rules attached to each. `parseProbeExpr` in
  `shared/src/rules.ts` already evaluates "MU+IN+CH". The Einstellungen page is
  where these settings dock. Migrate existing free-form `special` rows into it
  without data loss.
- [sketch] Make ASP itself optional — some characters have none (best done in the
  same pass).

## Mid-Prio

- [sketch] **Attribute provenance & unused-point reminder**: attributes don't
  distinguish where a point came from — track whether it was added by leveling up
  vs. another source. Players specifically asked for a **visual reminder when
  points are unused** (e.g. leveled up but haven't raised an attribute yet).
- [sketch] **Money rework**: a coin counter for how much a character is carrying,
  with editable money pouches. Also allow renaming currencies and adding/removing
  currency types.
- [sketch] **Inventory UX**: "Zur Ausrüstung" should stick — moving items from the
  bottom of a bag currently isn't possible without zooming out to ~10%. Eventually
  make item categories collapsible without changing the current look.
- [sketch] **Weapon tab rework** (complete rework, upcoming): weapons can carry
  statuses like *Geschärft*, *Stumpf*, etc. Only the status note is captured so
  far — the rest of the rework still needs a concept.
- [ready] **Group overview page for GM** (concept agreed — chip-based, stats only):
   - Separate GM-only screen at `/gruppe/:id/uebersicht`, linked from the group
     page. NOT a table — one card per character, stats shown as chips, grid reflows.
   - Card header: portrait thumbnail + name + player + Stufe
   - Chips: Vitals (LE, AUS, AsE, Psyche) as `akt/max`, color-coded by drain %
     (AsE chip hidden when the character has no ASP); Wundschwelle + Todesschwelle;
     the eight attributes (MU KL IN CH FF GE KO KK) as small chips. Defenses skipped.
   - Data: new GM-only aggregate endpoint over `buildSummary` for the whole group,
     live quiet-refresh on focus (reuse the group page's focus/visibility pattern).
   - Deferred (later pass): GM overlay of flags + private notes per character.
     "Hat Gefahreninstinkt" = TaW ≠ 0 in the Gefahreninstinkt talent — a talent-
     catalogue-derived boolean (ensure the talent exists in the catalogue), NOT a
     hand-maintained checklist. Make checklist (which Talents are looked up) editable by GM.
- [ready] **Audit log on characters - RECHECK CONCEPT WITH DEVELOPER** (on hold until a stable 1.0, so it isn't touched on
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

- [sketch] **Spell-creation table in-app**: creating spells in-game follows a
  regulated table (`files/spell_creation.webp`). Surface it somewhere visible in
  the app; also needs styling tweaks to look better.
- [sketch] **Landing page & rebrand**: clicking the banner header (title) should
  open a landing page. Alongside it, a new header/title for the app
  (`files/title.jpg`) — extract the font if possible and weave it in; otherwise
  just use the new name.
- [sketch] **CSS tidy-up**: check for components than can be combined
 - less exclusive designs (e.g. section headers get rendered different, but are actually the same everywhere)
 - splitting CSS into more fitting files
   - good pre-work for the responsiveness-pass
- [sketch] **General tidy-up**: check code for unused elements and remove
- [sketch] **Filtering** (own-element AsE increase): a SEPARATE future concept from
  overcharge — the character is filled with their own elemental energy → shown as
  an AsE increase. Not started; do not conflate with the overcharge display above.
- [sketch] **Armor-material catalogue**: a GM-editable material→RS list (like
  talents/languages) so a worn piece picks a material and shows its RS. Today RS is
  a manual per-piece number on the item.
   - Accepted simplification (revisit only if it bites): an item's load follows its
    own `location`, so a container placed on the animal still has its contents
    counted as carried.
- [sketch] **Ammunition**: damage values and effects (new catalogue).
- [sketch] **A more neutral default theme** than Khôm (red) and more themes in general.
- [sketch] **Print / PDF follow-ups - PROBABLY OUTDATED**:
   - Tables break across pages mid-section — add break-inside handling / keep
    sections together / repeat table headers.
   - Talente and Waffen tables get cut off at the sides even in landscape — too
    wide; needs print-specific narrower columns / smaller font / scaling /
    wrapping (easier now that static text wraps where an input would not).
   - Sprachen has rendering issues (investigate).
   - Maybe clamp column widths to the minimum necessary in print for readability.
- [sketch] **Mobile/tablet & general layout + responsiveness pass - PROBABLY OUTDATED FINDINGS** (most players are on PC — saved for
  later): responsiveness and layout touch-up, testing across many resolutions,
  and splitting `styles.css` into smaller files for maintenance. The below-700px
  table scroller and the sidebar's narrow-screen reflow belong to this pass.
- [sketch] **Look-up lists** (needs GM data; none yet): e.g. which attributes can be raised
  per weapon level / per spell level. Separate from the catalogues — a different
  kind of list.
- [sketch] **Liturgien catalogue** (waits until the catalogue content is finished): read
  the character's priest level to unlock Liturgien accordingly. Priest-level
  requirements are still not fleshed out.
- [sketch] **Portrait follow-ups**: on-page cutout editor (choose the crop instead of
  auto-center).

## Unsorted ideas (treat all as [sketch])

- **Notifications** let players know, when things have changend (approved characters, new changelog entries [which include 'Demnächst' and 'Bekannte Fehler'])

- **wiki for world lore and game rules**

- **expanded bio for characters as a dedicated page** examples for content:
   - background story
   - detailed description of visuals and behaviour
   - more images (outfits, different poses etc.)

- **Discord-webhook**
   - to post new changelog entries automated

- **catalogue for character races**
   - wires into the Psyche calculation

- **dice rolls and chat**
   - hidden rolls (only visible for the rolling user)
   - GM and selected player only rolls (so the gm can roll with a player without anyone noticing)
   - roll logs
   - dice rollable from sheet
   - chat commands
     - /me
       - "/me baut eine Sandburg" -> "Raskir baut eine Sandburg"
     - general commands for different roll styles
   - dice shortcuts
