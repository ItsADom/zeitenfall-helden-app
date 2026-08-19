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

---

## User feedback

- make GM + player rolls selectable by player and GM directly in chat (GM can choose who to send to, different from requesting Probe)
- confirmation gets rolled for every dice itself, but the player should only decide to roll confirmations as a single decision
- [sketch] worried that keeping the whole chat/roll backlog loaded in the docked
  panel forever will make loading times grow over time. Checked: server-side is
  already fine — `loadFeedPage` (`server/src/feed.ts:144`) is cursor-paginated
  against the `(group_id, id)` index (`server/src/db.ts:381`) in bounded
  batches, cost doesn't grow with total history. The real risk is client-side:
  `DicePanelProvider`'s `feed` array only ever grows (each `loadMore()` appends
  via `mergeFeed`, nothing trims), so a long-lived tab or repeated "Ältere
  Nachrichten laden" clicks bloat React/DOM state, not network calls. Needs a
  concept pass: cap in-memory history (drop oldest beyond N when appending),
  and/or list virtualization, and/or lean on the dedicated full-page view
  (already tracked below) for deep-history browsing while the dock stays
  capped to recent messages.
- "/master" for master-dice (fixed set of result names per number)
- "/wild" will roll a d6 and d20. this is for wild magic, where the d6 sets the category of spell from afixed list. should be made visible
- give player the choice to use w or d for rolls in display

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
- [ready] Make ASP itself optional — some characters have none (best done in the
  same pass).

## Mid-Prio

- [sketch] **Race catalogue → live calculations (LE/AU/AsE/MR/AK)**: the race
  catalogue (`races_catalog`, ~66 races from the Rassenbrief) wires Geschwindigkeit
  (`gsBase`), Psyche (`meta.psycheBase`) and Resilienz (`baseValues.resilienzBase`)
  live already — picking a race locks those three cells to the race's value
  (editable again only via a different race pick; personal adjustment stays on the
  existing Mod./Bonus column). Still store-and-display only for the other five
  bonuses (LE/AU/AsE/MR/AK): they show as info text under the race picker but are
  NOT yet added into `computeResource`/`computeBaseValueBases` in
  `shared/src/rules.ts`. Deliberately deferred to avoid silently shifting every
  existing character's computed LE/AU/AsE/MR/AK in the same pass as introducing
  the catalogue.
- [sketch] **Shapeshifting characters** (design notes at
  `docs/concepts/shapeshifting.md` — a build-then-revert pass surfaced real
  data-model disagreement with the GM, written up there instead of lost):
  a character that can shapeshift needs genuinely different values for
  almost everything (attributes, base values, possibly talents/abilities)
  per form — effectively a separate sheet per shape bundled under one
  character, not multiple independent characters. Still needs a concept
  pass with the GM (data model + how much duplicates vs. derives from a
  base sheet) before building.
- [ready] **Expanded bio page** (concept agreed): a dedicated route (e.g.
  `/charakter/:id/bio`), linked from the character sheet — deliberately outside
  the existing `char_tabs`/`char_sections` tab system, new territory for the app.
   - Background story via a markdown content editor: plain textarea for the
     markdown source + a write/preview toggle button rendering it (no rich-text
     editor library — matches the app's existing plain-textarea pattern, e.g.
     `sidebarNotiz` in `components/inputs.tsx`). Needs a markdown renderer added.
   - GM-only tagging: block-level for now — a marker wraps a whole
     paragraph/block as GM-only (e.g. a fenced ` ```gm ... ``` ` block), hidden
     from other players, always shown to the GM. Inline span-level tagging
     (mid-sentence) is a later idea, not built now.
   - Image gallery: new table for multiple images per character — separate from
     today's single-portrait `char_portraits` BLOB (`db.ts:257-262`, one row per
     character) — each image with an optional caption, reorderable, upload/delete;
     mirrors the existing portrait upload flow but many-of instead of one-of.
   - Existing `char_bio` fields (Heldenbrief) stay as they are, always public —
     the new markdown content is the only place with GM-only tagging.
   - Still open before a build plan: markdown library choice, where the markdown
     source is stored (new column/table), exact link/entry point from the sheet.
   - Images: `helden-assets.db` **already exists** — the wiki built it, keyed by
     `owner_type`/`owner_id` and generic from the start precisely so the bio
     gallery plugs in without a schema change. Use `assets/store.ts` with
     `owner_type='character'`, `rolle='galerie'`; the weekly backup schedule,
     the cleanup hook and the orphan sweeper are all in place. Note the catch it
     was built around: SQLite has no cross-database CASCADE, so any new delete
     path must call `loescheAssetsFuer()` by hand — the weekly sweeper is the
     safety net, not the mechanism.
   - The markup renderer also already exists and is shared, not wiki-private:
     `shared/src/wikiMarkup.ts` (source → typed AST) plus `client/src/wiki/
     Markup.tsx` (AST → React elements, no HTML string anywhere), including the
     ` ```gm ` block. The bio page should import those rather than grow a second
     parser — that was the whole reason they live in `shared`.
   - Still open: where the bio markdown source is stored (new column/table) and
     the exact link/entry point from the sheet. The library question is settled
     — there is no library, and the existing renderer is the answer.
- [sketch] **Dice rolls and chat — dedicated chat page.** The core feature
  (Probe/expression rolls, crit confirmations, chat, visibility picker, GM +
  player requests, roll log, explicit room switching) shipped on
  `feature/dice-rolls-chat`; the rules/mechanics are documented in
  `docs/concepts/dice-rolls-and-chat.md`, not repeated here. Still open: a
  docked-only panel would collide with a possible future virtual-table
  feature, now sketched out in `docs/concepts/VTT-concept.md` and
  `docs/concepts/virtual-table.md`. Not a rework: any page can call
  `useDicePanel()` and read the same `feed`/`sendChat`/etc., so a dedicated
  full-page chat view is additive — reuses `FeedEntryView` for individual
  messages/rolls, no duplicate connection. **Settled:** that dedicated page
  does NOT also render the floating dock (`DicePanel.tsx`'s fixed widget) —
  showing the same feed twice on the same page would be redundant.
- [ready] **Weapon tab rework**: Nahkampf-/Fernkampfwaffen live in a bespoke
  card-based tab (`client/src/tabs/WaffenNeu.tsx`, key `WaffenNeu`, shown as
  „Waffen" — one collapsible card per weapon, computed AT/PA/BL or FK probe
  shown next to the name in the collapsed head, full field grid on expand;
  follows the Ausrüstung item-chip pattern). Remaining:
   - `client/src/tabs/Waffen.tsx` (the retired generic-list tab, unreachable
     but still on disk) is dead code — safe to delete once nobody needs it
     for reference.
   - `Waffenloser Kampf`/`Kampfstile` (still the old generic `ListEditor`
     table inside `WaffenNeu.tsx`, unstyled as cards) still want their own
     card treatment eventually, same reasoning as the weapon rework itself.
   - `Pfeile-Bolzen` (Munition, same old-table situation) gets its own
     solution once the planned lookup catalogue exists (see „Look-up lists"
     below) — low priority, don't card-ify it first.
   - Weapon statuses (*Geschärft*, *Stumpf*, etc.) still need a concept — only
     the free-text `Besonderes`/Notiz fields capture them today.
   - [sketch] **Fold ammunition damage into the Fernkampf damage formula**
     (user feedback): every ranged weapon has its own `schaden` value today,
     but the ammunition actually loaded/used should add to it — currently
     nothing links the two, so a weapon's shown/computed damage ignores which
     ammo is equipped. Blocked on the **Ammunition** catalogue (Low-Prio,
     below) existing first, since there's no per-ammo damage value to pull in
     yet; once that catalogue has one, wire it into the Fernkampf damage
     calc (and presumably the collapsed-head Schaden display above). Needs a
     concept pass: how ammo gets selected/tracked per weapon (a field on the
     Fern row referencing the ammo catalogue? current stock/inventory-linked?),
     and how its damage combines with the weapon's own (added flat, or
     replaces part of the dice formula).
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

- [sketch] **Asset sweep: sanity-check before deleting** (`server/src/assets/sweep.ts`):
  `fegeVerwaisteBilder` treats every asset whose owner id isn't in `helden.db`
  as orphaned and deletes it from `helden-assets.db`. That's correct when both
  DBs are the real ones, but there's no cross-check that they actually belong
  together — point `HELDEN_DB` at an empty/wrong database while
  `HELDEN_ASSETS_DB` still points at the real one (e.g. a throwaway DB for a
  manual test, env misconfiguration) and the sweep reads "no owners exist" and
  wipes real assets on next startup. Bit the dev DB once already. Needs a
  cheap guard — e.g. skip the sweep (with a loud warning) if `helden.db` has
  suspiciously few rows in the owner tables relative to what's referenced in
  `helden-assets.db`, or a shared marker linking a DB pair together — exact
  approach still open.
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
- [sketch] **Ammunition**: damage values and effects (new catalogue). Once it
  has a per-ammo damage value, wire it into the Fernkampf damage formula (see
  „Fold ammunition damage into the Fernkampf damage formula" under the Weapon
  tab rework, Mid-Prio) — currently blocking that item.
  This feature will need the players to keep their own list of ammunitions and damage values for them, which then feeds the damage formula. ranged weapons then pick which ammunition is used.
- [sketch] **A more neutral default theme** than Khôm (red) and more themes in general.
  - Andergast as colorless
  - Orkland dark green, Bornland lighter green
  - Efferdia light blue
- [ready] **Secret "chaos mode" easter egg** (concept agreed — gag, not a real
  theme): click the decorative `banner-fx` strip in the header (`App.tsx:99-103`
  — purely decorative today, `aria-hidden`, no click handler, spans every page;
  deliberately NOT the "Zeitenkompass" wordmark, which is a `Link to="/"` and
  would navigate/interrupt the click sequence) 5x fast (~1.5s window) to trigger
  a garish/clashing "chaos" color mode — a joke, not a real addition to `THEMES`
  in `theme.ts`. Timed: runs for a fixed short duration (~10–15s) then auto-
  reverts to whatever theme was active before, no persistence, no toggle-off needed.
  Not yet implemented — when it is, it needs to report itself to the easter-egg
  tracker below (same as any future egg), so build the trigger with that hook
  from the start rather than adding it after the fact.
- [ready] **Easter egg tracker** (concept agreed; visual reference at
  `docs/concepts/easter-egg-tracker.html`): a public page listing every
  easter egg that exists, who found it first, and when — first-finder-only,
  deliberately competitive/leaderboard in tone, visible to all players.
   - Generic across eggs so adding a new egg later is a code change only, no
     schema change: catalog table `easter_eggs(key, name, added_at)` (one row
     per egg, `key` a stable slug like `chaos-mode`), plus
     `easter_egg_finds(id, egg_key, user_id, found_at)` with
     `UNIQUE(egg_key, user_id)` — insert-or-ignore, so only the first trigger
     per (player, egg) sticks and later triggers are silently no-ops.
   - Each egg's trigger needs to call a small `POST /easter-eggs/:key/found`
     (or similar) when it fires — there's no other persistence today (chaos
     mode is 100% client-side), so this is new wiring on the egg itself, not
     just a new page reading existing data.
   - **Decided:** the list itself is a normal, always-reachable page — NOT an
     egg to find (considered, dropped: paradoxical to gate a "how many eggs
     have been found" page behind being found itself).
   - **Decided:** found eggs show name/description/finder/date, unveiled for
     everyone once triggered. Unfound eggs are NOT individually listed (no
     per-egg "???" row, no exact remaining count) — instead, a single trailing
     "???" line is appended to the list ONLY while at least one egg is still
     unfound, just to tease that more exist. That line disappears once every
     known egg has been found.
   - Still open before a build plan: exact route/entry point for the public
     page.
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
  auto-center). click image to view bigger (check for storage usage)
- [sketch] **Link spoken languages to their writing system** (user feedback):
  `Sprachen.tsx` treats languages and scripts as two entirely separate,
  unlinked catalogs (`kind: 'sprache' | 'schrift'`), rendered by the same
  generic `LanguageTable` and grouped by `familie` — no field anywhere says
  "spoken language X uses script Y". Needs a concept pass: a `schriftId` /
  default-script field on `sprache`-kind catalog rows (or a join table), plus
  how to surface it in the UI (sub-label on the Sprachen row, auto-suggest in
  the Schriften table, …).
- [ready] **Reuse the item-creation `Dialog` for spells/abilities and weapons**:
  the new `components/Dialog.tsx` (generic modal chrome) plus the pattern
  established in `components/itemDialogs.tsx` (fill fields before insert,
  instead of pushing a blank record and auto-opening its editor) should
  extend to two remaining blank-then-edit spots: `AbilityManager.tsx`'s
  `emptyAbility()`, and `WaffenNeu.tsx`'s `emptyNahRow()`/`emptyFernRow()`
  (~10+ fields each, inserted blank on "+ Waffe", collapsed by default but
  still fill-after-insert). Each needs its own concept pass for field
  selection — Ability's shape (Element, Stufe, Komplexität, Probe, Effekt)
  and the weapon fields are both unrelated to Item's.
- [sketch] **Spell creation table — theme it, make it feel less like a plain
  table** (user feedback): `AbilityManager.tsx`'s "Regeltabelle: Zauber
  erschaffen" panel (`SPELL_CREATION_ROWS`, ~line 12) renders as a plain
  `<table className="sheet">` (3 cols, 8 static rows) with none of the app's
  card/chip theming — unlike the rest of the same page's ability list, which
  already uses the `abil-row`/`abil-compact` card pattern, or `WaffenNeu.tsx`'s
  `.wpn-card` / `Ausruestung.tsx`'s `.item-chip` styling used elsewhere. Needs
  a concept pass: restyle as themed table variant, or restructure as cards
  (one per attribute row)?
- [ready] **New-tab category picker** (concept agreed — convenience seeding only):
  right now creating a tab (character sheet via Einstellungen `addTab`, and group
  tabs via the group page's `+ Tab` button) just gives an empty "Neuer Tab" with
  no content. Offer the same table/notepad choice that already exists one level
  down for sections (`Sektionen.tsx` `addSection('table' | 'notes')`) at tab-
  creation time instead: "Tabelle" / "Notizfeld" / "Leer" pre-seeds the new tab
  with one starter section of that type (or none). Purely a convenience default —
  the tab behaves like any other afterward, sections of either type can still be
  freely added/removed. Applies to both character tabs and group tabs.

## Unsorted ideas (treat all as [sketch])

- logcally connect weapons and inventory
  - weapons should be real items, too. they just carry some extra information.
  - e.g. reducing a weapons Haltbarkeit on Ausrüstung should also be mirrored on Waffen

- FAQ - like a little manual or easy to miss features

- **Notifications** let players know, when things have changend (approved characters, new changelog entries [which include 'Demnächst' and 'Bekannte Fehler'])

- **drop `char_portraits`** — portraits now live in `helden-assets.db`; the old
  table was deliberately kept as a read fallback (copied, not moved) so a
  rollback onto older code still shows portraits. Once a release has gone by
  without needing one, delete the table and the fallback branches in
  `assets/portraits.ts`. Not before: it is the only copy an older build can see.

- **wiki: inline span-level GM tagging** — the wiki marks GM-only content at
  block level (a fenced ` ```gm ... ``` ` region). Marking a few words
  *mid-sentence* as GM-only is the open piece, and it is harder than it looks:
  the server strips GM regions from the response before sending, so an inline
  marker has to survive that removal without leaving a hole that reads as a
  typo. Same decision as the bio page's, and it should stay one decision for
  both.

- **wiki: Steckbriefe, dann Vorlagen** (concept settled, deliberately deferred —
  the navigation/category/redirect round shipped without it). Two steps, in this
  order, because the first is the visible half and carries none of the second's
  cost:
   - **Steckbrief block** — a ` ```infobox ` fence of `Schlüssel: Wert` lines,
     rendered as the floated box every Wikipedia article has. A parser node plus
     CSS; no reuse machinery, no staleness, no recursion.
   - **Transclusion** — `{{Vorlage:NSC|name=Alrik}}`, where a Vorlage is a page
     in a `vorlage` namespace (the `namensraum` column already carries one) whose
     text holds an infobox with `{{{name}}}` placeholders. Named parameters and
     defaults only; **no conditionals or parser functions** — that is where
     Wikipedia's template language becomes a programming language nobody can
     debug.
   - Two constraints that are not optional if this gets built: expansion happens
     **server-side on the read path, before the GM strip** (a Vorlage may contain
     a ` ```gm ` region, so the order is expand → strip, never the reverse), and
     it must **never touch the source the editor loads**, or the `[[gm:n]]`
     marker scheme breaks and a save writes the expanded text back.
   - The search index keeps storing the **unexpanded** source. Otherwise editing
     one Vorlage silently stales fifty pages' index entries (Wikipedia runs a job
     queue for exactly this) — and every NSC page would match „Rüstungsschutz"
     because the boilerplate says so.

- **wiki: Beobachtungsliste — decided AGAINST for now.** A per-page watchlist
  duplicates what the „N Änderungen seit deinem letzten Besuch" badge already
  does for a group this size. Revisit only if notifications land; that sketch is
  its proper home.

- **Discord feedback → TODO scan** (concept agreed; needs bot setup before build)
   - A local CLI script (like the changelog test flags) reads the feedback
     **forum channel** via a real Discord **Bot** (not the existing webhook —
     webhooks can't read). Needs a bot token + channel ID as env vars, the
     **Message Content Intent** enabled, and View Channel + Read Message History
     on the channel.
   - Per forum post: pull the **starter message only** + a reply count (threads
     get chatty; the starter is the actual feedback).
   - A per-thread **watermark** state file (gitignored, `thread_id → last-seen
     msg id`) so re-runs only surface new posts; abbruchsicher like the changelog
     mirror.
   - Writes into a **fenced, marked section** of TODO.md
     (`<!-- DISCORD-FEEDBACK:START/END -->`), each item carrying its thread/msg
     id in an HTML comment so re-scans never duplicate and items can be safely
     deleted once promoted. Raw passthrough — **no LLM in the script** (no added
     cost); refinement into real tasks happens in a normal coding session.

