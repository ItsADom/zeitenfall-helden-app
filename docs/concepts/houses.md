# Houses: shared group locations, subdivided into rooms

Concept agreed 2026-09-02 (session with the developer), building on
`docs/concepts/shared-inventories.md` (the `owner_type`/`owner_id`
generalization, the group pool, the item-ops mechanism). Covers the
`[sketch]` TODO.md entry "Houses", left deliberately out of scope while
shared-inventories.md was built.

Status: **built 2026-09-02**.

---

## 1. What is being built

A player-driven way to tag a group-owned item with a fictional location —
"this is in the kitchen, in the old mill" — organized as houses containing
rooms, browsable as an alternate grouping of the existing Gruppenpool panel.

## 2. The framing that settled the open questions

The TODO sketch left open: can a group own multiple houses, who can
create/name rooms, does a room have capacity. The developer's framing
resolved all three at once: **the group pool already fictionally represents
"somewhere shared, unspecified"** — a room just answers *where* more
precisely. A house/room isn't a new kind of thing bolted onto the pool, it's
the pool's own fiction gaining detail.

Consequences:

- **Not a new ownership kind.** A room is a location tag on a group-owned
  item, exactly like `kategorie` is a classification tag. Filing an item into
  a room is an ordinary field patch through the existing item-ops mechanism
  (`shared/src/items.ts` `ITEM_PATCH_KEYS`), never the cross-owner move
  endpoint (shared-inventories.md §2.2) — ownership doesn't change.
- **Multiple houses per group** — a home base plus, say, a safehouse — since
  nothing about "the pool is a location" caps it at one.
- **Any player can create/name a house or room.** Same flat permission model
  the group pool already has; no GM gatekeeping.
- **No capacity/size tracking** on rooms, matching the pool's existing
  weightless simplicity (shared-inventories.md §2.5).
- **Houses are group-only.** The GM pool represents "not yet handed out to
  the fiction", not a place — it doesn't get houses.

## 3. Decisions

### 3.1 `haus`/`raum` are plain strings on `Item`, not foreign keys

Creation needed to feel as light as filing an item under a category: pick an
existing name or type a new one, no separate "create a house first" step.
That ruled out `room_id` pointing at a `group_rooms.id` — assigning a
brand-new room would need a create-then-patch round trip. Instead `Item`
gains `haus: string` and `raum: string`, exactly the same role `kategorie`
already has: freeform, curated-suggested, no validation coupling.
shared-inventories.md §3.1 already proved this is safe — a foreign/unmanaged
string value is harmless, it just doesn't show up in the managed list.

`group_houses`/`group_rooms` are therefore **suggestion/rename lists**, not
authoritative references — the same role `char_item_categories` plays for
`kategorie`, one level deeper (`group_rooms` scoped to a house *name* within
a group, not a house id).

### 3.2 A room only means anything while the item is group-owned

`ITEM_MOVE_RESET_PATCH` (shared-inventories.md §2.2) now also clears
`haus`/`raum` — a cross-owner move to a character or the GM's pool resets
them to `''`, same as `containerUid`. A stale house tag surviving onto a
character's own inventory would reference a place that item no longer has
any connection to.

### 3.3 Containers carry their contents implicitly

Tagging a container with a room places it in that room; its contents don't
get their own `haus`/`raum` and just travel with it — the same rule
shared-inventories.md §2.2 already established for a cross-owner move of a
container ("only the root resets/carries state, descendants keep theirs").

### 3.4 Everything lives inside the existing Gruppenpool panel

Not a separate page. `PoolInventory.tsx` gained a Kategorie/Raum view
toggle over the *same* item list — switching lenses, not navigating
somewhere else. A house switcher (`<select>`) appears only once a group has
more than one house, and only in Raum view; it's a plain inline control, not
a dialog, because *viewing* which house is a frequent action. Per
`docs/concepts/ui-dialogs.md` (drafted the same session): only
*creation* (typing a new name into an item's Haus/Raum field) and *cleanup*
(rename/delete in `HouseManagerDialog`) are dialog-gated.

### 3.5 Renaming "Gruppenpool" — deliberately left open

Once a house/room is just the pool's fiction gaining detail, "Gruppenpool"
as a label sits a little oddly. Not decided here — tracked as its own
`[ready]` TODO.md entry, since the right name also has to keep working for a
group with zero houses defined, and must not collide with a live group's own
free-typed dynamic tab (shared-inventories.md §6 already hit this once).

---

## 4. Build (mechanical mirror of `kategorie`)

`haus`/`raum` flow through every place `kategorie` already does — see
`shared/src/items.ts` (`Item`, `ITEM_PATCH_KEYS`, `ITEM_MOVE_RESET_PATCH`),
`server/src/db.ts` (two new `TEXT NOT NULL DEFAULT ''` columns on
`char_items`, additive `ALTER TABLE`, no rebuild needed), and
`server/src/characterData.ts` (`normalizedItemRow`, `ITEM_UPDATE_SQL`/
`itemUpdateParams`, `loadItemsForOwner`, `applyItemOpsForOwner`, `moveItem`'s
reset SQL).

New pieces:

- `group_houses` / `group_rooms` tables (`server/src/db.ts`) — direct, real
  `group_id` FK with `ON DELETE CASCADE` (not the generic `owner_type`/
  `owner_id` pair `char_items` uses): a house/room only ever belongs to a
  group, so there's no ownership-kind ambiguity to generalize away, and a
  real cascade avoids the manual-delete burden the generic pair took on for
  `char_items`.
- `loadHouses`/`loadRoomsForGroup`/`manageHouses`/`manageRoomsForHouse`
  (`server/src/characterData.ts`) — modeled directly on
  `loadItemCategoriesForOwner`/`manageItemCategoriesForOwner`, one level
  deeper: a house rename/remove cascades to `group_rooms.haus` and to
  `char_items` (rename updates `haus`; remove clears **both** `haus` and
  `raum`, since a room means nothing without its house).
- `GET /groups/:id` (existing response) gained `houses`/`roomsByHaus` fields,
  next to `itemCategories` — no new fetch. `PUT /groups/:id/houses/manage`
  and `PUT /groups/:id/houses/:haus/rooms/manage` are the only new
  endpoints; room *assignment* itself rides the existing
  `POST /groups/:id/items/ops`.
- Client: `AddItemDialog` gained Haus/Raum fields (same input+datalist
  pattern as `kategorie`), `PoolInventory` gained the view toggle/house
  switcher/room-grouping, and `HouseManagerDialog.tsx` (new) mirrors
  `CategoryManagerDialog.tsx` one level deeper, applying its own cascade to
  the already-loaded item pool client-side (`applyHouseCascade`, parallel to
  `applyCategoryCascade`) instead of forcing a refetch.
