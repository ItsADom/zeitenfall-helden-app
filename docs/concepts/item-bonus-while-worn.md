# Item edit dialog + "Bonus while worn" — build plan

Approved build plan from a planning session (2026-08-21), revised 2026-08-28
against the current tree. Not yet implemented — see `TODO.md`'s Mid-Prio entry
"Editing dialogs for items/weapons/abilities, with item bonuses while worn",
which stays the source of truth for readiness tag and status until this lands.
Kept as a separate file because the plan is long enough (a general calculation
rule, data model, compute plumbing across ~10 call sites, UI layer, sequencing,
verification) that it doesn't fit inline in `TODO.md`.

---

## Context

Player feedback asked for two things that turned out to be one initiative:

1. **Item bonuses while carried** — a worn item (a ring, an amulet, a masterwork
   tool) should actually raise the stat it buffs, instead of the player doing the
   arithmetic by hand. No equip-effect mechanism exists anywhere today; the one
   precedent, `effektiverRs()` (`shared/src/items.ts:206`), is hardcoded to pull
   only `rs` from worn items.
2. **Leave inline table editing behind for items** — an item can carry *several*
   bonuses, and a repeatable list of target+amount rows does not fit the chip /
   inline-cell editing style. The dialog is not decoration; it is what makes the
   feature buildable.

**Scope of this plan: items only.** The same dialog treatment for weapons
(`WaffenNeu.tsx`) and abilities (`AbilityManager.tsx`) is tracked in the same
TODO entry and gets its own plan once the pattern is proven here.

Decisions already taken:

- Bonuses apply **only while `location === 'getragen'`**, matching `effektiverRs()`.
- **Structured** target + amount, not free-form text.
- **Multiple bonuses per item** — hence the dialog.
- Targets cover **attributes, TaW/AT/PA/BL, base values, resources, special
  energies, Psyche and Traglast** (the last three added 2026-08-28).
- Same-target bonuses from several worn items **sum** (no max-only cap like `rs`).
- Grouped `<select><optgroup>` picker — no new combobox component.
- **Hybrid editing**: Anzahl / Haltbarkeit-aktuell / duplicate / delete / drag
  stay inline; structural fields plus the bonus list move into a dialog.
- Effective values render with a **marker + tooltip naming the contributing items**.
- Bonuses **flow into dice rolls**, not just the displayed number.
- **A resource bonus raises the maximum, never `aktuell`** (2026-08-28).

### Already done since the first draft — do not re-do

- **The `diceSource` mod fix** (originally section 0 of this plan) landed as
  `a7326c6` on 2026-08-21. `diceSource.ts` now resolves everything from
  `computeBaseValues(...).ergebnis` (`:99`, `:192`, `:205`), the same numbers the
  sheet shows. No prerequisite commit, no changelog line for it.
- **The `.dialog-body` scroll caveat** is fixed: `.dialog-body`
  (`styles.css:3404`) has `overflow-y: auto` + `min-height: 0` and
  `.dialog-panel` has `max-height: 100%`. A `.dialog-panel--wide` (760px) opt-in
  now exists too, and is probably what the bonus editor wants.
- **"Create equipment directly in the Ausrüstung tab"** landed as `8b520d4`.
  `AddItemDialog` is already mounted at `Ausruestung.tsx:263` behind
  `addItemOpen` — the edit-mode mount has a local pattern to copy.

---

## 1. The general rule: always calculate with full values

**Every calculation reads the complete, bonus-inclusive value unless the rule
being implemented explicitly says otherwise.** This is a standing rule for the
whole app, not a detail of this feature. It exists because the feature exposed
two bugs that predate it and share one cause — a code path that pulled a raw
stored number where the sheet shows a derived one:

- `diceSource.ts` rolled weapon probes off the raw base value while the sheet
  displayed base + mod (fixed in `a7326c6`).
- `board.ts:653 characterCombatStats` still computes the VTT initiative basis
  and Todesschwelle from un-bonused inputs; `overviewForChars`
  (`characterData.ts:1952`) still reports `sr.max` for special energies — the
  stored snapshot that `SpecialResource`'s own doc comment says is *not* the
  source of truth once the catalog entry carries a formula.

Both are wrong today, before a single item bonus exists. Adding boni on top of
scattered raw reads would multiply that class of bug across every new target, so
**this plan closes the pattern rather than adding to it.** Concretely:

### Server: one loader, and raw reads that say they are raw

Add to `characterData.ts`:

```ts
export interface CharStats {
  attrs: Attributes;              // mit Boni
  baseInputs: BaseValueInputs;    // mods mit Boni
  resources: Resources;           // maxPlus/permanent mit Boni
  special: SpecialResource[];     // bonus mit Boni
  talente: CharTalent[];          // taw/at/pa/bl mit Boni
  psycheBonus: number;            // gespeichert + Item
  traglastBonus: number;          // gespeichert + Item
  boni: StatBoni;                 // nur für Herkunft/Tooltips
}
export function loadStats(charId: number): CharStats;
```

Then **rename the raw loaders** — `loadAttributes` → `loadAttributesRaw`,
`loadBaseValueInputs` → `loadBaseValueInputsRaw`, `loadResources` →
`loadResourcesRaw`. TypeScript then points at every existing caller and each one
gets consciously classified: a save/edit path keeps the raw loader, a
calculation path moves to `loadStats`. That is the type-level safety net this
plan used to get for free from a required `Item` field (see section 2, it no
longer does), and it is what stops the *next* `board.ts` from happening.

### Client: one derived object on the context, `data` stays raw

`CharCtx` (`Character.tsx:152`) gains a memoized `stats` alongside `data`, built
once from `data.items`. Reads go through `stats`; **editing keeps binding to
`data`** — layered for display, never written back, the same non-destructive
contract `attrMax` already has with `akt`/`mod`. Every consumer then destructures
`const { data, stats } = useChar()` instead of computing its own.

### Bonus fields are additive, never overwritten

`psycheBonus`, `traglastBonus` and `SpecialResource.bonus` are **player-editable
stored fields**. Item boni are added on top when reading; a write into any of
them would destroy what the player typed. Same rule as `attrs.mod`.

---

## 2. Data model

### `ItemBonus` (new, `shared/src/items.ts`)

Seven key-spaces with no shared type today, so a discriminated union rather than
one flat string enum:

```ts
export type ItemBonusKind =
  | 'attr'       // code = AttrCode
  | 'baseValue'  // code = BaseValueKey
  | 'resource'   // code = ResourceKey (le | aus | ase)
  | 'talent'     // code = talentId, feld = taw | at | pa | bl
  | 'spezial'    // code = special_energies_catalog.id
  | 'psyche'     // code = '' (Einzelwert)
  | 'traglast';  // code = '' (Einzelwert, kg)
export const ITEM_BONUS_KINDS = [...] as const;
export type TalentBonusFeld = 'taw' | 'at' | 'pa' | 'bl';

export interface ItemBonus {
  kind: ItemBonusKind;
  code: string;               // je nach kind, leer bei psyche/traglast
  feld: TalentBonusFeld | ''; // nur bei kind === 'talent'
  wert: number;               // darf negativ sein (verfluchte Gegenstände)
}
```

`Item` gains one field: `bonusse: ItemBonus[]`. Negative values are allowed
deliberately — a cursed item is the same mechanism.

**Where each target lands** (all additive, all on top of the stored value):

| kind | Fold into | Note |
|---|---|---|
| `attr` | `attrs[code].mod` | every formula reads through `attrMax`, so it ripples |
| `baseValue` | `baseInputs.mods[code]` | covers all 12 keys incl. `ini`, `todesschwelle`, `gs` |
| `resource` | `permanent` (+ `maxPlus`, see below) | never `aktuell` |
| `talent` | the talent row's `taw`/`at`/`pa`/`bl` | display-only copy, stored value untouched |
| `spezial` | `SpecialResource.bonus` | **only meaningful when the catalog entry has a formula** — see caveat |
| `psyche` | the `bonus` argument of `psycheMax(attrs, base, bonus)` | |
| `traglast` | the `bonus` argument of `lastInfo(items, attrs, bonus)` | kg; `lastInfo` already receives `items` |

**Special-energy caveat.** `SpecialResource.bonus` is only used when the catalog
entry carries a formula; without one, `max` is free-edited by the player and
`bonus` is unused (`types.ts:130-155`). So the `spezial` optgroup must offer
**only catalog entries that have a formula** — a bonus on a formula-less energy
would silently do nothing. The `SpecialResource.bonus` doc comment already
anticipates exactly this feature ("ein Talent/Gegenstand, der NUR diese eine
Energie anhebt"), so the slot is the intended one.

**Resource bonuses raise the maximum only.** A `+2 LE` ring raises what the
player can fill up to; it never heals 2 points into `aktuell`. Today
`computeResource` derives `ergebnis = vor + raceBase + permanent + kauf` (the
actual pool) and `max = … + kaufMax + maxPlus` (the Ausbaugrenze), with
`nutzbar = min(ergebnis, max)`. **The bonus belongs in `permanent`** — the pool
side, which is the side that survives. While the Ausbaugrenze still exists the
same value must also go into `maxPlus`, or the cap eats the bonus; that second
write is **temporary scaffolding, to be deleted together with the hard caps**
(planned) and needs a comment saying so. Do not build the feature around the cap.

### Storage: new child table

Follow the `char_pouches` → `char_pouch_coins` precedent (`db.ts:324`,
`characterData.ts:935-999`), **not** the JSON-in-TEXT shape of
`char_abilities.kategorien` — whose cost is visible where a rename must load,
parse, rewrite and re-stringify every row.

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

`db.pragma('foreign_keys = ON')` (`db.ts:13`) is confirmed, so the cascade fires.
Keyed on `char_items.id` (fresh `lastInsertRowid`), exactly like
`char_pouch_coins` keys on the pouch rowid — **not** on `uid`. `saveItems`
already DELETE-all-then-reinserts in one transaction, so children die by
`ON DELETE CASCADE` and are re-inserted against the new rowid in the same pass.

### Load / save — `server/src/characterData.ts`

- `loadItems` (`:792`): second query for all bonus rows of the character's items,
  grouped into a `Map<number, ItemBonus[]>` in JS — same two-query-then-group
  shape as `loadPouches` (`:935`). Validate `kind` against `ITEM_BONUS_KINDS` and
  coerce `wert` via `Number()`, mirroring how `loadItems` already re-validates
  `ITEM_LOCATIONS` / `CONTAINER_ARTEN` / `KAPAZITAET_ARTEN`.
- `saveItems` (`:852`): capture `Number(ins.run(...).lastInsertRowid)` and insert
  bonus rows with `pos = index`, following `savePouches` (`:966`). Add
  `MAX_BONUSSE_PRO_ITEM` (~20) next to the existing `MAX_ITEMS` / `MAX_ITEM_TEXT`
  caps (`:782-783`); drop rows failing validation rather than throwing, matching
  how `savePouches` skips stale FK targets.
- **No route change** — `PUT /api/characters/:id/items` already ships the whole
  array, and `update('items', …)` already sends everything.

### Type-completeness touch points

`makeItem()` (`shared/src/items.ts:120`) now centralizes construction, so a
required new field **no longer** makes TypeScript point at every literal — it
points at four places: `makeItem` itself, `characterData.ts:544` and `:603`
(migration constructors), `itemDialogs.tsx:63`, and the `item()` fixture at
`shared/test/items.test.ts:53`. Each gets `bonusse: []`. The real safety net for
this feature is the loader rename in section 1, not the `Item` field.

`duplicateItem()` (`items.ts:133`) spreads, so a duplicate carries its bonuses.
That is correct behaviour — assert it in a test so nobody "fixes" it.

---

## 3. Compute plumbing

### The core trick: derive, don't re-plumb

`rules.ts` needs **no signature changes at all**. Every formula already reads
attributes through one choke point (`attrMax`, `rules.ts:16`), base values
already carry a per-key mod record, and Psyche / Traglast / special energies each
already take an additive `bonus` argument. So each call site swaps its *inputs*
for a derived copy with boni folded into the existing slots.

Pure functions in `shared/src/items.ts`, next to `effektiverRs()`:

```ts
export interface StatBoni {
  attrs:      Partial<Record<AttrCode, number>>;
  baseValues: Partial<Record<BaseValueKey, number>>;
  resources:  Partial<Record<ResourceKey, number>>;
  spezial:    Record<number, number>;   // catalog_id -> Summe
  psyche:     number;
  traglast:   number;
  talente:    Record<number, Partial<Record<TalentBonusFeld, number>>>;
  quellen:    Record<string, string[]>; // Zielschlüssel -> Item-Namen (Tooltip)
}

export function wornBoni(items: readonly Item[]): StatBoni;
export function attrsMitBoni(attrs: Attributes, b: StatBoni): Attributes;
export function baseInputsMitBoni(inputs: BaseValueInputs, b: StatBoni): BaseValueInputs;
export function resourceInputMitBoni(input: ResourceInput, key: ResourceKey, b: StatBoni): ResourceInput;
export function specialMitBoni(sr: SpecialResource, b: StatBoni): SpecialResource;
export function talentMitBoni(talent: CharTalent, b: StatBoni): CharTalent;
```

`wornBoni` filters to `location === 'getragen'` and **sums** same-target rows,
collecting `quellen` in the same pass so the tooltip needs no second walk. All
pure, all taking `readonly Item[]`, matching the module's existing style.

**The type is deliberately named `StatBoni`, not `WornBoni`, and the accumulator
is deliberately separate from the item-only producer.** `docs/concepts/perk-trees.md`
(lines 72-88) plans to reuse this exact target union — "the only difference is
the condition" — so `wornBoni(items)` is one producer of a `StatBoni`, and a
future `perkBoni(perks)` is another, merged by a `mergeBoni()`. Renaming across
~10 call sites later is the thing being avoided; the shape costs nothing now.
Perks additionally want `talent-kat` (a whole category) and `talent-frei` (a
stored allocation), which this plan does **not** build — they extend the union
when perks get built.

### Client — the context does it once

`Character.tsx`'s `CharCtx` computes `stats` (section 1) from `data.items` and
exposes it. Consumers then read `stats` instead of recomputing:

- `client/src/tabs/Heldenbrief.tsx` — five spots, not two: `:168` (`bv`),
  `:231-236` (`energyFormulaVars`, three `computeResource` calls plus
  `psycheMax`), `:433` (resource table), `:487` (Psyche row), `:587`
  (`evaluateEnergyFormula` for special energies).
- `client/src/components/CharacterSidebar.tsx:135` (`SidebarPools`) — resources
  at `:153` and `psycheMax` at `:139`.
- `client/src/tabs/WaffenNeu.tsx:62` — derived attrs/inputs, plus `talentMitBoni`
  on the talent looked up in `probesFor` / `fkProbeFor`.
- `client/src/tabs/Zauber.tsx:52` — `psycheMax`.
- `client/src/tabs/Ausruestung.tsx:144` — `lastInfo(items, attrs, traglastBonus)`
  gains the item traglast bonus. It already receives `items`, so it can fold its
  own boni internally; do it there so every caller gets it.
- `client/src/tabs/Talente.tsx` — shows effective values through `talentMitBoni`
  while **the input still binds to the stored raw value**.

`client/src/tabs/Waffen.tsx:11` also calls `computeBaseValues` but nothing
imports the file — confirm it is dead and delete it rather than wiring it.

### Server — six sites, all through `loadStats`

Once section 1's `loadStats` exists, each site is a one-line swap. Sites that
must be migrated:

| Site | File | What changes |
|---|---|---|
| `saveSection`, `resources` branch | `characterData.ts:1571-1600` | Clamp `aktuell` against the **bonus-aware** `nutzbar` |
| `buildSummary` | `characterData.ts:1802` | Derived inputs for attribute / basiswerte / ressourcen / spezial / psyche / talente / waffen |
| `overviewForChars` | `characterData.ts:1915` | Derived inputs in the per-character loop. **Also fix the pre-existing bug at `:1952`**: it reports `sr.max`, the stored snapshot, instead of the live formula maximum |
| `computeProbeForCharacter` | `diceSource.ts:120-215` | Six branches now (attribute / talent / ability / sprache / weapon / baseValue), not two lines. The `ability` branch carries a weapon term |
| `characterCombatStats` | `board.ts:653` | **Currently wrong** — VTT initiative basis and Todesschwelle are un-bonused. `lp` reads `resources.le.aktuell`, a *current* value, which boni correctly do not touch |
| `chatAttrResolver` | `ws.ts:621` | Typing `MU` in a free `/r` roll resolves via `attrMax` on raw attrs. Boni apply, same as a talent probe — otherwise the two disagree |

**The `saveSection` clamp is not optional.** If boni raise a resource's maximum
and the clamp doesn't know, a player wearing a bonus item can never save
`aktuell` above the un-bonused ceiling — data-loss-shaped, not a display glitch.
(The reverse direction, `aktuell` dropping when the item comes off, is correct
game behaviour: the buffer is gone.) This clamp goes away with the hard caps.

Wiring `computeProbeForCharacter` also fixes the GM's "Probe anfordern" list for
free, since `listRollableProbes` (`diceSource.ts:230+`) reuses it.

---

## 4. UI layer

### 4a. Dialog gains edit mode — `client/src/components/itemDialogs.tsx`

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
existing `commit()` (`:61-70`) are harmless when creating and destructive when
patching:

- `haltbarkeit` is one field writing **both** `haltbarkeitMax` and
  `haltbarkeitAktuell` — editing a sword at 40/100 would reset it to 100/100.
  Edit mode needs the two-field treatment `ItemChip` already uses
  (`Ausruestung.tsx:331-347`).
- `containerArt: 'quick'` and `kapazitaetArt: 'stueck'` are written
  **unconditionally** — patching a storage backpack would convert it.
- `istBehaelter: ausr && quickslots > 0` would clear the flag on a storage
  container.

`commitEdit()` builds a conditional patch touching only what the dialog actually
edits. Fields the dialog never shows (`location`, `zone`, `beidseitig`,
`containerUid`, `uid`, `id`) survive because `patchItem` merges (`{...it, ...patch}`).

Title and primary-button copy swap on mode (currently hard-coded).

**Bonus rows editor.** A new block wrapped in `.dlg-fade-group` +
`.dlg-group-label` (the existing device for an optional extra field group,
`styles.css:3512-3520`), built on the `.cat-editor` / `.cat-row` pattern from
`client/src/pages/Einstellungen.tsx:572-600` — div-based, raw `<input>`,
`ConfirmDeleteButton` per row, capped add button. That is the closest existing
match to "add row / remove row / two fields per row" and its CSS is three rules
(`styles.css:3557-3570`).

Per row: one grouped `<select>` whose value encodes kind and code together
(`attr:MU`, `baseValue:at`, `resource:le`, `talent:42`, `spezial:7`, `psyche:`,
`traglast:`) under six `<optgroup>`s (Attribut / Basiswert / Energie /
Spezialenergie / Talent / Sonstiges), then a `feld` `<select>` shown **only** when
kind is `talent`, then a number input, then delete. Talent options come from
`catalogs.talents` and special-energy options from `catalogs.specialEnergies`
**filtered to entries with a formula** (see section 2), so the dialog needs both
passed in.

The bonus row is wide; consider `Dialog`'s existing `wide` prop
(`.dialog-panel--wide`, 760px) rather than fighting the 420px default. Scope
`.cat-row input { width: 18em }` down for the dialog either way.

### 4b. Ausrüstung — `client/src/tabs/Ausruestung.tsx`

- **Shrink `.chip-editor`** (`:327-383`) to the high-frequency fields only:
  Anzahl and Haltbarkeit-aktuell, plus the existing duplicate and delete buttons.
  Everything else (Name, kg/St., RS, Haltbarkeit-max, Behälter-Felder, Notiz)
  moves to the dialog.
  **Caution:** `.chip-editor` is deliberately shared with `WaffenNeu.tsx`'s weapon
  cards — change the JSX here, not the shared CSS.
- **Add a second `.chip-btn`** next to the existing one (`:320-324`), gated the
  same `{!ro && …}` way using the `ro` prop already threaded in at `:276`. No new
  CSS — `.chip-btn` already covers it.
- **State** `const [editUid, setEditUid] = useState<string | null>(null)`, the
  same shape as the `addItemOpen` state already at `:49`. Mount a second
  `AddItemDialog` (or reuse the one at `:263` with an `item` prop) with
  `open={editUid !== null}` and `onSubmit={(patch) => patchItem(editUid!, patch)}`.
- **Bonus marker on the chip**: a `.chip-bonus` span (styled like the existing
  `.chip-rs` at `styles.css:3116`) shown when `item.bonusse.length > 0`, with the
  list in its `title`.

### 4c. Inventar — `client/src/tabs/Inventar.tsx`

Same dialog, reachable from here too, so a ring's bonus can be set before it is
ever worn. Add a per-row "Bearbeiten" button; this means **bumping `cols`**
(`:129`, currently `ro ? 6 : 7`) and adding a matching `<col>` to the `colgroup`
(`:118-127`) — every `colSpan` in the file derives from `cols`.

### 4d. Showing that a value is item-derived

A small shared component (e.g. `client/src/components/BonusWert.tsx`) rendering
the effective number plus a marker span carrying `title={quellen.join(', ')}`,
used by Heldenbrief's attribute / basiswerte / resource / Psyche /
Spezialenergie tables, the Talente tables, the Traglast readout, and
`SidebarPools`. One new `.bonus-mark` CSS rule, tinted with `var(--accent)` like
`.chip-rs`. It sits next to the existing `MaximumWert.tsx`, which already does
the "show a derived number with an explanatory title" job for the Ausbaugrenze.

---

## 5. Sequencing

One coherent change per commit (functional work, so it commits as it lands —
`CLAUDE.md`):

1. **`loadStats` + the raw-loader rename** (section 1), migrating the existing
   server sites to it. Fixes `board.ts` and `overviewForChars`' special-energy max
   on its own, before any bonus exists — own commit, own `fixed` changelog lines.
2. `ItemBonus` type, `char_item_bonuses` table, load/save, type touch points.
3. `StatBoni` + `wornBoni` + the derive helpers + unit tests — pure, no callers yet.
4. Dialog edit mode + bonus rows editor.
5. Ausrüstung + Inventar wiring (chip-editor shrink, Bearbeiten buttons, marker).
6. Client `stats` on `CharCtx` + `BonusWert` display.
7. Server bonus wiring (feed `wornBoni` into `loadStats`).
8. Docs: `TODO.md` prune + changelog.

Step 1 is worth doing even if the rest slips — it is a bug fix, not scaffolding.
Steps 3 and 4 are independent and can land in either order.

### Interaction with other planned work

- **Group ↔ player inventory** (`TODO.md`, Mid-Prio). That entry replaces
  `char_items.character_id` with an `owner_type`/`owner_id` pair. SQLite cannot
  alter a foreign key in place — that is a full table rebuild, and with
  `foreign_keys = ON` dropping `char_items` cascades every `char_item_bonuses`
  row away. Either land the owner generalization **first**, or write its
  migration to carry the children across (`db.ts:791` already does the
  `foreign_keys = OFF` dance for another migration). Second, that entry wants a
  per-item cross-owner transfer primitive to replace the whole-array reinsert
  this plan's insert path leans on — a transfer that moves a row without its
  bonus rows is a data-loss bug. Rules-wise there is no conflict: an owner change
  resets `location` to `inventar`, and boni only fire at `getragen`, so a
  group-owned item grants nobody anything.
- **Perk trees** (`docs/concepts/perk-trees.md`) — reuses this target union
  wholesale; see the `StatBoni` naming note in section 3.
- **Hard caps going away** — removes the `maxPlus` half of the resource write and
  the `saveSection` clamp (sections 2 and 3). Both are marked in-code as temporary.
- **Containers: bench-exclusion cascade** (`TODO.md`) touches `zaehltZurLast` /
  `itemLastAnteil` in the same file but a different function — no conflict.

---

## 6. Verification

**Automated**

```bash
npm test
```

```bash
npx tsc --noEmit -p server/tsconfig.json
```

New unit tests in `shared/test/items.test.ts` (the `item()` fixture at `:38-56`
already exists): boni sum across several worn items; a non-`getragen` item
contributes nothing; negative values subtract; `quellen` names the right items;
`resourceInputMitBoni` raises the maximum and leaves `aktuell` alone;
`talentMitBoni` leaves the stored talent untouched; `duplicateItem` carries
bonuses; a `spezial` bonus on a formula-less catalog entry is rejected at the
picker.

**Manual end-to-end** — run `npm run dev:server` + `npm run dev:client`, and per
the project's own note, test two roles at once by using `localhost` for one and
`[::1]` for the other (separate cookie jars, one origin per role):

1. Create a ring in Inventar with a `+1 MU` bonus → **not** worn yet: Heldenbrief
   MU unchanged.
2. Drag it to a body zone → MU shows the effective value with the marker, tooltip
   names the ring. Sidebar agrees.
3. Roll a talent whose probe uses MU in the dice panel → the rolled `probeZahl`
   matches the sheet. Type `MU` as a free roll → same number (`ws.ts`).
4. Add a `+2 LE` bonus, fill LE to the new max, then unequip → confirm `aktuell`
   clamps sanely and nothing is silently zeroed (the `saveSection` path).
5. Add a `+1 INI` bonus, place the character's token on the VTT and roll
   initiative → the basis matches the sheet (`board.ts`).
6. Add a bonus on a formula-driven special energy and on Psyche → both maxima
   rise on the sheet and in the GM overview.
7. Add a `+5 kg` Traglast bonus → the Ausrüstung load bar reflects it.
8. Edit a **storage container** through the dialog → confirm it stays a storage
   container and its capacity unit is unchanged (the `commit()` landmines).
9. Edit an item with partial durability → confirm current durability is not reset
   to max.
10. As GM, open the group overview → bonused vitals show; open another player's
    character (summary access) → their bonused values show.
11. Flip the sheet to read-only → "Bearbeiten" buttons disappear, drag still works.

**Data safety** — verify the new table against a throwaway DB before touching the
dev database (`HELDEN_DB` pointed at a scratch file, then `npm run seed`), and
note the standing warning in `TODO.md`: pointing `HELDEN_DB` at an empty DB while
`HELDEN_ASSETS_DB` still points at the real one makes the asset sweeper wipe real
assets on startup. Point **both** at scratch files or neither.

---

## 7. Docs

- **`TODO.md`**: remove the "Editing dialogs for items/weapons/abilities, with
  item bonuses while worn" entry's item-bonus half and its plumbing plan; keep
  the weapons/abilities dialog half as the remaining open work, re-tagged to
  reflect that the item dialog pattern now exists as precedent.
- **Changelog** (`shared/src/changelog.ts`): fold player-facing notes into the
  top unversioned entry per `CLAUDE.md`. `added` for item bonuses and the edit
  dialog; `fixed` for the step-1 bugs (VTT initiative basis ignored base-value
  modifiers, GM overview showed a stale maximum for formula-driven special
  energies). Versioning is deliberately out of scope for this plan — it depends on
  when the work actually lands.
