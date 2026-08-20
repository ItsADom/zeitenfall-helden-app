# Item edit dialog + "Bonus while worn" — build plan

Approved build plan from a planning session (2026-08-21). Not yet implemented —
see `TODO.md`'s Mid-Prio entry "Editing dialogs for items/weapons/abilities,
with item bonuses while worn", which stays the source of truth for readiness
tag and status until this lands. Kept as a separate file because the plan is
long enough (data model, compute plumbing across 7 call sites, UI layer,
sequencing, verification) that it doesn't fit inline in `TODO.md`.

---

## Context

Player feedback asked for two things that turned out to be one initiative:

1. **Item bonuses while carried** — a worn item (a ring, an amulet, a masterwork
   tool) should actually raise the stat it buffs, instead of the player doing the
   arithmetic by hand. No equip-effect mechanism exists anywhere today; the one
   precedent, `effektiverRs()` (`shared/src/items.ts:168`), is hardcoded to pull
   only `rs` from worn items.
2. **Leave inline table editing behind for items** — an item can carry *several*
   bonuses, and a repeatable list of target+amount rows does not fit the chip /
   inline-cell editing style. The dialog is not decoration; it is what makes the
   feature buildable.

**Scope of this plan: items only.** The same dialog treatment for weapons
(`WaffenNeu.tsx`) and abilities (`AbilityManager.tsx`) is tracked in the same
TODO entry and gets its own plan once the pattern is proven here.

Decisions already taken (recorded in `TODO.md`, Mid-Prio):

- Bonuses apply **only while `location === 'getragen'`**, matching `effektiverRs()`.
- **Structured** target + amount, not free-form text.
- **Multiple bonuses per item** — hence the dialog.
- Targets cover **attributes, TaW/AT/PA/BL, base values, resources**.
- Same-target bonuses from several worn items **sum** (no max-only cap like `rs`).
- Grouped `<select><optgroup>` picker — no new combobox component.
- **Hybrid editing**: Anzahl / Haltbarkeit-aktuell / delete / drag stay inline;
  structural fields plus the bonus list move into a dialog.
- Effective values render with a **marker + tooltip naming the contributing items**.
- Bonuses **flow into dice rolls**, not just the displayed number.

---

## 0. Prerequisite fix (own commit, before anything else)

The client computes weapon probes from `computeBaseValues(...).ergebnis` (base
**+ mod**, `WaffenNeu.tsx:61-62`), while the server rolls from
`computeBaseValueBases()` **raw, without mods** (`diceSource.ts:133`). A
character with any Mod. on AT/PA/BL/FK already sees one number on the sheet and
rolls another.

Fix `diceSource.ts` to use `computeBaseValues` and read `.ergebnis`. This is
unrelated to item boni and predates this work, but the two paths must agree
before boni are layered on either.

**This changes roll results** for characters with a non-zero Mod., so it needs a
`fixed` changelog line of its own.

---

## 1. Data model

### `ItemBonus` (new, `shared/src/items.ts`)

Four key-spaces with no shared type today, so a discriminated union rather than
one flat string enum:

```ts
export type ItemBonusKind = 'attr' | 'baseValue' | 'resource' | 'talent';
export const ITEM_BONUS_KINDS = ['attr', 'baseValue', 'resource', 'talent'] as const;
export type TalentBonusFeld = 'taw' | 'at' | 'pa' | 'bl';

export interface ItemBonus {
  kind: ItemBonusKind;
  code: string;               // AttrCode | BaseValueKey | ResourceKey | talentId
  feld: TalentBonusFeld | ''; // nur bei kind === 'talent'
  wert: number;               // darf negativ sein (verfluchte Gegenstände)
}
```

`Item` gains one field: `bonusse: ItemBonus[]`. Negative values are allowed
deliberately — a cursed item is the same mechanism.

### Storage: new child table

Follow the `char_pouches` → `char_pouch_coins` precedent (`db.ts:286-300`,
`characterData.ts:925-999`), **not** the JSON-in-TEXT shape of
`char_abilities.kategorien` — whose cost is visible at
`characterData.ts:1199-1217`, where a rename must load, parse, rewrite and
re-stringify every row.

New table in the big `db.exec` block of `server/src/db.ts`. A new table is free:
`CREATE TABLE IF NOT EXISTS`, no `user_version` bump, no `ALTER TABLE`, and no
boot-time re-derive (that rule applies to *derived* columns; this is user data).

```sql
CREATE TABLE IF NOT EXISTS char_item_bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES char_items(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'attr',
  code TEXT NOT NULL DEFAULT '',
  feld TEXT NOT NULL DEFAULT '',
  wert REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_item_bonuses_item ON char_item_bonuses(item_id);
```

Keyed on `char_items.id` (fresh `lastInsertRowid`), exactly like
`char_pouch_coins` keys on the pouch rowid — **not** on `uid`. `saveItems`
already DELETE-all-then-reinserts in one transaction, so children die by
`ON DELETE CASCADE` and are re-inserted against the new rowid in the same pass.

### Load / save — `server/src/characterData.ts`

- `loadItems` (`:782-829`): second query for all bonus rows of the character's
  items, grouped into a `Map<number, ItemBonus[]>` in JS — same two-query-then-
  group shape as `loadPouches` (`:925-949`). Validate `kind` against
  `ITEM_BONUS_KINDS` and coerce `wert` via `Number()`, mirroring how `loadItems`
  already re-validates `ITEM_LOCATIONS` / `CONTAINER_ARTEN` / `KAPAZITAET_ARTEN`.
- `saveItems` (`:842-898`): capture `Number(ins.run(...).lastInsertRowid)` and
  insert bonus rows with `pos = index`, following `savePouches` (`:966-983`).
  Add `MAX_BONUSSE_PRO_ITEM` (~20) next to the existing `MAX_ITEMS` /
  `MAX_ITEM_TEXT` caps (`:772-773`); drop rows failing validation rather than
  throwing, matching how `savePouches` skips stale FK targets (`:962-963`).
- **No route change** — `PUT /api/characters/:id/items` (`routes.ts:867`) already
  ships the whole array, and `update('items', …)` (`Character.tsx:343`, flushed
  at `:303`) already sends everything.

### Type-completeness touch points

`Item` is constructed literally in several places; a required new field makes
TypeScript point at each. That is the safety net — each gets `bonusse: []`:
`client/src/tabs/Inventar.tsx:59-63` (`newItem`), both commit paths in
`client/src/components/itemDialogs.tsx`, `server/src/characterData.ts:534` and
`:593` (migration constructors), `shared/test/items.test.ts:40-55` (fixture).

---

## 2. Compute plumbing

### The core trick: derive, don't re-plumb

`rules.ts` needs **no signature changes at all**. Every formula already reads
attributes through one choke point, and base values already carry a per-key mod
record:

```ts
export function attrMax(attrs: Attributes, code: AttrCode | 'SO'): number {
  const a = attrs[code];
  return (a?.akt ?? 0) + (a?.mod ?? 0);
}
```

So each call site swaps its *inputs* for a derived copy with boni folded into the
existing `mod` / `mods` slots. Five pure functions in `shared/src/items.ts`, next
to `effektiverRs()`:

```ts
export interface WornBoni {
  attrs:      Partial<Record<AttrCode, number>>;
  baseValues: Partial<Record<BaseValueKey, number>>;
  resources:  Partial<Record<ResourceKey, number>>;
  talente:    Record<number, Partial<Record<TalentBonusFeld, number>>>;
  quellen:    Record<string, string[]>;   // Zielschlüssel -> Item-Namen (Tooltip)
}

export function wornBoni(items: readonly Item[]): WornBoni;
export function attrsMitBoni(attrs: Attributes, b: WornBoni): Attributes;
export function baseInputsMitBoni(inputs: BaseValueInputs, b: WornBoni): BaseValueInputs;
export function resourceInputMitBoni(input: ResourceInput, key: ResourceKey, b: WornBoni): ResourceInput;
export function talentMitBoni(talent: CharTalent, b: WornBoni): CharTalent;
```

`wornBoni` filters to `location === 'getragen'` and **sums** same-target rows,
collecting `quellen` in the same pass so the tooltip needs no second walk. All
pure, all taking `readonly Item[]`, matching the module's existing style.

**Resource boni need both slots.** `computeResource` derives
`ergebnis = vor + permanent + kauf` and `max = … + kaufMax + maxPlus`, with
`nutzbar = min(ergebnis, max)`. To actually raise what a player can use, a `+N`
resource bonus must go into **both `permanent` and `maxPlus`** — adding to only
one leaves `nutzbar` pinned by the other. This is the one non-obvious line in the
feature and needs a comment.

### Client — 3 sites, no new data loading

All three already read the same `data` object from one shared `CharCtx`
(`Character.tsx:152`), with `data.items` already alongside `attributes` /
`baseValues` / `resources` (`:62`). Each adds `items` to its destructure and
computes `const b = wornBoni(items)` once:

- `client/src/tabs/Heldenbrief.tsx:97` — add `items`; `:123` and `:349` swap in
  `attrsMitBoni` / `baseInputsMitBoni` / `resourceInputMitBoni`.
- `client/src/components/CharacterSidebar.tsx:124` — same swap in `SidebarPools`.
- `client/src/tabs/WaffenNeu.tsx:60` — derived attrs/inputs, plus `talentMitBoni`
  on the talent looked up in `probesFor` / `fkProbeFor`.

Talent display (`Talente.tsx`) shows effective values through `talentMitBoni`
while **the input still binds to the stored raw value** — layered for display,
never written back, the same non-destructive contract `attrMax` has with
`akt`/`mod`.

### Server — 4 genuinely separate sites

No shared assembler; each is its own purpose-built path. The fix at each is the
same two lines (`loadItems(charId)` + derived inputs). `loadItems` is exported
from `characterData.ts:782`, so three of the four need no import.

| Site | File | What changes |
|---|---|---|
| `saveSection`, `resources` branch | `characterData.ts:1518-1552` | Clamp `aktuell` against the **bonus-aware** `nutzbar` |
| `buildSummary` | `characterData.ts:1735-1818` | Derived inputs for attribute / basiswerte / ressourcen / talente / waffen |
| `overviewForChars` | `characterData.ts:1850-1927` | Derived inputs inside the per-character loop (one more `loadItems` per iteration, same shape as the existing per-character queries) |
| `computeProbeForCharacter` | `diceSource.ts:68-148` | Add `loadItems` to the existing `characterData.js` import (no cycle — `characterData` does not import `diceSource`), derive attrs/base inputs, apply `talentMitBoni` to the `char_talents` row |

**The `saveSection` clamp is not optional.** If boni raise a resource's max and
the clamp doesn't know, a player wearing a bonus item has `aktuell` silently
written down to the un-bonused ceiling on the next save — data-loss-shaped, not a
display glitch.

Wiring `computeProbeForCharacter` also fixes the GM's "Probe anfordern" list for
free, since `listRollableProbes` (`diceSource.ts:165+`) reuses it.

---

## 3. UI layer

### 3a. Dialog gains edit mode — `client/src/components/itemDialogs.tsx`

`AddItemDialog` takes an optional `item?: Item`; when set, it is the edit case.

**Seeding.** State is currently initialized to constants and only re-seeded by
`reset()` on close, with no effect on `open`. Add the pattern already used at
`client/src/wiki/NeueSeiteDialog.tsx:25-31`:

```tsx
useEffect(() => { if (open) { /* seed from item ?? blanks */ } }, [open, item?.uid]);
```

Seeding on `open` (rather than replacing `reset()`) is required because
`Dialog.tsx` unmounts only its own DOM (`if (!open) return null`) while
`AddItemDialog` itself stays mounted.

**A separate `commitEdit()` — do not reuse `commit()`.** Three lines in the
existing `commit()` (`:50-72`) are harmless when creating and destructive when
patching:

- `haltbarkeit` is one field writing **both** `haltbarkeitMax` and
  `haltbarkeitAktuell` — editing a sword at 40/100 would reset it to 100/100.
  Edit mode needs the two-field treatment `ItemChip` already uses
  (`Ausruestung.tsx:292-309`).
- `containerArt: 'quick'` and `kapazitaetArt: 'stueck'` are written
  **unconditionally** — patching a storage backpack would convert it.
- `istBehaelter: ausr && quickslots > 0` would clear the flag on a storage
  container.

`commitEdit()` builds a conditional patch touching only what the dialog actually
edits. Fields the dialog never shows (`location`, `zone`, `beidseitig`,
`containerUid`, `uid`, `id`) survive because `patchItem` merges (`{...it, ...patch}`).

Title and primary-button copy swap on mode (currently hard-coded at `:78` / `:86`).

**Bonus rows editor.** A new block wrapped in `.dlg-fade-group` +
`.dlg-group-label` (the existing device for an optional extra field group,
`styles.css:3295-3307`), built on the `.cat-editor` / `.cat-row` pattern from
`client/src/pages/Einstellungen.tsx:500-527` — div-based, raw `<input>`,
`ConfirmDeleteButton` per row, capped add button. That is the closest existing
match to "add row / remove row / two fields per row" and its CSS is three rules
(`styles.css:3328-3341`).

Per row: one grouped `<select>` whose value encodes kind and code together
(`attr:MU`, `baseValue:at`, `resource:le`, `talent:42`) under four `<optgroup>`s
(Attribut / Basiswert / Energie / Talent), then a `feld` `<select>` shown **only**
when kind is `talent`, then a number input, then delete. Talent options come from
`catalogs.talents`, so the dialog needs that passed in.

**CSS caveat:** `.dialog-panel` is `max-width: 420px` and `.dialog-body` has **no
`max-height` / `overflow-y`** (`styles.css:3149-3203`) — an unbounded list would
grow the panel off-screen. Add `max-height` + `overflow-y: auto` to
`.dialog-body`, and scope `.cat-row input { width: 18em }` down for the dialog.

### 3b. Ausrüstung — `client/src/tabs/Ausruestung.tsx`

- **Shrink `.chip-editor`** (`:286-349`) to the high-frequency fields only:
  Anzahl and Haltbarkeit-aktuell. Everything else (Name, RS, Haltbarkeit-max,
  Beidseitig, container fields, Notiz) moves to the dialog.
  **Caution:** `.chip-editor` is deliberately shared with `WaffenNeu.tsx`'s weapon
  cards (`styles.css:5027, 5133-5182`) — change the JSX here, not the shared CSS.
- **Add a second `.chip-btn`** next to the existing one (`:280-284`), gated the
  same `{!ro && …}` way using the `ro` prop already threaded in at `:39`. No new
  CSS — `.chip-btn` already covers it.
- **State** `const [editUid, setEditUid] = useState<string | null>(null)`,
  the same "which target is the dialog open for" shape as `Inventar.tsx`'s
  `addItemFor` (`:44`). Mount the dialog with
  `open={editUid !== null}` and `onSubmit={(patch) => patchItem(editUid!, patch)}`.
- **Bonus marker on the chip**: a `.chip-bonus` span (styled like the existing
  `.chip-rs`) shown when `item.bonusse.length > 0`, with the list in its `title`.

### 3c. Inventar — `client/src/tabs/Inventar.tsx`

Same dialog, reachable from here too, so a ring's bonus can be set before it is
ever worn. Add a per-row "Bearbeiten" button; this means **bumping `cols`**
(`:130`, currently `ro ? 6 : 7`) and adding a matching `<col>` to the `colgroup`
(`:119-129`) — every `colSpan` in the file derives from `cols`.

### 3d. Showing that a value is item-derived

A small shared component (e.g. `client/src/components/BonusWert.tsx`) rendering
the effective number plus a marker span carrying `title={quellen.join(', ')}`,
used by Heldenbrief's attribute / basiswerte / resource tables, the Talente
tables, and `SidebarPools`. One new `.bonus-mark` CSS rule, tinted with
`var(--accent)` like `.chip-rs`.

---

## 4. Sequencing

One coherent change per commit (functional work, so it commits as it lands —
`CLAUDE.md`):

1. `diceSource.ts` mod fix (section 0) — standalone, own changelog `fixed` line.
2. `ItemBonus` type, `char_item_bonuses` table, load/save, type touch points.
3. `wornBoni` + the four derive helpers + unit tests — pure, no callers yet.
4. Dialog edit mode + bonus rows editor.
5. Ausrüstung + Inventar wiring (chip-editor shrink, Bearbeiten buttons, marker).
6. Client compute wiring (3 sites) + `BonusWert` display.
7. Server compute wiring (4 sites).
8. Docs: `TODO.md` prune + changelog.

Steps 3 and 4 are independent and can land in either order.

**Adjacent, deliberately not included:** the separate `[ready]` TODO item
"Create equipment directly in the Ausrüstung tab" becomes nearly free once the
dialog is mounted there in step 5 (one `!ro`-gated "+ Gegenstand" button seeding
`location: 'bench'`). Worth doing right after, but it is its own entry and its
own commit.

---

## 5. Verification

**Automated**

```bash
npm test
```

```bash
npx tsc --noEmit -p server/tsconfig.json
```

New unit tests in `shared/test/items.test.ts` (the `item()` fixture at `:40-55`
already exists): boni sum across several worn items; a non-`getragen` item
contributes nothing; negative values subtract; `quellen` names the right items;
`resourceInputMitBoni` raises `nutzbar` (the both-slots rule); `talentMitBoni`
leaves the stored talent untouched.

**Manual end-to-end** — run `npm run dev:server` + `npm run dev:client`, and per
the project's own note, test two roles at once by using `localhost` for one and
`[::1]` for the other (separate cookie jars, one origin per role):

1. Create a ring in Inventar with a `+1 MU` bonus → **not** worn yet: Heldenbrief
   MU unchanged.
2. Drag it to a body zone → MU shows the effective value with the marker, tooltip
   names the ring. Sidebar agrees.
3. Roll a talent whose probe uses MU in the dice panel → the rolled `probeZahl`
   matches the sheet (this exercises `diceSource.ts`).
4. Add a `+2 LE` bonus, fill LE to the new max, then unequip → confirm `aktuell`
   clamps sanely and nothing is silently zeroed (the `saveSection` path).
5. Edit a **storage container** through the dialog → confirm it stays a storage
   container and its capacity unit is unchanged (the `commit()` landmines).
6. Edit an item with partial durability → confirm current durability is not reset
   to max.
7. As GM, open the group overview → bonused vitals show; open another player's
   character (summary access) → their bonused values show.
8. Flip the sheet to read-only → "Bearbeiten" buttons disappear, drag still works.

**Data safety** — verify the new table against a throwaway DB before touching the
dev database (`HELDEN_DB` pointed at a scratch file, then `npm run seed`), and
note the standing warning in `TODO.md`: pointing `HELDEN_DB` at an empty DB while
`HELDEN_ASSETS_DB` still points at the real one makes the asset sweeper wipe real
assets on startup. Point **both** at scratch files or neither.

---

## 6. Docs

- **`TODO.md`**: remove the "Editing dialogs for items/weapons/abilities, with
  item bonuses while worn" entry's item-bonus half and its plumbing plan; keep
  the weapons/abilities dialog half as the remaining open work, re-tagged to
  reflect that the item dialog pattern now exists as precedent.
- **Changelog** (`shared/src/changelog.ts`): the top entry is already versioned
  (`0.6.0`), so per the working agreement this needs a **fresh draft entry above
  it** with today's date and **no `version` field** (an unversioned entry is
  invisible to players and unmirrored to Discord until someone numbers it).
  Bullets: `added` for item bonuses and the edit dialog, `fixed` for the weapon-
  probe mod discrepancy from section 0.
- **Version**: this is a new player-facing capability (players must learn a new
  concept), so it argues for a **minor** bump when released — but assigning the
  number is the developer's call, never mine.
