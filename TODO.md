# TODO — forward-looking backlog

Open work only. Finished work is pruned (git history + the in-app changelog
record what shipped). Keep this in English. Tasks inside a prio-category are not ordered by urgency.

Durable engineering rules (the scroll-container/sticky-offset/display-mode/no-
data-loss gotchas) now live in `CLAUDE.md`; run-book bits (HTTPS/secure cookies)
live in `README.md` / `DEPLOYMENT.md`.

## Readiness tags

Each open item is tagged: **[sketch]** = a raw idea + instructions; needs a
concept worked out (and sign-off) before building. Do not assume a sketch to be ready, because it looks trivial.
**[ready]** = concept agreed, can go straight to a build plan. Priority is the section (High/Mid/Low);
"on hold" / "blocked" notes stay inline and are a separate axis.

---

## User feedback

- [ready] **Image gallery for houses** (user feedback, concept agreed
  2026-09-03). Multiple images per house (floor plans, reference photos), not
  just one — reuses the existing generic `assets` table
  (`server/src/assets/store.ts`), which already supports several images per
  owner via `pos` (exactly a gallery) and is the same mechanism the wiki and
  portraits use. **New:** `OwnerTyp` value `'house'` (`store.ts:22`),
  `owner_id = group_houses.id` (that row already has a stable id —
  the `haus`/`raum` strings on `Item` stay untouched,
  this hangs off the suggestion-list row instead). No `gm_only` restriction:
  everyone uploads/sees/deletes, matching the flat, no-GM-gatekeeping
  permission model houses already have. Delete: call `loescheAssetsFuer
  ('house', id)` when a `group_houses` row is deleted or renamed away (same
  "any new delete path must call this by hand" rule as every other owner
  type, CLAUDE.md). UI: a small, unobtrusive icon button next to each house's
  header in `PoolInventory.tsx`'s house/room view, opening a gallery dialog
  (upload/view/delete) — reuse the wiki's upload flow (`skaliereBild`
  client-side resize, `Bilder.tsx` as the pattern to copy), not a new one.

Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections above in a later pass. (Empty = all caught up.)

## Mid-Prio

- [sketch] **Animal/pet companion sheets**: a character owning a trained animal
  or mount with its own small sheet (attributes, maybe a handful of
  talents/skills). Not concepted at all yet: how much a pet sheet shares with
  a full character sheet, how it's linked to its owner, whether it's a
  separate `characters` row or something lighter, is all still open.
   - topic is related to shapeshifting: a sheet that belongs to a specific character instead of being a standalone character
- [ready] **Multiple sheets per character (shapeshifting)**: concept settled,
  see `docs/concepts/shapeshifting.md` ("Revised direction" and "Build plan").
  Phases 1 and 2 (separate sheets, active vs viewed, carry-over dialog, sync, detach
  and re-link), the afterwork gaps, the export/import and backup check and the changelog
  draft are done. Remaining:
   - Open for later: worn-item bonuses and equipment presets across forms (items
     are shared; bonuses apply to the active form for now).
- [ready] **Weapon tab rework**: Nahkampf-/Fernkampfwaffen live in a bespoke
  card-based tab (`client/src/tabs/WaffenNeu.tsx`, key `WaffenNeu`, shown as
  „Waffen" — one collapsible card per weapon, computed AT/PA/BL or FK probe
  shown next to the name in the collapsed head, full field grid on expand;
  follows the Ausrüstung item-chip pattern). Remaining:
   - Weapon statuses (*Geschärft*, *Stumpf*, etc.) still need a concept — only
     the free-text `Besonderes`/Notiz fields capture them today.
     The actual statuses can be hardcoded, no need for settings.
- [sketch] **Ability bonus list (deferred from the ability-editing-dialog build)**:
  abilities now have their own `AbilityEditDialog`
  (`client/src/components/AbilityEditDialog.tsx`, opened from
  `AbilityManager.tsx`), mirroring `AddItemDialog`'s create/edit-in-one-
  component shape — but deliberately shipped WITHOUT an item-bonus-style
  repeatable effect list. Explicitly deferred, not forgotten: **user
  feedback when deferring — such a list would only ever make sense on
  `passiv` entries; an active talent/spell never grants a standing bonus by
  existing, its effect happens when it's actively used**, so the field (if
  built) should probably only show/apply for `passiv === true`, not for
  every ability. If this gets picked up, it's the same generalization the
  "Player-set structured bonuses" entry below already plans for Vorteile/
  Nachteile — do that generalization once, shared by both, rather than two
  parallel bonus mechanisms.
- [sketch] **Player-set structured bonuses for Vorteile/Nachteile/Titel/Professionsboni**
  (user feedback): these currently live in plain free-text
  dynamic-table sections under the locked "Vorteile & Nachteile" tab
  (`professionBoni`/`vorteile`/`nachteile`/`titel` section IDs,
  `characterData.ts:250`), and — unlike the 20+ perks — have **no fixed
  catalog**: a player types whatever advantage/disadvantage/title they want,
  so a lookup-table approach doesn't apply here. Instead, each row would get
  an optional structured effect the *player* sets themselves (pick a target
  from the same `attr | baseValue | resource | talent` union already planned
  for item bonuses, then type the amount), and the app applies it
  automatically from then on instead of the player doing the arithmetic by
  hand. Item bonuses while worn
  are built now, so this is unblocked: generalize its aggregator (`wornBoni`
  etc. in `shared/src/items.ts`) to accept any bonus source, not just
  `Item[]`, rather than growing a second parallel plumbing path. Still open: which of the four
  sections actually get this (all four, or just vorteile/nachteile?), the UI
  for attaching a structured effect to a free-text dynamic-table row (a
  per-row dialog like the item one, or a new `DynColumn` type?), and whether a
  row gets one effect or a repeatable list like items do.
- [onHold] **20+ perk picker** — source PDF analysed and written up at
  `docs/concepts/perk-trees.md` (8 attribute trees, uniform 10/5/3/1/1 tier grid,
  no prerequisite edges, ~160 effects classified into 6 computable and 8
  display-only categories). Rules confirmed: pool = `attribut − 20`, one point
  per stage, stage values absolute (not cumulative), base attribute only
  (never `attrMax`), later columns need points *spent* not merely earned,
  Heldenkraft perks are a single pick granting one in-combat and one
  out-of-combat effect (not two picks). Half the perks target exactly the
  `attr | baseValue | resource | talent` union item bonuses while worn
  (built now) already use — reuse
  that plumbing (`StatBoni`/`wornBoni` in `shared/src/items.ts`, deliberately
  named apart from the item-only producer for exactly this reuse) rather than
  grow a second aggregator. Blocked
  on GM input before a catalog can be seeded: ~7 name conflicts between graphic
  and description list, a duplicate in the Konstitution tree, ambiguous stage
  counts, the missing `stufenfk` master list, and the Kampf/Anders split not
  yet written per Heldenkraft. Also needs a server-side reveal state — 34+/60
  perks are hidden until the GM unveils them, so they must not be sent, same
  rule as the wiki's ` ```gm ` regions.

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
- [sketch] **CSS tidy-up (second round)**: popups, chips, badges, buttons,
  search fields, tokens (colors, radii, z-index) are unified; what is left is
  optional:
   - possible split of `styles.css` (7.4k lines, fine for now, no runtime gain
     since Vite bundles it into one file): move the dice chat/feed block
     (~1,200 lines) to `dice.css` and the VTT block incl. the color picker
     (~1,000 lines) to `vtt.css`, imported in `main.tsx` in their original
     order so the cascade stays identical (verify with a computed-style diff);
     fix the stale "4336 lines" comments in `main.tsx`/`wiki.css` at the same time
   - the feed, dice dock and VTT blocks were read rule by rule (see git log);
     the VTT context menu was only tested with injected markup, not on a real token
   - checked and deliberately left alone: `gm-chip` vs `wpn-chip` (the weapon
     tile carries the sheet's computed-value tint), `.rules-table`/`.inv-table`
     (only the header typography is shared), the `*-empty` message classes
     (only container margins differ), `hold-button`/`note-toggle`/`cat-toggle`/
     `fav-pin` and the two segmented controls (distinct controls; only the
     active look is shared), the duplicate-rule groups whose rules carry their
     own comments (bio pairs, grips, resize cursors: merging would orphan the
     comments), section headings (panel titles already share one ornament; the
     serif sheet labels vs sans changelog labels are different hierarchy levels)
   - good pre-work for the responsiveness-pass
- [sketch] **General tidy-up**: check code for unused elements and remove
- [sketch] **Print / PDF follow-ups - PROBABLY OUTDATED**:
   - Tables break across pages mid-section — add break-inside handling / keep
    sections together / repeat table headers.
   - Talente and Waffen tables get cut off at the sides even in landscape — too
    wide; needs print-specific narrower columns / smaller font / scaling /
    wrapping (easier now that static text wraps where an input would not).
   - Sprachen has rendering issues (investigate).
   - Maybe clamp column widths to the minimum necessary in print for readability.
- [sketch] **Responsiveness: remaining follow-ups** (most players are on PC, so
  this is polish). Target range is about 960px (half of a 1080p screen) up to 4K;
  `main` stays capped at 2200px and centred, no scaling on big screens (decided).
  The clipping/overflow fixes and the burger top bar are in; what is left:
  - Flyouts built on `useHoverFlyout` open by tap on touch (the browser emulates
    hover) and now close on `pointerdown`; the probe roll buttons get touch-size
    targets under `pointer: coarse`. Never tried on a real touch device; the VTT
    toolbar flyouts were not looked at.
  - VTT below 900px stacks, but its toolbar/token editor/map pointer handling were
    never tried on a phone.
  - Sheet header still sticks between 701px and 1100px (about 100-140px pinned);
    decide whether it should un-stick up to 1100px like the tab bar scrolls.
  - px to rem migration (rule is in CLAUDE.md, "CSS units & responsiveness"): done
    for `.dialog-*`, `.dlg-*`, `.field` and the popups/flyouts (nav, theme and
    dice menus, VTT pickers/settings, colour picker, equipment presets, GM poll
    and request lists) and the base buttons, inputs and `.tabs` (the iOS 16px
    input size, 40px touch minimums and the 3px tab drop marker stay px on
    purpose), panels, cards, grids and table cells, and the top bar, burger
    panel and sheet header (the 47px `--topbar-h` fallback and the 44px/40px
    touch rows stay px) and base typography (`body`, `h1`, `h3`, `button`,
    `main` padding; `main`'s 2200px cap stays px). Text now follows the root
    size on about 80-99% of elements per page; the rest still carries its own px
    size. Also done: the character sidebar and sheet rules (`.side-*`, `.bio-*`,
    `.portrait*`, `.formel`, `.probe-roll*`; the `--sidebar-w` fallback and the
    34px collapsed rail stay px because JS and `flex-basis` pair with them), and
    the wiki (`wiki.css`, whole file, incl. the 190px TOC column) with the
    changelog rules. Next areas, in this order: the remaining sheet tabs
    (`.wpn-*`, `.abil-*`, `.inv-*`, `.akt-*`), the leftovers
    (`.changelog-version`, `.known-bugs-*`, easter-egg panels), then the dice
    dock and VTT. Known
    loose end: `CELL_CHROME_PX = 30` in `components/tableLayout.tsx` (double-click
    "fit column to content") assumes px cell padding, so at a larger root size
    the fitted width comes out slightly narrow; derive it from the cell's
    computed padding when this matters. One area per commit, converted mechanically
    (px / 16, skipping 1px and 0) and checked with a computed-style comparison
    at the default root size, plus a scaling check at 20px.
  - Not tried on a real phone or with touch input; the pending badge on
    "Kataloge & Nutzer" was never seen in the burger panel.
  - Splitting `styles.css` (about 7,400 lines) into smaller files.
- [sketch] **Look-up lists** (needs GM data; none yet): e.g. which attributes can be raised
  per weapon level / per spell level. Separate from the catalogues — a different
  kind of list.
- [sketch] **Liturgien catalogue** (waits until the catalogue content is finished): read
  the character's priest level to unlock Liturgien accordingly. Priest-level
  requirements are still not fleshed out.

## Unsorted ideas (treat all as [sketch])

- FAQ - like a little manual or easy to miss features

- **drop `char_portraits`** — portraits now live in `helden-assets.db`; the old
  table was deliberately kept as a read fallback (copied, not moved) so a
  rollback onto older code still shows portraits. Once a release has gone by
  without needing one, delete the table and the fallback branches in
  `assets/portraits.ts`. Not before: it is the only copy an older build can see.

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