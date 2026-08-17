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
   - Consider storing the images in a separate, shared SQLite file (e.g.
     `helden-assets.db`) with its own, less frequent backup schedule (see
     `backup.ts`), instead of in `helden.db` alongside the frequently-changing
     character/wiki data. Reason: `backup.ts` does full daily snapshots, not
     incremental — a large, mostly-static image blob table would bloat every
     daily backup even on days nothing changed, wasting OneDrive sync bandwidth.
     Shared across features (bio gallery, wiki images, and eventually portraits)
     rather than one image db per feature, keyed by owner_type/owner_id, to
     avoid a growing pile of near-identical blob-storage db files. Catch:
     SQLite has no cross-database FK/CASCADE, so character/page deletion would
     need a manual cleanup hook against the second file instead of relying on
     `ON DELETE CASCADE`. Wiki *text* content itself stays in `helden.db`
     (see wiki entry below) — only images get split out; text is cheap enough
     that splitting it out isn't worth the operational cost of a third db.
- [sketch] **Dice rolls and chat** (concept fully worked out, split into
  sub-pieces below — already teased in the changelog's `COMING_SOON`. Left as
  `[sketch]` rather than bumped to `[ready]` deliberately: this is large enough
  that a build plan should re-walk it piece by piece anyway):
   - **Roll mechanic (decided):** a Probe rolls N d20, where N = the number of
     attributes in that Probe's formula (`talentProbeZahl`/`probeExprZahl` in
     `shared/src/rules.ts` already compute the target number = summed attributes
     + Erleichterung — the app models Proben as a single combined number today,
     not per-attribute). The N d20 results are **summed**, not compared
     individually; success = that sum ≤ the precomputed Probe-Zahl. Damage rolls
     are separate and NOT part of this sum.
   - **Crit rules (decided):** any die rolling a natural 20 triggers its own
     separate re-roll ("Bestätigung"/confirmation), one per 20 rolled (not one
     shared confirmation for the whole roll). Bestätigung ≥ 10 → that 20 is
     confirmed as an instant critical failure, overriding the normal sum-vs-
     Probe-Zahl comparison; Bestätigung < 10 → not confirmed, its value is
     instead added to the rolled sum (worsening normal odds). Mirrored for a
     natural 1: also its own separate Bestätigung roll, but its value is
     *always* subtracted from the rolled sum regardless of the roll's outcome —
     improves the odds but does NOT itself guarantee success (the adjusted sum
     still has to beat the Probe-Zahl normally). With 2+ dice rolling 20 (or
     2+ rolling 1) each gets its own independent Bestätigung roll per the rules
     above, and the effects stack/compound rather than collapsing into one
     shared outcome — e.g. two confirmed 20s is a more severe failure than one.
   - Sub-pieces, each decided on its own pass:
      - **Real-time transport (decided): WebSockets, scoped to this feature
        only** — not a general replacement for the app's existing polling.
        Nothing real-time exists today, only polling (`Group.tsx`/
        `GroupOverview.tsx`'s "quiet-refresh" pattern, 15s + focus-triggered).
        For those two pages the traffic is already trivial at this app's scale
        (small payload, only while focused) — WS being bandwidth-lighter isn't
        a real win there, so leave them on polling; not worth the added
        connection-lifecycle/auth/reconnect complexity for a problem they don't
        have. Chat/live rolls are different: they're inherently "something just
        happened, tell everyone now," where polling means either laggy updates
        or an unpleasantly tight interval — a genuine UX argument for a push
        channel, independent of the bandwidth question. So: build the socket
        infra for chat/dice, don't retrofit it onto Group/GroupOverview unless
        a real need shows up later.
      - **Visibility rules (decided):** chosen per-roll before rolling, via a
        picker with three modes:
         - **Public** (default): visible to the whole group, as normal.
         - **Hidden**: visible to the roller only — completely excluded from
           everyone else, INCLUDING the GM (no trace in anyone else's feed).
           Available to anyone rolling, not just the GM.
         - **GM + selected player**: GM-exclusive to initiate (matches the
           original ask — "GM rolls with a player without anyone else
           noticing"); invisible to the rest of the group, no trace. The GM
           specifies the exact Probe/expression to roll when initiating (e.g.
           "roll your Sinnesschärfe") — the player doesn't pick anything
           themselves, their accept is just consent to that specific roll
           happening. The prompt reaches the targeted player as a pending-
           request card in their own docked panel (auto-opens it, same as any
           other roll) with Accept/Decline buttons — not a blocking modal.
           Declining just means no roll happens, no trace elsewhere.
      - **Chat surface (decided):**
         - **Placement**: a docked panel (collapsible sidebar/drawer), not a
           separate page — usable from the character sheet and group page
           without losing your place.
         - **Feed**: one interleaved chronological feed — chat messages and
           dice-roll results together, not a separate chat log vs. roll log.
         - `/me` command (e.g. "/me baut eine Sandburg" → "Raskir baut eine
           Sandburg").
         - **Dice shortcuts (decided):** saved/named favorites, NOT tied to
           sheet/talent values — plain dice math a player defines for
           themselves (inspired by rolz.org's "dicebar", but with our own
           simpler syntax instead of adopting rolz.org's bracket format).
           Edited as plain text (fits the app's existing textarea pattern, no
           form builder): one shortcut per line, `Label: expression` (e.g.
           `Dolch-Schaden: 2w6+5`), "w" notation matching how it's already
           written elsewhere in this doc (not "d"); a line of dashes acts as a
           visual separator between groups. Rendered as a flyout of clickable
           buttons inside the roll/chat panel — click a shortcut, the roll
           fires immediately and posts into the feed.
         - Crit/Bestätigung mechanic (natural 20s/1s → confirmation rolls)
           applies to these raw expression rolls too, not just Probe rolls
           (decided): no success/fail concept to override since there's no
           Probe-Zahl, so a confirmed crit has no mechanical effect on the raw
           expression rolls — the confirmation roll's value still gets added
           (20s) or subtracted (1s) into the result as usual, and the entry is
           visually highlighted/flagged in the feed so the table notices it
           happened, but nothing beyond that.
      - **Roll log (decided):** persisted in the DB per group (like other
        group content, e.g. `group_tabs`) — not ephemeral, players can scroll
        back through past sessions. **No pruning/retention window** — kept
        indefinitely. Storage cost is negligible at this scale (small text
        rows; even heavy monthly-session use over years lands in single-digit
        MB, dwarfed by e.g. portrait BLOBs already in the DB) and the
        traceability value is real given how spaced out sessions are (~monthly)
        — a short window would delete exactly the content people come back to
        reference. Revisit only if storage genuinely becomes a concern later.
        **Visibility on history matches the live feed exactly** — hidden and
        GM+selected-player rolls stay excluded from non-permitted viewers when
        scrolling back too, no separate/looser access for old entries.
      - **Dice rollable from sheet (decided):** a roll button next to every
        already-computed Probe-Zahl on the sheet — Talente (`Talente.tsx`'s
        "Probe (Zahl)" column), Waffen (AT/PA/BL), Zauber/Liturgien, Sprachen —
        anywhere `shared/src/rules.ts` already produces a target number, not
        just Talente/Zauber. One click fires immediately as a **Public** roll
        (the common case); a secondary control (e.g. a small dropdown arrow
        next to the button) exposes Hidden/GM+Player for when that's actually
        wanted — keeps the fast path fast instead of prompting every time.
        Disabled/hidden for a groupless character (no group ⇒ no feed to post
        to). Rolling from the sheet auto-opens the docked chat/roll panel so
        the result and group reaction are immediately visible.
   - Structurally scoped per group already (`GroupInfo`, per-group routes exist
     in `routes.ts`) — but no per-group real-time channel exists yet.
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
- [sketch] **Ammunition**: damage values and effects (new catalogue). Once it
  has a per-ammo damage value, wire it into the Fernkampf damage formula (see
  „Fold ammunition damage into the Fernkampf damage formula" under the Weapon
  tab rework, Mid-Prio) — currently blocking that item.
- [sketch] **A more neutral default theme** than Khôm (red) and more themes in general.
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
- [sketch] **Inventory item creation — fill fields while inserting** (user
  feedback): `Ausruestung.tsx`'s `addTo()` currently inserts a fully blank
  `Item` (`blank()`) into the live list and auto-opens its editor — a
  create-then-edit two-step. `Inventar.tsx` already has the wanted pattern for
  items added inside a storage container: `AddItemRow` is a small inline form
  (name/kategorie/anzahl/gewicht) that collects fields before calling
  `commit()`, nothing blank ever hits the list. Rework target: bring
  `Ausruestung.tsx`'s worn-zone/bench "+" creation in line with that
  `AddItemRow` pattern; `Inventar.tsx`'s own `addContainer()` has the same
  instant-blank-object issue and could be swept into the same fix. Needs a
  concept pass: which fields belong in the inline form (name-only vs.
  name+RS+weight), and whether worn-zone items need different prefill than
  bench items.
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

- FAQ - like a little manual or easy to miss features

- **Notifications** let players know, when things have changend (approved characters, new changelog entries [which include 'Demnächst' and 'Bekannte Fehler'])

- **wiki for world lore and game rules** — no cross-interaction with character
  sheets planned beyond living on the same site. Page text/structure belongs in
  `helden.db` alongside character data (cheap, no backup-weight concern); wiki
  images belong in the shared `helden-assets.db` discussed under „Expanded bio
  page" above, not a wiki-specific db file.

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

