# Shared inventories: group pool, GM pool, cross-owner moves

Concept agreed 2026-08-31 (session with the developer). Covers the `[ready]`
TODO entry "Group ↔ player inventory, player ↔ player item transfer". Houses
stay out of scope and keep their own `[sketch]` status.

Status: **concept only, no code written yet.** Branch `feature/shared-inventories`
exists and holds this document.

---

## 1. What is being built

Three things, one branch:

1. **Ownership generalization.** An item stops belonging to a character and
   starts belonging to an *owner*: a character, a group, or the GM.
2. **A cross-owner move**, driven from the item edit dialog.
3. **Two new panels**: a Gruppen-Inventar on `Group.tsx`, a GM prep pool on
   `GroupOverview.tsx`.

---

## 2. Decisions

### 2.1 Ownership

- `char_items` gains `owner_type` / `owner_id`, mirroring the pair
  `assets/store.ts` already uses. Values: `'character'`, `'group'`, `'gm'`.
- The GM pool is **one single global pool**. `owner_id` is unused for it
  (store `0`). Only one GM account exists, so per-GM scoping would be dead
  complexity.
- `char_item_categories` takes **the same pair** (see 2.6).

**A table rebuild is unavoidable.** `character_id` is
`NOT NULL REFERENCES characters(id) ON DELETE CASCADE`, and SQLite cannot drop
`NOT NULL` via `ALTER`. So: `PRAGMA foreign_keys=OFF`, create the new table,
`INSERT … SELECT` **preserving `id`** (the child tables `char_item_bonuses` and
`char_item_weapon_stats` reference it), drop, rename, `foreign_key_check`,
pragma back on. The pragma must be set *outside* the transaction, since it is a
no-op inside one.

Two consequences, both accepted:

- **The DB-level cascade is gone.** Deleting a character or a group no longer
  deletes its items. Both delete paths need a manual delete, exactly like the
  existing `loescheAssetsFuer()` rule for the cross-database asset store.
- **A rollback would strand the data.** Old code reads `character_id`, which no
  longer exists. This is a one-way migration. (The alternative considered and
  rejected: keeping nullable `character_id`/`group_id` with real FKs, which
  preserves both cascade and rollback but is not the generic pair the entry
  decided on, and needs another column for `'room'` later.)

**Migration ordering constraint.** The rebuild has to run *after* the existing
`char_items` column `ALTER`s (db.ts ~965-1007) so the column set is complete.
The weapons migration further down (db.ts ~1128) inserts with `character_id`,
so it must be switched to the new pair. Note it is guarded by
`tableExists('sec_waffenNahNeu')` and an `already` count, so on a database where
those legacy tables exist but are empty the guard still lets execution in, and
`prepare()` on the old column list would throw at boot. Rebuild first, then fix
that INSERT.

Table names stay (`char_items`, `char_item_categories`). The `char_` prefix
becomes a mild lie once groups own items, but renaming would churn every SQL
string and both child FK definitions for no behavioural gain. Worth a schema
comment, not a rename.

### 2.2 The move is an endpoint, not an op

`diffItems` compares one owner's list against *its own* previous state. It
structurally cannot express "this uid leaves my list and joins yours", and it
must not learn how: the whole reason ops exist is that a client can only ever
address a uid it has actually seen.

So the move is an **imperative call to its own endpoint**, outside the debounced
autosave flush, authorized for both sides, applied in one transaction.

- **Containers move atomically.** Moving a container moves every item whose
  `containerUid` points into it, in the same transaction. Nothing is orphaned.
- **Only the root item resets.** `location` → `'inventar'`, `zone` → `''`,
  `beidseitig` → `false`, `containerUid` → `''`. Descendants keep their
  `containerUid` and stay `location: 'behaelter'`, so the container's internal
  structure survives the trip.
- **No confirmation step.** The move happens outright.

### 2.3 The move UI is a name picker

A "Verschieben nach…" target picker in `AddItemDialog`. It lists target
**names only** and never shows what is already in the target.

Targets: the group pool, every character in the group, and the GM pool.

**The permission split is enforced by the source, not the target list.** You can
only open the dialog on an item you can already see: your own items, or the
pool's. So "a player can give away their own stuff but cannot reach into another
player's inventory" falls out of which dialogs a player can open, with no
target-side rule to write.

### 2.4 The GM pool

- **Everyone can send to it.** The GM stands in for every NPC there will ever
  be, so moving an item to the GM pool *is* handing it to an NPC. It is the way
  to conserve an item while taking it out of a player's hands.
- **Contents are GM-only.** For a player the pool is write-only: the item goes
  in and comes back only through the GM, which matches the fiction.
- **Hand-out is the same picker**, not drag-and-drop. The TODO's "Decided:
  hand-out is drag-and-drop, drag a chip onto a roster card" is **superseded**,
  and with it the hard blocker that said the GM pool could not start before a
  drag gesture existed. `GroupOverview.tsx` needs no drop targets and stays free
  of drag plumbing. Drag can be added later as an accelerator.

### 2.5 Weight

Group and GM pool items are weightless for everyone, and this needs **no special
case**. Pool items are simply not in a character's `data.items`, so `lastInfo`
and `wornBoni` never see them. The "infinite Traglast for the GM" note in the
TODO is likewise automatic.

### 2.6 Categories: per-owner curated lists

**Decided: generalize `char_item_categories` with the same `owner_type`/
`owner_id` pair.** A character keeps its curated list with Einstellungen
unchanged; the group pool and the GM pool each get one, edited in their own
panel. Options remain today's rule: own curated list plus categories in use.

The cascade in `manageItemCategories` becomes
`WHERE owner_type=? AND owner_id=? AND kategorie=?`. `seedItemCategories` and
`loadItemCategories` take the same substitution. `INVENTAR_KATEGORIEN` seeds
every new owner, so everyone still starts from the same baseline.

**No global layer.** Taxonomy spreads by movement instead: an item carries its
category wherever it goes, and once there the string shows up in that owner's
suggestions. Propagation by use, not by decree.

See section 3 for why this is safe and section 4 for what was rejected.

---

## 3. Findings (verified in code, so nobody relearns them)

### 3.1 A foreign category is already completely harmless

Traced end to end. An item arriving with a category the receiving owner has
never heard of does nothing but sort itself in:

1. **The server never validates it.** `normalizedItemRow`
   (`characterData.ts:1048`) is `String(o.kategorie ?? '').slice(0, MAX_ITEM_TEXT)`.
   There is no membership check against `char_item_categories` on any write path.
2. **It renders correctly.** `catsOf()` (`Inventar.tsx:29`) derives group headers
   from the items present, not from the managed list. The category gets its own
   header, count and weight sum, and a working collapse key.
3. **It becomes selectable.** `catOptions` unions the managed list with every
   in-use value, so other items can then be filed under it too.
4. **It survives category management.** `manageItemCategories` does *not* diff
   the order array. It acts only on explicit `renames`/`removes` sent by the
   client, and `Einstellungen.tsx:277` computes
   `removes = savedCats.filter(o => !catRows.some(r => r.orig === o))`.
   `savedCats` is the player's own loaded list, so a foreign category can never
   land in `removes`; `renames` only covers rows carrying an `orig`. The cascade
   never names it.

The single consequence is a **ghost category**: real on the item, absent from
Einstellungen, not renameable there, and gone from the dropdown once the last
item carrying it leaves.

### 3.2 The category list's order is dead code

Nothing reads `char_item_categories.pos` for display. `catsOf()` sorts
alphabetically with `''` last, and `catOptions` sorts with `localeCompare`.
Reordering in Einstellungen has never changed a rendered thing.

### 3.3 Only ONE category string is load-bearing, and it is not the obvious one

Both `AUSRUESTUNG_KATEGORIE` (`'Ausrüstung'`) and `WAFFE_KATEGORIE` (`'Waffe'`)
are written into `kategorie` on save (`itemDialogs.tsx:516`), which hides an
asymmetry:

- **`Waffe` is cosmetic.** Dialog mode is detected from `waffenArt`, a real
  field (`itemDialogs.tsx:459`). Change the category and the item still opens as
  a weapon.
- **`Ausrüstung` is the sole signal** for equipment mode:
  `item.kategorie === AUSRUESTUNG_KATEGORIE`.

So a rename, or a stray trailing space, on that one string silently drops an
item out of equipment mode and hides its RS/Haltbarkeit fields. **This fragility
already exists today and is unchanged by this work**, because curated lists are
being kept. It only becomes urgent if categories ever go fully freeform (4.2),
in which case equipment should get a real `istAusruestung` field mirroring
`istBehaelter`, so that no category string decides anything.

### 3.4 `INVENTAR_KATEGORIEN` is already a de-facto global set

`shared/src/sections.ts:240` is `['Allgemein', 'Tränke/Proviant', 'Handwerk']`,
seeded into every new character. A shared baseline already exists as a constant;
it is just small, and used as a seed rather than as a live catalog. That is why
no new catalog table is needed to give the pools sensible starting suggestions.

---

## 4. Rejected alternatives (and why)

### 4.1 Global category catalog plus per-player lists

The two layers overlap on a plain string and cannot be told apart. A player
deletes "Alchemie" from their list, the cascade clears it off their items, and
the entry is still in the dropdown because it is also global. Nothing breaks,
but the delete visibly did not do what it said. Avoiding that needs a second
table of per-player suppressions.

Worth the cost only if the goal is to *impose* a taxonomy (a GM-defined list
everyone sees whether they use it or not). **Confirmed that is not the goal**:
categories should spread through item exchange.

### 4.2 Dropping curated category lists entirely

Considered seriously: categories as pure freeform text, suggestions fed by what
is in the inventory, new ones created by typing. Sections 3.1 and 3.2 show it
would work, and it dissolves the cross-owner problem rather than working around
it. Rejected because curated lists are wanted. Costs if ever revisited: bulk
rename disappears (mitigation: a rename action on the category group header,
doing a find/replace over that owner's items, which would be *better* than the
Einstellungen cascade because it is per-owner and would reach pools), and
`istAusruestung` becomes necessary (3.3).

### 4.3 Keeping nullable `character_id`/`group_id` instead of the generic pair

Preserves DB cascade and rollback readability, but is not the decided pair and
needs another column for `'room'`. Rejected in favour of the generic pair;
consequences accepted in 2.1.

### 4.4 Cross-page drag for group to player

The group pool lives on `Group.tsx`, a player's items on `Character.tsx`. A drag
cannot cross pages, so this would have required embedding a group panel inside
the Inventar tab. The dialog picker replaces it and works from anywhere.

---

## 5. Build order

1. `shared/src/items.ts`: owner types, move request type, the move reset patch.
2. `server/src/db.ts`: schema for both tables, the two rebuilds, fix the weapons
   migration INSERT.
3. `server/src/characterData.ts`: owner-scoped `loadItems`/`applyItemOps`/
   category functions (keep thin `charId` wrappers so `diceSource.ts`, `ws.ts`
   and `seedTestUser.ts` stay untouched), plus the atomic move.
4. `server/src/routes.ts`: group and GM item routes, the move endpoint, manual
   delete on character and group deletion.
5. Client: the move picker in `AddItemDialog`, then the two panels.

The panels want a shared component rather than reusing `InventarTab`, which is
tightly bound to `useChar()` and carries Traglast and body zones that a pool has
no use for.

## 6. Still open (build-time calls)

- Panel layout proportions and collapsibility for both new panels.
- Whether the pools refresh on focus like `Group.tsx` does today, or push over
  the existing websocket. Recommendation: focus-reload first, no WS.
