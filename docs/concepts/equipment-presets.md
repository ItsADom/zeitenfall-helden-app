# Equipment presets: named worn-item loadouts

Concept agreed 2026-09-06 (session with the developer). Covers the "User
feedback" TODO entry "equipment presets" (a set for leisure, a set for combat
etc.).

Status: **built 2026-09-06**, verified end-to-end in the browser against the
seed dev DB (create/rename/apply/resave, missing-item hint, preset surviving
its referenced item's deletion). Pure functions covered by
`shared/test/equipmentPresets.test.ts`.

---

## 1. What is being built

A character can save the current set of *worn* items (`location === 'getragen'`,
which zone, whether `beidseitig`) under a name, and later re-apply it —
switching outfits in one click instead of dragging each item by hand.

## 2. Decisions

### 2.1 A preset is a snapshot, not a live rule

A preset is a named list of `(item uid, item name, zone, beidseitig)` entries —
one per item that was worn when the preset was saved. There is no separate
"bench list": everything *not* in the preset is what gets unequipped on apply
(see 2.2). An item worn in every outfit (a ring you never take off) simply has
to appear in each preset's own snapshot; nothing is shared between presets.

`item_name` is a cache taken at snapshot time. It is used **only** for the
missing-item hint (2.4) — never read for anything mechanical, since the whole
point is it may outlive the item actually existing.

### 2.2 Applying is a full outfit swap

Confirmed developer decision: applying preset P means the character ends up
wearing exactly what P lists, nothing else. Concretely, given the character's
current `Item[]`:

1. Every item currently `getragen` whose uid is **not** in P → patched to
   `{ location: 'bench', zone: '', beidseitig: false }`.
2. Every entry in P whose uid **is** found among the character's current items
   → patched to `{ location: 'getragen', zone, beidseitig, containerUid: '' }`.
   The explicit `containerUid: ''` matters: if the item had been stashed in a
   container since the preset was saved, applying pulls it back out.
3. Every entry in P whose uid is **not** found → skipped. The entry is left
   untouched in the stored preset (not deleted) — see 2.4.

Containers and their contents need no special handling: a container's own
`getragen`/`bench` state changes like any other item in step 1/2, but its
contents are addressed by `containerUid`, not by zone, so they simply keep
riding along with it regardless of the container's worn state (same as today,
outside of presets).

### 2.3 Applying is client-side only — no new server endpoint, no new op

The swap above produces a plain new `Item[]`. It is computed in
`Ausruestung.tsx` and handed to the existing `setItems` → `update('items', …)`
path — the exact same call every drag-to-equip already makes. That path
already flows through `diffItems`/the ops-based autosave
(`shared/src/items.ts`, see the "Items save incrementally" rule in
`CLAUDE.md`), so applying a preset gets crash-safe, concurrency-safe
incremental saving for free. **No new `ItemOp` variant and no apply endpoint
are needed.**

Applying works in read-only display mode, matching the file's existing
principle that re-equipping is a quick game action, not a sheet edit (see the
top-of-file comment in `Ausruestung.tsx`). Creating/renaming/deleting/resaving
a preset **is** gated to edit mode — those are structural actions, like
`+ Zeile`.

### 2.4 Missing-item hint

Before applying, compare P's uids against the character's current items. If
any are missing, show a confirmation step listing them by their cached
`item_name` (e.g. *"Nicht im Inventar: Schwert, Schild — werden
übersprungen. Trotzdem anwenden?"*) before proceeding. If nothing is missing,
apply immediately with no interruption — the hint only appears when it has
something to say.

An item can go missing two ways: it was deleted, or it moved to the group/GM
pool via the existing cross-owner move (`docs/concepts/shared-inventories.md`).
Both look identical to a preset — a uid it no longer finds — and both are
handled the same: skip, keep the entry, hint. No group/GM pool awareness is
built (see 2.7).

### 2.5 Authoring: snapshot current state, no dedicated editor

To build or update a preset, physically equip the character as normal in
Ausrüstung, then use one of:

- **"Set speichern"** — creates a new preset from every currently-`getragen`
  item.
- **"Neu speichern" (resave)** — overwrites an *existing* preset's item list
  from the current worn state, keeping its name and position. Same server
  call as create, just targeting an existing preset id (see 2.6) — from the
  server's point of view, rename and resave are the same operation
  (`PUT .../equipment-presets/:id { name, items }`), just the client decides
  which field actually changed.

No separate placement UI is built. You cannot build a preset for gear the
character isn't currently wearing.

**UI shape: a flyout, not an inline block.** A single "Sets" button in
`Ausruestung.tsx` opens a floating panel listing presets, each row carrying
Anwenden / Neu speichern / Umbenennen (inline `TextInput`) / Löschen — reusing
the existing flyout pattern (`.vtt-tile-picker`-style: `position: absolute`,
floats below its trigger button) rather than adding an always-visible inline
list to an already-dense tab. This is the same shape as `TilePicker`/
`HighlightPicker`/`MeasureKindPicker` in `VirtualTable.tsx`, just outside the
VTT toolbar — no modal dialog either way.

### 2.6 Data model and API

```sql
CREATE TABLE IF NOT EXISTS char_equipment_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_equipment_presets_char ON char_equipment_presets(character_id, pos);

CREATE TABLE IF NOT EXISTS char_equipment_preset_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL REFERENCES char_equipment_presets(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  item_uid TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  beidseitig INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_equipment_preset_items_preset ON char_equipment_preset_items(preset_id);
```

`character_id` is a real FK with `ON DELETE CASCADE` — unlike `char_items`,
a preset is always and only owned by a character (never the group/GM pool, see
2.7), so there is no owner-type ambiguity to generalize away and no manual
delete path to add.

`item_uid` is deliberately **not** a foreign key — same reasoning as
`containerUid` on `Item` itself: identity here is the client-set `uid`, not a
DB row id, and a dangling reference is an expected, handled case (2.4), not a
constraint violation.

CRUD is a plain whole-object `PUT`/`POST`/`DELETE` per preset, **not** the
ops machinery `char_items` uses. That machinery exists because two people can
concurrently edit the *same* shared item list (`CLAUDE.md`, "Items save
incrementally"); a character's own preset list has no such concurrent-editor
risk, so a full-object replace per preset is safe.

Presets load alongside the rest of a character's data (like `data.items`
today) so `Ausrüstung.tsx` has them on hand without an extra round trip.

Endpoints:

- `GET` is folded into the existing character data load.
- `POST /api/characters/:id/equipment-presets` `{ name, items }` — create.
- `PUT /api/characters/:id/equipment-presets/:presetId` `{ name, items }` —
  rename and/or resave (same call, see 2.5).
- `DELETE /api/characters/:id/equipment-presets/:presetId`.
- Reorder: same `pos`-array-PUT pattern already used for category/house lists.

### 2.7 Scope explicitly cut: group/GM pools

Confirmed developer decision: presets do not interact with the group or GM
pool. A preset only ever references the character's own items. An item that
left via a cross-owner move is indistinguishable from a deleted one as far as
a preset is concerned — both are just "uid not found," handled by 2.4. No
borrowing, no auto-move-back, no pool awareness anywhere in this feature.

---

## 3. Build order

1. `shared/src/items.ts` (or a new `shared/src/equipmentPresets.ts`): the
   `EquipmentPreset`/`EquipmentPresetItem` types, and the pure swap function
   (`applyEquipmentPreset(items, preset) => Item[]`) plus a
   `missingPresetItems(items, preset) => EquipmentPresetItem[]` helper for the
   hint — both unit-testable without a server, same spirit as `diffItems`'s
   own tests.
2. `server/src/db.ts`: the two `CREATE TABLE IF NOT EXISTS` blocks above.
3. `server/src/characterData.ts`: load/create/update/delete/reorder for a
   character's presets, folded into the existing character data load.
4. `server/src/routes.ts`: the four endpoints in 2.6.
5. Client: preset list UI in `Ausruestung.tsx` (apply/resave/rename/delete/
   reorder), using `applyEquipmentPreset`/`missingPresetItems` from step 1.
