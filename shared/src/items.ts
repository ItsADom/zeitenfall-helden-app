// Einheitliches Gegenstands-Modell (Cluster 5).
//
// Jeder Besitz ist EIN Item. Wo es liegt (`location`, dazu `zone`/`containerUid`)
// entscheidet, welcher Reiter es zeigt — es gibt KEIN „Ausrüstung"-Flag:
//   getragen   am Körper (welche Stelle sagt `zone`)            → Ausrüstung
//   bench      abgelegt, „gerade nicht getragen"                → Ausrüstung
//   behaelter  in einem Behälter (welcher sagt `containerUid`)  → Inventar (Stauraum)
//                                                                  bzw. inline bei Schnellzugriff-Behältern
//   inventar   mitgeführt an oberster Stelle (Behälter selbst;  → Inventar
//              plus ein loser Alt-Topf aus der Migration)
import type { AttrCode, Attributes, BaseValueInputs, BaseValueKey, CharTalent, ResourceInput, ResourceKey, SpecialResource } from './types.js';
import { ATTR_ROW_CODES } from './types.js';
import { maximaleLast } from './rules.js';

export type ItemLocation = 'inventar' | 'getragen' | 'behaelter' | 'bench';
export const ITEM_LOCATIONS: ItemLocation[] = ['inventar', 'getragen', 'behaelter', 'bench'];

// Art eines Behälters entscheidet, WO sein Inhalt erscheint:
//   quick    Schnellzugriff (Gürtel, Bandelier) — Inhalt inline in der Ausrüstung
//   storage  Stauraum (Rucksack, Tasche)        — Inhalt im Inventar
export type ContainerArt = 'quick' | 'storage';
export const CONTAINER_ARTEN: ContainerArt[] = ['quick', 'storage'];

// Womit ein Behälter sein Fassungsvermögen misst:
//   gewicht  Kapazität in kg — der übliche Fall (Rucksack, Gürteltasche).
//   stueck   Kapazität in Stück (Summe der `anzahl` der Inhalte) — für Behälter,
//            bei denen die Anzahl zählt statt das Gewicht (Köcher, Münzbeutel,
//            aber auch Schnellzugriff-Behälter/„Quickslots", `containerArt ===
//            'quick'`). Bei Stauraum-Behältern (`containerArt === 'storage'`)
//            zählt der Inhalt dabei automatisch NICHT zur Traglast (siehe
//            itemLastAnteil) — eine eigene Gewichtsreduktion ist dafür unnötig.
//            Bei Schnellzugriff-Behältern gilt das NICHT: ihr Inhalt zählt voll
//            (siehe itemLastAnteil) — hier misst „stueck" nur die Fach-Anzahl,
//            keine Gewichtslosigkeit.
export type KapazitaetArt = 'gewicht' | 'stueck';
export const KAPAZITAET_ARTEN: KapazitaetArt[] = ['gewicht', 'stueck'];

// Körperzonen für getragene Ausrüstung. Arme/Hände/Beine sind seitengetrennt
// (Spieler-Entscheidung 2026-08-10) — eine Zone ist KEIN Einzelfach, sondern
// eine Liste: an „Arm links" dürfen Armschiene UND Armreif zugleich liegen.
export const BODY_ZONES = [
  'Kopf',
  'Hals',
  'Brust',
  'Rücken',
  'Arm links',
  'Arm rechts',
  'Hand links',
  'Hand rechts',
  'Gürtel',
  'Bein links',
  'Bein rechts',
  'Füße',
] as const;
export type BodyZone = (typeof BODY_ZONES)[number];

// Bonus, den ein Gegenstand verleiht, solange er getragen wird (location ===
// 'getragen', siehe wornBoni in Kürze) — sieben Zielräume ohne gemeinsamen
// Schlüsseltyp heute, daher eine Discriminated Union statt eines flachen
// Strings. `code` bedeutet je nach `kind` etwas anderes:
//   attr       AttrCode (MU/KL/…)
//   baseValue  BaseValueKey (at/pa/bl/…)
//   resource   ResourceKey (le/aus/ase) — hebt NUR das Maximum an, nie `aktuell`
//   talent     talentId (aus talents_catalog); WELCHE Spalte sagt `feld`
//   spezial    special_energies_catalog.id — wirkt nur, wenn der Katalog-
//              Eintrag eine Formel trägt (siehe SpecialResource), sonst tote Zeile
//   psyche     kein Ziel-Code nötig, code bleibt ''
//   traglast   kein Ziel-Code nötig, code bleibt '' — wert in kg
// Negative Werte sind erlaubt (ein verfluchter Gegenstand ist derselbe Mechanismus).
export type ItemBonusKind = 'attr' | 'baseValue' | 'resource' | 'talent' | 'spezial' | 'psyche' | 'traglast';
export const ITEM_BONUS_KINDS: ItemBonusKind[] = ['attr', 'baseValue', 'resource', 'talent', 'spezial', 'psyche', 'traglast'];

// Nur bei kind === 'talent' relevant: was der Bonus trifft. Kampftalente
// führen TaW/AT/PA/BL als vier UNABHÄNGIGE Werte (siehe Talente.tsx
// KampfTable) — es gibt nirgends eine Formel, die TaW in AT/PA/BL umrechnet,
// also zielt ein Bonus dort auf at/pa/bl (die tatsächlich in eine Kampfprobe
// einfließen), nie auf taw (reine Anzeige/Meisterschaftsschwelle dort).
// Normale Talente kennen nur taw/probe: 'taw' hebt den Talentwert selbst an
// (wirkt auf die Probe nur GROB, über erleichterung() — alle 5 TaW +1), 'probe'
// ist eine direkte, unskalierte Erschwernis/Erleichterung auf die Probe-Zahl
// selbst (negativ erlaubt) — siehe talentProbeBonus() unten, NICHT Teil von
// talentMitBoni(), weil CharTalent kein `probe`-Feld hat, das überschrieben
// werden könnte.
export type TalentBonusFeld = 'taw' | 'at' | 'pa' | 'bl' | 'probe';
export const TALENT_BONUS_FELDER: TalentBonusFeld[] = ['taw', 'at', 'pa', 'bl', 'probe'];

// Weapons as real items (TODO.md, "Weapons become real items"): eine Waffe ist
// ein ganz normales Item, `waffenArt` entscheidet nur, welcher Karten-
// Renderer/Feldsatz greift und ob es im Waffen-Reiter erscheint — leer heißt
// „kein Waffe". Bewusst NICHT selbst verdeckbar: ein noch nicht ausgeteiltes
// GM-Pool-Item ist bereits vollständig unsichtbar (eigener Mechanismus), und
// „ist das übehaupt eine Waffe" ist eine strukturelle Frage, keine verdeckte
// Spielinformation.
export type WaffenArt = 'nah' | 'fern' | '';
export const WAFFEN_ARTEN: WaffenArt[] = ['nah', 'fern'];

// Jedes Waffen-Feld — inklusive talentId — läuft über denselben Melde-
// Mechanismus wie ItemBonus (siehe WaffenStat unten), statt einen Teil der
// Felder verdeckbar zu machen und den Rest als feste Item-Spalten (Spieler-
// Entscheidung: lieber ein einheitlicher Mechanismus als zwei schlankere).
export type WaffenStatFeld =
  | 'talentId' | 'schaden' | 'material' | 'rd' | 'reichweite' | 'iniBonus' | 'anforderung'
  | 'expLevel' | 'at' | 'pa' | 'bl' | 'besonderes' | 'eBE' | 'entfernung' | 'atMod';

// Feldsatz je Waffenart — 1:1 die Felder, die WaffenNeu.tsx heute schon als
// Karten-Grid zeigt (siehe emptyNahRow/emptyFernRow, client/src/tabs/WaffenNeu.tsx).
export const WAFFEN_NAH_FELDER: readonly WaffenStatFeld[] = [
  'talentId', 'schaden', 'material', 'rd', 'reichweite', 'iniBonus', 'anforderung', 'expLevel', 'at', 'pa', 'bl', 'besonderes',
];
export const WAFFEN_FERN_FELDER: readonly WaffenStatFeld[] = [
  'talentId', 'schaden', 'eBE', 'rd', 'entfernung', 'atMod', 'besonderes',
];
export function waffenFelderFuerArt(art: WaffenArt): readonly WaffenStatFeld[] {
  return art === 'nah' ? WAFFEN_NAH_FELDER : art === 'fern' ? WAFFEN_FERN_FELDER : [];
}
// Vereinigung beider Feldsätze — fürs serverseitige Whitelisten eines
// ankommenden `feld`-Werts (wie ITEM_BONUS_KINDS es für ItemBonus.kind tut),
// ohne dass der Aufrufer erst die Waffenart des Items kennen müsste.
export const WAFFEN_STAT_FELDER: readonly WaffenStatFeld[] = [...new Set([...WAFFEN_NAH_FELDER, ...WAFFEN_FERN_FELDER])];

export interface WaffenStat {
  // Stabile, client-vergebene Kennung — wie ItemBonus.uid, aus demselben
  // Grund: ein einzelnes Feld muss über einen Op gezielt ansprechbar sein.
  uid: string;
  feld: WaffenStatFeld;
  // Immer als Text gespeichert (wie die alten Row-Felder, Record<string, unknown>
  // im Client) — die Feldbedeutung (Zahl wie AT-Bonus, Text wie Schaden-Formel
  // „1W6+2") hängt vom Feld ab, ein einheitlicher Typ erspart eine Union.
  wert: string;
  // Hidden/revealable Ausrüstung stats (TODO.md), hier je Waffen-Feld statt je
  // Bonus-Zeile: Existenz der Zeile bleibt sichtbar (der Reiter zeigt „???"
  // für dieses Feld, siehe ohneVerborgeneItems), NUR der Wert wird verborgen —
  // anders als ein verdeckter ItemBonus (dort ist auch die Existenz verdeckt),
  // weil ein Waffen-Feld ein strukturell erwarteter Teil der Karte ist (wie
  // rs/haltbarkeit), keine überraschende Zusatzwirkung. Aufdecken ist
  // einseitig, wie bei rs/haltbarkeit/ItemBonus.
  verborgen: boolean;
}

// Frischer Stat-Zeilensatz für eine gewählte Waffenart — jede Waffe bekommt
// von Anfang an ALLE ihre Felder als Zeilen (leer, sichtbar), damit „Feld
// existiert noch nicht" nie mit „Feld ist verdeckt" verwechselt wird.
export function waffenStatsFuerArt(art: WaffenArt): WaffenStat[] {
  return waffenFelderFuerArt(art).map((feld) => ({ uid: makeUid(), feld, wert: '', verborgen: false }));
}

export interface ItemBonus {
  // Stabile, client-vergebene Kennung — wie Item.uid, aus demselben Grund:
  // incremental item saves (siehe ItemOp weiter unten) müssen EINE Bonus-Zeile
  // gezielt ansprechen können, ohne die ganze bonusse-Liste zu ersetzen. Ohne
  // eigene Kennung ließ sich eine gerade aufgedeckte Zeile nicht von einer
  // schlicht nie gesehenen unterscheiden — eine ganze Bonus-Klasse an Bugs
  // (siehe TODO.md, "Hidden/revealable Ausrüstung stats").
  uid: string;
  kind: ItemBonusKind;
  code: string; // Bedeutung je nach kind, siehe oben; '' bei psyche/traglast
  feld: TalentBonusFeld | ''; // nur bei kind === 'talent', sonst ''
  wert: number;
  // Verdeckte Bonus-Zeile (Hidden/revealable Ausrüstung stats, TODO.md):
  // solange true, existiert die Zeile für einen Nicht-SL nicht — weder Ziel
  // noch Wert noch die Tatsache, dass es sie gibt (volle Verdeckung, siehe
  // ohneVerborgeneItems). Nur die Spielleitung kann sie anlegen/aufdecken;
  // Aufdecken ist einseitig (kein Zurück, siehe AddItemDialog „Aufdecken").
  verborgen: boolean;
}

export interface Item {
  id: number;
  // Stabile, client-vergebene Kennung. Anders als die DB-`id` (wird beim Speichern
  // per DELETE+INSERT neu vergeben) überlebt die uid das Speichern — deshalb
  // verweist die Behälter-Zugehörigkeit (`containerUid`) auf sie, nicht auf `id`.
  uid: string;
  name: string;
  anzahl: number; // Stückzahl
  gewicht: number; // kg je Stück (Dezimalzahlen erlaubt)
  kategorie: string; // Name aus der Kategorienliste des Charakters ('' = ohne)
  location: ItemLocation;
  // Körperstelle, wenn location === 'getragen' (Name aus BODY_ZONES). Sonst ''.
  zone: string;
  // Beidseitig getragen (nur bei seitengetrennten Zonen Arm/Hand/Bein sinnvoll):
  // EIN Gegenstand — ein Paar Schienen, Handschuhe, Beinlinge —, der zugleich auf
  // der Gegenseite erscheint. Gewicht und RS zählen einmal (der Datensatz bleibt
  // einer); nur die Anzeige wird gespiegelt (siehe zoneView / ZONE_SIBLING).
  beidseitig: boolean;
  // uid des Behälters, wenn location === 'behaelter'. Sonst ''.
  containerUid: string;
  // Kann dieser Gegenstand andere aufnehmen (z. B. Rucksack, Gürteltasche)?
  istBehaelter: boolean;
  // Behälter-Art (nur relevant, wenn istBehaelter): Schnellzugriff vs. Stauraum.
  containerArt: ContainerArt;
  // Fassungsvermögen des Behälters (0 = ohne Angabe/unbegrenzt) — Einheit
  // richtet sich nach kapazitaetArt: kg oder Stück.
  kapazitaet: number;
  // Womit das Fassungsvermögen gemessen wird (nur relevant, wenn istBehaelter).
  kapazitaetArt: KapazitaetArt;
  // Gewichtsreduktion des Inhalts in Prozent (0–100). 100 % = der Inhalt zählt
  // gar nicht zur getragenen Last (Beutel des Fassungsvermögens / „bag of holding").
  // Bei Stauraum-Behältern (containerArt === 'storage') mit kapazitaetArt ===
  // 'stueck' wirkt das IMMER wie 100 %, unabhängig vom gespeicherten Wert —
  // bei Schnellzugriff-Behältern (containerArt === 'quick') dagegen NIE: ihr
  // Inhalt zählt immer voll, dieses Feld bleibt für sie ungenutzt (siehe
  // itemLastAnteil).
  gewichtsreduktion: number;
  // Rüstungsschutz (nur bei Rüstungsteilen sinnvoll). Es wird NICHT summiert —
  // fürs Spiel zählt der höchste getragene Wert (siehe effektiverRs).
  rs: number;
  // Haltbarkeit wie LP für Gegenstände — nur bei Rüstung/Waffen o.ä. sinnvoll.
  // 0 = nicht verfolgt (Standard; blendet die %-Anzeige aus, siehe haltbarkeitPct).
  haltbarkeitMax: number;
  haltbarkeitAktuell: number;
  notiz: string;
  // Boni, die dieser Gegenstand verleiht, solange location === 'getragen' ist
  // (siehe ItemBonus oben). Leer für die allermeisten Items.
  bonusse: ItemBonus[];
  // Verdeckte RS/Haltbarkeit (Hidden/revealable Ausrüstung stats, TODO.md):
  // NICHT an kategorie/location gebunden — ein unidentifiziertes Stück im
  // Inventar bleibt verdeckt. Anders als ein verdeckter ItemBonus (voll
  // unsichtbar) bleiben rs/haltbarkeit als FELDER sichtbar, zeigen aber „???"
  // statt der echten Zahl, solange verborgen ist (siehe ohneVerborgeneItems).
  rsVerborgen: boolean;
  haltbarkeitVerborgen: boolean;
  // Weapons as real items (TODO.md): '' für ein gewöhnliches Item, sonst
  // 'nah'/'fern' — routet die Karte in den Waffen-Reiter und wählt den
  // Feldsatz (siehe waffenFelderFuerArt). Alle tatsächlichen Waffenwerte
  // (inkl. talentId) liegen in waffenStats, nicht als eigene Item-Felder.
  waffenArt: WaffenArt;
  waffenStats: WaffenStat[];
}

// Haltbarkeit als Prozentsatz (0–100), oder null wenn nicht verfolgt (max = 0).
export function haltbarkeitPct(item: Pick<Item, 'haltbarkeitMax' | 'haltbarkeitAktuell'>): number | null {
  if (item.haltbarkeitMax <= 0) return null;
  const aktuell = Math.min(item.haltbarkeitMax, Math.max(0, Number(item.haltbarkeitAktuell) || 0));
  return Math.round((aktuell / item.haltbarkeitMax) * 100);
}

// Neue, stabile Kennung. crypto.randomUUID gibt es im Browser wie in Node 18+.
export function makeUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Neues Item mit allen Standardwerten, überschrieben von `over` — für die
// Anlegen-Dialoge (Inventar wie Ausrüstung), damit die Feldliste nur an einer
// Stelle steht.
export function makeItem(over: Partial<Item>): Item {
  return {
    id: 0, uid: makeUid(), name: '', anzahl: 1, gewicht: 0, kategorie: '', location: 'inventar',
    zone: '', beidseitig: false, containerUid: '', istBehaelter: false, containerArt: 'storage', kapazitaet: 0,
    kapazitaetArt: 'gewicht', gewichtsreduktion: 0, rs: 0, haltbarkeitMax: 0, haltbarkeitAktuell: 0, notiz: '',
    bonusse: [], rsVerborgen: false, haltbarkeitVerborgen: false, waffenArt: '', waffenStats: [], ...over,
  };
}

// Die Sicht eines Nicht-Spielleiters auf einen Gegenstand (Hidden/revealable
// Ausrüstung stats, TODO.md): rs/haltbarkeit bleiben als Felder da, ihr Wert
// wird aber auf 0 genullt, solange verborgen — der Client entscheidet über
// die *Verborgen-Flags, ob „???" statt der Zahl steht, NIE über den Wert
// selbst (0 wäre sonst nicht von „wirklich 0" zu unterscheiden). Eine
// verdeckte Bonus-Zeile wird komplett entfernt (volle Verdeckung — weder Ziel
// noch Wert noch Existenz sichtbar), NICHT nur ihr Wert genullt. Server-seitig
// vor jeder Antwort an einen Nicht-SL anzuwenden (siehe ohneGmBloecke in
// shared/src/wikiMarkup.ts fürs selbe Prinzip) — ein Client, der die Felder
// nur nicht rendert, hätte die echten Werte trotzdem verschickt.
export function ohneVerborgeneItems(items: readonly Item[]): Item[] {
  return items.map((it) => ({
    ...it,
    rs: it.rsVerborgen ? 0 : it.rs,
    haltbarkeitMax: it.haltbarkeitVerborgen ? 0 : it.haltbarkeitMax,
    haltbarkeitAktuell: it.haltbarkeitVerborgen ? 0 : it.haltbarkeitAktuell,
    bonusse: it.bonusse.filter((b) => !b.verborgen),
    // Waffen-Stat-Zeilen: wie rs/haltbarkeit, NICHT wie ItemBonus — die Zeile
    // (also DASS es dieses Feld gibt) bleibt sichtbar, nur ihr Wert wird
    // geleert, damit der Reiter „???" statt eines echten Werts zeigen kann
    // (siehe WaffenStat.verborgen).
    waffenStats: it.waffenStats.map((s) => (s.verborgen ? { ...s, wert: '' } : s)),
  }));
}

// Exakte Kopie — neue `uid`/`id: 0`, sonst jedes Feld identisch (Name,
// Haltbarkeit, Notiz, Ort/Zone/Behälter …), direkt neben dem Original in
// derselben Liste. Für zwei real identische Gegenstände, deren Zustand aber
// getrennt verfolgt werden soll (z. B. zwei Dolche mit je eigener
// Haltbarkeit) — anders als `anzahl`, das nur EINEN gemeinsamen Zustand kennt.
export function duplicateItem(item: Item): Item {
  // Bonus- wie Waffen-Stat-Zeilen bekommen ebenfalls neue uids — sonst trüge
  // die Kopie dieselbe Kennung wie das Original, obwohl beide von nun an
  // unabhängig editier-/aufdeckbar sein sollen (siehe ItemBonus.uid).
  return {
    ...item, id: 0, uid: makeUid(),
    bonusse: item.bonusse.map((b) => ({ ...b, uid: makeUid() })),
    waffenStats: item.waffenStats.map((s) => ({ ...s, uid: makeUid() })),
  };
}

// --- Shared inventories: ownership (docs/concepts/shared-inventories.md) ---
//
// An item belongs to an OWNER, not directly to a character: a character's own
// stuff, a group's shared pool, or the GM's prep pool. 'gm' is a single global
// pool (only one GM account exists, so per-GM scoping would be dead
// complexity) — ownerId is unused for it, always 0.
export type ItemOwnerType = 'character' | 'group' | 'gm';
export interface ItemOwnerRef {
  ownerType: ItemOwnerType;
  ownerId: number; // unused (0) when ownerType === 'gm'
}

// A cross-owner move is its own imperative call (moveItem in
// server/src/characterData.ts), never an ItemOp: diffItems compares one
// owner's list against its OWN previous state and structurally cannot express
// "this uid leaves my list and joins yours". Only the root item resets — a
// moved container's descendants keep their location/containerUid untouched
// (they travel with it, see server-side subtreeIds), so the container's
// internal structure survives the trip. Server-side mirrors this patch
// directly in SQL (see moveItem) rather than importing it, but the shape must
// stay identical — this is the single source of truth for what resets.
export const ITEM_MOVE_RESET_PATCH: Partial<Item> = {
  location: 'inventar',
  zone: '',
  beidseitig: false,
  containerUid: '',
};

// --- Incremental item saves ---
//
// `PUT /items` used to replace the WHOLE list (delete+reinsert) on every
// save, no matter how small the edit. That is fine for crash-safety (one DB
// transaction, atomic) but not for two people editing concurrently: a client
// can only ever echo back what it has locally, so a full-list save silently
// DROPS anything it never received — which is exactly what happens to a
// bonus row a GM reveals mid-session while a player's tab is still open on
// the pre-reveal item list (see TODO.md, "Hidden/revealable Ausrüstung
// stats" — the bug that motivated this). An op describes ONE targeted change
// instead of a whole snapshot, so a client can never accidentally erase data
// it was never shown in the first place — there is no "whole list" moment
// where that data would need to be echoed back.
export type ItemOp =
  | { op: 'add'; item: Item }
  | { op: 'remove'; uid: string }
  | { op: 'patch'; uid: string; patch: Partial<Item> }
  | { op: 'reorder'; uids: string[] }
  | { op: 'addBonus'; itemUid: string; bonus: ItemBonus }
  | { op: 'removeBonus'; itemUid: string; bonusUid: string }
  | { op: 'patchBonus'; itemUid: string; bonusUid: string; patch: Partial<ItemBonus> }
  | { op: 'addWeaponStat'; itemUid: string; stat: WaffenStat }
  | { op: 'removeWeaponStat'; itemUid: string; statUid: string }
  | { op: 'patchWeaponStat'; itemUid: string; statUid: string; patch: Partial<WaffenStat> };

// Item-Felder, die ein 'patch'-Op tragen darf — ausdrücklich OHNE `id`/`uid`
// (Identität, nicht Inhalt) und OHNE `bonusse` (eigene addBonus/patchBonus/
// removeBonus-Ops; ein Patch, der bonusse als Ganzes ersetzt, hätte exakt
// dasselbe Verlustproblem wie der alte Ganze-Liste-Ersatz, nur eine Ebene
// tiefer).
const ITEM_PATCH_KEYS = [
  'name', 'anzahl', 'gewicht', 'kategorie', 'location', 'zone', 'beidseitig', 'containerUid',
  'istBehaelter', 'containerArt', 'kapazitaet', 'kapazitaetArt', 'gewichtsreduktion',
  'rs', 'haltbarkeitMax', 'haltbarkeitAktuell', 'notiz', 'rsVerborgen', 'haltbarkeitVerborgen', 'waffenArt',
] as const satisfies readonly (keyof Item)[];

const BONUS_PATCH_KEYS = ['kind', 'code', 'feld', 'wert', 'verborgen'] as const satisfies readonly (keyof ItemBonus)[];
const WAFFEN_STAT_PATCH_KEYS = ['feld', 'wert', 'verborgen'] as const satisfies readonly (keyof WaffenStat)[];

function diffBonusRows(itemUid: string, prevRows: readonly ItemBonus[], nextRows: readonly ItemBonus[]): ItemOp[] {
  const ops: ItemOp[] = [];
  const prevByUid = new Map(prevRows.map((b) => [b.uid, b]));
  const nextByUid = new Map(nextRows.map((b) => [b.uid, b]));
  for (const b of prevRows) {
    if (!nextByUid.has(b.uid)) ops.push({ op: 'removeBonus', itemUid, bonusUid: b.uid });
  }
  for (const b of nextRows) {
    const old = prevByUid.get(b.uid);
    if (!old) {
      ops.push({ op: 'addBonus', itemUid, bonus: b });
      continue;
    }
    const patch: Partial<ItemBonus> = {};
    let changed = false;
    for (const k of BONUS_PATCH_KEYS) {
      if (old[k] !== b[k]) {
        (patch as Record<string, unknown>)[k] = b[k];
        changed = true;
      }
    }
    if (changed) ops.push({ op: 'patchBonus', itemUid, bonusUid: b.uid, patch });
  }
  return ops;
}

// Gegenstück zu diffBonusRows für WaffenStat-Zeilen — dieselbe Op-Familie,
// mit addWeaponStat/patchWeaponStat/removeWeaponStat statt …Bonus.
function diffWeaponStatRows(itemUid: string, prevRows: readonly WaffenStat[], nextRows: readonly WaffenStat[]): ItemOp[] {
  const ops: ItemOp[] = [];
  const prevByUid = new Map(prevRows.map((s) => [s.uid, s]));
  const nextByUid = new Map(nextRows.map((s) => [s.uid, s]));
  for (const s of prevRows) {
    if (!nextByUid.has(s.uid)) ops.push({ op: 'removeWeaponStat', itemUid, statUid: s.uid });
  }
  for (const s of nextRows) {
    const old = prevByUid.get(s.uid);
    if (!old) {
      ops.push({ op: 'addWeaponStat', itemUid, stat: s });
      continue;
    }
    const patch: Partial<WaffenStat> = {};
    let changed = false;
    for (const k of WAFFEN_STAT_PATCH_KEYS) {
      if (old[k] !== s[k]) {
        (patch as Record<string, unknown>)[k] = s[k];
        changed = true;
      }
    }
    if (changed) ops.push({ op: 'patchWeaponStat', itemUid, statUid: s.uid, patch });
  }
  return ops;
}

// Berechnet die Ops, die `prev` in `next` überführen — die Client-seitige
// Gegenseite zu applyItemOps() (server/src/characterData.ts). `prev` und
// `next` sind beide der eigene, lokale Stand desselben Betrachters (nie ein
// fremder/serverseitiger) — genau deshalb kann ein Nicht-SL hier strukturell
// NIE einen Op erzeugen, der eine verdeckte Zeile berührt: seine eigene
// Kopie hat sie ja nie enthalten, in `prev` so wenig wie in `next`, also
// zeigt der Vergleich für sie schlicht „keine Änderung".
export function diffItems(prev: readonly Item[], next: readonly Item[]): ItemOp[] {
  const ops: ItemOp[] = [];
  const prevByUid = new Map(prev.map((it) => [it.uid, it]));
  const nextByUid = new Map(next.map((it) => [it.uid, it]));
  for (const it of prev) {
    if (!nextByUid.has(it.uid)) ops.push({ op: 'remove', uid: it.uid });
  }
  for (const it of next) {
    const old = prevByUid.get(it.uid);
    if (!old) {
      ops.push({ op: 'add', item: it });
      continue;
    }
    const patch: Partial<Item> = {};
    let changed = false;
    for (const k of ITEM_PATCH_KEYS) {
      if (old[k] !== it[k]) {
        (patch as Record<string, unknown>)[k] = it[k];
        changed = true;
      }
    }
    if (changed) ops.push({ op: 'patch', uid: it.uid, patch });
    ops.push(...diffBonusRows(it.uid, old.bonusse, it.bonusse));
    ops.push(...diffWeaponStatRows(it.uid, old.waffenStats, it.waffenStats));
  }
  // Reihenfolge nur unter den in BEIDEN Ständen vorhandenen uids vergleichen —
  // neu/entfernt wird bereits oben behandelt, dafür braucht reorder keine
  // eigene Sonderrolle.
  const commonPrevOrder = prev.filter((it) => nextByUid.has(it.uid)).map((it) => it.uid);
  const commonNextOrder = next.filter((it) => prevByUid.has(it.uid)).map((it) => it.uid);
  if (commonPrevOrder.join(' ') !== commonNextOrder.join(' ')) {
    ops.push({ op: 'reorder', uids: next.map((it) => it.uid) });
  }
  return ops;
}

// Zeilengewicht: Stückzahl × Einzelgewicht (kg), OHNE Reduktion.
export function itemGewicht(item: Pick<Item, 'anzahl' | 'gewicht'>): number {
  return (Number(item.anzahl) || 0) * (Number(item.gewicht) || 0);
}

// Zählt der Gegenstand grundsätzlich zur getragenen Last? Abgelegtes (bench)
// zählt NICHT mit — es liegt irgendwo in Reichweite, nicht am Körper oder im
// Gepäck. Am Körper Getragenes (getragen) zählt mit halbem Gewicht (siehe
// itemLastAnteil); mitgeführte (inventar) und in Behältern liegende
// (behaelter) Gegenstände zählen voll.
export function zaehltZurLast(item: Pick<Item, 'location'>): boolean {
  return item.location === 'inventar' || item.location === 'behaelter' || item.location === 'getragen';
}

// Prozentsatz auf [0,100] begrenzen.
const clampPct = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));

// Halber Lastanteil für am Körper getragene Gegenstände (Spieler-Regel
// 2026-08-16) — sie sind zwar dabei, aber am Körper verteilt statt im Gepäck.
const GETRAGEN_ANTEIL = 0.5;

// Lastanteil EINES Gegenstands (kg): 0 für nicht zählende; getragene zählen
// halb; Behälter-Inhalt um die Reduktion seines Behälters gemindert. `byUid`
// liefert den Behälter.
export function itemLastAnteil(item: Item, byUid: Map<string, Item>): number {
  if (!zaehltZurLast(item)) return 0;
  const base = itemGewicht(item);
  if (item.location === 'getragen') return base * GETRAGEN_ANTEIL;
  if (item.location === 'behaelter') {
    const c = byUid.get(item.containerUid);
    if (!c) return base;
    // Schnellzugriff-Behälter (Gürtel, Bandelier, „Quickslots"): der Inhalt
    // zählt voll zum Behälter — anders als bei Stauraum-Köchern/-Beuteln ist
    // die Anzahl-Kapazität hier keine Weightless-Zusage, nur eine Fach-Zählung
    // (Spieler-Entscheidung 2026-08-24). Der Behälter selbst wird beim Tragen
    // wie jeder andere Körper-Gegenstand halbiert (GETRAGEN_ANTEIL) — dieselbe
    // Halbierung wirkt dann auf seinen Inhalt mit, solange er getragen wird.
    if (c.containerArt === 'quick') {
      return c.location === 'getragen' ? base * GETRAGEN_ANTEIL : base;
    }
    const red = c.kapazitaetArt === 'stueck' ? 100 : clampPct(c.gewichtsreduktion);
    return base * (1 - red / 100);
  }
  return base;
}

// Liegt item in einem STAURAUM-Behälter, der (direkt oder über weitere
// Verschachtelung) selbst auf der Ablage (bench) liegt? Dann zählt es nicht
// zur Traglast — eine spare, unworn backpack's Inhalt ist nicht am Körper/im
// Gepäck. Nur containerArt === 'storage' benched zählt: ein Schnellzugriff-
// Behälter (Gürtel, Bandelier) zählt seinen Inhalt schon immer unabhängig vom
// Tragen voll, außer beim Tragen selbst halbiert (siehe itemLastAnteil) — das
// ändert sich hier nicht, nur Stauraum bekommt die neue Bench-Ausnahme.
// Bewusst getrennt von itemLastAnteil: die Kapazitäts-/Füllstandsprüfung
// eines Behälters (containerEffektiveFuellung) bleibt davon unberührt, ein
// benchter Behälter kann weiterhin über seine Kapazität hinaus vollgestopft
// sein.
function inBenchtemStauraum(item: Pick<Item, 'location' | 'containerUid'>, byUid: Map<string, Item>): boolean {
  let location = item.location;
  let containerUid = item.containerUid;
  const seen = new Set<string>();
  while (location === 'behaelter') {
    if (seen.has(containerUid)) break;
    seen.add(containerUid);
    const container = byUid.get(containerUid);
    if (!container) break;
    if (container.containerArt === 'storage' && container.location === 'bench') return true;
    location = container.location;
    containerUid = container.containerUid;
  }
  return false;
}

// Summe der getragenen Last (kg), inklusive Behälter-Reduktion. Inhalt eines
// benchten Stauraum-Behälters (auch verschachtelt) zählt nicht mit (siehe
// inBenchtemStauraum).
export function getrageneLast(items: readonly Item[]): number {
  const byUid = new Map(items.map((it) => [it.uid, it]));
  return items.reduce(
    (sum, it) => sum + (inBenchtemStauraum(it, byUid) ? 0 : itemLastAnteil(it, byUid)),
    0,
  );
}

export interface LastInfo {
  getragen: number; // kg
  max: number; // maximaleLast(attrs) + bonus, als kg gelesen
  ueberladen: boolean;
}

// Traglast-Übersicht für die Ladungsanzeige: getragen / Maximum + Überladung.
// `bonus` (kg) ist der gespeicherte, freie Zusatz (char_meta.traglastBonus) auf
// die berechnete maximale Last; er darf negativ sein, das Maximum wird aber nie
// unter 0 gedrückt. Item-Boni fließen HIER intern ein (traglast-Ziel plus, über
// attrsMitBoni, jeder Attribut-Bonus, der die Formel selbst anhebt) — lastInfo
// bekommt `items` ohnehin schon fürs Gewicht, wornBoni also gleich mit
// berechnen statt jeden Aufrufer zu zwingen, das selbst zu tun.
export function lastInfo(items: readonly Item[], attrs: Attributes, bonus = 0): LastInfo {
  const boni = wornBoni(items);
  const getragen = getrageneLast(items);
  const max = Math.max(0, maximaleLast(attrsMitBoni(attrs, boni)) + (Number(bonus) || 0) + boni.traglast);
  return { getragen, max, ueberladen: getragen > max };
}

// Maßgeblicher Rüstungsschutz: der höchste RS unter den getragenen Teilen
// (es wird nicht summiert — Spieler-Regel 2026-08-10).
export function effektiverRs(items: readonly Item[]): number {
  return items.reduce((m, it) => (it.location === 'getragen' ? Math.max(m, Number(it.rs) || 0) : m), 0);
}

// --- Item-Boni ---
//
// Summierte Boni aus allen GETRAGENEN Items, über den vollen Zielraum von
// ItemBonus. Bewusst NICHT „WornBoni" genannt und der Sammler (dieser Typ)
// bewusst getrennt vom Erzeuger (wornBoni): perk-trees.md plant, denselben
// Zielraum für Heldenpunkte-Perks wiederzuverwenden („nur die Bedingung ist
// anders") — wornBoni(items) wird dann EIN Erzeuger von StatBoni neben einem
// künftigen perkBoni(perks), zusammengeführt über ein mergeBoni(). Das spart
// die Umbenennung über ~10 Aufrufstellen, die sonst später fällig würde.
export interface StatBoni {
  attrs: Partial<Record<AttrCode, number>>;
  baseValues: Partial<Record<BaseValueKey, number>>;
  resources: Partial<Record<ResourceKey, number>>;
  spezial: Record<number, number>; // special_energies_catalog.id -> Summe
  psyche: number;
  traglast: number;
  talente: Record<number, Partial<Record<TalentBonusFeld, number>>>;
  // Zielschlüssel ("attr:MU", "talent:42:taw", "psyche", …) -> Namen der
  // beitragenden Items, fürs Tooltip. NUR von Boni ungleich 0 befüllt — ein
  // angelegter, aber noch leerer Bonus (wert: 0) trägt zahlenmäßig nichts bei
  // und soll auch nicht als Quelle auftauchen.
  quellen: Record<string, string[]>;
}

// Zielschlüssel für `quellen`, EINMAL definiert statt an jeder addQuelle()-
// Stelle und jeder BonusWert-Aufrufstelle im Client neu zusammengebaut —
// sonst laufen Erzeuger (wornBoni) und Verbraucher (Heldenbrief & Co.)
// irgendwann auseinander. talent braucht `feld` mit im Schlüssel: derselbe
// Talent-Bonus kann TaW UND AT zugleich anheben, das sind zwei Ziele.
export const attrBonusKey = (code: AttrCode): string => `attr:${code}`;
export const baseValueBonusKey = (key: BaseValueKey): string => `baseValue:${key}`;
export const resourceBonusKey = (key: ResourceKey): string => `resource:${key}`;
export const talentBonusKey = (talentId: number, feld: TalentBonusFeld): string => `talent:${talentId}:${feld}`;
export const spezialBonusKey = (catalogId: number): string => `spezial:${catalogId}`;
export const PSYCHE_BONUS_KEY = 'psyche';
export const TRAGLAST_BONUS_KEY = 'traglast';

function leererStatBoni(): StatBoni {
  return { attrs: {}, baseValues: {}, resources: {}, spezial: {}, psyche: 0, traglast: 0, talente: {}, quellen: {} };
}

// Summiert die Boni aller getragenen Items zu EINEM StatBoni. Reine Funktion,
// kein State — jeder Aufrufer (Client wie Server) ruft sie selbst mit der
// jeweils aktuellen Item-Liste auf, es gibt keinen globalen Cache.
export function wornBoni(items: readonly Item[]): StatBoni {
  const boni = leererStatBoni();
  // key -> Item-Name -> Summe seiner Boni auf DIESES Ziel — ein Item kann
  // mehr als eine Bonus-Zeile auf denselben Zielschlüssel tragen, die
  // Tooltip-Zahl muss die Summe zeigen, nicht nur die zuletzt gesehene.
  const quellenSummen = new Map<string, Map<string, number>>();
  const addQuelle = (key: string, name: string, wert: number) => {
    const perItem = quellenSummen.get(key) ?? new Map<string, number>();
    const label = name.trim() || '(ohne Name)';
    perItem.set(label, (perItem.get(label) ?? 0) + wert);
    quellenSummen.set(key, perItem);
  };
  const addNum = (rec: Record<string, number>, key: string, wert: number) => {
    rec[key] = (rec[key] ?? 0) + wert;
  };

  for (const item of items) {
    if (item.location !== 'getragen') continue;
    for (const b of item.bonusse) {
      // Ein verdeckter Bonus wirkt mechanisch noch nicht — „effects apply
      // only once revealed" (Hidden/revealable Ausrüstung stats, TODO.md).
      // Das gilt hier UNBEDINGT, nicht nur beim Verschicken an einen
      // Nicht-SL: derselbe Aufruf (client wie server, u. a. loadStats für
      // Würfe) darf einen unaufgedeckten Bonus nie mitrechnen, auch nicht in
      // der eigenen SL-Vorschau — das Item hat sich narrativ noch nicht
      // offenbart.
      if (b.verborgen) continue;
      const wert = Number(b.wert) || 0;
      if (wert === 0) continue;
      switch (b.kind) {
        case 'attr':
          addNum(boni.attrs as Record<string, number>, b.code, wert);
          addQuelle(attrBonusKey(b.code as AttrCode), item.name, wert);
          break;
        case 'baseValue':
          addNum(boni.baseValues as Record<string, number>, b.code, wert);
          addQuelle(baseValueBonusKey(b.code as BaseValueKey), item.name, wert);
          break;
        case 'resource':
          addNum(boni.resources as Record<string, number>, b.code, wert);
          addQuelle(resourceBonusKey(b.code as ResourceKey), item.name, wert);
          break;
        case 'talent': {
          const talentId = Number(b.code);
          if (!Number.isFinite(talentId) || !b.feld) break;
          const rec = boni.talente[talentId] ?? {};
          rec[b.feld] = (rec[b.feld] ?? 0) + wert;
          boni.talente[talentId] = rec;
          addQuelle(talentBonusKey(talentId, b.feld), item.name, wert);
          break;
        }
        case 'spezial': {
          const catalogId = Number(b.code);
          if (!Number.isFinite(catalogId)) break;
          boni.spezial[catalogId] = (boni.spezial[catalogId] ?? 0) + wert;
          addQuelle(spezialBonusKey(catalogId), item.name, wert);
          break;
        }
        case 'psyche':
          boni.psyche += wert;
          addQuelle(PSYCHE_BONUS_KEY, item.name, wert);
          break;
        case 'traglast':
          boni.traglast += wert;
          addQuelle(TRAGLAST_BONUS_KEY, item.name, wert);
          break;
      }
    }
  }
  // Formatierung wie bonusLabel() (client/src/tabs/Ausruestung.tsx) für eine
  // einzelne Bonus-Zeile — hier auf die je Item aufsummierte Zahl angewandt,
  // damit der Tooltip zeigt WIEVIEL ein Gegenstand beiträgt, nicht nur DASS.
  for (const [key, perItem] of quellenSummen) {
    boni.quellen[key] = [...perItem].map(([name, sum]) => `${name} (${sum > 0 ? '+' : ''}${sum})`);
  }
  return boni;
}

// Attribute mit Item-Boni überlagert: der Bonus fließt in `mod`, NICHT `akt`
// — derselbe nicht-destruktive Vertrag wie attrMax() ihn schon mit akt/mod
// hat. Jede Formel liest Attribute über attrMax() und damit automatisch
// bonusiert; nichts davon wird je zurückgeschrieben.
export function attrsMitBoni(attrs: Attributes, boni: StatBoni): Attributes {
  const out = {} as Attributes;
  for (const code of ATTR_ROW_CODES) {
    const bonus = (boni.attrs as Record<string, number>)[code] ?? 0;
    out[code] = bonus ? { akt: attrs[code].akt, mod: attrs[code].mod + bonus } : attrs[code];
  }
  return out;
}

// Basiswerte-Mods mit Item-Boni überlagert — deckt alle zwölf BaseValueKeys ab
// (inkl. Initiative, Todesschwelle, GS), da computeBaseValues() ohnehin jeden
// Key über dasselbe `mods`-Feld liest.
export function baseInputsMitBoni(inputs: BaseValueInputs, boni: StatBoni): BaseValueInputs {
  const bonusKeys = Object.keys(boni.baseValues);
  if (bonusKeys.length === 0) return inputs;
  const mods = { ...inputs.mods };
  for (const key of bonusKeys) {
    const bonus = (boni.baseValues as Record<string, number>)[key] ?? 0;
    if (bonus) mods[key as BaseValueKey] = (mods[key as BaseValueKey] ?? 0) + bonus;
  }
  return { ...inputs, mods };
}

// Ressourcen-Eingabe (LE/AUS/AsE) mit Item-Boni überlagert. Der Bonus geht in
// `permanent` — die Seite, die den tatsächlichen Vorrat bildet (ergebnis =
// vor + raceBase + permanent + kauf, siehe computeResource) und die einzige,
// die eine spätere Entfernung der Ausbaugrenze überlebt. Der Parallel-Eintrag
// in `maxPlus` ist NUR nötig, solange die Ausbaugrenze (max = … + kaufMax +
// maxPlus, nutzbar = min(ergebnis, max)) noch existiert — ohne ihn würde der
// Hard-Cap den frischen Bonus sofort wieder wegkappen. Fällt die Ausbaugrenze
// (geplant, siehe TODO.md), fällt dieser zweite Schreibzugriff ersatzlos weg.
export function resourceInputMitBoni(input: ResourceInput, key: ResourceKey, boni: StatBoni): ResourceInput {
  const bonus = boni.resources[key] ?? 0;
  if (!bonus) return input;
  return { ...input, permanent: input.permanent + bonus, maxPlus: input.maxPlus + bonus };
}

// Spezialenergie mit Item-Bonus überlagert — wirkt nur, wenn der Katalog-
// Eintrag eine Formel trägt (siehe SpecialResource-Dokumentation): ohne
// Formel bleibt `bonus` ungenutzt, ein Item-Bonus auf so eine Energie liefe
// dann ins Leere. Die Dialog-Auswahl (spätere UI) filtert das bereits weg —
// diese Funktion bleibt trotzdem defensiv, falls doch mal ein toter Verweis
// gespeichert wurde (z. B. weil der Katalog-Eintrag nachträglich seine Formel
// verlor).
export function specialMitBoni(sr: SpecialResource, boni: StatBoni): SpecialResource {
  const bonus = sr.catalogId != null ? (boni.spezial[sr.catalogId] ?? 0) : 0;
  return bonus ? { ...sr, bonus: sr.bonus + bonus } : sr;
}

// Talent mit Item-Boni überlagert — NUR fürs Anzeigen (Probe-Berechnung,
// Waffen-Aufteilung). Das gespeicherte Talent selbst bleibt unangetastet,
// exakt wie attrsMitBoni es mit akt/mod hält: nichts hiervon wird je
// zurückgeschrieben, die Eingabefelder binden weiter an den rohen Wert.
// Absichtlich OHNE `probe` — dafür gibt es kein CharTalent-Feld zum
// Überschreiben, siehe talentProbeBonus() direkt darunter.
export function talentMitBoni(talent: CharTalent, boni: StatBoni): CharTalent {
  const bonus = boni.talente[talent.talentId];
  if (!bonus) return talent;
  return {
    ...talent,
    taw: talent.taw + (bonus.taw ?? 0),
    at: talent.at + (bonus.at ?? 0),
    pa: talent.pa + (bonus.pa ?? 0),
    bl: talent.bl + (bonus.bl ?? 0),
  };
}

// Direkte, unskalierte Probe-Erschwernis/-Erleichterung eines normalen
// Talents — additiv auf talentProbeZahl(...)'s Ergebnis, NICHT auf taw davor
// (also ohne den erleichterung()-Deckel von "alle 5 TaW +1"). Getrennt von
// talentMitBoni, weil kein CharTalent-Feld existiert, das diesen Wert trüge;
// jeder Aufrufer von talentProbeZahl für ein normales Talent addiert das
// Ergebnis hier separat.
export function talentProbeBonus(talentId: number, boni: StatBoni): number {
  return boni.talente[talentId]?.probe ?? 0;
}

// --- Sichten auf denselben Bestand ---

// Am Körper getragene Gegenstände einer Zone.
export function itemsInZone(items: readonly Item[], zone: string): Item[] {
  return items.filter((it) => it.location === 'getragen' && it.zone === zone);
}

// Seitenpaare am Körper. Ein beidseitig getragener Gegenstand speichert EINE der
// beiden Seiten als seine Zone; auf der Gegenseite erscheint er nur gespiegelt.
export const ZONE_SIBLING: Record<string, BodyZone> = {
  'Arm links': 'Arm rechts',
  'Arm rechts': 'Arm links',
  'Hand links': 'Hand rechts',
  'Hand rechts': 'Hand links',
  'Bein links': 'Bein rechts',
  'Bein rechts': 'Bein links',
};
// Hat diese Zone eine Gegenseite (Arm/Hand/Bein)? Nur dort ist „beidseitig" sinnvoll.
export function isPairedZone(zone: string): boolean {
  return zone in ZONE_SIBLING;
}

// Anzeige-Sicht einer Körperzone: die dort abgelegten Gegenstände PLUS die
// beidseitig getragenen der Gegenseite (sie erscheinen hier gespiegelt). Fürs
// Gewicht/RS bleibt itemsInZone maßgeblich — jeder Gegenstand liegt genau einmal
// im Bestand, die Spiegelung dupliziert nur die Anzeige.
export function zoneView(items: readonly Item[], zone: string): Item[] {
  const own = itemsInZone(items, zone);
  const sibling = ZONE_SIBLING[zone];
  if (!sibling) return own;
  const mirrored = items.filter(
    (it) => it.location === 'getragen' && it.zone === sibling && it.beidseitig,
  );
  return [...own, ...mirrored];
}

// Inhalt eines Behälters (über dessen uid).
export function itemsInContainer(items: readonly Item[], containerUid: string): Item[] {
  return items.filter((it) => it.location === 'behaelter' && it.containerUid === containerUid);
}

// Belegtes Gewicht eines Behälters (kg) — Summe der Inhalte OHNE Reduktion
// (roher Inhalt).
export function containerFuellung(items: readonly Item[], containerUid: string): number {
  return itemsInContainer(items, containerUid).reduce((s, it) => s + itemGewicht(it), 0);
}

// Effektive Füllung eines Behälters (kg): Inhaltsgewicht NACH Abzug der
// Gewichtsreduktion des Behälters. Diese Zahl zählt gegen das Fassungsvermögen —
// ein Beutel mit 50 % Reduktion und 60 kg Kapazität fasst so 120 kg roher Ware.
export function containerEffektiveFuellung(items: readonly Item[], containerUid: string): number {
  const byUid = new Map(items.map((it) => [it.uid, it]));
  return itemsInContainer(items, containerUid).reduce((s, it) => s + itemLastAnteil(it, byUid), 0);
}

// Belegte Stückzahl eines Behälters — Summe der `anzahl` seiner Inhalte, für
// Behälter mit kapazitaetArt === 'stueck' (Köcher, Münzbeutel …).
export function containerFuellungStueck(items: readonly Item[], containerUid: string): number {
  return itemsInContainer(items, containerUid).reduce((s, it) => s + (Number(it.anzahl) || 0), 0);
}

// Füllstand eines Behälters in seiner eigenen Einheit (kg oder Stück) — zum
// Vergleich mit seinem `kapazitaet`, ohne dass die aufrufende Stelle zwischen
// beiden Varianten unterscheiden muss.
export function containerFuellungAnzeige(items: readonly Item[], container: Pick<Item, 'uid' | 'kapazitaetArt'>): number {
  return container.kapazitaetArt === 'stueck'
    ? containerFuellungStueck(items, container.uid)
    : containerEffektiveFuellung(items, container.uid);
}

// Alle Behälter (Gegenstände, die andere aufnehmen können).
export function containers(items: readonly Item[]): Item[] {
  return items.filter((it) => it.istBehaelter);
}

// --- Waffen-Stat-Zeilen ---
//
// Effektiver (aufgedeckter) Wert eines Waffen-Felds — leer, solange die Zeile
// fehlt ODER noch verborgen ist. Gilt UNBEDINGT, auch für die eigene SL-Sicht
// (dieselbe Regel wie wornBoni schon für ItemBonus durchsetzt: „effects apply
// only once revealed" — ein noch nicht aufgedecktes Feld wirkt narrativ noch
// nicht, auch nicht in der Proben-Berechnung). Für die Anzeige (Karte/Dialog)
// bleibt die verdeckte Zeile trotzdem in item.waffenStats sichtbar (mit
// geleertem wert, siehe ohneVerborgeneItems) — dort steht sie fürs „???",
// hier zählt sie nicht.
export function waffenStatWert(item: Pick<Item, 'waffenStats'>, feld: WaffenStatFeld): string {
  return item.waffenStats.find((s) => s.feld === feld && !s.verborgen)?.wert ?? '';
}
export function waffenStatZahl(item: Pick<Item, 'waffenStats'>, feld: WaffenStatFeld): number {
  return Number(waffenStatWert(item, feld)) || 0;
}
// Gibt es diese Zeile überhaupt, unabhängig vom Aufdeckungs-Zustand — für den
// GM-Editor (Aufdecken-Knopf, Rohwert bearbeiten), der die volle Zeile sehen
// muss, nicht nur den effektiven Wert.
export function waffenStatZeile(item: Pick<Item, 'waffenStats'>, feld: WaffenStatFeld): WaffenStat | undefined {
  return item.waffenStats.find((s) => s.feld === feld);
}
