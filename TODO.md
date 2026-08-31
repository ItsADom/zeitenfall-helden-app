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

- [ready] **Move Training/Lesen tracker into the Überblick sidebar, guarded
  everywhere** (user feedback, concept agreed). Today `TrainingLeseTracker`
  (`client/src/tabs/Heldenbrief.tsx:107-138`) is a 4-clover book-icon row
  bound to `meta.trainingLeseHeute`, rendered next to Abenteuerpunkte,
  `disabled={readOnly}` — unusable outside edit mode. **Decided: move, not
  duplicate** — remove it from `Heldenbrief.tsx` entirely, render it only in
  `CharacterSidebar.tsx` (a new `side-block`, same pattern as `SidebarPools`
  etc.). **Decided: every click goes through a confirm step**, in both edit
  and read mode — reuse `SchicksalspunkteControl`'s exact pattern
  (`client/src/components/dice/SchicksalspunkteControl.tsx`): `useHoverFlyout`
  opened by a click on the book icon, a small flyout panel with
  Bestätigen/Abbrechen, only the confirm actually calls `onChange`. This
  replaces today's direct instant-click in edit mode too, not just adds a
  gate for read mode. **Decided: silent** — no chat line on confirm (unlike
  Schicksalspunkte's `/me` announcement); this is personal bookkeeping, not a
  table action. Un-filling (undo an entry) goes through the same confirm
  step as filling.
- [ready] **Broadcast a token's step trail to everyone at the table** (user
  feedback, concept agreed — reverses a prior explicit decision). Today's
  step-counter trail (`client/src/pages/VirtualTable.tsx:1021-1029`,
  `tokenTrailActive`) was deliberately settled as local-only, gone instantly
  on release; moves themselves also only ever send the final position over
  the wire, never the path (`:1441`, `board.token.move` in
  `server/src/ws.ts:1633-1668`). **Decided: full trail, not just distance** —
  reuse `chebyshevPath(from, to)` (`VirtualTable.tsx:379-391`), which is
  already a pure/deterministic straight-line function of two cell
  coordinates. Since the server already has the pre-move position as
  `existing.x/y` (read right before `moveBoardToken` overwrites it,
  `ws.ts:1636-1654`) — **no new client payload needed**: add `fromX`/`fromY`
  (the origin) onto the `board.token.updated`/`created` message the
  `board.token.move` handler already broadcasts, gated by the same
  `tokenVisibleTo` filtering it already does (so a trail through/into fog
  respects visibility exactly like the token move itself). Each receiving
  client (including the mover) computes the same trail locally via
  `chebyshevPath`, no path serialization over the wire. **Decided: fixed
  10s auto-fade for everyone, AND click-to-dismiss layered on top** — the
  10s timer is shared/absolute (not reset or extended by a click), the click
  only hides it early for that one viewer, local UI state, not
  broadcast/synced. Only `board.token.move` triggers a trail — ordinary
  `board.token.update` (color, size, etc.) must not.
- [ready] **Competitive check ("Wettstreit"): a second pool kind alongside the
  Kooperationsprobe** (user feedback, concept agreed — rules confirmed with
  the GM, since Zeitenfall's probe mechanics are homebrew, not DSA5).
  Reuses the existing self-serve join/leave/start scaffolding
  (`CoopPoolCard.tsx`, `roll.coop.propose/join/leave/start/cancel` in
  `shared/src/diceProtocol.ts:395-434`, `server/src/coopPools.ts`) — same
  UI shape, a new pool `mode: 'coop' | 'competitive'` instead of a
  parallel set of message types. Only the verdict differs from
  `computeCoopVerdict` (`shared/src/dice.ts:296-309`), which pools sums for a
  joint pass/fail: a competitive verdict instead ranks participants and picks
  ONE winner (or a tied set — see below), nobody's roll pooled with anyone
  else's. **Decided verdict algorithm:**
   1. Tier every participant by crit status: confirmed crit-success (top) >
      ordinary roll > confirmed crit-fail (bottom) — a crit auto-outranks any
      non-crit tier, same override precedence the coop pool already gives
      crits over the sum-check.
   2. Within a tier, rank by margin — `probeZahl - adjustedSum` (bigger =
      beat target by more) — descending; the winner is the best margin in the
      highest non-empty tier. **Decided: best margin always wins, even if
      negative** — a participant does NOT need to have actually succeeded
      their own probe to win the contest; if everyone in the top tier failed,
      whoever failed by the least still wins.
   3. **Decided (corollary, not separately asked): an exact tie within the
      winning tier/margin is a genuine tie** — report all tied participants
      as joint winners rather than picking one arbitrarily; no further
      tie-break rule.
   4. Multiple crit-successes (or multiple crit-fails) still get ranked
      against each other by margin within their own tier — a crit only
      outranks OTHER tiers, it doesn't flatten comparisons within its own.
  **New:** `computeCompetitiveVerdict` in `shared/src/dice.ts`, parallel to
  `computeCoopVerdict`, returning winner(s) + each participant's tier/margin
  for display. UI: a `CompetitivePoolCard` alongside `CoopPoolCard`,
  labels via a `WETTSTREIT`-style entry in `labels.ts`.
- [onHold] **Players adding individual/custom talents to Talente** (user
  feedback — on hold, needs GM input before a concept can be settled).
  Today's Talente tab (`client/src/tabs/Talente.tsx`) has no per-character
  add path at all: rows come entirely from the shared, GM-managed
  `catalogs.talents` (`TalentCatalogRow`, `Character.tsx`) — every character
  sees the same fixed list, filled in with their own TaW/AT/PA/BL. Open
  before this can move to `[ready]`:
   - **Scope: private-to-character vs. joins the shared catalog** — does an
     „individual" talent only ever show on the adding player's own sheet, or
     does it become a real catalog entry visible/usable by every character
     (effectively proposing a new official talent)? Not decided, needs the
     GM's call.
   - **Approval:** GM-gated before it's usable/rollable, or immediately live
     once a player adds it? No preference expressed yet either way.
   - Once those two are settled, a build pass still needs: what a
     custom-talent row actually needs filled in (name + which attributes
     feed its `probeExpr`, at minimum — a real talent's probe formula isn't
     optional), and where it lives structurally (a new per-character table,
     or an extension of the existing catalog schema with an owner column).
- [ready] **Favorite a talent/spell so it shows up in the dice-favorites
  flyout** (user feedback, concept agreed). Today's dice favorites
  (`ShortcutsFlyout.tsx`) are hand-typed free-text lines (`Label: Ausdruck`,
  parsed by `parseDiceShortcuts`, maintained in Einstellungen) — no link to
  real talents/abilities at all, and a favorited one needs the ACTUAL probe
  roll (same as `ProbeRollButton`/`AbilityWeaponRollButton`, resolved
  server-side from a `ProbeSource`), not a raw dice-expression string.
  **Decided: one flyout, two sections** — keep the existing 🎲 flyout and its
  text shortcuts as-is, add a second, visually separated group underneath
  listing the current character's favorited talents/spells. Clicking one
  calls `rollProbe(rollCtx.groupId, rollCtx.charId, source, 'public')`
  directly (`source: { kind: 'talent', talentId }` or `{ kind: 'ability',
  abilityId }`, same `ProbeSource` shape every roll button already uses) —
  no visibility flyout, mirrors the existing shortcut buttons' one-click
  „always public" behavior. **Decided: 📌 pin icon** for the toggle — ★/☆ was
  ruled out, already double-booked (Signatur-Zauber toggle in
  `AbilityManager.tsx:537-545`, and the 100-TaW Mastery marker in
  `Talente.tsx:21-32`). Toggle sits on the row itself: `Talente.tsx`'s
  `KampfTable`/`NormalTable` rows and `AbilityTable.tsx`'s ability row
  (next to its `ProbeRollButton`, `:249-254`). **New:** `favorit: boolean`
  on `CharTalent` (`shared/src/types.ts`) and on `Ability`
  (`shared/src/abilities.ts`), default `false` so existing rows are
  unaffected — same no-data-loss-safe pattern as any other new boolean
  column added to an existing table.
- [ready] **Percentage bonus for energies, and what "Filtern" actually is**
  (concept agreed — this also gives the Low-Prio "Filtern" sketch below its
  first real mechanic). Lore: Astralenergie is made of 8 base elements;
  filtering shifts a mage's elemental balance to boost efficiency with one
  element. The app doesn't track elements numerically, so the existing
  "overcharge" mechanism (any pool's `aktuell` may already sit above its
  computed max, freely typed, no clamp — `client/src/components/energie.ts`
  `overfilled()`/`poolClass()` → `res-over` styling, `AktuellFeld.tsx`) is
  reused as the *display*, but it isn't itself "Filtern" — filtering needs its
  own gating. **Decided:** AsE only (not LE/AUS). **Decided:** a new
  per-character stored value — "max Filterbonus %" — reflecting how well
  *that* character can filter (set directly, not derived from a formula).
  **Decided:** an all-or-nothing "gefiltert" toggle; when on, it raises AsE's
  effective/displayed max by that stored percentage, computed after the
  normal `computeResource()` result (i.e. a final multiplier, not baked into
  `mods`/`permanent`). **Decided:** triggering/ending is entirely manual — a
  player adds "Filtern" as an ordinary rollable ability/spell entry (same
  pattern as the special-checks catalog below) and rolls for it in the
  fiction; there's no in-app duration/expiry ("the point where a character
  stops counting as filtered isn't clearly set either"), so the toggle is
  just flipped off by the player/GM when the GM calls it.

- [ready] **Group ↔ player inventory, player ↔ player item transfer, and
  containers as a real, movable, worn concept** (concept agreed for the first
  two; houses is a much rougher sketch — see below). Confirmed starting
  point: **no group-level item storage exists at all today** — only
  `char_items`, strictly `character_id`-scoped, saved as a full delete+
  reinsert per character (`saveItems`, `characterData.ts:846-903`) with no
  per-item CRUD or cross-character transfer primitive of any kind.
   - **Decided: generalize item ownership.** Replace the hard `character_id`
     FK with an `owner_type`/`owner_id` pair (mirroring the pattern
     `assets/store.ts` already uses for images) — `'character'` or `'group'`
     for now, extensible to `'room'` later for houses.
   - **Decided: a new cross-owner move action** on any item chip (including
     containers) reassigns `owner_type`/`owner_id`. Moving a container moves
     every item whose `containerUid` points into it atomically, in the same
     operation — nothing gets orphaned.
   - **Decided: permission split.** Pulling an item *from* the shared group
     inventory is open to any group member. Sending is restricted to your
     own items — a player can give away or drop their own stuff, but can't
     reach into another player's personal inventory directly (that needs the
     GM, or that other player).
   - **Decided: no confirmation step** — a move happens outright, same as a
     normal drag-to-equip today.
   - **Decided: items in the group pool are weightless** for everyone's
     Traglast — nobody is personally hauling the shared stash.
   - **Decided:** on any owner change, position-specific fields (`location`,
     `zone`, `beidseitig`) reset to a safe default (`inventar`) rather than
     trying to preserve a worn-state that can't carry over to the new owner
     — no data is lost, just re-equip on arrival.
   - **New UI needed:** a "Gruppen-Inventar" section on `Group.tsx`, using
     the same specialized item-chip UI as `Ausruestung.tsx`/`Inventar.tsx`
     (not the generic `Sektionen` dynamic-table component, which can't
     represent weight/location/container relationships) — this is the "big
     overhaul of group page" the original note anticipated.
   - **[sketch] Houses** — much rougher than the above two: confirmed shared
     group property, subdivided into rooms, with containers inside rooms
     holding items ("all the stuff a real house has"). Structurally this
     would reuse the same `owner_type`/`owner_id` generalization (a
     lightweight `group_rooms` table, group-owned items optionally tagged
     with a `room_id`), but still open: can a group own multiple houses, who
     can create/name rooms, whether a room has any capacity/size concept.
     Needs its own concept pass before it's buildable — do not treat as
     `[ready]` just because the other two pieces in this entry are.
   - **[ready] GM-wide prep pool** (from the same Discord discussion that
     produced "Hidden/revealable Ausrüstung stats" below — a GM wants to
     stat out equipment in advance, cross-group, before it's ever found by
     anyone; concept pass done 2026-08-28). **Decided:** third `owner_type:
     'gm'` value in the generalization above, `owner_id` unused — **one
     single shared pool** (not per-GM: confirmed only one GM account exists
     today, so per-GM scoping would be unused complexity). **Decided:**
     invisible to players entirely — unlike the group pool (open to any
     member), a GM-pool item never appears anywhere a player can see it;
     only a GM ever sees the pool at all, so there's no separate "pull"
     rule to design. **Decided: lives on `GroupOverviewPage`**
     (`client/src/pages/GroupOverview.tsx`, already GM-only via
     `requireGm`), not the `/verwaltung` catalog page — a new panel next to
     the existing roster-chips panel, reusing the full `ItemChip`/
     `AddItemDialog` UI from `Ausruestung.tsx`/`Inventar.tsx` (create, edit,
     hide/reveal stats — a real management surface, not a read-only staging
     list). Since the pool is global, the same contents show regardless of
     which group's overview you're on — you pick *who* gets an item by
     being on that group's page. **Decided: hand-out is drag-and-drop** —
     drag a chip from the GM-inventory panel onto a player's roster card to
     reassign it (`owner_type`/`owner_id`: `'gm'` → that character),
     outright, no confirm step, reusing the cross-owner move action from
     the entry above. This makes every roster card a drop target, the first
     interactive element on a page currently documented as strictly
     read-only (`// Nur-Lesen (die Route dahinter ist requireGm).`,
     `GroupOverview.tsx:17`) — confirmed fine to break (GM-notes on that
     same page already do). **Decided:** GM has infinite Traglast — simpler
     than the group pool's "weightless" workaround, `owner_type: 'gm'`
     items just skip capacity/Traglast computation entirely, no carrying
     character to compute it for. Layout proportions/collapsibility of the
     new panel are a build-time call, not settled here.
      - **Hard blocker, build order:** needs the cross-owner move action
        from the entry above to exist **as a drag gesture specifically**
        (drag chip → drop on a target), not just any move button — this
        entry's whole interaction is built on that drag. Do not start this
        sub-item before that lands.

- [ready] **Containers: bench-exclusion must cascade to contents, plus expose
  weight/worn-state in the UI** (concept agreed after a few rounds — the
  actual house rule turned out to differ from the first read). Confirmed
  today: a container is just an `Item` with `istBehaelter: true`; its own
  `location` (`shared/src/items.ts`) is completely independent of whether it
  functions as a container. `zaehltZurLast()` (`items.ts:147-149`) already
  excludes `bench` for an item's own weight — that part is correct and needs
  no change. The actual bug: an item **inside** a container always counts
  toward Traglast based on its own `location` (`'behaelter'`), regardless of
  whether the *parent* container is benched — so a spare, unworn backpack's
  contents still fully count today, when they shouldn't.
   - **Decided: a container's weight-reduction discount to its contents is
     NOT conditional on being worn** — carried (`getragen`) or merely held/
     slung (`inventar`) make no difference, the discount always applies while
     the container is with the character. Only `bench` (genuinely not with
     you right now — the spare-backpack case) changes anything.
   - **Decided: the fix is a cascade, not a new gate.** When a container sits
     on the bench, its contents stop counting toward Traglast too (need to
     walk up the `containerUid` chain, not just check each item's own
     top-level `location`) — mirrors the `containerArt === 'quick'` branch's
     existing worn-check (`itemLastAnteil`, `items.ts:165-179`), generalized
     to also cover `containerArt === 'storage'` and to cascade through
     nesting rather than only checking one level.
   - **Decided: capacity/overfill checking stays location-independent** — a
     benched container can still be over-stuffed beyond what it can
     physically hold (e.g. its stated 120/60kg capacity); that check is
     separate from, and unaffected by, the Traglast-contribution fix above.
   - **Decided: containers get a real weight field in the UI.** `gewicht`
     already exists generically on `Item` and already applies to containers
     structurally, but no container-creation/edit UI exposes it
     (`AddContainerDialog`, `Inventar.tsx`'s container header) — containers
     are zero-weight today purely by UI omission, not a schema gap. Add the
     field where containers are actually created/edited.
   - Note: this pairs with the cross-owner move feature above — "make a
     container's `location` editable" doesn't require migrating storage
     containers into the worn/body-zone drag system; that's a separate,
     optional nicety, not a prerequisite for either fix here.

- [ready] **Hidden/revealable Ausrüstung stats** (concept agreed, from a GM/
  player Discord discussion 2026-08-28 — prep an item's stats ahead of time,
  then reveal them narratively: "you pick up a sword, it has some strange
  energy emitting" before the GM later confirms it's +2 RS). **Decided:**
  scope gates on `kategorie === 'Ausrüstung'` (`shared/src/items.ts:84-132`),
  not on `location` — an unworn, not-yet-identified item sitting in Inventar
  still has to stay hidden, so `location` can't be the gate. **Decided:**
  `name`, `anzahl`, `gewicht`, `kategorie` (already just the generic
  "Ausrüstung" bucket — reveals nothing further) and `notiz` stay always
  visible regardless of hidden state. **Decided:** `rs`,
  `haltbarkeitAktuell`/`haltbarkeitMax` (as one unit — always shown together)
  and each row of `bonusse` (`ItemBonus`, `items.ts:70-82`) get their own
  independent reveal state, not one item-level flag — the GM wants to unveil
  e.g. "it's armored" before "it's also cursed." **Decided:** full
  concealment for a hidden bonus row — it leaks neither its target nor that
  it exists at all; RS/Haltbarkeit stay visible as fields but render `???` in
  place of the real number while hidden. **Decided:** only the GM can
  create/toggle hidden state — the player-facing `AddItemDialog`
  (`client/src/components/itemDialogs.tsx:141-378`) never shows the toggle.
  **Decided:** reveal is one-way per field, GM-triggered manually (no
  player-facing "Untersuchung"/identify check exists or is needed — confirmed
  no such mechanic exists anywhere in `rules.ts`/`dice.ts` today), and needs
  the same confirm-step safeguard as deleting an item, since there's no undo.
  UI direction (rough, not locked): a small eye-icon next to each
  hidden-eligible field/row, GM-view only.
   - **Data model:** `rsVerborgen`/`haltbarkeitVerborgen: boolean` on `Item`,
     default `false` (visible) so existing rows are unaffected by the new
     columns; `verborgen: boolean` on each `ItemBonus` row.
   - **Plumbing (correction to first instinct):** gating does NOT belong in
     `wornBoni()` (`items.ts:291`) or `effektiverRs()` — those are pure
     client-side aggregators that just sum whatever `Item[]` they're handed.
     The real gate has to be server-side: one transform stripping hidden
     fields from the `Item` payload before it's serialized to a non-GM
     requester, same principle as the wiki's `ohneGmBloecke()`
     (`shared/src/wikiMarkup.ts:540-547`) stripping ` ```gm ` blocks before
     the response goes out, not a client that merely declines to render
     them. Once that strip exists, `wornBoni()`/`effektiverRs()` need no
     changes at all — a hidden bonus row simply never reaches a non-GM
     client's `data.items`, so it's already excluded from `CharCtx.stats` for
     free, and "effects apply only once revealed" falls out automatically.
     Still needs a build-time audit: every server call site that currently
     serializes item data to a client (`loadFullCharacter`, `buildSummary`
     at `characterData.ts:1740`, `overviewForChars` at
     `characterData.ts:1854`, at least) must know the requester's GM status
     at that point — same kind of multi-call-site sweep
     `docs/concepts/item-bonus-while-worn.md` already had to do for `loadStats`.
   - **New dependency since item bonuses landed:** `loadStats()`
     (`characterData.ts`) now folds `wornBoni(loadItems(charId))` into every
     calculation, dice rolls included — so a hidden-but-unrevealed
     `ItemBonus` row must be stripped *before* it reaches `wornBoni()`, not
     just before the `Item[]` is serialized to a non-GM client. The
     server-side strip this entry already needs (above) has to sit upstream
     of `loadItems()`'s callers inside `loadStats`, not only at the
     response-serialization boundary, or an unrevealed bonus would silently
     affect a player's own roll before the GM ever unveils it.

Inbox for raw feedback as it comes in. Drop new points here; they get refined and
sorted into the priority sections above in a later pass. (Empty = all caught up.)

## Mid-Prio

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
     THe actual statuses can be hardcoded, no need for settings.
     THe actual statuses can be hardcoded, no need for settings.
   - [ready] **Structured min/max range for Fernkampf** (user feedback):
     `entfernung` (`WaffenNeu.tsx:520-522`, `sections.ts:92-93`) is a single
     freeform text field, historically hand-written like "10/20/30". Decided:
     replace it with structured numeric `reichweiteMin`/`reichweiteMax`
     fields rather than adding alongside. Migration must not silently drop
     existing values (no-data-loss rule) — for rows whose old `entfernung`
     text doesn't cleanly parse into two numbers, fold the original string
     into the row's `notiz` instead of discarding it.
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
- [ready] **Editing dialogs for weapons/abilities** (user feedback; supersedes
  the old "reuse the item-creation Dialog for spells/abilities and weapons"
  note that used to live in Low-Prio). The items half of this shipped —
  `AddItemDialog` (`client/src/components/itemDialogs.tsx`) is dual-purpose
  now, opening pre-filled for an existing item (click the chip/row on
  Ausrüstung or Inventar, in either read-only or edit mode), with
  Duplizieren/Löschen in its footer and a repeatable Boni-beim-Tragen list.
  Item bonuses while worn are fully wired end to end, including the server
  dice-roll path — see `docs/concepts/item-bonus-while-worn.md` for the build
  history; that's the precedent to copy for the remaining two shapes, not
  re-derive:
   - **Move weapon/ability editing into the same dialog pattern.**
     `WaffenNeu.tsx`'s expand-to-edit cards and `AbilityManager.tsx` still
     edit everything inline/on-card. **Decided: hybrid, not a full
     replacement** — the highest-frequency actions (drag, Anzahl-style bumps)
     stay inline; a dialog handles the structural fields, same split already
     proven on items. **Decided: reuse the dialog shell, not the item schema**
     — `WaffenNeu.tsx`'s `emptyNahRow()`/`emptyFernRow()` (~10+ fields each)
     and `AbilityManager.tsx`'s `emptyAbility()` are shapes of their own; each
     needs its own field-selection pass, since none of the three (items,
     weapons, abilities) overlap.
   - **Open: do weapons/abilities want an item-bonus-style effect list too?**
     Not decided. If yes, it's the same generalization the "Player-set
     structured bonuses" entry below already plans for Vorteile/Nachteile —
     do that generalization once, shared by both, rather than two parallel
     bonus mechanisms.
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
- [ready] **Graded (fortified) spells/skills** (user feedback, concept
  agreed): `Ability.stufe` (`shared/src/abilities.ts:30`) already caps at
  `ABILITY_STUFE_MAX = 10` (`:82`) — reaching that cap is meant to let the
  player create a fortified version of the same spell/skill, and this can
  happen twice (three grades total). **Decided:** no automation on granting —
  the player creates the new `Ability` entry themselves exactly like any
  other, same as today. **Decided:** a new `derivedFrom` field (an `Ability`
  `uid` reference, empty by default) drives the grade: unset = grade 1
  ("Basis"), set = one more than the referenced ability's own grade
  ("Aufgewertet" = 2, "Potenzial" = 3 — names supplied by the GM). Grade is
  **display-only**, shown next to the name — it does not feed the
  Stufe×Komplexität Magiepunkte formula or any other calculation. **Decided:**
  the picker only offers abilities of the same `magisch` value (spell derives
  from spell, skill from skill only) — same partition `zauberOf`/
  `faehigkeitenOf` already use (`abilities.ts:43-48`). **Decided:** the server
  enforces both the max-grade-3 rule and cycle prevention at save time (reject
  a `derivedFrom` that would push grade past 3, or that would loop back on
  itself) — `saveAbilities` (`characterData.ts:1107`) already has the same
  shape of per-save validation for the one-signatur-spell rule
  (`signaturVergeben`, `:1111`) and uid dedup (`seenUids`, `:1109`), so this
  follows the same pattern rather than adding a new validation style. Needs a
  build pass: `derivedFrom` on the `Ability` type + `char_abilities` column,
  a grade-computation helper (walk the chain, same file as `spellPunkte`/
  `istTrivial`), the derive-from picker in `AbilityManager.tsx`, and the
  grade label next to the ability name.
- [sketch] **20+ perk picker** — source PDF analysed and written up at
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

- [sketch] **VTT: a way to set a character token's own appearance (custom
  image/icon), not just fall back to initials** (developer feedback,
  Phase 10 initiative tracker). The initiative strip shows a real portrait
  for a character with one uploaded (`client/src/pages/VirtualTable.tsx`,
  `InitiativeStrip`'s `renderCard`), a dashed empty box otherwise — the
  two-letter initials monogram used elsewhere on the map (`initials()`) reads
  as stale/placeholder-ish for a token that's meant to represent a real
  character across a whole session. No design decided yet on what a token's
  own settable appearance would look like (a small icon picker? a distinct
  upload separate from the character's sheet portrait?) — needs a concept
  pass before building.
- [sketch] **Native colour swatch reopens on a second click instead of
  closing** (VTT, `ColorSwatchInput` in `client/src/pages/VirtualTable.tsx`,
  used by token colour/ring colour, the tile/highlight picker, and the
  measure-shape colour field): clicking a `<input type="color">` swatch
  while its native browser dialog is already open should close it, but the
  browser reopens it instead. Two fix attempts (a tracked "believed open"
  ref + `blur()`, then a `document.activeElement` check + `blur()`) both
  failed live testing — a native colour dialog isn't part of the DOM, so it
  can't be driven/observed by this session's automated browser tooling
  either, which made both attempts guesswork. Confirmed minor/cosmetic by
  the developer, not blocking. Whoever picks this up next needs to actually
  reproduce it live (real browser, real clicks) to see what's really
  happening before trying a third fix — or consider swapping to a custom
  (non-native) colour picker instead, which would sidestep the browser
  quirk entirely.
- [sketch] **Potion charges** (user feedback): no charge concept exists
  today — the closest precedent is `Item.anzahl` (plain stack count).
  Decided: a charge is a portion/dose — potions come in three fixed sizes
  with a fixed charge count (klein = 1, mittel = 2, groß = 4), tracked as a
  current/max pair similar to the existing Haltbarkeit pattern, decrementing
  on use. Still open: how this interacts with `anzahl` when several
  identical potions are stacked — a single Item row's current/max charge
  pair can't represent "3 potions, each at a different remaining charge" any
  more than Haltbarkeit can today. Needs a concept pass on whether a
  partially-drunk potion has to split off the stack into its own row, or
  charges only make sense while `anzahl === 1`.
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
- [sketch] **Armor-material catalogue**: a GM-editable material→RS list (like
  talents/languages) so a worn piece picks a material and shows its RS. Today RS is
  a manual per-piece number on the item.
- [sketch] **Ammunition**: damage values and effects (new catalogue). Once it
  has a per-ammo damage value, wire it into the Fernkampf damage formula (see
  „Fold ammunition damage into the Fernkampf damage formula" under the Weapon
  tab rework, Mid-Prio) — currently blocking that item.
  This feature will need the players to keep their own list of ammunitions and damage values for them, which then feeds the damage formula. ranged weapons then pick which ammunition is used.
  Ammunition can have bonus on AT too.
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
- [sketch] **Link spoken languages to their writing system** (user feedback):
  `Sprachen.tsx` treats languages and scripts as two entirely separate,
  unlinked catalogs (`kind: 'sprache' | 'schrift'`), rendered by the same
  generic `LanguageTable` and grouped by `familie` — no field anywhere says
  "spoken language X uses script Y". Needs a concept pass: a `schriftId` /
  default-script field on `sprache`-kind catalog rows (or a join table), plus
  how to surface it in the UI (sub-label on the Sprachen row, auto-suggest in
  the Schriften table, …).
- [sketch] **Spell creation table — theme it, make it feel less like a plain
  table** (user feedback): `AbilityManager.tsx`'s "Regeltabelle: Zauber
  erschaffen" panel (`SPELL_CREATION_ROWS`, ~line 12) renders as a plain
  `<table className="sheet">` (3 cols, 8 static rows) with none of the app's
  card/chip theming — unlike the rest of the same page's ability list, which
  already uses the `abil-row`/`abil-compact` card pattern, or `WaffenNeu.tsx`'s
  `.wpn-card` / `Ausruestung.tsx`'s `.item-chip` styling used elsewhere. Needs
  a concept pass: restyle as themed table variant, or restructure as cards
  (one per attribute row)?

## Unsorted ideas (treat all as [sketch])

- logically connect weapons and inventory
  - weapons should be real items, too, but they carry some extra information
  - e.g. reducing a weapons Haltbarkeit on Ausrüstung should also be mirrored on Waffen and vice versa
  - this lets the player carry the ewapon on Ausrüstung as a real entry, not a separate and unconnected copy

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
  typo.

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