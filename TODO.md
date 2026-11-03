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

## Virtual table

- [ready] **Multiple scenes per group** (concept agreed 2026-08-25, full plan
  in `docs/concepts/virtual-table.md` Phase 13 — build after that plan
  itself, not from scratch here): a group gets several named boards to
  switch between (not one bigger shared canvas — that would still share one
  token set/fog/round counter across unrelated areas). **Data model:** drop
  `idx_boards_group_id`'s uniqueness, add `boards.name TEXT NOT NULL DEFAULT
  ''`; "current" scene is `groups.active_board_id INTEGER REFERENCES
  boards(id) ON DELETE SET NULL` (a FK, not a boolean flag on `boards` —
  ambiguous if two ever end up marked active). Migration: every existing
  group has exactly one board (today's unique constraint guaranteed it) — set
  `active_board_id` to it for all of them in the same pass that drops the
  constraint. `getOrCreateBoard` keeps auto-creating on first access, just
  also names it (e.g. „Szene 1") and sets it active. **Server (`board.ts`,
  next to the existing token/overlay CRUD):** `listScenes(groupId)`,
  `createScene(groupId, name)`, `renameScene(boardId, name)`,
  `deleteScene(boardId)`, `setActiveScene(groupId, boardId)`. Deleting the
  *active* scene auto-switches to another remaining one first (lowest id),
  then deletes; a group's last remaining scene cannot be deleted (same
  reasoning as a board always existing today). **Rights:** hard-coded
  GM-only, same shape as `canEditFog` — not a new `perm_*`, scene management
  is prep work, never a player case. **Realtime, decided live-for-the-room
  with a fade (not a GM-private-preview-then-present):** GM picks a scene
  from a GM-only toolbar picker (players never see it) →
  `board.scene.switch {reqId, boardId}` → server validates the id belongs to
  this group, calls `setActiveScene`, broadcasts `board.scene.switched`
  carrying a **full snapshot** of the new scene (board settings + tokens +
  tiles + highlights + overlays — same shape as the REST snapshot response),
  not just a bare id, so nobody races a follow-up REST fetch. Client plays a
  short fade-out on `.vtt-map-wrap`/`.vtt-map-svg` (~250–300 ms opacity
  transition), swaps in the new scene's state once faded, fades back in —
  purely a client-side CSS transition around the existing hydrate call.
  **Per-scene camera:** `usePersistedState`'s existing pan/zoom camera key
  (`vtt-camera:${groupId}` today) switches to keying by `boardId` instead, so
  each scene remembers its own last view independently. **Still open, low
  stakes:** `perm_*` columns live on `boards` already, so they're naturally
  per-scene at zero migration cost — whether a GM wants to reconfigure
  rights per scene or find that mildly annoying is untested, not worth
  designing around before it's felt.

## User feedback

- [ready] **Image gallery for houses** (user feedback, concept agreed
  2026-09-03). Multiple images per house (floor plans, reference photos), not
  just one — reuses the existing generic `assets` table
  (`server/src/assets/store.ts`), which already supports several images per
  owner via `pos` (exactly a gallery) and is the same mechanism the wiki and
  portraits use. **New:** `OwnerTyp` value `'house'` (`store.ts:22`),
  `owner_id = group_houses.id` (that row already has a stable id —
  `docs/concepts/houses.md`'s `haus`/`raum` strings on `Item` stay untouched,
  this hangs off the suggestion-list row instead). No `gm_only` restriction:
  everyone uploads/sees/deletes, matching the flat, no-GM-gatekeeping
  permission model houses already have. Delete: call `loescheAssetsFuer
  ('house', id)` when a `group_houses` row is deleted or renamed away (same
  "any new delete path must call this by hand" rule as every other owner
  type, CLAUDE.md). UI: a small, unobtrusive icon button next to each house's
  header in `PoolInventory.tsx`'s house/room view, opening a gallery dialog
  (upload/view/delete) — reuse the wiki's upload flow (`skaliereBild`
  client-side resize, `Bilder.tsx` as the pattern to copy), not a new one.
- [sketch] **Arithmetic in free rolls and favorites** (e.g.
  `Athletik+FF+(2*Akrobatik)`). Concept agreed so far (replaces an earlier
  "dice-sum formula" idea): names resolve to **probe targets**, the whole
  expression is rolled and judged as success/fail, exactly like a talent
  probe today (crits, "knapp", Erleichterung/Erschwernis modifier,
  Schicksalspunkte all reused).
  - **Target:** the arithmetic result over the names' targets (talent =
    its three attributes + Erleichterung, attribute code = its value,
    ability = its probe expression incl. element/Markenzeichen bonuses).
  - **Dice:** one d20 per attribute term after expanding the names
    (attribute 1, talent 3, ...). `k*X` (whole k >= 1) means X k times, dice
    AND target, exactly like writing X k times: `2*Athletik` is
    `Athletik+Athletik` (6 d20s against 2x the target) and
    `Athletik+FF+2*Akrobatik` with 40/12/36 is 3+1+6 = 10 d20s against 124.
    (This replaced an earlier "multiplier only scales the target" idea.)
    `+`/`-` constants only shift the target (`Athletik+5` is 3 d20s against
    45), `/` by a constant scales the target. The old `Nx` prefix is retired
    for probes (a lone `2xAthletik` is rejected with a hint to write
    `2*Athletik`); it stays for dice sums (`3x2w6+8`), where `*` already
    multiplies the sum.
  - **Overall verdict and parts:** success is decided on the total (all dice
    against the combined target). The card also lists every name with its own
    dice and target and a check/cross, so you see which part was over; that
    is display only (stored as `parts` on the roll).
  - **Two modes, decided by the dice blocks:** *no* dice block
    (`Athletik+FF+(2*Akrobatik)`) is a probe as above (accepted by `/r`
    although `parseDiceExpression` rejects zero-dice formulas today).
    *Any* dice block (`1w20+Athletik`, `2w6+KK`) stays today's dice-sum
    roll: names resolve to plain numbers, no success/fail check (the team
    does use mixed expressions, they just can't be judged). So mixing is
    allowed, not rejected.
  - **Picker (agreed direction):** reuse the `/r` suggestion list
    (`/api/characters/:id/probes`, which already carries label, `n` and
    `probeZahl` per name), but picking *inserts* the name into the input
    instead of rolling it, auto-quoting names that contain anything but
    letters and spaces (`"Hämmer/Keulen"`, `"Schwert (AT)"`). Suggestions
    must then search the token being typed (after the last operator or
    parenthesis) instead of the whole text after `/r`. **Key scheme
    (agreed):** Enter on a lone name keeps rolling it directly (today's fast
    path); Shift+Enter or Tab inserts it into the input instead (Shift+Enter
    is unused today). Inside a larger formula (`1w20+Ath`) there is nothing
    to roll directly, so a pick there always inserts. Mouse/touch: clicking
    a row still rolls (as today), plus a small "+" button per row to insert
    (touch has no Shift+Enter). A hint line at the foot of the open list
    ("Enter würfeln · Shift+Enter / Tab einfügen") makes the split
    discoverable, since a wrong Enter posts a public roll. `/koop` and
    `/wettstreit` keep picking a probe directly.
  - **Dice-sum mode, what a name is:** its probe target (e.g. Athletik =
    40, as the suggestion list shows), so `1w20+Athletik` adds 40.
    Attribute codes are their value, as today.
  - **Syntax:** names are case-insensitive; letters and inner spaces work
    bare (`Heilkunde Wunden+FF`: two names without an operator are never
    valid, so a space is unambiguous); names containing `/` or `-` (33 of
    159 talents, e.g. "Hämmer/Keulen") need double quotes. The tokenizer in
    `shared/src/formula.ts` only accepts letters today.
  - **Engine:** `formula.ts` (hand-written parser, no library needed) stays
    the single grammar; favorites (`parseDiceShortcuts`) and `/r` share it,
    names are resolved at roll time with the sender's character
    (`chatAttrResolver` in `ws.ts` only knows attribute codes today).
  - **Built (parser + server):** `formula.ts` (quoted/spaced names,
    `evaluateProbeFormula`, `collectNames`/`mapNames`), `parseRollFormula`
    in `dice.ts` (also used for favorite validity), `makeNameLookup` in
    `diceSource.ts` (names resolve against the sender's rollable probes,
    ambiguous labels are rejected), and the `roll.expr` handler in `ws.ts`
    (probe mode writes a normal probe card with source kind `formula` and a
    canonical-name label; the modifier travels as its own field). The dock's
    `rollExpr` already sends the modifier separately for probe formulas.
    Verified end to end over the WebSocket.
  - **Built (dock):** `findNameToken`/`applyNameInsert` in `dice.ts`
    (tested) and the picker in `FeedColumn.tsx`: suggestions follow the word
    before the cursor, also inside a formula; Enter rolls a lone name as
    before, Shift+Enter / Tab insert (quotes added where needed), inside a
    formula Enter inserts until the typed word is a whole name and then sends;
    a "+" button per row and a hint line; `/r` accepts probe formulas;
    `/koop` and `/wettstreit` unchanged. Dice-sum cards show canonical names.
  - **Built (card):** a probe formula with more than one part renders one
    row per part (label, its dice, `= sum / target`, check/cross, targets
    only for the roller and the GM) and the overall result below.
  - **Still to build:** (1) favorites typed in Einstellungen have no picker
    (quotes by hand); (2) name suggestions while typing do not mark ambiguous
    labels (two weapons of one name): the server rejects them at roll time
    with a clear message; (3) per-part marks use the raw dice, crit
    confirmations only change the overall total.
  - **Open:** which name kinds the picker offers (it offers whatever
    `/api/characters/:id/probes` lists: attributes, base values, talents,
    abilities, languages, weapons).
- [sketch] make wiki-pages lockable to allow players protecting their character-pages etc.
  - in the same pass, the edit-log gets flooded with every single save a player makes. how can we reduce this so a single edit-session does not end in "version number 145" for example

- [sketch] **Animal/pet companion sheets**: a character owning a trained animal
  or mount with its own small sheet (attributes, maybe a handful of
  talents/skills). Not concepted at all yet: how much a pet sheet shares with
  a full character sheet, how it's linked to its owner, whether it's a
  separate `characters` row or something lighter, is all still open.
   - topic is related to shapeshifting: a sheet that belongs to a specific character instead of being a standalone character
- [onHold] **Shapeshifting characters** (design notes at
  `docs/concepts/shapeshifting.md` — a build-then-revert pass surfaced real
  data-model disagreement with the GM, written up there instead of lost):
  a character that can shapeshift needs genuinely different values for
  almost everything (attributes, base values, possibly talents/abilities)
  per form — effectively a separate sheet per shape bundled under one
  character, not multiple independent characters. Still needs a concept
  pass with the GM (data model + how much duplicates vs. derives from a
  base sheet) before building.
- [ready] **Weapon tab rework**: Nahkampf-/Fernkampfwaffen live in a bespoke
  card-based tab (`client/src/tabs/WaffenNeu.tsx`, key `WaffenNeu`, shown as
  „Waffen" — one collapsible card per weapon, computed AT/PA/BL or FK probe
  shown next to the name in the collapsed head, full field grid on expand;
  follows the Ausrüstung item-chip pattern). Remaining:
   - Weapon statuses (*Geschärft*, *Stumpf*, etc.) still need a concept — only
     the free-text `Besonderes`/Notiz fields capture them today.
     The actual statuses can be hardcoded, no need for settings.
- [sketch] **Ability bonus list (deferred from the ability-editing-dialog
  build)**: abilities now have their own `AbilityEditDialog`
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
- [sketch] **Player-set structured bonuses for Vorteile/Nachteile/Titel/
  Professionsboni** (user feedback): these currently live in plain free-text
  dynamic-table sections under the locked "Vorteile & Nachteile" tab
  (`professionBoni`/`vorteile`/`nachteile`/`titel` section IDs,
  `characterData.ts:250`), and — unlike the 20+ perks — have **no fixed
  catalog**: a player types whatever advantage/disadvantage/title they want,
  so a lookup-table approach doesn't apply here. Instead, each row would get
  an optional structured effect the *player* sets themselves (pick a target
  from the same `attr | baseValue | resource | talent` union already planned
  for item bonuses, then type the amount), and the app applies it
  automatically from then on instead of the player doing the arithmetic by
  hand. Item bonuses while worn (`docs/concepts/item-bonus-while-worn.md`)
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
  (`docs/concepts/item-bonus-while-worn.md`, built now) already use — reuse
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
- [sketch] **CSS tidy-up**: check for components than can be combined
   - less exclusive designs (e.g. section headers get rendered different, but are actually the same everywhere)
   - splitting CSS into more fitting files
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