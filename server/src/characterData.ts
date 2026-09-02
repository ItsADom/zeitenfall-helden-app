import {
  ATTR_CODES,
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  LIST_SECTIONS,
  MAX_EXTERNAL_ATTR_POINTS,
  MAX_EXTERNAL_ATTR_POINT_NAME,
  MAX_SPECIAL_RESOURCES,
  MAX_SPECIAL_RESOURCE_NAME,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  VISIBILITY_SECTIONS,
  attrPointsActualTotal,
  attrPointsTheoreticalTotal,
  levelForAp,
  computeBaseValues,
  computeResource,
  evaluateEnergyFormula,
  psycheMax,
  dynTabId,
  dynTabKey,
  erleichterung,
  BODY_ZONES,
  CONTAINER_ARTEN,
  KAPAZITAET_ARTEN,
  containerSlotCount,
  DYN_CONTAINER_KEY,
  DYN_SLOTS_KEY,
  INVENTAR_KATEGORIEN,
  isPairedZone,
  ITEM_BONUS_KINDS,
  ITEM_LOCATIONS,
  makeUid,
  ohneVerborgeneItems,
  TALENT_BONUS_FELDER,
  WAFFEN_ARTEN,
  WAFFEN_STAT_FELDER,
  listSectionById,
  readSlots,
  normalizeColumns,
  normalizeTabOrder,
  normalizeWidths,
  talentProbeZahl,
  weaponProbes,
  wornBoni,
  attrsMitBoni,
  baseInputsMitBoni,
  resourceInputMitBoni,
  specialMitBoni,
  talentMitBoni,
  talentProbeBonus,
} from 'shared';
import type {
  Ability,
  AttrCode,
  Attributes,
  BaseValueInputs,
  CharTalent,
  CharLanguage,
  CoinPouch,
  ContainerArt,
  KapazitaetArt,
  DynColumn,
  EnergyFormulaVars,
  ExternalAttrPoint,
  Item,
  ItemBonus,
  ItemBonusKind,
  ItemLocation,
  ItemOp,
  ItemOwnerType,
  ResourceInput,
  Resources,
  SpecialResource,
  StatBoni,
  TalentBonusFeld,
  VisibilitySection,
  WaffenArt,
  WaffenStat,
  WaffenStatFeld,
} from 'shared';
import { db, initCharacterRows } from './db.js';
import {
  hatPortrait,
  ladePortrait,
  loeschePortrait,
  speicherePortrait,
  speicherePortraitOriginal,
} from './assets/portraits.js';
import { createDynSection, createTab, loadDynSections, loadDynTabs, saveDynRows, updateDynSection } from './dynSections.js';

// --- Laden ---

export function loadAttributesRaw(charId: number): Attributes {
  const rows = db.prepare('SELECT attr, akt, mod FROM char_attributes WHERE character_id = ?').all(charId) as {
    attr: string;
    akt: number;
    mod: number;
  }[];
  const out = {} as Attributes;
  for (const code of ATTR_ROW_CODES) out[code] = { akt: 0, mod: 0 };
  for (const r of rows) if (r.attr in out) out[r.attr as keyof Attributes] = { akt: r.akt, mod: r.mod };
  return out;
}

export function loadBaseValueInputsRaw(charId: number): BaseValueInputs {
  const rows = db.prepare('SELECT key, mod, base FROM char_base_values WHERE character_id = ?').all(charId) as {
    key: string;
    mod: number;
    base: number;
  }[];
  const mods = Object.fromEntries(BASE_VALUE_KEYS.map((k) => [k, 0])) as BaseValueInputs['mods'];
  let gsBase = 0;
  let resilienzBase = 0;
  let mrBase = 0;
  let akBase = 0;
  for (const r of rows) {
    if (BASE_VALUE_KEYS.includes(r.key as never)) mods[r.key as keyof typeof mods] = r.mod;
    if (r.key === 'gs') gsBase = r.base;
    if (r.key === 'resilienz') resilienzBase = r.base;
    if (r.key === 'mr') mrBase = r.base;
    if (r.key === 'artefaktkontrolle') akBase = r.base;
  }
  return { mods, gsBase, resilienzBase, mrBase, akBase };
}

export function loadResourcesRaw(charId: number): Resources {
  const rows = db
    .prepare('SELECT key, permanent, kauf, kaufMax, maxPlus, aktuell, besonderes, raceBase FROM char_resources WHERE character_id = ?')
    .all(charId) as ({ key: string } & Resources['le'])[];
  const empty = () => ({ permanent: 0, kauf: 0, kaufMax: 0, maxPlus: 0, aktuell: 0, besonderes: '', raceBase: 0 });
  const out = { le: empty(), aus: empty(), ase: empty() } as Resources;
  for (const r of rows) {
    if (RESOURCE_KEYS.includes(r.key as never)) {
      const { key, ...rest } = r;
      out[key as keyof Resources] = rest;
    }
  }
  return out;
}

export function loadSingleRow(table: 'char_bio' | 'char_meta', charId: number): Record<string, unknown> {
  const row = (db.prepare(`SELECT * FROM ${table} WHERE character_id = ?`).get(charId) ?? {}) as Record<string, unknown>;
  delete row.character_id;
  return row;
}

export function loadTalents(charId: number): CharTalent[] {
  const rows = db
    .prepare(
      `SELECT talent_id AS talentId, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus, notiz, favorit
       FROM char_talents WHERE character_id = ?`,
    )
    .all(charId) as (Omit<CharTalent, 'favorit'> & { favorit: number })[];
  return rows.map((r) => ({ ...r, favorit: !!r.favorit }));
}

export function loadLanguages(charId: number): CharLanguage[] {
  const rows = db
    .prepare('SELECT language_id AS languageId, taw, muttersprache FROM char_languages WHERE character_id = ?')
    .all(charId) as { languageId: number; taw: number; muttersprache: number }[];
  return rows.map((r) => ({ languageId: r.languageId, taw: r.taw, muttersprache: !!r.muttersprache }));
}

export function loadSpecialResources(charId: number): SpecialResource[] {
  return db
    .prepare('SELECT catalog_id AS catalogId, name, max, bonus, aktuell FROM char_special_resources WHERE character_id = ? ORDER BY pos, id')
    .all(charId) as SpecialResource[];
}

// Live-Maximum einer Spezialenergie: hat der Katalog-Eintrag eine Formel, ist
// das gespeicherte `max` nur ein ungenutzter Snapshot (siehe SpecialResource in
// shared/src/types.ts) — dasselbe evaluateEnergyFormula(...) + bonus wie im
// Heldenbrief (Heldenbrief.tsx computedMax), nur serverseitig, damit GM-Übersicht
// und Gruppen-Karten nicht den veralteten Snapshot statt des echten Werts zeigen.
function spezialenergieMax(sr: SpecialResource, formelnById: Map<number, string>, vars: EnergyFormulaVars): number {
  const formula = sr.catalogId != null ? (formelnById.get(sr.catalogId) ?? '') : '';
  if (!formula) return sr.max;
  const formulaMax = evaluateEnergyFormula(formula, vars);
  return formulaMax != null ? formulaMax + sr.bonus : sr.max;
}

function ladeSpezialenergieFormeln(): Map<number, string> {
  const rows = db.prepare('SELECT id, formula FROM special_energies_catalog').all() as { id: number; formula: string }[];
  return new Map(rows.map((r) => [r.id, r.formula]));
}

// Eingaben für eine Berechnung, EINMAL geladen (Attribute/Basiswerte/Ressourcen/
// Spezialenergien/Talente/Psyche/Traglast) — Gegenstück zu den *Raw-Ladern oben,
// die absichtlich roh bleiben (Bearbeiten-Pfad, siehe loadFullCharacter). Jeder
// NEUE Rechen-Aufrufort verwendet diese Funktion statt einzelner *Raw-Aufrufe,
// damit ein Bonus, der an einer Stelle einfließt (z. B. ein getragener
// Gegenstand), automatisch überall ankommt — Regel: eine Berechnung liest immer
// den vollen Wert, nie den rohen, sofern nicht ausdrücklich anders verlangt.
// Item-Boni fließen HIER ein (wornBoni + die *MitBoni-Helfer aus shared/items.ts)
// — jeder Aufrufer, der schon auf loadStats umgestellt ist (saveSection,
// buildSummary, overviewForChars, board.ts, diceSource.ts, ws.ts), bekommt sie
// dadurch automatisch, ohne selbst etwas zu wissen.
export interface CharStats {
  attrs: Attributes;
  baseInputs: BaseValueInputs;
  resources: Resources;
  special: SpecialResource[];
  talente: CharTalent[];
  psycheBonus: number;
  traglastBonus: number;
  // Roher StatBoni-Akkumulator, nur für Aufrufer, die die Boni selbst noch auf
  // einen Wert anwenden müssen, den loadStats nicht schon zurückgibt — z. B.
  // saveSection()'s resources-Zweig, der `input` frisch aus dem Request-Body
  // baut statt aus loadResourcesRaw, und dieselbe Ausbaugrenze für die
  // aktuell-Kappung sehen muss wie das Sheet.
  boni: StatBoni;
}

export function loadStats(charId: number): CharStats {
  const meta = loadSingleRow('char_meta', charId) as { psycheBase?: number; psycheBonus?: number; traglastBonus?: number };
  const boni = wornBoni(loadItems(charId));
  const attrs = attrsMitBoni(loadAttributesRaw(charId), boni);
  const baseInputs = baseInputsMitBoni(loadBaseValueInputsRaw(charId), boni);
  const rawResources = loadResourcesRaw(charId);
  const resources: Resources = {
    le: resourceInputMitBoni(rawResources.le, 'le', boni),
    aus: resourceInputMitBoni(rawResources.aus, 'aus', boni),
    ase: resourceInputMitBoni(rawResources.ase, 'ase', boni),
  };
  const psycheBonus = (meta.psycheBonus ?? 0) + boni.psyche;
  const traglastBonus = (meta.traglastBonus ?? 0) + boni.traglast;

  const vars: EnergyFormulaVars = {
    attrs,
    leMax: computeResource(attrs, 'le', resources.le).nutzbar,
    auMax: computeResource(attrs, 'aus', resources.aus).nutzbar,
    aseMax: computeResource(attrs, 'ase', resources.ase).nutzbar,
    psycheMax: psycheMax(attrs, meta.psycheBase ?? 0, psycheBonus),
  };
  const formelnById = ladeSpezialenergieFormeln();
  const special = loadSpecialResources(charId).map((sr) => {
    const srMitBonus = specialMitBoni(sr, boni);
    return { ...srMitBonus, max: spezialenergieMax(srMitBonus, formelnById, vars) };
  });

  // Ein Item-Bonus kann ein Talent treffen, das der Charakter nie angerührt hat
  // (kein char_talents-Eintrag) — ein „ungelernter Versuch" ist trotzdem
  // würfelbar (siehe computeProbeForCharacter), und der Client synthetisiert
  // für genau diesen Fall schon eine leere Zeile (Talente.tsx, EMPTY). Ohne
  // dasselbe hier würde ein Wurf den Bonus nicht sehen, den das Blatt (und
  // buildSummary) längst anzeigen — das Sheet/Wurf-Auseinanderlaufen, das
  // dieser Plan eigentlich schließt.
  const geladeneTalente = loadTalents(charId).map((t) => talentMitBoni(t, boni));
  const bekannteIds = new Set(geladeneTalente.map((t) => t.talentId));
  const boniNurTalente = Object.keys(boni.talente)
    .map(Number)
    .filter((id) => !bekannteIds.has(id))
    .map((talentId) =>
      talentMitBoni(
        { talentId, taw: 0, at: 0, pa: 0, bl: 0, spezialisierung: '', waffenmeister: '', berufsbonus: '', notiz: '', favorit: false },
        boni,
      ),
    );

  return {
    attrs,
    baseInputs,
    resources,
    special,
    talente: [...geladeneTalente, ...boniNurTalente],
    psycheBonus,
    traglastBonus,
    boni,
  };
}

export function loadExternalAttrPoints(charId: number): ExternalAttrPoint[] {
  return db
    .prepare('SELECT quelle, punkte FROM char_attr_extern WHERE character_id = ? ORDER BY pos, id')
    .all(charId) as ExternalAttrPoint[];
}

export function loadList(sectionId: string, charId: number): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM sec_${sectionId} WHERE character_id = ? ORDER BY pos, id`).all(charId) as Record<
    string,
    unknown
  >[];
}

export function loadAllLists(charId: number): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const s of LIST_SECTIONS) out[s.id] = loadList(s.id, charId);
  return out;
}

export function loadVisibility(charId: number): Record<VisibilitySection, boolean> {
  const rows = db.prepare('SELECT section, visible FROM character_visibility WHERE character_id = ?').all(charId) as {
    section: string;
    visible: number;
  }[];
  const out = Object.fromEntries(VISIBILITY_SECTIONS.map((s) => [s, false])) as Record<VisibilitySection, boolean>;
  for (const r of rows) if (r.section in out) out[r.section as VisibilitySection] = !!r.visible;
  return out;
}

// --- Spaltenbreiten der eingebauten Tabellen ---
//
// Der Schlüssel benennt die Tabelle im Client (z. B. 'list:vorteile' oder
// 'talente:Körperliche Talente'); der Server kennt ihn absichtlich nicht im
// Detail, sondern behandelt ihn als undurchsichtige Kennung. So kommen neue
// Tabellen ohne Server-Änderung aus. Geprüft wird nur, dass die Werte plausibel
// sind — normalisiert wird beim Speichern.

export const MAX_TABLE_KEY = 120;
export const MAX_TABLE_COLUMNS = 64;

export function loadTableWidths(charId: number): Record<string, number[]> {
  const rows = db.prepare('SELECT table_key, widths FROM character_table_widths WHERE character_id = ?').all(charId) as {
    table_key: string;
    widths: string;
  }[];
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.widths) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        out[r.table_key] = parsed as number[];
      }
    } catch {
      // Defekter Eintrag — die Tabelle fällt auf Gleichverteilung zurück
    }
  }
  return out;
}

export function saveTableWidths(charId: number, tableKey: string, widths: number[]): void {
  db.prepare(
    `INSERT INTO character_table_widths (character_id, table_key, widths) VALUES (?, ?, ?)
     ON CONFLICT (character_id, table_key) DO UPDATE SET widths = excluded.widths`,
  ).run(charId, tableKey, JSON.stringify(widths));
}

// --- Reihenfolge der Reiter ---
//
// Auch hier bleibt der Server absichtlich unwissend: er prüft nur, dass eine
// Liste kurzer Zeichenketten ankommt, und verlässt sich darauf, dass der Client
// unbekannte Schlüssel beim Anzeigen wegfiltert. Sonst müsste jede neue Reiter-
// Art am Server nachgezogen werden.

export function loadTabOrder(charId: number): string[] {
  const row = db.prepare('SELECT keys FROM character_tab_order WHERE character_id = ?').get(charId) as
    | { keys: string }
    | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.keys) as unknown;
    return Array.isArray(parsed) ? normalizeTabOrder(parsed) : [];
  } catch {
    return []; // Defekter Eintrag — es gilt die Voreinstellung
  }
}

export function saveTabOrder(charId: number, keys: string[]): void {
  db.prepare(
    `INSERT INTO character_tab_order (character_id, keys) VALUES (?, ?)
     ON CONFLICT (character_id) DO UPDATE SET keys = excluded.keys`,
  ).run(charId, JSON.stringify(keys));
}

// --- Standard-Vorlage & Migration der festen Listen in Tabs mit Sektionen ---

// Konfigurierbare Inhalts-Tabs (die berechneten Tabs Heldenbrief/Talente/Waffen/
// Sprachen sind im Client fest). locked = Pflicht-Tab (nicht löschbar).
const VORTEILE_TAB = 'Vorteile & Nachteile';

// Alle jemals ausgelieferten Standard-Tabs. Dient HEUTE nur noch der Migration
// alter Charaktere (migrateCharacterPeriphery überführt darüber ihre Listendaten
// in Tabs). FRISCHE Charaktere bekommen davon nur NEW_CHARACTER_TABS — die Liste
// bleibt hier vollständig, damit ein noch nicht migrierter Alt-Charakter beim
// Migrieren nichts verliert (oberste Regel: kein stiller Datenverlust).
const STANDARD_TABS: { name: string; locked: boolean; sectionIds: string[] }[] = [
  { name: VORTEILE_TAB, locked: true, sectionIds: ['professionBoni', 'vorteile', 'nachteile', 'titel', 'perks'] },
  // „Inventar" und „Ausrüstung" sind seit Cluster 5 eingebaute Reiter auf dem
  // Gegenstands-Modell (char_items) — keine dynamischen Sektionen mehr. Neue
  // Charaktere bekommen stattdessen ein paar Standard-Kategorien (seedItemCategories).
  { name: 'Zauber/Fähigkeiten', locked: true, sectionIds: [] },
  { name: 'Bibliothek', locked: true, sectionIds: ['bibliothek'] },
  { name: 'Artefakte', locked: false, sectionIds: ['kraftspeicher', 'artefakte'] },
  { name: 'Besitz', locked: false, sectionIds: ['waehrungen', 'schulden', 'wertgegenstaende', 'einnahmequellen', 'immobilien', 'besitzSonstiges'] },
  { name: 'Boni', locked: false, sectionIds: ['boni'] },
  { name: 'Vorlieben', locked: false, sectionIds: ['vorlieben'] },
];

// Dynamische Tabs, die ein NEUER Charakter erhält. Bewusst nur „Vorteile &
// Nachteile" — die übrigen früheren Standard-Tabs (Zauber/Fähigkeiten,
// Bibliothek, Artefakte, Besitz, Boni, Vorlieben) legt der Spieler bei Bedarf
// selbst an. Der Rest der Startreiter ist im Client eingebaut (Heldenbrief,
// Talente, Waffen, Zauber, Fähigkeiten, Inventar, Ausrüstung, Sprachen).
const NEW_CHARACTER_TABS = STANDARD_TABS.filter((t) => t.name === VORTEILE_TAB);

const ZAUBER_TAB = 'Zauber/Fähigkeiten';

// Einmaliger Nachtrag: „Vorteile & Nachteile" war als einziger der ersten fünf
// Standard-Reiter löschbar, obwohl er wie die übrigen zum Grundgerüst gehört.
// Läuft genau einmal über PRAGMA user_version als Migrationszähler (2 = Reiter
// nachträglich zum Pflicht-Tab gemacht); ein später selbst angelegter Reiter
// gleichen Namens bleibt also löschbar.
export function lockVorteileTab(): void {
  if (Number(db.pragma('user_version', { simple: true })) >= 2) return;
  const tx = db.transaction(() => {
    db.prepare('UPDATE char_tabs SET locked = 1 WHERE name = ? AND locked = 0').run(VORTEILE_TAB);
    db.pragma('user_version = 2');
  });
  tx();
}

// Für die Ausrüstungs-Sektionen: welche Spalte den Gegenstandsnamen trägt.
// Diese Spalte bekommt beim Anlegen den Typ 'equipment' und schaltet damit die
// Behälter-Funktion (feste Fächer je Zeile, z. B. Gürtel mit 4 Steckplätzen)
// direkt frei — ohne dass der Spieler die Spalte erst umstellen muss.
const EQUIPMENT_NAME_COL: Record<string, string> = {
  ausruestungSlots: 'beschreibung',
  behaelter: 'name',
  proviant: 'name',
  kleidungen: 'kleidung',
  tierAusruestung: 'name',
};

function zauberColumns(): DynColumn[] {
  return [
    { key: 'name', label: 'Name', type: 'text', width: 220 },
    { key: 'stufe', label: 'Stufe', type: 'text', width: 80 },
    { key: 'kosten', label: 'Kosten', type: 'text', width: 90 },
    { key: 'probe', label: 'Probe', type: 'text', width: 120 },
    { key: 'probeZahl', label: 'Probe (Zahl)', type: 'probe', width: 100, probeExprKey: 'probe' },
    { key: 'probeZahlManuell', label: 'Probe (manuell)', type: 'number', width: 100 },
    { key: 'effekt', label: 'Effekt', type: 'text', width: 300 },
    { key: 'fortschritt', label: 'Fortschritt', type: 'number', width: 90 },
  ];
}

function toDynColumns(
  defs: { key: string; label: string; type: string; width?: number }[],
  equipmentKey?: string,
): DynColumn[] {
  return defs
    .filter((c) => c.key !== 'notiz')
    .map((c) => {
      const base = (['text', 'number', 'bool'] as const).includes(c.type as never) ? (c.type as DynColumn['type']) : 'text';
      // Die Namens-/Gegenstandsspalte einer Ausrüstungs-Sektion als 'equipment'
      // markieren — verhält sich wie Text, schaltet aber die Behälter-Funktion frei.
      const type: DynColumn['type'] = c.key === equipmentKey ? 'equipment' : base;
      const col: DynColumn = { key: c.key, label: c.label, type };
      if (c.width) col.width = Math.max(90, c.width * 60);
      return col;
    });
}

const stripRowMeta = (row: Record<string, unknown>): Record<string, unknown> => {
  const { id, character_id, pos, ...rest } = row;
  void id;
  void character_id;
  void pos;
  return rest;
};

// Legt die Standard-Tabs samt Sektionen an; getRows liefert die Zeilen je Listen-ID.
function buildStandardTabs(
  charId: number,
  getRows: (sectionId: string) => Record<string, unknown>[],
  tabDefs: readonly { name: string; locked: boolean; sectionIds: string[] }[] = STANDARD_TABS,
): number {
  let created = 0;
  for (const tabDef of tabDefs) {
    const tabId = createTab(charId, tabDef.name, tabDef.locked);
    for (const sid of tabDef.sectionIds) {
      const def = listSectionById(sid);
      if (!def) continue;
      const secId = createDynSection(charId, tabId, def.label, 'table', toDynColumns(def.columns, EQUIPMENT_NAME_COL[sid]));
      created++;
      const rows = getRows(sid);
      if (rows.length) saveDynRows(secId, rows);
    }
  }
  return created;
}

// Leere Standard-Tabs für einen neuen Charakter anlegen.
export function instantiateStandardSections(charId: number): void {
  const tx = db.transaction(() => {
    buildStandardTabs(charId, () => [], NEW_CHARACTER_TABS);
    seedItemCategories(charId);
  });
  tx();
}

// Ein paar sinnvolle Ausgangs-Kategorien für einen neuen Owner (Charakter,
// Gruppenpool, GM-Pool), sofern er noch keine hat. Frei änderbar — nur eine
// Starthilfe, kein Zwang. Idempotent, damit sie auch für den GM-Pool (der
// keinen eigenen Anlege-Zeitpunkt hat) bei jedem Zugriff gefahrlos erneut
// aufgerufen werden kann (siehe GET-Route für den GM-Pool).
export function seedItemCategoriesForOwner(ownerType: ItemOwnerType, ownerId: number): void {
  const have = (
    db.prepare('SELECT COUNT(*) AS n FROM char_item_categories WHERE owner_type = ? AND owner_id = ?').get(ownerType, ownerId) as {
      n: number;
    }
  ).n;
  if (have > 0) return;
  const ins = db.prepare('INSERT INTO char_item_categories (owner_type, owner_id, pos, name) VALUES (?, ?, ?, ?)');
  INVENTAR_KATEGORIEN.forEach((name, i) => ins.run(ownerType, ownerId, i, name));
}

export function seedItemCategories(charId: number): void {
  seedItemCategoriesForOwner('character', charId);
}

// Einmalige Migration (Cluster 5a): den früheren dynamischen „Inventar"-Reiter
// jedes Charakters in das Gegenstands-Modell (char_items) überführen und den
// alten Reiter entfernen. Läuft genau einmal über PRAGMA user_version (= 3).
//
// Datenverlust vermeiden (oberste Regel): bekannte Spalten werden abgebildet,
// alle anderen (selbst angelegte) wandern als „Label: Wert" in die Notiz.
const KNOWN_INV_KEYS = new Set(['name', 'anzahl', 'eGewicht', 'kategorie', 'notiz']);

export function migrateInventarToItems(): void {
  if (Number(db.pragma('user_version', { simple: true })) >= 3) return;
  const tx = db.transaction(() => {
    const tabs = db.prepare("SELECT id, character_id FROM char_tabs WHERE name = 'Inventar'").all() as {
      id: number;
      character_id: number;
    }[];
    for (const tab of tabs) {
      const charId = tab.character_id;
      const sections = db.prepare('SELECT id, columns FROM char_sections WHERE tab_id = ? ORDER BY pos, id').all(tab.id) as {
        id: number;
        columns: string;
      }[];
      let pos = (db.prepare('SELECT COALESCE(MAX(pos), -1) AS m FROM char_items WHERE character_id = ?').get(charId) as { m: number }).m + 1;
      const existingCats = new Set(loadItemCategories(charId));
      const catsSeen: string[] = [];
      const insItem = db.prepare(
        'INSERT INTO char_items (character_id, pos, uid, name, anzahl, gewicht, kategorie, location, notiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const sec of sections) {
        let cols: DynColumn[] = [];
        try {
          cols = JSON.parse(sec.columns) as DynColumn[];
        } catch {
          cols = [];
        }
        const labelByKey = new Map(cols.map((c) => [c.key, c.label]));
        const rows = db.prepare('SELECT data FROM char_section_rows WHERE section_id = ? ORDER BY pos, id').all(sec.id) as {
          data: string;
        }[];
        for (const r of rows) {
          let d: Record<string, unknown> = {};
          try {
            d = JSON.parse(r.data) as Record<string, unknown>;
          } catch {
            d = {};
          }
          const name = String(d.name ?? '').trim();
          const anzahl = Number(d.anzahl) || 0;
          const gewicht = Number(d.eGewicht) || 0;
          const kategorie = String(d.kategorie ?? '').trim();
          // Nicht abbildbare Spalten in die Notiz falten — nichts geht verloren.
          const extras: string[] = [];
          for (const [k, v] of Object.entries(d)) {
            if (KNOWN_INV_KEYS.has(k)) continue;
            const val = String(v ?? '').trim();
            if (val) extras.push(`${labelByKey.get(k) ?? k}: ${val}`);
          }
          let notiz = String(d.notiz ?? '').trim();
          if (extras.length) notiz = notiz ? `${notiz}\n${extras.join('\n')}` : extras.join('\n');
          if (!name && !anzahl && !gewicht && !kategorie && !notiz) continue; // ganz leere Zeile
          insItem.run(charId, pos++, makeUid(), name, anzahl, gewicht, kategorie, 'inventar', notiz);
          if (kategorie && !existingCats.has(kategorie) && !catsSeen.includes(kategorie)) catsSeen.push(kategorie);
        }
      }
      if (catsSeen.length) {
        let cpos =
          (db.prepare('SELECT COALESCE(MAX(pos), -1) AS m FROM char_item_categories WHERE character_id = ?').get(charId) as { m: number }).m + 1;
        const insCat = db.prepare('INSERT INTO char_item_categories (character_id, pos, name) VALUES (?, ?, ?)');
        for (const c of catsSeen) insCat.run(charId, cpos++, c);
      }
      // Alten dynamischen Reiter samt Sektionen/Zeilen entfernen (ON DELETE CASCADE).
      db.prepare('DELETE FROM char_tabs WHERE id = ?').run(tab.id);
      // In der gemerkten Reiter-Reihenfolge den alten Schlüssel durch den
      // eingebauten 'Inventar' ersetzen — die Position bleibt so erhalten.
      const ord = db.prepare('SELECT keys FROM character_tab_order WHERE character_id = ?').get(charId) as { keys: string } | undefined;
      if (ord) {
        let keys: string[] = [];
        try {
          keys = JSON.parse(ord.keys) as string[];
        } catch {
          keys = [];
        }
        const oldKey = dynTabKey(tab.id);
        const idx = keys.indexOf(oldKey);
        if (idx >= 0) keys[idx] = 'Inventar';
        else if (!keys.includes('Inventar')) keys.push('Inventar');
        keys = keys.filter((k, i) => keys.indexOf(k) === i); // doppeltes 'Inventar' vermeiden
        db.prepare('UPDATE character_tab_order SET keys = ? WHERE character_id = ?').run(JSON.stringify(keys), charId);
      }
    }
    db.pragma('user_version = 3');
  });
  tx();
}

// --- Migration (Cluster 5b): dynamische „Ausrüstung" ins Gegenstands-Modell ---
//
// Läuft genau einmal über PRAGMA user_version (= 4). Überführt jeden dynamischen
// „Ausrüstung"-Reiter (getragene Ausrüstung, Behälter, Proviant, Kleidungen,
// Tier-Ausrüstung) in char_items und entfernt den alten Reiter. Datenverlust
// vermeiden (oberste Regel): bekannte Felder werden abgebildet, alle anderen
// wandern als „Label: Wert" in die Notiz. Der Behälter-/Fächer-Prototyp
// (__faecher/__inhalt) wird zu echten Behälter-Gegenständen mit Inhalt.

// Freitext einer „Körperstelle" auf eine feste Zone abbilden (best effort).
function mapSlotToZone(raw: string): string {
  const s = raw.toLowerCase();
  const links = /links|linke|linker|linkes|\bli\.?\b/.test(s);
  const rechts = /rechts|rechte|rechter|rechtes|\bre\.?\b/.test(s);
  if (s.includes('kopf') || s.includes('helm') || s.includes('haupt')) return 'Kopf';
  if (s.includes('hals') || s.includes('nacken') || s.includes('kragen')) return 'Hals';
  if (s.includes('hand') || s.includes('finger') || s.includes('handschuh')) return rechts ? 'Hand rechts' : 'Hand links';
  if (s.includes('arm') || s.includes('schulter')) return rechts ? 'Arm rechts' : 'Arm links';
  if (s.includes('gürtel') || s.includes('guertel') || s.includes('bauch') || s.includes('hüfte') || s.includes('huefte')) return 'Gürtel';
  if (s.includes('fuß') || s.includes('fuss') || s.includes('füße') || s.includes('fuesse') || s.includes('stiefel') || s.includes('schuh')) return 'Füße';
  if (s.includes('bein') || s.includes('knie') || s.includes('schenkel')) return rechts ? 'Bein rechts' : 'Bein links';
  if (s.includes('rücken') || s.includes('ruecken') || s.includes('umhang') || s.includes('mantel') || s.includes('cape')) return 'Rücken';
  if (s.includes('brust') || s.includes('torso') || s.includes('körper') || s.includes('koerper') || s.includes('rüstung') || s.includes('ruestung') || s.includes('panzer')) return 'Brust';
  void links;
  return '';
}

const numText = (v: unknown): number => {
  const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};

interface AusrItem {
  uid: string;
  name: string;
  anzahl: number;
  gewicht: number;
  kategorie: string;
  location: ItemLocation;
  zone: string;
  beidseitig: boolean;
  containerUid: string;
  istBehaelter: boolean;
  containerArt: ContainerArt;
  kapazitaet: number;
  gewichtsreduktion: number;
  rs: number;
  haltbarkeitMax: number;
  haltbarkeitAktuell: number;
  notiz: string;
}

// Eine dynamische Ausrüstungs-Zeile in einen (oder mehrere, bei Fächern)
// Gegenstände übersetzen. `keys` sind die Spaltenschlüssel der Sektion, über die
// der Typ erkannt wird; `labelByKey` liefert die Beschriftungen für die Notiz.
function ausrRowToItems(
  d: Record<string, unknown>,
  keys: Set<string>,
  labelByKey: Map<string, string>,
): AusrItem[] {
  const consumed = new Set<string>(['notiz', DYN_CONTAINER_KEY, DYN_SLOTS_KEY]);
  const extras: string[] = [];
  const note = (label: string, val: unknown) => {
    const s = String(val ?? '').trim();
    if (s) extras.push(`${label}: ${s}`);
  };

  const base: AusrItem = {
    uid: makeUid(), name: '', anzahl: 1, gewicht: 0, kategorie: '',
    location: 'inventar', zone: '', beidseitig: false, containerUid: '', istBehaelter: false, containerArt: 'storage',
    kapazitaet: 0, gewichtsreduktion: 0, rs: 0, haltbarkeitMax: 0, haltbarkeitAktuell: 0, notiz: '',
  };

  if (keys.has('slot') && keys.has('beschreibung')) {
    // Getragene Ausrüstung → am Körper.
    base.name = String(d.beschreibung ?? '').trim();
    base.location = 'getragen';
    base.zone = mapSlotToZone(String(d.slot ?? ''));
    consumed.add('slot').add('beschreibung');
    if (!base.zone) note('Körperstelle', d.slot);
  } else if (keys.has('kapazitaet')) {
    // Behälter → Stauraum, mitgeführt (oberste Ebene).
    base.name = String(d.name ?? '').trim();
    base.istBehaelter = true;
    base.containerArt = 'storage';
    base.kapazitaet = numText(d.kapazitaet);
    consumed.add('name').add('kapazitaet');
    if (!base.kapazitaet) note('Kapazität', d.kapazitaet);
  } else if (keys.has('portionen')) {
    // Proviant/Tränke/Magisches → loser Alt-Bestand (Migration).
    base.name = String(d.name ?? '').trim();
    base.anzahl = Number(d.portionen) || 1;
    base.gewicht = Number(d.gewicht) || 0;
    base.kategorie = 'Tränke/Proviant';
    consumed.add('name').add('portionen').add('gewicht');
  } else if (keys.has('kleidung')) {
    // Kleidungen → abgelegt (nicht getragene Ausrüstung, auf der Bank).
    base.name = String(d.kleidung ?? '').trim();
    base.gewicht = Number(d.gewicht) || 0;
    base.location = 'bench';
    consumed.add('kleidung').add('gewicht').add('anlass');
    note('Anlass', d.anlass);
  } else if (keys.has('tier')) {
    // Tier-Ausrüstung → loser Alt-Bestand (der Tier-Bereich wurde entfernt;
    // wer will, legt sich dafür einen eigenen Reiter an). Das Tier steht in der Notiz.
    base.name = String(d.name ?? '').trim();
    base.gewicht = Number(d.gewicht) || 0;
    base.location = 'inventar';
    consumed.add('name').add('gewicht').add('tier');
    note('Tier', d.tier);
  } else {
    // Unbekannte (selbst angelegte) Sektion: Name best effort, Rest in die Notiz.
    const nameKey = keys.has('name') ? 'name' : [...keys].find((k) => String(d[k] ?? '').trim());
    base.name = String((nameKey && d[nameKey]) ?? '').trim();
    if (nameKey) consumed.add(nameKey);
  }

  // Fächer-Prototyp: Zeile wird zum Behälter, jedes belegte Fach zum Inhalt.
  // Ein getragener Fächer-Behälter (z. B. Gürtel) ist Schnellzugriff (quick);
  // sonst Stauraum. Der Inhalt zählt weiterhin als getragen (behaelter).
  const children: AusrItem[] = [];
  if (containerSlotCount(d) > 0) {
    base.istBehaelter = true;
    base.containerArt = base.location === 'getragen' ? 'quick' : 'storage';
    for (const slotName of readSlots(d)) {
      const nm = slotName.trim();
      if (!nm) continue;
      children.push({ ...base, uid: makeUid(), name: nm, anzahl: 1, gewicht: 0,
        location: 'behaelter', zone: '', beidseitig: false, containerUid: base.uid, istBehaelter: false, containerArt: 'storage',
        kapazitaet: 0, gewichtsreduktion: 0, rs: 0, haltbarkeitMax: 0, haltbarkeitAktuell: 0, notiz: '' });
    }
  }

  // Nicht abgebildete Spalten in die Notiz falten — nichts geht verloren.
  for (const [k, v] of Object.entries(d)) {
    if (consumed.has(k)) continue;
    const val = String(v ?? '').trim();
    if (val) extras.push(`${labelByKey.get(k) ?? k}: ${val}`);
  }
  const ownNote = String(d.notiz ?? '').trim();
  base.notiz = [ownNote, ...extras].filter(Boolean).join('\n');

  // Ganz leere Zeile überspringen (kein Name, kein Gewicht, keine Notiz, keine Fächer).
  if (!base.name && !base.gewicht && !base.notiz && !base.istBehaelter && children.length === 0) return [];
  return [base, ...children];
}

export function migrateAusruestungToItems(): void {
  if (Number(db.pragma('user_version', { simple: true })) >= 4) return;
  const tx = db.transaction(() => {
    const tabs = db.prepare("SELECT id, character_id FROM char_tabs WHERE name = 'Ausrüstung'").all() as {
      id: number;
      character_id: number;
    }[];
    for (const tab of tabs) {
      const charId = tab.character_id;
      const sections = db.prepare('SELECT id, columns FROM char_sections WHERE tab_id = ? ORDER BY pos, id').all(tab.id) as {
        id: number;
        columns: string;
      }[];
      let pos = (db.prepare('SELECT COALESCE(MAX(pos), -1) AS m FROM char_items WHERE character_id = ?').get(charId) as { m: number }).m + 1;
      const existingCats = new Set(loadItemCategories(charId));
      const catsSeen: string[] = [];
      const insItem = db.prepare(
        `INSERT INTO char_items (character_id, pos, uid, name, anzahl, gewicht, kategorie, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, gewichtsreduktion, rs, notiz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const sec of sections) {
        let cols: DynColumn[] = [];
        try {
          cols = JSON.parse(sec.columns) as DynColumn[];
        } catch {
          cols = [];
        }
        const keys = new Set(cols.map((c) => c.key));
        const labelByKey = new Map(cols.map((c) => [c.key, c.label]));
        const rows = db.prepare('SELECT data FROM char_section_rows WHERE section_id = ? ORDER BY pos, id').all(sec.id) as {
          data: string;
        }[];
        for (const r of rows) {
          let d: Record<string, unknown> = {};
          try {
            d = JSON.parse(r.data) as Record<string, unknown>;
          } catch {
            d = {};
          }
          for (const it of ausrRowToItems(d, keys, labelByKey)) {
            insItem.run(
              charId, pos++, it.uid, it.name, it.anzahl, it.gewicht, it.kategorie,
              it.location, it.zone, it.beidseitig ? 1 : 0, it.containerUid, it.istBehaelter ? 1 : 0, it.containerArt, it.kapazitaet,
              it.gewichtsreduktion, it.rs, it.notiz,
            );
            if (it.kategorie && !existingCats.has(it.kategorie) && !catsSeen.includes(it.kategorie)) catsSeen.push(it.kategorie);
          }
        }
      }
      if (catsSeen.length) {
        let cpos =
          (db.prepare('SELECT COALESCE(MAX(pos), -1) AS m FROM char_item_categories WHERE character_id = ?').get(charId) as { m: number }).m + 1;
        const insCat = db.prepare('INSERT INTO char_item_categories (character_id, pos, name) VALUES (?, ?, ?)');
        for (const c of catsSeen) insCat.run(charId, cpos++, c);
      }
      // Alten dynamischen Reiter samt Sektionen/Zeilen entfernen (ON DELETE CASCADE).
      db.prepare('DELETE FROM char_tabs WHERE id = ?').run(tab.id);
      // In der gemerkten Reiter-Reihenfolge den alten Schlüssel durch den
      // eingebauten 'Ausrüstung' ersetzen — die Position bleibt so erhalten.
      const ord = db.prepare('SELECT keys FROM character_tab_order WHERE character_id = ?').get(charId) as { keys: string } | undefined;
      if (ord) {
        let keys: string[] = [];
        try {
          keys = JSON.parse(ord.keys) as string[];
        } catch {
          keys = [];
        }
        const oldKey = dynTabKey(tab.id);
        const idx = keys.indexOf(oldKey);
        if (idx >= 0) keys[idx] = 'Ausrüstung';
        else if (!keys.includes('Ausrüstung')) keys.push('Ausrüstung');
        keys = keys.filter((k, i) => keys.indexOf(k) === i); // doppeltes 'Ausrüstung' vermeiden
        db.prepare('UPDATE character_tab_order SET keys = ? WHERE character_id = ?').run(JSON.stringify(keys), charId);
      }
    }
    db.pragma('user_version = 4');
  });
  tx();
}

// Bestehende Listendaten in Tabs mit Sektionen überführen (idempotent).
export function migrateCharacterPeriphery(charId: number): { created: number } {
  const already = (db.prepare('SELECT COUNT(*) AS n FROM char_tabs WHERE character_id = ?').get(charId) as { n: number }).n;
  if (already > 0) return { created: 0 };
  let created = 0;
  const tx = db.transaction(() => {
    created += buildStandardTabs(charId, (sid) => loadList(sid, charId).map(stripRowMeta));
    // Zauber-Sektionen des Charakters in den Zauber/Fähigkeiten-Tab
    const zTab = db.prepare('SELECT id FROM char_tabs WHERE character_id = ? AND name = ?').get(charId, ZAUBER_TAB) as
      | { id: number }
      | undefined;
    if (zTab) {
      const zSecs = loadList('zauberSektionen', charId);
      const zEntries = loadList('zauberEintraege', charId);
      for (const zs of zSecs) {
        const name = String(zs.name);
        const secId = createDynSection(charId, zTab.id, name, 'table', zauberColumns());
        created++;
        const rows = zEntries
          .filter((e) => e.sektion === name)
          .map((e) => {
            const r = stripRowMeta(e);
            delete r.sektion;
            return r;
          });
        saveDynRows(secId, rows);
      }
    }
  });
  tx();
  return { created };
}

// Zeichnet einmalig einen „Migrationskorrektur"-Eintrag in die externen
// Attributspunkte, wenn ein Charakter (ohne jede externe Quelle) schon mehr
// Punkte gesetzt hat, als die Stufen-Formel theoretisch hergibt — sonst würde
// die Sperre gegen negative Werte im Heldenbrief Bestandscharaktere blockieren.
// Läuft bei jedem Laden mit; sobald eine Zeile existiert, greift es nie wieder.
function ensureAttrPointsMigration(charId: number, meta: Record<string, unknown>, attributes: Attributes): ExternalAttrPoint[] {
  const existing = loadExternalAttrPoints(charId);
  if (existing.length > 0) return existing;
  const level = levelForAp(Number(meta.ap) || 0);
  const deficit = attrPointsActualTotal(attributes) - attrPointsTheoreticalTotal(level, []);
  if (deficit <= 0) return existing;
  db.prepare('INSERT INTO char_attr_extern (character_id, pos, quelle, punkte) VALUES (?, 0, ?, ?)').run(
    charId,
    'Migrationskorrektur',
    deficit,
  );
  return loadExternalAttrPoints(charId);
}

// `requesterIsGm` gates Hidden/revealable Ausrüstung stats (TODO.md): a
// character's own owner is NOT exempt — an unrevealed item stays hidden from
// them too, only the GM sees the real rs/haltbarkeit/bonusse. Called with the
// VIEWER's GM status (viewerFor()'s simulated identity during "Ansehen als"
// in routes.ts), not always the raw session user.
export function loadFullCharacter(charId: number, requesterIsGm: boolean) {
  const meta = loadSingleRow('char_meta', charId);
  const attributes = loadAttributesRaw(charId);
  const items = loadItems(charId);
  return {
    bio: loadSingleRow('char_bio', charId),
    meta,
    attributes,
    baseValues: loadBaseValueInputsRaw(charId),
    resources: loadResourcesRaw(charId),
    special: loadSpecialResources(charId),
    attrExtern: ensureAttrPointsMigration(charId, meta, attributes),
    talents: loadTalents(charId),
    languages: loadLanguages(charId),
    lists: loadAllLists(charId),
    tabs: loadDynTabs(charId),
    visibility: loadVisibility(charId),
    tableWidths: loadTableWidths(charId),
    tabOrder: loadTabOrder(charId),
    portrait: hasPortrait(charId),
    items: requesterIsGm ? items : ohneVerborgeneItems(items),
    itemCategories: loadItemCategories(charId),
    abilities: loadAbilities(charId),
    abilityLists: loadAbilityLists(charId),
    pouches: loadPouches(charId),
  };
}

// --- Gegenstände (Cluster 5) ---

const MAX_ITEMS = 2000;
const MAX_ITEM_TEXT = 4000;
const MAX_CATEGORIES = 200;
const MAX_CATEGORY_LEN = 200;
const MAX_BONUSSE_PRO_ITEM = 20;
const MAX_BONUS_CODE = 64;

const clampMin = (v: unknown, min = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

export function loadItems(charId: number): Item[] {
  return loadItemsForOwner('character', charId);
}

export function loadItemsForOwner(ownerType: ItemOwnerType, ownerId: number): Item[] {
  const rows = db
    .prepare(
      'SELECT id, uid, name, anzahl, gewicht, kategorie, haus, raum, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, haltbarkeit_max, haltbarkeit_aktuell, notiz, rs_verborgen, haltbarkeit_verborgen, waffen_art FROM char_items WHERE owner_type = ? AND owner_id = ? ORDER BY pos, id',
    )
    .all(ownerType, ownerId) as {
    id: number;
    uid: string;
    name: string;
    anzahl: number;
    gewicht: number;
    kategorie: string;
    haus: string;
    raum: string;
    location: string;
    zone: string;
    beidseitig: number;
    container_uid: string;
    ist_behaelter: number;
    container_art: string;
    kapazitaet: number;
    kapazitaet_art: string;
    gewichtsreduktion: number;
    rs: number;
    haltbarkeit_max: number;
    haltbarkeit_aktuell: number;
    notiz: string;
    rs_verborgen: number;
    haltbarkeit_verborgen: number;
    waffen_art: string;
  }[];
  // Zweite Abfrage + Gruppierung in JS statt JOIN, gleiche Form wie loadPouches
  // für char_pouch_coins — ein Item hat 0..N Boni, ein JOIN würde Items ohne
  // Bonus verlieren oder Items mit mehreren Boni vervielfachen.
  const bonusRows = db
    .prepare(
      `SELECT ib.item_id, ib.uid, ib.kind, ib.code, ib.feld, ib.wert, ib.verborgen FROM char_item_bonuses ib
       JOIN char_items ci ON ci.id = ib.item_id WHERE ci.owner_type = ? AND ci.owner_id = ? ORDER BY ib.pos, ib.id`,
    )
    .all(ownerType, ownerId) as { item_id: number; uid: string; kind: string; code: string; feld: string; wert: number; verborgen: number }[];
  const bonusesByItem = new Map<number, ItemBonus[]>();
  for (const r of bonusRows) {
    if (!(ITEM_BONUS_KINDS as string[]).includes(r.kind)) continue;
    const list = bonusesByItem.get(r.item_id) ?? [];
    list.push({
      uid: r.uid || makeUid(),
      kind: r.kind as ItemBonusKind,
      code: r.code,
      feld: r.kind === 'talent' && (TALENT_BONUS_FELDER as string[]).includes(r.feld) ? (r.feld as TalentBonusFeld) : '',
      wert: Number(r.wert) || 0,
      verborgen: !!r.verborgen,
    });
    bonusesByItem.set(r.item_id, list);
  }
  // Waffen-Stat-Zeilen — dieselbe Zweitabfrage-plus-Gruppierung wie bei den
  // Boni oben, aus demselben Grund (0..N Zeilen je Item).
  const weaponStatRows = db
    .prepare(
      `SELECT ws.item_id, ws.uid, ws.feld, ws.wert, ws.verborgen FROM char_item_weapon_stats ws
       JOIN char_items ci ON ci.id = ws.item_id WHERE ci.owner_type = ? AND ci.owner_id = ? ORDER BY ws.pos, ws.id`,
    )
    .all(ownerType, ownerId) as { item_id: number; uid: string; feld: string; wert: string; verborgen: number }[];
  const weaponStatsByItem = new Map<number, WaffenStat[]>();
  for (const r of weaponStatRows) {
    if (!(WAFFEN_STAT_FELDER as string[]).includes(r.feld)) continue;
    const list = weaponStatsByItem.get(r.item_id) ?? [];
    list.push({ uid: r.uid || makeUid(), feld: r.feld as WaffenStatFeld, wert: r.wert, verborgen: !!r.verborgen });
    weaponStatsByItem.set(r.item_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid || makeUid(),
    name: r.name,
    anzahl: r.anzahl,
    gewicht: r.gewicht,
    kategorie: r.kategorie,
    haus: r.haus,
    raum: r.raum,
    location: (ITEM_LOCATIONS as string[]).includes(r.location) ? (r.location as ItemLocation) : 'inventar',
    zone: r.zone,
    beidseitig: !!r.beidseitig,
    containerUid: r.container_uid,
    istBehaelter: !!r.ist_behaelter,
    containerArt: (CONTAINER_ARTEN as string[]).includes(r.container_art) ? (r.container_art as ContainerArt) : 'storage',
    kapazitaet: r.kapazitaet,
    kapazitaetArt: (KAPAZITAET_ARTEN as string[]).includes(r.kapazitaet_art) ? (r.kapazitaet_art as KapazitaetArt) : 'gewicht',
    gewichtsreduktion: r.gewichtsreduktion,
    rs: r.rs,
    haltbarkeitMax: r.haltbarkeit_max,
    haltbarkeitAktuell: r.haltbarkeit_aktuell,
    notiz: r.notiz,
    bonusse: bonusesByItem.get(r.id) ?? [],
    waffenArt: (WAFFEN_ARTEN as string[]).includes(r.waffen_art) ? (r.waffen_art as WaffenArt) : '',
    waffenStats: weaponStatsByItem.get(r.id) ?? [],
    rsVerborgen: !!r.rs_verborgen,
    haltbarkeitVerborgen: !!r.haltbarkeit_verborgen,
  }));
}

export function loadItemCategories(charId: number): string[] {
  return loadItemCategoriesForOwner('character', charId);
}

export function loadItemCategoriesForOwner(ownerType: ItemOwnerType, ownerId: number): string[] {
  return (
    db
      .prepare('SELECT name FROM char_item_categories WHERE owner_type = ? AND owner_id = ? ORDER BY pos, id')
      .all(ownerType, ownerId) as { name: string }[]
  ).map((r) => r.name);
}

// Ganze Liste ersetzen (wie die übrigen Sektionen). Serverseitig gedeckelt und
// normalisiert, damit über die Schnittstelle nichts Unsinniges in die DB kommt.
const ZONE_SET = new Set<string>(BODY_ZONES as readonly string[]);
const clampPct = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));

// Ein zusammengeführtes (bestehend+patch) Item-artiges Objekt auf die
// tatsächlichen DB-Spaltenwerte normalisieren — dieselben Regeln wie die
// frühere Ganze-Liste-saveItems (Zone/Behälter-Konsistenz, Clamps), jetzt für
// EINE Zeile statt die ganze Liste (siehe applyItemOps).
function normalizedItemRow(o: Record<string, unknown>) {
  const loc = (ITEM_LOCATIONS as string[]).includes(String(o.location)) ? String(o.location) : 'inventar';
  const zoneRaw = String(o.zone ?? '');
  const zone = loc === 'getragen' && ZONE_SET.has(zoneRaw) ? zoneRaw : '';
  const beidseitig = isPairedZone(zone) && o.beidseitig ? 1 : 0;
  const containerUid = loc === 'behaelter' ? String(o.containerUid ?? '').slice(0, 64) : '';
  const art = (CONTAINER_ARTEN as string[]).includes(String(o.containerArt)) ? String(o.containerArt) : 'storage';
  const kapArt = (KAPAZITAET_ARTEN as string[]).includes(String(o.kapazitaetArt)) ? String(o.kapazitaetArt) : 'gewicht';
  const haltbarkeitMax = clampMin(o.haltbarkeitMax);
  const haltbarkeitAktuell = Math.min(haltbarkeitMax, clampMin(o.haltbarkeitAktuell));
  const waffenArt = (WAFFEN_ARTEN as string[]).includes(String(o.waffenArt)) ? (String(o.waffenArt) as WaffenArt) : '';
  return {
    name: String(o.name ?? '').slice(0, MAX_ITEM_TEXT),
    anzahl: clampMin(o.anzahl),
    gewicht: clampMin(o.gewicht),
    kategorie: String(o.kategorie ?? '').slice(0, MAX_ITEM_TEXT),
    haus: String(o.haus ?? '').slice(0, MAX_ITEM_TEXT),
    raum: String(o.raum ?? '').slice(0, MAX_ITEM_TEXT),
    location: loc,
    zone,
    beidseitig,
    containerUid,
    istBehaelter: o.istBehaelter ? 1 : 0,
    containerArt: art,
    kapazitaet: clampMin(o.kapazitaet),
    kapazitaetArt: kapArt,
    gewichtsreduktion: clampPct(o.gewichtsreduktion),
    rs: clampMin(o.rs),
    haltbarkeitMax,
    haltbarkeitAktuell,
    notiz: String(o.notiz ?? '').slice(0, MAX_ITEM_TEXT),
    rsVerborgen: o.rsVerborgen ? 1 : 0,
    haltbarkeitVerborgen: o.haltbarkeitVerborgen ? 1 : 0,
    waffenArt,
  };
}

const ITEM_UPDATE_SQL = `UPDATE char_items SET name=?, anzahl=?, gewicht=?, kategorie=?, haus=?, raum=?, location=?, zone=?, beidseitig=?, container_uid=?, ist_behaelter=?, container_art=?, kapazitaet=?, kapazitaet_art=?, gewichtsreduktion=?, rs=?, haltbarkeit_max=?, haltbarkeit_aktuell=?, notiz=?, rs_verborgen=?, haltbarkeit_verborgen=?, waffen_art=? WHERE id=?`;
const itemUpdateParams = (n: ReturnType<typeof normalizedItemRow>, id: number) => [
  n.name, n.anzahl, n.gewicht, n.kategorie, n.haus, n.raum, n.location, n.zone, n.beidseitig, n.containerUid, n.istBehaelter,
  n.containerArt, n.kapazitaet, n.kapazitaetArt, n.gewichtsreduktion, n.rs, n.haltbarkeitMax, n.haltbarkeitAktuell,
  n.notiz, n.rsVerborgen, n.haltbarkeitVerborgen, n.waffenArt, id,
];

const MAX_ITEM_OPS = 500;
const MAX_WEAPON_STATS_PRO_ITEM = 20;
const MAX_WEAPON_STAT_WERT = 4000;

// „Aufdecken" ist einseitig — sobald eine Zeile nicht mehr verdeckt ist, kann
// KEIN Patch sie wieder verstecken, es gibt bewusst keinen Verstecken-Knopf.
// Nur aufrufen, nachdem der Aufrufer bereits als SL bestätigt ist — ein
// Nicht-SL darf das Feld an keiner Stelle anfassen (siehe die jeweiligen
// Aufrufer, die das vorher separat sperren).
function nextVerborgen(existing: boolean, incoming: unknown): boolean {
  if (!existing) return false; // schon sichtbar: bleibt sichtbar, egal was ankommt
  return incoming === undefined ? existing : !!incoming;
}

// Boni-Zeile: Ziel/Feld normalisieren, ungültige kind-Werte verwerfen (wie
// savePouches mit veralteten Katalog-Verweisen umgeht) — Aufrufer prüft vorher
// bereits, ob kind überhaupt geändert werden darf.
function normalizedBonusFields(kind: ItemBonusKind, o: Record<string, unknown>): { code: string; feld: TalentBonusFeld | '' } {
  const feld = kind === 'talent' && (TALENT_BONUS_FELDER as string[]).includes(String(o.feld)) ? (String(o.feld) as TalentBonusFeld) : '';
  const code = kind === 'psyche' || kind === 'traglast' ? '' : String(o.code ?? '').slice(0, MAX_BONUS_CODE);
  return { code, feld };
}

interface WorkingItem extends Omit<Item, 'bonusse' | 'waffenStats'> {
  bonusse: (ItemBonus & { dbId: number })[];
  waffenStats: (WaffenStat & { dbId: number })[];
}

// Incremental item saves (Hidden/revealable Ausrüstung stats, TODO.md — siehe
// diffItems in shared/src/items.ts für die Client-Gegenseite und die
// Begründung, warum ein Ganze-Liste-Ersatz hier nicht mehr geht). Jede Zeile
// (Item wie Bonus) wird über ihre eigene stabile uid angesprochen — ein Op zu
// einer uid, die dieser Client nie gesehen hat (weil sie verdeckt war), kann
// es strukturell gar nicht geben, also muss hier nichts rekonstruiert werden.
export function applyItemOps(charId: number, raw: unknown, requesterIsGm: boolean): void {
  applyItemOpsForOwner('character', charId, raw, requesterIsGm);
}

export function applyItemOpsForOwner(ownerType: ItemOwnerType, ownerId: number, raw: unknown, requesterIsGm: boolean): void {
  const ops = (Array.isArray(raw) ? raw.slice(0, MAX_ITEM_OPS) : []) as Record<string, unknown>[];
  if (ops.length === 0) return;

  // Laufender Arbeitsstand, EINMAL geladen, dann pro Op weitergeschrieben —
  // spätere Ops im selben Batch (z. B. patch direkt nach add) sehen so den
  // Stand vorheriger Ops, ohne zwischendurch neu aus der DB zu lesen.
  const byUid = new Map<string, WorkingItem>();
  const idToUid = new Map<number, string>();
  for (const it of loadItemsForOwner(ownerType, ownerId)) {
    byUid.set(it.uid, { ...it, bonusse: [], waffenStats: [] });
    idToUid.set(it.id, it.uid);
  }
  {
    const bonusRows = db
      .prepare(
        `SELECT ib.id, ib.item_id, ib.uid, ib.kind, ib.code, ib.feld, ib.wert, ib.verborgen FROM char_item_bonuses ib
         JOIN char_items ci ON ci.id = ib.item_id WHERE ci.owner_type = ? AND ci.owner_id = ?`,
      )
      .all(ownerType, ownerId) as { id: number; item_id: number; uid: string; kind: string; code: string; feld: string; wert: number; verborgen: number }[];
    for (const r of bonusRows) {
      const itemUid = idToUid.get(r.item_id);
      const item = itemUid ? byUid.get(itemUid) : undefined;
      if (!item || !(ITEM_BONUS_KINDS as string[]).includes(r.kind)) continue;
      item.bonusse.push({
        dbId: r.id, uid: r.uid || makeUid(), kind: r.kind as ItemBonusKind, code: r.code,
        feld: r.kind === 'talent' && (TALENT_BONUS_FELDER as string[]).includes(r.feld) ? (r.feld as TalentBonusFeld) : '',
        wert: Number(r.wert) || 0, verborgen: !!r.verborgen,
      });
    }
  }
  {
    const statRows = db
      .prepare(
        `SELECT ws.id, ws.item_id, ws.uid, ws.feld, ws.wert, ws.verborgen FROM char_item_weapon_stats ws
         JOIN char_items ci ON ci.id = ws.item_id WHERE ci.owner_type = ? AND ci.owner_id = ?`,
      )
      .all(ownerType, ownerId) as { id: number; item_id: number; uid: string; feld: string; wert: string; verborgen: number }[];
    for (const r of statRows) {
      const itemUid = idToUid.get(r.item_id);
      const item = itemUid ? byUid.get(itemUid) : undefined;
      if (!item || !(WAFFEN_STAT_FELDER as string[]).includes(r.feld)) continue;
      item.waffenStats.push({ dbId: r.id, uid: r.uid || makeUid(), feld: r.feld as WaffenStatFeld, wert: r.wert, verborgen: !!r.verborgen });
    }
  }

  const tx = db.transaction(() => {
    const insItem = db.prepare(
      `INSERT INTO char_items (owner_type, owner_id, pos, uid, name, anzahl, gewicht, kategorie, haus, raum, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, haltbarkeit_max, haltbarkeit_aktuell, notiz, rs_verborgen, haltbarkeit_verborgen, waffen_art)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updItem = db.prepare(ITEM_UPDATE_SQL);
    const delItem = db.prepare('DELETE FROM char_items WHERE id=?');
    const nextPos = db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM char_items WHERE owner_type=? AND owner_id=?');
    const setPos = db.prepare('UPDATE char_items SET pos=? WHERE id=?');
    const insBonus = db.prepare('INSERT INTO char_item_bonuses (item_id, pos, uid, kind, code, feld, wert, verborgen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updBonus = db.prepare('UPDATE char_item_bonuses SET kind=?, code=?, feld=?, wert=?, verborgen=? WHERE id=?');
    const delBonus = db.prepare('DELETE FROM char_item_bonuses WHERE id=?');
    const nextBonusPos = db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM char_item_bonuses WHERE item_id=?');
    const insStat = db.prepare('INSERT INTO char_item_weapon_stats (item_id, pos, uid, feld, wert, verborgen) VALUES (?, ?, ?, ?, ?, ?)');
    const updStat = db.prepare('UPDATE char_item_weapon_stats SET feld=?, wert=?, verborgen=? WHERE id=?');
    const delStat = db.prepare('DELETE FROM char_item_weapon_stats WHERE id=?');
    const nextStatPos = db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM char_item_weapon_stats WHERE item_id=?');

    const applyPatchToItem = (existing: WorkingItem, patch: Record<string, unknown>): void => {
      const p = { ...patch };
      if (!requesterIsGm) {
        delete p.rsVerborgen;
        delete p.haltbarkeitVerborgen;
        if (existing.rsVerborgen) delete p.rs;
        if (existing.haltbarkeitVerborgen) {
          delete p.haltbarkeitMax;
          delete p.haltbarkeitAktuell;
        }
      } else {
        if ('rsVerborgen' in p) p.rsVerborgen = nextVerborgen(existing.rsVerborgen, p.rsVerborgen);
        if ('haltbarkeitVerborgen' in p) p.haltbarkeitVerborgen = nextVerborgen(existing.haltbarkeitVerborgen, p.haltbarkeitVerborgen);
      }
      const merged = { ...existing, ...p };
      const n = normalizedItemRow(merged as unknown as Record<string, unknown>);
      updItem.run(...itemUpdateParams(n, existing.id));
      Object.assign(existing, {
        name: n.name, anzahl: n.anzahl, gewicht: n.gewicht, kategorie: n.kategorie, haus: n.haus, raum: n.raum,
        location: n.location as ItemLocation, zone: n.zone, beidseitig: !!n.beidseitig, containerUid: n.containerUid,
        istBehaelter: !!merged.istBehaelter, containerArt: n.containerArt as ContainerArt, kapazitaet: n.kapazitaet,
        kapazitaetArt: n.kapazitaetArt as KapazitaetArt, gewichtsreduktion: n.gewichtsreduktion, rs: n.rs,
        haltbarkeitMax: n.haltbarkeitMax, haltbarkeitAktuell: n.haltbarkeitAktuell, notiz: n.notiz,
        rsVerborgen: !!n.rsVerborgen, haltbarkeitVerborgen: !!n.haltbarkeitVerborgen, waffenArt: n.waffenArt,
      });
    };

    for (const rawOp of ops) {
      const o = (rawOp ?? {}) as Record<string, unknown>;
      const kindOfOp = String(o.op ?? '');

      if (kindOfOp === 'add') {
        const item = (o.item ?? {}) as Record<string, unknown>;
        let uid = String(item.uid ?? '').slice(0, 64);
        if (!uid) uid = makeUid();
        const already = byUid.get(uid);
        if (already) {
          // Wiederholter add (z. B. nach einem Netzwerk-Retry) — wie ein
          // Patch behandeln statt eine zweite Zeile anzulegen.
          applyPatchToItem(already, item);
          continue;
        }
        if (byUid.size >= MAX_ITEMS) continue;
        const fields: Record<string, unknown> = { ...item };
        if (!requesterIsGm) {
          fields.rsVerborgen = false;
          fields.haltbarkeitVerborgen = false;
        }
        const n = normalizedItemRow(fields);
        const pos = (nextPos.get(ownerType, ownerId) as { p: number }).p;
        const id = Number(
          insItem.run(
            ownerType, ownerId, pos, uid, n.name, n.anzahl, n.gewicht, n.kategorie, n.haus, n.raum, n.location, n.zone, n.beidseitig,
            n.containerUid, n.istBehaelter, n.containerArt, n.kapazitaet, n.kapazitaetArt, n.gewichtsreduktion,
            n.rs, n.haltbarkeitMax, n.haltbarkeitAktuell, n.notiz, n.rsVerborgen, n.haltbarkeitVerborgen, n.waffenArt,
          ).lastInsertRowid,
        );
        const working: WorkingItem = {
          id, uid, name: n.name, anzahl: n.anzahl, gewicht: n.gewicht, kategorie: n.kategorie, haus: n.haus, raum: n.raum,
          location: n.location as ItemLocation, zone: n.zone, beidseitig: !!n.beidseitig, containerUid: n.containerUid,
          istBehaelter: !!fields.istBehaelter, containerArt: n.containerArt as ContainerArt, kapazitaet: n.kapazitaet,
          kapazitaetArt: n.kapazitaetArt as KapazitaetArt, gewichtsreduktion: n.gewichtsreduktion, rs: n.rs,
          haltbarkeitMax: n.haltbarkeitMax, haltbarkeitAktuell: n.haltbarkeitAktuell, notiz: n.notiz,
          rsVerborgen: !!n.rsVerborgen, haltbarkeitVerborgen: !!n.haltbarkeitVerborgen, waffenArt: n.waffenArt,
          bonusse: [], waffenStats: [],
        };
        byUid.set(uid, working);
        const initialBonusse = Array.isArray(item.bonusse) ? (item.bonusse as unknown[]).slice(0, MAX_BONUSSE_PRO_ITEM) : [];
        initialBonusse.forEach((b, bi) => {
          const bo = (b ?? {}) as Record<string, unknown>;
          const kindRaw = String(bo.kind ?? '');
          if (!(ITEM_BONUS_KINDS as string[]).includes(kindRaw)) return;
          const kind = kindRaw as ItemBonusKind;
          const { code, feld } = normalizedBonusFields(kind, bo);
          const wert = Number(bo.wert);
          if (!Number.isFinite(wert)) return;
          const verborgen = requesterIsGm ? !!bo.verborgen : false;
          let bUid = String(bo.uid ?? '').slice(0, 64);
          if (!bUid) bUid = makeUid();
          const bId = Number(insBonus.run(id, bi, bUid, kind, code, feld, wert, verborgen ? 1 : 0).lastInsertRowid);
          working.bonusse.push({ dbId: bId, uid: bUid, kind, code, feld, wert, verborgen });
        });
        const initialStats = Array.isArray(item.waffenStats) ? (item.waffenStats as unknown[]).slice(0, MAX_WEAPON_STATS_PRO_ITEM) : [];
        initialStats.forEach((s, si) => {
          const so = (s ?? {}) as Record<string, unknown>;
          const feldRaw = String(so.feld ?? '');
          if (!(WAFFEN_STAT_FELDER as string[]).includes(feldRaw)) return;
          const feld = feldRaw as WaffenStatFeld;
          const wert = String(so.wert ?? '').slice(0, MAX_WEAPON_STAT_WERT);
          const verborgen = requesterIsGm ? !!so.verborgen : false;
          let sUid = String(so.uid ?? '').slice(0, 64);
          if (!sUid) sUid = makeUid();
          const sId = Number(insStat.run(id, si, sUid, feld, wert, verborgen ? 1 : 0).lastInsertRowid);
          working.waffenStats.push({ dbId: sId, uid: sUid, feld, wert, verborgen });
        });
      } else if (kindOfOp === 'patch') {
        const existing = byUid.get(String(o.uid ?? ''));
        if (!existing) continue;
        applyPatchToItem(existing, (o.patch ?? {}) as Record<string, unknown>);
      } else if (kindOfOp === 'remove') {
        const existing = byUid.get(String(o.uid ?? ''));
        if (!existing) continue;
        delItem.run(existing.id);
        byUid.delete(existing.uid);
      } else if (kindOfOp === 'reorder') {
        const uids = Array.isArray(o.uids) ? (o.uids as unknown[]).map(String) : [];
        uids.forEach((uid, i) => {
          const it = byUid.get(uid);
          if (it) setPos.run(i, it.id);
        });
      } else if (kindOfOp === 'addBonus') {
        const item = byUid.get(String(o.itemUid ?? ''));
        if (!item) continue;
        const bonus = (o.bonus ?? {}) as Record<string, unknown>;
        let bUid = String(bonus.uid ?? '').slice(0, 64);
        if (!bUid) bUid = makeUid();
        const already = item.bonusse.find((b) => b.uid === bUid);
        const kindRaw = String(bonus.kind ?? '');
        if (!(ITEM_BONUS_KINDS as string[]).includes(kindRaw)) continue;
        const kind = kindRaw as ItemBonusKind;
        const { code, feld } = normalizedBonusFields(kind, bonus);
        const wert = Number(bonus.wert);
        if (!Number.isFinite(wert)) continue;
        if (already) {
          // Ein Retry (Netzwerkfehler, erneuter Flush) darf eine bereits
          // verdeckte Zeile nicht anfassen — Nicht-SL kennt ihre uid ohnehin
          // strukturell nie, das hier ist reine Verteidigung in der Tiefe.
          if (!requesterIsGm && already.verborgen) continue;
          const verborgen = requesterIsGm ? nextVerborgen(already.verborgen, bonus.verborgen) : false;
          updBonus.run(kind, code, feld, wert, verborgen ? 1 : 0, already.dbId);
          Object.assign(already, { kind, code, feld, wert, verborgen });
          continue;
        }
        if (item.bonusse.length >= MAX_BONUSSE_PRO_ITEM) continue;
        const verborgen = requesterIsGm ? !!bonus.verborgen : false;
        const pos = (nextBonusPos.get(item.id) as { p: number }).p;
        const dbId = Number(insBonus.run(item.id, pos, bUid, kind, code, feld, wert, verborgen ? 1 : 0).lastInsertRowid);
        item.bonusse.push({ dbId, uid: bUid, kind, code, feld, wert, verborgen });
      } else if (kindOfOp === 'patchBonus') {
        const item = byUid.get(String(o.itemUid ?? ''));
        const bonus = item?.bonusse.find((b) => b.uid === String(o.bonusUid ?? ''));
        if (!item || !bonus) continue;
        if (!requesterIsGm && bonus.verborgen) continue; // Nicht-SL kennt diese uid strukturell nie — defensiv trotzdem sperren
        const patch = { ...(o.patch ?? {}) } as Record<string, unknown>;
        if (!requesterIsGm) delete patch.verborgen;
        else if ('verborgen' in patch) patch.verborgen = nextVerborgen(bonus.verborgen, patch.verborgen);
        const kind = 'kind' in patch && (ITEM_BONUS_KINDS as string[]).includes(String(patch.kind)) ? (patch.kind as ItemBonusKind) : bonus.kind;
        const merged = { ...bonus, ...patch, kind };
        const { code, feld } = normalizedBonusFields(kind, merged as unknown as Record<string, unknown>);
        const wert = Number(merged.wert);
        if (!Number.isFinite(wert)) continue;
        const verborgen = !!merged.verborgen;
        updBonus.run(kind, code, feld, wert, verborgen ? 1 : 0, bonus.dbId);
        Object.assign(bonus, { kind, code, feld, wert, verborgen });
      } else if (kindOfOp === 'removeBonus') {
        const item = byUid.get(String(o.itemUid ?? ''));
        const idx = item?.bonusse.findIndex((b) => b.uid === String(o.bonusUid ?? '')) ?? -1;
        if (!item || idx < 0) continue;
        const bonus = item.bonusse[idx];
        if (!requesterIsGm && bonus.verborgen) continue;
        delBonus.run(bonus.dbId);
        item.bonusse.splice(idx, 1);
      } else if (kindOfOp === 'addWeaponStat') {
        const item = byUid.get(String(o.itemUid ?? ''));
        if (!item) continue;
        const stat = (o.stat ?? {}) as Record<string, unknown>;
        let sUid = String(stat.uid ?? '').slice(0, 64);
        if (!sUid) sUid = makeUid();
        const already = item.waffenStats.find((s) => s.uid === sUid);
        const feldRaw = String(stat.feld ?? '');
        if (!(WAFFEN_STAT_FELDER as string[]).includes(feldRaw)) continue;
        const feld = feldRaw as WaffenStatFeld;
        const wert = String(stat.wert ?? '').slice(0, MAX_WEAPON_STAT_WERT);
        if (already) {
          // Ein Retry darf eine bereits verdeckte Zeile nicht anfassen — wie
          // bei addBonus, aus demselben Grund.
          if (!requesterIsGm && already.verborgen) continue;
          const verborgen = requesterIsGm ? nextVerborgen(already.verborgen, stat.verborgen) : false;
          updStat.run(feld, wert, verborgen ? 1 : 0, already.dbId);
          Object.assign(already, { feld, wert, verborgen });
          continue;
        }
        if (item.waffenStats.length >= MAX_WEAPON_STATS_PRO_ITEM) continue;
        const verborgen = requesterIsGm ? !!stat.verborgen : false;
        const pos = (nextStatPos.get(item.id) as { p: number }).p;
        const dbId = Number(insStat.run(item.id, pos, sUid, feld, wert, verborgen ? 1 : 0).lastInsertRowid);
        item.waffenStats.push({ dbId, uid: sUid, feld, wert, verborgen });
      } else if (kindOfOp === 'patchWeaponStat') {
        const item = byUid.get(String(o.itemUid ?? ''));
        const stat = item?.waffenStats.find((s) => s.uid === String(o.statUid ?? ''));
        if (!item || !stat) continue;
        if (!requesterIsGm && stat.verborgen) continue; // Nicht-SL kennt diese uid strukturell nie — defensiv trotzdem sperren
        const patch = { ...(o.patch ?? {}) } as Record<string, unknown>;
        if (!requesterIsGm) delete patch.verborgen;
        else if ('verborgen' in patch) patch.verborgen = nextVerborgen(stat.verborgen, patch.verborgen);
        const feld = 'feld' in patch && (WAFFEN_STAT_FELDER as string[]).includes(String(patch.feld)) ? (patch.feld as WaffenStatFeld) : stat.feld;
        const merged = { ...stat, ...patch, feld };
        const wert = String(merged.wert ?? '').slice(0, MAX_WEAPON_STAT_WERT);
        const verborgen = !!merged.verborgen;
        updStat.run(feld, wert, verborgen ? 1 : 0, stat.dbId);
        Object.assign(stat, { feld, wert, verborgen });
      } else if (kindOfOp === 'removeWeaponStat') {
        const item = byUid.get(String(o.itemUid ?? ''));
        const idx = item?.waffenStats.findIndex((s) => s.uid === String(o.statUid ?? '')) ?? -1;
        if (!item || idx < 0) continue;
        const stat = item.waffenStats[idx];
        if (!requesterIsGm && stat.verborgen) continue;
        delStat.run(stat.dbId);
        item.waffenStats.splice(idx, 1);
      }
    }
  });
  tx();
}

export function saveItemCategories(charId: number, raw: unknown): void {
  saveItemCategoriesForOwner('character', charId, raw);
}

export function saveItemCategoriesForOwner(ownerType: ItemOwnerType, ownerId: number, raw: unknown): void {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const v of arr) {
    const name = String(v ?? '').trim().slice(0, MAX_CATEGORY_LEN);
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
    if (clean.length >= MAX_CATEGORIES) break;
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM char_item_categories WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
    const ins = db.prepare('INSERT INTO char_item_categories (owner_type, owner_id, pos, name) VALUES (?, ?, ?, ?)');
    clean.forEach((name, i) => ins.run(ownerType, ownerId, i, name));
  });
  tx();
}

// --- Geldbeutel (Geld-Umbau) ---

const MAX_POUCHES = 50;
const MAX_POUCH_NAME = 200;

export function loadPouches(charId: number): CoinPouch[] {
  const pouches = db
    .prepare('SELECT id, name, system_id, kapazitaet, is_bank FROM char_pouches WHERE character_id = ? ORDER BY pos, id')
    .all(charId) as { id: number; name: string; system_id: number | null; kapazitaet: number; is_bank: number }[];
  const coinRows = db
    .prepare(
      `SELECT pc.pouch_id, pc.denomination_id, pc.anzahl FROM char_pouch_coins pc
       JOIN char_pouches p ON p.id = pc.pouch_id WHERE p.character_id = ?`,
    )
    .all(charId) as { pouch_id: number; denomination_id: number; anzahl: number }[];
  const coinsByPouch = new Map<number, Record<number, number>>();
  for (const r of coinRows) {
    const coins = coinsByPouch.get(r.pouch_id) ?? {};
    coins[r.denomination_id] = r.anzahl;
    coinsByPouch.set(r.pouch_id, coins);
  }
  return pouches.map((p) => ({
    id: p.id,
    name: p.name,
    systemId: p.system_id,
    kapazitaet: p.kapazitaet,
    coins: coinsByPouch.get(p.id) ?? {},
    bank: !!p.is_bank,
  }));
}

// Ganze Liste ersetzen (wie saveItems): Delete+Insert, serverseitig gedeckelt.
// Der Bank-Beutel (CoinPouch.bank) ist eine erzwungene Ausnahme: genau einer,
// Name fest „Bank", Kapazität immer unbegrenzt — unabhängig davon, was der
// Client schickt. Fehlt er im Payload (z. B. weil eine ältere Client-Version
// ihn nicht mitschickt), wird er hier neu angelegt statt verloren zu gehen.
export function savePouches(charId: number, raw: unknown): void {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]).slice(0, MAX_POUCHES) : [];
  // Stets gegen den tatsächlichen Katalogstand prüfen: eine zwischenzeitlich vom
  // Spielleiter gelöschte Währung/Münzsorte darf nicht als Fremdschlüssel-
  // Verletzung den ganzen Speichervorgang zum Absturz bringen — solche
  // Verweise werden hier still ausgelassen (das Feld erscheint dann leer/„—").
  const validSystemIds = new Set((db.prepare('SELECT id FROM currency_systems').all() as { id: number }[]).map((r) => r.id));
  const validDenomIds = new Set((db.prepare('SELECT id FROM currency_denominations').all() as { id: number }[]).map((r) => r.id));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM char_pouches WHERE character_id = ?').run(charId);
    const insPouch = db.prepare(
      'INSERT INTO char_pouches (character_id, pos, name, system_id, kapazitaet, is_bank) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insCoin = db.prepare('INSERT INTO char_pouch_coins (pouch_id, denomination_id, anzahl) VALUES (?, ?, ?)');
    let pos = 0;
    let bankSeen = false;
    const insertOne = (o: Record<string, unknown>, isBank: boolean) => {
      const systemIdRaw = o.systemId == null || o.systemId === '' ? null : Math.trunc(Number(o.systemId));
      const systemId = systemIdRaw != null && validSystemIds.has(systemIdRaw) ? systemIdRaw : null;
      const name = isBank ? 'Bank' : String(o.name ?? '').slice(0, MAX_POUCH_NAME);
      const kapazitaet = isBank ? 0 : clampMin(o.kapazitaet);
      const pouchId = Number(insPouch.run(charId, pos++, name, systemId, kapazitaet, isBank ? 1 : 0).lastInsertRowid);
      const coins = (o.coins ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(coins)) {
        const denomId = Math.trunc(Number(key));
        const anzahl = clampMin(value);
        if (validDenomIds.has(denomId) && anzahl > 0) insCoin.run(pouchId, denomId, anzahl);
      }
    };
    arr.forEach((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const isBank = !!o.bank && !bankSeen;
      if (isBank) bankSeen = true;
      insertOne(o, isBank);
    });
    if (!bankSeen) {
      const firstSystem = db.prepare('SELECT id FROM currency_systems ORDER BY sort, id LIMIT 1').get() as
        | { id: number }
        | undefined;
      insertOne({ systemId: firstSystem?.id ?? null, coins: {} }, true);
    }
  });
  tx();
}

// Kategorien verwalten MIT Kaskade auf die Gegenstände (für die Einstellungen-
// Seite): Umbenennen zieht die betroffenen char_items mit, Entfernen setzt deren
// Kategorie auf '' (ohne). Danach wird die Liste in der neuen Reihenfolge gesetzt.
export function manageItemCategories(charId: number, raw: unknown): string[] {
  return manageItemCategoriesForOwner('character', charId, raw);
}

export function manageItemCategoriesForOwner(ownerType: ItemOwnerType, ownerId: number, raw: unknown): string[] {
  const body = (raw ?? {}) as { order?: unknown; renames?: unknown; removes?: unknown };
  const renames = Array.isArray(body.renames) ? body.renames : [];
  const removes = Array.isArray(body.removes) ? body.removes : [];
  const orderArr = Array.isArray(body.order) ? body.order : [];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const v of orderArr) {
    const name = String(v ?? '').trim().slice(0, MAX_CATEGORY_LEN);
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
    if (clean.length >= MAX_CATEGORIES) break;
  }
  const tx = db.transaction(() => {
    const up = db.prepare('UPDATE char_items SET kategorie = ? WHERE owner_type = ? AND owner_id = ? AND kategorie = ?');
    for (const r of renames) {
      const from = String((r as { from?: unknown })?.from ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      const to = String((r as { to?: unknown })?.to ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      if (from && to && from !== to) up.run(to, ownerType, ownerId, from);
    }
    for (const name of removes) {
      const n = String(name ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      if (n) up.run('', ownerType, ownerId, n);
    }
    db.prepare('DELETE FROM char_item_categories WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
    const ins = db.prepare('INSERT INTO char_item_categories (owner_type, owner_id, pos, name) VALUES (?, ?, ?, ?)');
    clean.forEach((name, i) => ins.run(ownerType, ownerId, i, name));
  });
  tx();
  return loadItemCategoriesForOwner(ownerType, ownerId);
}

// --- Houses (docs/concepts/houses.md): group-only location tags ---
//
// haus/raum on char_items are freeform strings — same role as kategorie, no
// foreign key (shared-inventories.md §3.1 already proved a curated list can
// coexist safely with an unvalidated string field). group_houses/group_rooms
// are pure suggestion/rename lists, one level deeper than
// char_item_categories: a room is scoped to a house NAME within the group,
// not a house id. Houses are group-only — characters and the GM pool never
// populate haus/raum, so there is no ownerType parameter here.

const MAX_HOUSE_LEN = 200;
const MAX_HOUSES = 200;
const MAX_ROOMS_PER_HOUSE = 200;

export function loadHouses(groupId: number): string[] {
  return (
    db.prepare('SELECT name FROM group_houses WHERE group_id = ? ORDER BY pos, id').all(groupId) as { name: string }[]
  ).map((r) => r.name);
}

export function loadRoomsForGroup(groupId: number): Record<string, string[]> {
  const rows = db
    .prepare('SELECT haus, name FROM group_rooms WHERE group_id = ? ORDER BY pos, id')
    .all(groupId) as { haus: string; name: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const list = out[r.haus] ?? [];
    list.push(r.name);
    out[r.haus] = list;
  }
  return out;
}

// Häuser verwalten MIT Kaskade — wie manageItemCategoriesForOwner, nur eine
// Ebene tiefer: eine Umbenennung/Entfernung trifft auch group_rooms.haus
// (Räume dieses Hauses) und char_items (owner_type='group'). Entfernen setzt
// BEIDE Felder (haus UND raum) auf '' zurück — ohne sein Haus bedeutet ein
// Raum-Name nichts mehr.
export function manageHouses(groupId: number, raw: unknown): { houses: string[]; roomsByHaus: Record<string, string[]> } {
  const body = (raw ?? {}) as { order?: unknown; renames?: unknown; removes?: unknown };
  const renames = Array.isArray(body.renames) ? body.renames : [];
  const removes = Array.isArray(body.removes) ? body.removes : [];
  const orderArr = Array.isArray(body.order) ? body.order : [];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const v of orderArr) {
    const name = String(v ?? '').trim().slice(0, MAX_HOUSE_LEN);
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
    if (clean.length >= MAX_HOUSES) break;
  }
  const tx = db.transaction(() => {
    const upRooms = db.prepare('UPDATE group_rooms SET haus = ? WHERE group_id = ? AND haus = ?');
    const upItemsHaus = db.prepare("UPDATE char_items SET haus = ? WHERE owner_type = 'group' AND owner_id = ? AND haus = ?");
    for (const r of renames) {
      const from = String((r as { from?: unknown })?.from ?? '').trim().slice(0, MAX_HOUSE_LEN);
      const to = String((r as { to?: unknown })?.to ?? '').trim().slice(0, MAX_HOUSE_LEN);
      if (from && to && from !== to) {
        upRooms.run(to, groupId, from);
        upItemsHaus.run(to, groupId, from);
      }
    }
    const delRooms = db.prepare('DELETE FROM group_rooms WHERE group_id = ? AND haus = ?');
    const clearItems = db.prepare(
      "UPDATE char_items SET haus = '', raum = '' WHERE owner_type = 'group' AND owner_id = ? AND haus = ?",
    );
    for (const name of removes) {
      const n = String(name ?? '').trim().slice(0, MAX_HOUSE_LEN);
      if (n) {
        delRooms.run(groupId, n);
        clearItems.run(groupId, n);
      }
    }
    db.prepare('DELETE FROM group_houses WHERE group_id = ?').run(groupId);
    const ins = db.prepare('INSERT INTO group_houses (group_id, pos, name) VALUES (?, ?, ?)');
    clean.forEach((name, i) => ins.run(groupId, i, name));
  });
  tx();
  return { houses: loadHouses(groupId), roomsByHaus: loadRoomsForGroup(groupId) };
}

// Räume EINES Hauses verwalten — exakt wie manageItemCategoriesForOwner, nur
// zusätzlich auf `haus` gefiltert (sowohl bei group_rooms als auch beim
// char_items-Kaskade-UPDATE).
export function manageRoomsForHouse(groupId: number, haus: string, raw: unknown): string[] {
  const body = (raw ?? {}) as { order?: unknown; renames?: unknown; removes?: unknown };
  const renames = Array.isArray(body.renames) ? body.renames : [];
  const removes = Array.isArray(body.removes) ? body.removes : [];
  const orderArr = Array.isArray(body.order) ? body.order : [];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const v of orderArr) {
    const name = String(v ?? '').trim().slice(0, MAX_HOUSE_LEN);
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
    if (clean.length >= MAX_ROOMS_PER_HOUSE) break;
  }
  const tx = db.transaction(() => {
    const up = db.prepare("UPDATE char_items SET raum = ? WHERE owner_type = 'group' AND owner_id = ? AND haus = ? AND raum = ?");
    for (const r of renames) {
      const from = String((r as { from?: unknown })?.from ?? '').trim().slice(0, MAX_HOUSE_LEN);
      const to = String((r as { to?: unknown })?.to ?? '').trim().slice(0, MAX_HOUSE_LEN);
      if (from && to && from !== to) up.run(to, groupId, haus, from);
    }
    for (const name of removes) {
      const n = String(name ?? '').trim().slice(0, MAX_HOUSE_LEN);
      if (n) up.run('', groupId, haus, n);
    }
    db.prepare('DELETE FROM group_rooms WHERE group_id = ? AND haus = ?').run(groupId, haus);
    const ins = db.prepare('INSERT INTO group_rooms (group_id, haus, pos, name) VALUES (?, ?, ?, ?)');
    clean.forEach((name, i) => ins.run(groupId, haus, i, name));
  });
  tx();
  return loadRoomsForGroup(groupId)[haus] ?? [];
}

// --- Shared inventories: cross-owner move (docs/concepts/shared-inventories.md) ---
//
// A move is its OWN imperative call, never an ItemOp — diffItems compares one
// owner's list against its own previous state and structurally cannot express
// "this uid leaves my list and joins yours" (see ItemOwnerType in
// shared/src/items.ts). Containers move atomically with their contents
// (collectSubtree walks container_uid the same way the client's ancestors()
// walk does, just downward instead of up for cycle-checking); only the moved
// ROOT item resets location/zone/beidseitig/containerUid
// (ITEM_MOVE_RESET_PATCH in shared/src/items.ts is the single source of truth
// for that shape — mirrored by hand below, there is no shared SQL builder to
// import it through) — descendants keep theirs, so a moved backpack's
// contents stay exactly as packed.
function collectSubtree(ownerType: ItemOwnerType, ownerId: number, rootUid: string): { rootId: number; ids: number[] } | null {
  const rows = db
    .prepare('SELECT id, uid, container_uid FROM char_items WHERE owner_type = ? AND owner_id = ?')
    .all(ownerType, ownerId) as { id: number; uid: string; container_uid: string }[];
  const root = rows.find((r) => r.uid === rootUid);
  if (!root) return null;
  const childrenByContainerUid = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.container_uid) continue;
    const list = childrenByContainerUid.get(r.container_uid) ?? [];
    list.push(r);
    childrenByContainerUid.set(r.container_uid, list);
  }
  const ids = [root.id];
  const seen = new Set([root.uid]);
  const queue = [root.uid];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenByContainerUid.get(cur) ?? []) {
      if (seen.has(child.uid)) continue;
      seen.add(child.uid);
      ids.push(child.id);
      queue.push(child.uid);
    }
  }
  return { rootId: root.id, ids };
}

// Moves one item — and, if it's a container, everything inside it — from one
// owner to another. Returns false on a uid that doesn't exist under `from`
// (stale, or the same request retried after it already moved) or if the
// target owner would exceed MAX_ITEMS; both are silent no-ops for the caller,
// the same defensive posture applyItemOps already takes on its own caps.
export function moveItem(from: { type: ItemOwnerType; id: number }, to: { type: ItemOwnerType; id: number }, uid: string): boolean {
  const found = collectSubtree(from.type, from.id, uid);
  if (!found) return false;
  const targetCount = (
    db.prepare('SELECT COUNT(*) AS n FROM char_items WHERE owner_type = ? AND owner_id = ?').get(to.type, to.id) as { n: number }
  ).n;
  if (targetCount + found.ids.length > MAX_ITEMS) return false;
  const tx = db.transaction(() => {
    const setOwner = db.prepare('UPDATE char_items SET owner_type = ?, owner_id = ? WHERE id = ?');
    for (const id of found.ids) setOwner.run(to.type, to.id, id);
    db.prepare(
      "UPDATE char_items SET location = 'inventar', zone = '', beidseitig = 0, container_uid = '', haus = '', raum = '' WHERE id = ?",
    ).run(found.rootId);
  });
  tx();
  return true;
}

// Manuelles Aufräumen beim Löschen eines Charakters/einer Gruppe — die
// DB-Kaskade ist mit character_id gegangen (siehe die owner_type-Migration in
// db.ts), also übernimmt das hier von Hand, exakt wie loescheAssetsFuer() es
// für den (datei-übergreifenden) Bild-Store schon tut. char_item_bonuses/
// char_item_weapon_stats hängen weiterhin per echter FK an char_items.id und
// räumen sich darüber von selbst mit.
export function loescheItemsFuer(ownerType: ItemOwnerType, ownerId: number): void {
  db.prepare('DELETE FROM char_items WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
  db.prepare('DELETE FROM char_item_categories WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
}

// --- Zauber & Fähigkeiten (Cluster 6) ---
//
// Ein Bestand je Charakter (char_abilities), aus dem beide Reiter nur anzeigen.
// Speichern ist — wie bei den Gegenständen — ein Ersetzen der ganzen Liste; die
// stabile uid überlebt es. Element- und Kategorie-Listen liegen getrennt in
// char_ability_lists (kind).

const MAX_ABILITIES = 2000;
const MAX_ABILITY_TEXT = 8000;

// Robust gegen kaputten/alten Inhalt (ein einzelner String statt eines JSON-
// Arrays, falls je manuell in der DB gepfuscht wurde): fällt auf ein
// Ein-Element-Array bzw. leeres Array zurück statt zu werfen.
function parseKategorien(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((s) => String(s));
  } catch {
    /* fällt durch auf die Textbehandlung unten */
  }
  return raw ? [raw] : [];
}

export function loadAbilities(charId: number): Ability[] {
  const rows = db
    .prepare(
      'SELECT id, uid, magisch, passiv, signatur, name, element, kategorien, stufe, komplexitaet, kosten, probe, effekt, fortschritt, notiz, favorit FROM char_abilities WHERE character_id = ? ORDER BY pos, id',
    )
    .all(charId) as {
    id: number;
    uid: string;
    magisch: number;
    passiv: number;
    signatur: number;
    name: string;
    element: string;
    kategorien: string;
    stufe: number;
    komplexitaet: number;
    kosten: string;
    probe: string;
    effekt: string;
    fortschritt: number;
    notiz: string;
    favorit: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid || makeUid(),
    magisch: !!r.magisch,
    passiv: !!r.passiv,
    signatur: !!r.signatur,
    name: r.name,
    element: r.element,
    kategorien: parseKategorien(r.kategorien),
    stufe: r.stufe,
    komplexitaet: r.komplexitaet,
    kosten: r.kosten,
    probe: r.probe,
    effekt: r.effekt,
    fortschritt: r.fortschritt,
    notiz: r.notiz,
    favorit: !!r.favorit,
  }));
}

// Ganze Liste ersetzen (wie saveItems): serverseitig gedeckelt, uids eindeutig.
export function saveAbilities(charId: number, raw: unknown): void {
  const arr = Array.isArray(raw) ? raw.slice(0, MAX_ABILITIES) : [];
  const seenUids = new Set<string>();
  // Nur EIN Signatur-Zauber je Charakter: der erste markierte gewinnt.
  let signaturVergeben = false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM char_abilities WHERE character_id = ?').run(charId);
    const ins = db.prepare(
      `INSERT INTO char_abilities (character_id, pos, uid, magisch, passiv, signatur, name, element, kategorien, stufe, komplexitaet, kosten, probe, effekt, fortschritt, notiz, favorit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    arr.forEach((it, i) => {
      const o = (it ?? {}) as Record<string, unknown>;
      let uid = String(o.uid ?? '').slice(0, 64);
      if (!uid || seenUids.has(uid)) uid = makeUid();
      seenUids.add(uid);
      const signatur = o.signatur && !signaturVergeben ? 1 : 0;
      if (signatur) signaturVergeben = true;
      const kategorien = Array.isArray(o.kategorien)
        ? [...new Set(o.kategorien.map((k) => String(k).trim().slice(0, MAX_CATEGORY_LEN)).filter(Boolean))].slice(0, 50)
        : [];
      ins.run(
        charId,
        i,
        uid,
        o.magisch ? 1 : 0,
        o.passiv ? 1 : 0,
        signatur,
        String(o.name ?? '').slice(0, MAX_ABILITY_TEXT),
        String(o.element ?? '').slice(0, MAX_ABILITY_TEXT),
        JSON.stringify(kategorien),
        clampMin(o.stufe),
        clampMin(o.komplexitaet),
        String(o.kosten ?? '').slice(0, MAX_ABILITY_TEXT),
        String(o.probe ?? '').slice(0, MAX_ABILITY_TEXT),
        String(o.effekt ?? '').slice(0, MAX_ABILITY_TEXT),
        clampMin(o.fortschritt),
        String(o.notiz ?? '').slice(0, MAX_ABILITY_TEXT),
        o.favorit ? 1 : 0,
      );
    });
  });
  tx();
}

export interface AbilityLists {
  element: string[];
  kategorie: string[];
}

export function loadAbilityLists(charId: number): AbilityLists {
  const rows = db
    .prepare('SELECT kind, name FROM char_ability_lists WHERE character_id = ? ORDER BY kind, pos, id')
    .all(charId) as { kind: string; name: string }[];
  const out: AbilityLists = { element: [], kategorie: [] };
  for (const r of rows) {
    if (r.kind === 'element') out.element.push(r.name);
    else if (r.kind === 'kategorie') out.kategorie.push(r.name);
  }
  return out;
}

// Eine der beiden Listen (element/kategorie) verwalten, MIT Kaskade auf die
// char_abilities-Spalte gleichen Namens: Umbenennen zieht die Einträge mit,
// Entfernen setzt deren Wert auf '' (ohne). Body: { order, renames, removes }.
export function manageAbilityList(charId: number, kind: string, raw: unknown): AbilityLists {
  const k: 'element' | 'kategorie' = kind === 'element' ? 'element' : 'kategorie';
  const body = (raw ?? {}) as { order?: unknown; renames?: unknown; removes?: unknown };
  const renames = Array.isArray(body.renames) ? body.renames : [];
  const removes = Array.isArray(body.removes) ? body.removes : [];
  const orderArr = Array.isArray(body.order) ? body.order : [];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const v of orderArr) {
    const name = String(v ?? '').trim().slice(0, MAX_CATEGORY_LEN);
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
    if (clean.length >= MAX_CATEGORIES) break;
  }
  const renamePairs = renames
    .map((r) => ({
      from: String((r as { from?: unknown })?.from ?? '').trim().slice(0, MAX_CATEGORY_LEN),
      to: String((r as { to?: unknown })?.to ?? '').trim().slice(0, MAX_CATEGORY_LEN),
    }))
    .filter((r) => r.from && r.to && r.from !== r.to);
  const removeSet = new Set(
    removes.map((n) => String(n ?? '').trim().slice(0, MAX_CATEGORY_LEN)).filter(Boolean),
  );
  const tx = db.transaction(() => {
    if (k === 'element') {
      // Einzelwert-Spalte: exakter Treffer reicht.
      const up = db.prepare('UPDATE char_abilities SET element = ? WHERE character_id = ? AND element = ?');
      for (const r of renamePairs) up.run(r.to, charId, r.from);
      for (const n of removeSet) up.run('', charId, n);
    } else {
      // 'kategorien' ist ein JSON-Array je Zeile — Umbenennen/Entfernen muss
      // innerhalb jedes Arrays passieren, nicht als exakter Spaltenvergleich.
      const rows = db.prepare('SELECT id, kategorien FROM char_abilities WHERE character_id = ?').all(charId) as {
        id: number;
        kategorien: string;
      }[];
      const up = db.prepare('UPDATE char_abilities SET kategorien = ? WHERE id = ?');
      for (const row of rows) {
        const cats = parseKategorien(row.kategorien);
        if (cats.length === 0) continue;
        const next = [
          ...new Set(
            cats
              .filter((c) => !removeSet.has(c))
              .map((c) => renamePairs.find((r) => r.from === c)?.to ?? c),
          ),
        ];
        if (next.length !== cats.length || next.some((c, i) => c !== cats[i])) {
          up.run(JSON.stringify(next), row.id);
        }
      }
    }
    db.prepare('DELETE FROM char_ability_lists WHERE character_id = ? AND kind = ?').run(charId, k);
    const ins = db.prepare('INSERT INTO char_ability_lists (character_id, kind, pos, name) VALUES (?, ?, ?, ?)');
    clean.forEach((name, i) => ins.run(charId, k, i, name));
  });
  tx();
  return loadAbilityLists(charId);
}

// --- Seed-Import (Cluster 6): ersetzt die frühere „harte" Migration ---
//
// Anders als 5a/5b läuft dies NICHT beim Start und löscht nichts: es ist eine
// vom Spieler ausgelöste Aktion, die den bestehenden dynamischen Reiter
// „Zauber/Fähigkeiten" liest und daraus die Stammliste vorbefüllt. Der alte
// Reiter bleibt unangetastet, bis der Spieler ihn (später) bewusst stilllegt.
// Gemappt wird über die Spalten-BESCHRIFTUNG (die Schlüssel sind je Charakter
// frei vergeben); alles Unabbildbare wandert in die Notiz — kein Datenverlust.

const abNorm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[()\s.]/g, '')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');

const ABILITY_LABELMAP = new Map<string, string>();
{
  const put = (field: string, labels: string[]) => labels.forEach((l) => ABILITY_LABELMAP.set(abNorm(l), field));
  put('name', ['Name']);
  put('element', ['Typ', 'Element']);
  put('stufe', ['Stufe', 'Level']);
  put('komplexitaet', ['Komplexität', 'Komplex', 'Komplexitaet']);
  put('kosten', ['Kosten']);
  put('probe', ['Probe']); // die TEXT-Spalte mit dem Ausdruck
  put('effekt', ['Effekt', 'Wirkung']);
  put('fortschritt', ['Fortschritt', 'Punkte', 'EXP', 'Erfahrung']);
  put('kategorie', ['Kategorie']);
}
// Abgeleitete Spalten (werden neu berechnet, nicht übernommen).
const ABILITY_DROP_LABELS = new Set(['mgpunkte', 'magiepunkte'].map((s) => abNorm(s)));

const ZAUBER_IMPORT_TAB = 'Zauber/Fähigkeiten';

export interface AbilitySeedResult {
  skipped: boolean; // true, wenn schon Einträge da sind oder kein alter Reiter existiert
  zauber: number;
  faehigkeiten: number;
}

export function seedAbilitiesFromZauber(charId: number): AbilitySeedResult {
  const have = (db.prepare('SELECT COUNT(*) AS n FROM char_abilities WHERE character_id = ?').get(charId) as { n: number }).n;
  if (have > 0) return { skipped: true, zauber: 0, faehigkeiten: 0 };
  const tab = db.prepare('SELECT id FROM char_tabs WHERE character_id = ? AND name = ?').get(charId, ZAUBER_IMPORT_TAB) as
    | { id: number }
    | undefined;
  if (!tab) return { skipped: true, zauber: 0, faehigkeiten: 0 };

  let zauber = 0;
  let faehig = 0;
  const elementsSeen: string[] = [];
  const tx = db.transaction(() => {
    const sections = db.prepare('SELECT id, name, columns FROM char_sections WHERE tab_id = ? ORDER BY pos, id').all(tab.id) as {
      id: number;
      name: string;
      columns: string;
    }[];
    const ins = db.prepare(
      `INSERT INTO char_abilities (character_id, pos, uid, magisch, passiv, name, element, kategorien, stufe, komplexitaet, kosten, probe, effekt, fortschritt, notiz)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const kategorienSeen: string[] = [];
    let pos = 0;
    for (const sec of sections) {
      let cols: DynColumn[] = [];
      try {
        cols = JSON.parse(sec.columns || '[]') as DynColumn[];
      } catch {
        cols = [];
      }
      const colKeys = new Set(cols.map((c) => c.key));
      const fieldOfKey = new Map<string, string>();
      const keyOfField: Record<string, string> = {};
      const noteLabelOfKey = new Map<string, string>();
      let hasStufe = false;
      let hasKomplex = false;
      for (const c of cols) {
        if (c.type === 'probe') continue; // berechnete Spalte → verwerfen
        const nl = abNorm(c.label);
        if (ABILITY_DROP_LABELS.has(nl)) continue; // abgeleitet → verwerfen
        const field = ABILITY_LABELMAP.get(nl);
        if (field && !keyOfField[field]) {
          keyOfField[field] = c.key;
          fieldOfKey.set(c.key, field);
          if (field === 'stufe') hasStufe = true;
          if (field === 'komplexitaet') hasKomplex = true;
        } else {
          noteLabelOfKey.set(c.key, c.label); // unabbildbar → Notiz
        }
      }
      // Eine Sektion mit Stufe- UND Komplexitäts-Spalte ist magisch; eine ohne
      // (z. B. „Kampffertigkeiten") ist eine mundane Fähigkeitenliste.
      const magisch = hasStufe && hasKomplex;

      const rows = db.prepare('SELECT data FROM char_section_rows WHERE section_id = ? ORDER BY pos, id').all(sec.id) as {
        data: string;
      }[];
      for (const r of rows) {
        let d: Record<string, unknown> = {};
        try {
          d = JSON.parse(r.data || '{}') as Record<string, unknown>;
        } catch {
          d = {};
        }
        const a = {
          name: '',
          element: '',
          kategorie: '',
          stufe: 0,
          komplexitaet: 0,
          kosten: '',
          probe: '',
          effekt: '',
          fortschritt: 0,
        } as Record<string, string | number>;
        const extras: string[] = [];
        for (const [k, v] of Object.entries(d)) {
          const val = v == null ? '' : String(v).trim();
          const field = fieldOfKey.get(k);
          if (field) {
            if (field === 'stufe' || field === 'komplexitaet' || field === 'fortschritt') a[field] = numText(v);
            else a[field] = val;
          } else if (k === 'notiz') {
            if (val) extras.unshift(val); // vorhandene Notiz zuerst
          } else if (k === '__faecher' || k === '__inhalt') {
            if (val && val !== '0' && val !== 'false') extras.push(`${k}: ${val}`);
          } else if (colKeys.has(k)) {
            const lbl = noteLabelOfKey.get(k);
            if (val && lbl) extras.push(`${lbl}: ${val}`);
          } else if (val && val !== 'false' && val !== '0') {
            extras.push(`(?): ${val}`); // Waise (gelöschte Spalte, kein Label mehr)
          }
        }
        const notiz = extras.filter(Boolean).join('\n');
        const stufe = a.stufe as number;
        const komplex = a.komplexitaet as number;
        if (!a.name && !a.effekt && !a.probe && !notiz && !stufe && !komplex) continue; // leere Zeile
        // Kategorie: eine echte „Kategorie"-Spalte hat Vorrang, sonst der
        // Sektionsname (Heilmagie, Kampfmagie …) — daraus wird die Gruppierung.
        const kategorie = (a.kategorie as string) || sec.name;
        ins.run(
          charId,
          pos++,
          makeUid(),
          magisch ? 1 : 0,
          0,
          a.name as string,
          a.element as string,
          JSON.stringify(kategorie ? [kategorie] : []),
          stufe,
          komplex,
          a.kosten as string,
          a.probe as string,
          a.effekt as string,
          a.fortschritt as number,
          notiz,
        );
        if (kategorie && !kategorienSeen.includes(kategorie)) kategorienSeen.push(kategorie);
        if (magisch) zauber++;
        else faehig++;
        const el = a.element as string;
        if (el && !elementsSeen.includes(el)) elementsSeen.push(el);
      }
    }
    const insL = db.prepare('INSERT INTO char_ability_lists (character_id, kind, pos, name) VALUES (?, ?, ?, ?)');
    elementsSeen.forEach((e, i) => insL.run(charId, 'element', i, e));
    kategorienSeen.forEach((k, i) => insL.run(charId, 'kategorie', i, k));
  });
  tx();
  return { skipped: false, zauber, faehigkeiten: faehig };
}

// Legt den alten dynamischen „Zauber/Fähigkeiten"-Reiter still: er wird samt
// Sektionen/Zeilen gelöscht, sobald der Spieler seine Daten in die neue
// Stammliste übernommen und geprüft hat. Einweg — die kuratierten Daten leben
// in char_abilities weiter, die rohe alte Tabelle ist danach weg.
export function retireOldZauberTab(charId: number): { retired: boolean } {
  const tab = db.prepare('SELECT id FROM char_tabs WHERE character_id = ? AND name = ?').get(charId, ZAUBER_IMPORT_TAB) as
    | { id: number }
    | undefined;
  if (!tab) return { retired: false };
  // Sicherheit: nicht entfernen, solange die neue Stammliste leer ist — sonst
  // ginge die einzige Kopie der Daten verloren.
  const have = (db.prepare('SELECT COUNT(*) AS n FROM char_abilities WHERE character_id = ?').get(charId) as { n: number }).n;
  if (have === 0) return { retired: false };
  const tx = db.transaction(() => {
    // Reiter samt Sektionen/Zeilen entfernen (ON DELETE CASCADE).
    db.prepare('DELETE FROM char_tabs WHERE id = ?').run(tab.id);
    // Den alten Schlüssel aus der gemerkten Reiter-Reihenfolge streichen (die
    // eingebauten Zauber-/Fähigkeiten-Reiter stehen dort ohnehin schon).
    const ord = db.prepare('SELECT keys FROM character_tab_order WHERE character_id = ?').get(charId) as { keys: string } | undefined;
    if (ord) {
      let keys: string[] = [];
      try {
        keys = JSON.parse(ord.keys) as string[];
      } catch {
        keys = [];
      }
      const oldKey = dynTabKey(tab.id);
      keys = keys.filter((k) => k !== oldKey);
      db.prepare('UPDATE character_tab_order SET keys = ? WHERE character_id = ?').run(JSON.stringify(keys), charId);
    }
  });
  tx();
  return { retired: true };
}

// --- Porträt ---
//
// Liegt seit dem Wiki in helden-assets.db, zusammen mit allen anderen Bildern
// und auf deren wöchentlichem Sicherungstakt. Die alte Tabelle `char_portraits`
// bleibt vorerst als Rückfallebene bestehen; die vier Funktionen hier sind nur
// noch die Naht, hinter der assets/portraits.ts das Ganze abwickelt.

export function hasPortrait(charId: number): boolean {
  return hatPortrait(charId);
}

export function loadPortrait(charId: number, full = false): { mime: string; data: Buffer } | undefined {
  return ladePortrait(charId, full);
}

export function savePortrait(charId: number, mime: string, data: Buffer, full = false): void {
  speicherePortrait(charId, mime, data, full);
}

export function savePortraitOriginal(charId: number, mime: string, data: Buffer): void {
  speicherePortraitOriginal(charId, mime, data);
}

// --- VTT-Wundverfolgung ---
//
// Hausregel-Mechanik neben der LE-Ressource (TODO.md "Wound tracking /
// count-display on VTT tokens") — kein Bogen-Bezug, nur die zwei rohen
// Zähler in char_meta, rein manuell von der VTT-Marke aus gepflegt (siehe
// board.ts's woundsVisibleTo/setTokenWounds).
export interface Wounds {
  small: number;
  big: number;
}

export function loadWounds(charId: number): Wounds {
  const row = db.prepare('SELECT small_wounds AS small, big_wounds AS big FROM char_meta WHERE character_id = ?').get(charId) as
    | Wounds
    | undefined;
  return row ?? { small: 0, big: 0 };
}

/** Clamped to [0, 20] — a hand-crafted WS message shouldn't be able to plant garbage; floors at 0 like the round tracker, no auto-removal at any count. */
export function saveWounds(charId: number, wounds: Wounds): Wounds {
  const small = Math.max(0, Math.min(20, Math.round(wounds.small)));
  const big = Math.max(0, Math.min(20, Math.round(wounds.big)));
  db.prepare('UPDATE char_meta SET small_wounds = ?, big_wounds = ? WHERE character_id = ?').run(small, big, charId);
  return { small, big };
}

export function deletePortrait(charId: number): void {
  loeschePortrait(charId);
}

// --- Speichern ---

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (v == null ? '' : String(v));

// Vorab-Diff für die Listen-Sektionen (talents/languages/Listen), die sonst
// blind DELETE+INSERT machen. Beide Seiten werden als Werte-Tupel in Spalten-
// reihenfolge normalisiert; sind sie deckungsgleich, wäre der Schreibvorgang ein
// reiner No-Op. Verglichen werden genau die Werte, die geschrieben würden — ein
// Save wird also nie fälschlich übersprungen.
const sameRows = (a: unknown[][], b: unknown[][]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

export function saveSection(charId: number, section: string, data: unknown): void {
  const tx = db.transaction(() => {
    if (section === 'bio' || section === 'meta') {
      const table = section === 'bio' ? 'char_bio' : 'char_meta';
      const existing = db.prepare(`SELECT * FROM ${table} WHERE character_id = ?`).get(charId) as Record<string, unknown>;
      const body = (data ?? {}) as Record<string, unknown>;
      // Geld-Umbau: geldD/geldS/geldH/geldK/bank sind kein Teil des Meta-Typs mehr
      // (siehe shared/src/types.ts) — die Spalten bleiben als Altbestand in
      // char_meta stehen, dürfen aber nicht länger mitgeschrieben werden (sonst
      // würde ein normales Meta-Speichern sie auf 0 zurücksetzen, weil `body`
      // diese Schlüssel gar nicht mehr enthält).
      const LEGACY_GELD_COLS = new Set(['geldD', 'geldS', 'geldH', 'geldK', 'bank']);
      const cols = Object.keys(existing).filter((k) => k !== 'character_id' && !LEGACY_GELD_COLS.has(k));
      const assignments = cols.map((c) => `${c} = ?`).join(', ');
      // rasseId ist die einzige nicht-textuelle char_bio-Spalte (Verweis in
      // races_catalog) — nullbare Ganzzahl statt der sonst üblichen str().
      const values = cols.map((c) => {
        if (c === 'rasseId') {
          const v = body[c];
          return v == null || v === '' ? null : Math.trunc(num(v));
        }
        return section === 'meta' ? num(body[c]) : str(body[c]);
      });
      db.prepare(`UPDATE ${table} SET ${assignments} WHERE character_id = ?`).run(...values, charId);
      return;
    }
    if (section === 'attributes') {
      const body = (data ?? {}) as Record<string, { akt?: unknown; mod?: unknown }>;
      const stmt = db.prepare('UPDATE char_attributes SET akt = ?, mod = ? WHERE character_id = ? AND attr = ?');
      for (const code of ATTR_ROW_CODES) {
        const v = body[code];
        if (v) stmt.run(num(v.akt), num(v.mod), charId, code);
      }
      return;
    }
    if (section === 'baseValues') {
      const body = (data ?? {}) as {
        mods?: Record<string, unknown>;
        gsBase?: unknown;
        resilienzBase?: unknown;
        mrBase?: unknown;
        akBase?: unknown;
      };
      const stmt = db.prepare('UPDATE char_base_values SET mod = ?, base = ? WHERE character_id = ? AND key = ?');
      for (const key of BASE_VALUE_KEYS) {
        const base =
          key === 'gs' ? num(body.gsBase)
          : key === 'resilienz' ? num(body.resilienzBase)
          : key === 'mr' ? num(body.mrBase)
          : key === 'artefaktkontrolle' ? num(body.akBase)
          : 0;
        stmt.run(num(body.mods?.[key]), base, charId, key);
      }
      return;
    }
    if (section === 'resources') {
      const body = (data ?? {}) as Record<string, Record<string, unknown>>;
      const stmt = db.prepare(
        'UPDATE char_resources SET permanent = ?, kauf = ?, kaufMax = ?, maxPlus = ?, aktuell = ?, besonderes = ?, raceBase = ? WHERE character_id = ? AND key = ?',
      );
      for (const key of RESOURCE_KEYS) {
        const v = body[key];
        if (!v) continue;
        const input: ResourceInput = {
          permanent: num(v.permanent),
          kauf: num(v.kauf),
          kaufMax: num(v.kaufMax),
          maxPlus: num(v.maxPlus),
          aktuell: num(v.aktuell),
          besonderes: str(v.besonderes),
          // Nicht vom Client editierbar (kommt aus der Rassen-Auswahl) — trotzdem
          // aus dem Body übernommen statt verworfen, sonst würde jedes Speichern
          // den Rassenbonus wieder auf 0 zurücksetzen.
          raceBase: num(v.raceBase),
        };
        // Aktuell wird NICHT gekappt, weder nach oben noch nach unten — ein
        // Vorrat darf bewusst über sein nutzbares Maximum steigen (Überladung,
        // siehe AktuellFeld.tsx) und ins Minus fallen. Ein Server-seitiges
        // Kappen nach oben widersprach dieser Absicht: der Wert kam bei jedem
        // Speichern (auch dem automatischen bei jeder Änderung) auf das
        // Maximum zurückgestutzt, was nach einem Neuladen wie ein Reset wirkte.
        stmt.run(
          input.permanent,
          input.kauf,
          input.kaufMax,
          input.maxPlus,
          input.aktuell,
          input.besonderes,
          input.raceBase,
          charId,
          key,
        );
      }
      return;
    }
    if (section === 'special') {
      // Spezialenergien: frei benannte Liste. Wie Talente/Sprachen per
      // Delete+Insert mit No-op-Wächter gespeichert. Namenlose Zeilen fallen
      // raus (leere „+ Zeile"-Reste), Name/Anzahl werden gekappt. Aktuell darf
      // — wie bei den festen Energien — bewusst über dem Maximum liegen
      // (Überladung), deshalb hier KEINE Deckelung nach oben.
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const next = rows
        .map(
          (r) =>
            [
              r.catalogId == null ? null : Number(r.catalogId),
              str(r.name).slice(0, MAX_SPECIAL_RESOURCE_NAME),
              num(r.max),
              num(r.bonus),
              num(r.aktuell),
            ] as [number | null, string, number, number, number],
        )
        .filter(([, name]) => name.trim() !== '')
        .slice(0, MAX_SPECIAL_RESOURCES);
      const cur = (db
        .prepare('SELECT catalog_id AS catalogId, name, max, bonus, aktuell FROM char_special_resources WHERE character_id = ? ORDER BY pos, id')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.catalogId, r.name, r.max, r.bonus, r.aktuell]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_special_resources WHERE character_id = ?').run(charId);
      const stmt = db.prepare(
        'INSERT INTO char_special_resources (character_id, pos, catalog_id, name, max, bonus, aktuell) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      next.forEach((values, i) => stmt.run(charId, i, ...values));
      return;
    }
    if (section === 'attrExtern') {
      // Externe Attributspunkte: gleiches Muster wie Spezialenergien
      // (Delete+Insert, No-op-Wächter). Quellenlose Zeilen fallen raus.
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const next = rows
        .map((r) => [str(r.quelle).slice(0, MAX_EXTERNAL_ATTR_POINT_NAME), num(r.punkte)] as [string, number])
        .filter(([quelle]) => quelle.trim() !== '')
        .slice(0, MAX_EXTERNAL_ATTR_POINTS);
      const cur = (db
        .prepare('SELECT quelle, punkte FROM char_attr_extern WHERE character_id = ? ORDER BY pos, id')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.quelle, r.punkte]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_attr_extern WHERE character_id = ?').run(charId);
      const stmt = db.prepare('INSERT INTO char_attr_extern (character_id, pos, quelle, punkte) VALUES (?, ?, ?, ?)');
      next.forEach((values, i) => stmt.run(charId, i, ...values));
      return;
    }
    if (section === 'talents') {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      // TaW ist bei 100 gedeckelt (Meisterschaft). Oberfläche kappt bereits beim
      // Eintippen; hier nochmal, weil die API auch direkt erreichbar ist.
      const next = rows.map((r) => [
        num(r.talentId), Math.min(100, num(r.taw)), num(r.at), num(r.pa), num(r.bl),
        str(r.billiger), str(r.spezialisierung), str(r.waffenmeister), str(r.berufsbonus), str(r.notiz),
        r.favorit ? 1 : 0,
      ]);
      const cur = (db
        .prepare('SELECT talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus, notiz, favorit FROM char_talents WHERE character_id = ? ORDER BY rowid')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.talent_id, r.taw, r.at, r.pa, r.bl, r.billiger, r.spezialisierung, r.waffenmeister, r.berufsbonus, r.notiz, r.favorit]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_talents WHERE character_id = ?').run(charId);
      const stmt = db.prepare(
        `INSERT INTO char_talents (character_id, talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus, notiz, favorit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const v of next) stmt.run(charId, ...v);
      return;
    }
    if (section === 'languages') {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const next = rows.map((r) => [num(r.languageId), num(r.taw), r.muttersprache ? 1 : 0]);
      const cur = (db
        .prepare('SELECT language_id, taw, muttersprache FROM char_languages WHERE character_id = ? ORDER BY rowid')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.language_id, r.taw, r.muttersprache]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_languages WHERE character_id = ?').run(charId);
      const stmt = db.prepare('INSERT INTO char_languages (character_id, language_id, taw, muttersprache) VALUES (?, ?, ?, ?)');
      for (const v of next) stmt.run(charId, ...v);
      return;
    }
    const def = listSectionById(section);
    if (!def) throw new Error(`Unbekannte Sektion: ${section}`);
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const cols = def.columns.map((c) => c.key);
    const next = rows.map((r) =>
      def.columns.map((c) => (c.type === 'number' ? num(r[c.key]) : c.type === 'bool' ? (r[c.key] ? 1 : 0) : str(r[c.key]))),
    );
    const cur = (db.prepare(`SELECT ${cols.join(', ')} FROM sec_${section} WHERE character_id = ? ORDER BY pos, id`).all(charId) as Record<string, unknown>[])
      .map((r) => cols.map((k) => r[k]));
    if (sameRows(cur, next)) return;
    db.prepare(`DELETE FROM sec_${section} WHERE character_id = ?`).run(charId);
    const stmt = db.prepare(
      `INSERT INTO sec_${section} (character_id, pos, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
    );
    next.forEach((values, i) => stmt.run(charId, i, ...values));
  });
  tx();
}

export function saveVisibility(charId: number, data: Record<string, unknown>): void {
  const stmt = db.prepare(
    'INSERT INTO character_visibility (character_id, section, visible) VALUES (?, ?, ?) ON CONFLICT (character_id, section) DO UPDATE SET visible = excluded.visible',
  );
  const tx = db.transaction(() => {
    for (const s of VISIBILITY_SECTIONS) if (s in data) stmt.run(charId, s, data[s] ? 1 : 0);
  });
  tx();
}

// Legt aus einer exportierten Charakter-Datei einen neuen Charakter an. Alles
// läuft in einer Transaktion: schlägt ein Teil fehl, entsteht kein halber
// Charakter. Die festen Sektionen gehen durch saveSection (validiert/kappt
// bereits), die dynamischen Tabs werden 1:1 nachgebaut. Standard-Tabs werden
// bewusst NICHT angelegt — die Tabs kommen vollständig aus der Datei.
export function importFullCharacter(
  name: string,
  ownerUserId: number,
  groupId: number,
  data: ReturnType<typeof loadFullCharacter>,
): number {
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, ?)').run(name, ownerUserId, groupId);
    const charId = Number(r.lastInsertRowid);
    initCharacterRows(charId);

    if (data.bio) saveSection(charId, 'bio', data.bio);
    if (data.meta) saveSection(charId, 'meta', data.meta);
    if (data.attributes) saveSection(charId, 'attributes', data.attributes);
    if (data.baseValues) saveSection(charId, 'baseValues', data.baseValues);
    if (data.resources) saveSection(charId, 'resources', data.resources);
    if (data.special) saveSection(charId, 'special', data.special);
    if (data.attrExtern) saveSection(charId, 'attrExtern', data.attrExtern);
    if (data.talents) saveSection(charId, 'talents', data.talents);
    if (data.languages) saveSection(charId, 'languages', data.languages);
    for (const [sid, rows] of Object.entries(data.lists ?? {})) {
      if (listSectionById(sid)) saveSection(charId, sid, rows);
    }

    // Beim Import bekommen die Reiter neue IDs. Die Zuordnung alt→neu wird
    // mitgeschrieben, damit die gespeicherte Reihenfolge (die Reiter über ihre
    // ID benennt) den Import übersteht.
    const tabIdMap = new Map<number, number>();
    for (const tab of data.tabs ?? []) {
      const tabId = createTab(charId, str(tab.name), !!tab.locked);
      if (typeof tab.id === 'number') tabIdMap.set(tab.id, tabId);
      for (const section of tab.sections ?? []) {
        const secId = createDynSection(charId, tabId, str(section.name), section.type, normalizeColumns(section.columns));
        if (Array.isArray(section.rows) && section.rows.length) saveDynRows(secId, section.rows);
        if (section.visible) updateDynSection(secId, { visible: true });
      }
    }

    if (data.visibility) saveVisibility(charId, data.visibility as Record<string, unknown>);

    // Spaltenbreiten aus der Datei übernehmen, damit ein importierter Charakter
    // genauso aussieht wie der exportierte. Ältere Dateien haben das Feld nicht.
    for (const [key, widths] of Object.entries(data.tableWidths ?? {})) {
      if (key.length > MAX_TABLE_KEY) continue;
      const clean = normalizeWidths((Array.isArray(widths) ? widths : []).slice(0, MAX_TABLE_COLUMNS));
      if (clean.length) saveTableWidths(charId, key, clean);
    }

    // Reiter-Reihenfolge übernehmen, mit den neuen IDs. Ein Schlüssel, dessen
    // Reiter nicht mitkam, fällt weg — der Client würde ihn ohnehin ignorieren.
    const order = normalizeTabOrder(Array.isArray(data.tabOrder) ? data.tabOrder : [])
      .map((key) => {
        const oldId = dynTabId(key);
        if (oldId === null) return key;
        const newId = tabIdMap.get(oldId);
        return newId === undefined ? '' : dynTabKey(newId);
      })
      .filter((key) => key !== '');
    if (order.length) saveTabOrder(charId, order);
    return charId;
  });
  return tx();
}

// --- Zusammenfassung für Gruppenmitglieder (serverseitig berechnet) ---

interface CatalogTalent {
  id: number;
  kategorie: string;
  gruppe: string;
  name: string;
  probe: string;
  ableiten: string;
}

export function buildSummary(charId: number) {
  const visibility = loadVisibility(charId);
  const stats = loadStats(charId);
  const { attrs: attributes, resources } = stats;
  const baseValues = computeBaseValues(attributes, stats.baseInputs);
  const bio = loadSingleRow('char_bio', charId);
  const lists = loadAllLists(charId);

  const sections: Record<string, unknown> = {};

  if (visibility.attribute) {
    sections.attribute = ATTR_ROW_CODES.map((code) => ({
      code,
      label: ATTR_LABELS[code],
      max: attributes[code].akt + attributes[code].mod,
    }));
  }
  if (visibility.basiswerte) {
    sections.basiswerte = BASE_VALUE_KEYS.map((key) => ({
      key,
      label: BASE_VALUE_LABELS[key].label,
      ergebnis: baseValues[key].ergebnis,
    }));
  }
  if (visibility.ressourcen) {
    sections.ressourcen = RESOURCE_KEYS.map((key) => {
      const r = computeResource(attributes, key, resources[key]);
      return {
        key,
        label: RESOURCE_LABELS[key].label,
        aktuell: resources[key].aktuell,
        ergebnis: r.ergebnis,
        max: r.max,
        nutzbar: r.nutzbar,
        gekappt: r.gekappt,
      };
    });
  }
  if (visibility.talente) {
    const catalog = db.prepare('SELECT * FROM talents_catalog').all() as CatalogTalent[];
    const byId = new Map(catalog.map((c) => [c.id, c]));
    sections.talente = stats.talente
      // Auch ein Talent zeigen, das nur über einen Item-„Probe"-Bonus wirkt
      // (siehe talentProbeBonus) — sonst würde eine an sich ungelernte Fähigkeit,
      // die ein Gegenstand trotzdem würfelbar erleichtert, in der Übersicht
      // spurlos verschwinden, obwohl der Bogen selbst die Zahl längst zeigt.
      .filter((t) => t.taw !== 0 || t.at !== 0 || t.pa !== 0 || t.bl !== 0 || talentProbeBonus(t.talentId, stats.boni) !== 0)
      .map((t) => {
        const cat = byId.get(t.talentId);
        const probe = cat?.probe ? (cat.probe.split('/') as AttrCode[]) : null;
        return {
          name: cat?.name ?? '?',
          kategorie: cat?.kategorie ?? '',
          probe: cat?.probe ?? '',
          taw: t.taw,
          probeZahl:
            probe && probe.length === 3
              ? talentProbeZahl(attributes, probe as [AttrCode, AttrCode, AttrCode], t.taw) + talentProbeBonus(t.talentId, stats.boni)
              : null,
          spezialisierung: t.spezialisierung,
        };
      });
  }
  if (visibility.waffen) {
    const talents = new Map(stats.talente.map((t) => [t.talentId, t]));
    const base = { at: baseValues.at.ergebnis, pa: baseValues.pa.ergebnis, bl: baseValues.bl.ergebnis };
    sections.waffen = {
      nah: lists.waffenNah.map((w) => {
        const talent = talents.get(Number(w.talentId));
        const split = { at: talent?.at ?? 0, pa: talent?.pa ?? 0, bl: talent?.bl ?? 0 };
        const probes = weaponProbes({ at: Number(w.at), pa: Number(w.pa), bl: Number(w.bl) }, base, split);
        return { ...w, probes };
      }),
      fern: lists.waffenFern,
      waffenlos: lists.waffenlos,
    };
  }
  if (visibility.sprachen) {
    const catalog = db.prepare('SELECT * FROM languages_catalog').all() as { id: number; kind: string; name: string; familie: string }[];
    const byId = new Map(catalog.map((c) => [c.id, c]));
    sections.sprachen = loadLanguages(charId)
      .filter((l) => l.taw !== 0 || l.muttersprache)
      .map((l) => ({ ...byId.get(l.languageId), taw: l.taw, muttersprache: l.muttersprache }));
  }

  // Sichtbar geschaltete generische Sektionen (Probe-Spalten rechnet der Client)
  const dynSections = loadDynSections(charId).filter((s) => s.visible);

  return { bio, sections, dynSections, attributes, visibility, portrait: hasPortrait(charId) };
}

// Spielleiter-Übersicht einer Gruppe: je Charakter die wichtigsten Kennwerte für
// die chip-basierte Kartenansicht. Anders als buildSummary ignoriert das die
// Sichtbarkeits-Einstellungen — der Spielleiter sieht immer alles (die Route
// dahinter ist requireGm). Der Client besitzt Kurz-Labels und Färbung.
// Ein Charakter gehört zu dieser Gruppe entweder fest (characters.group_id,
// exklusiv) oder additiv über eine Event-Gruppen-Mitgliedschaft
// (temp_group_members) — dieselbe Übersicht bedient deshalb beide
// Gruppenarten mit EINER Abfrage: für eine feste Gruppe trägt kein Charakter
// je einen temp_group_members-Eintrag mit dieser id, für eine Event-Gruppe
// zeigt umgekehrt kein group_id je auf sie. Die UNION ist also nie doppelt
// befüllt, ohne dass hier bekannt sein muss, welche Art von Gruppe das ist.
export function buildGroupOverview(groupId: number) {
  const chars = db
    .prepare(
      `SELECT c.id, c.name AS name, c.owner_user_id AS ownerUserId, u.display_name AS ownerName
       FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.group_id = ?
       UNION
       SELECT c.id, c.name AS name, c.owner_user_id AS ownerUserId, u.display_name AS ownerName
       FROM characters c
       JOIN users u ON u.id = c.owner_user_id
       JOIN temp_group_members tgm ON tgm.character_id = c.id
       WHERE tgm.temp_group_id = ?
       ORDER BY name`,
    )
    .all(groupId, groupId) as { id: number; name: string; ownerUserId: number; ownerName: string }[];
  return overviewForChars(chars);
}

function overviewForChars(chars: { id: number; name: string; ownerUserId: number; ownerName: string }[]) {
  return chars.map((c) => {
    const stats = loadStats(c.id);
    const { attrs: attributes, resources } = stats;
    const baseValues = computeBaseValues(attributes, stats.baseInputs);
    const meta = loadSingleRow('char_meta', c.id) as {
      stufe?: number;
      psycheAkt?: number;
      psycheBase?: number;
      schicksalspunkteAktuell?: number;
      schicksalspunkteMax?: number;
    };

    // Vitale Pools als Chips „aktuell/max". Als Maximum zählt der NUTZBARE Wert
    // (Rohsumme über der Ausbaugrenze ist kein Vorrat) — gleiche Wahl wie im
    // Heldenbrief. AsE nur, wenn der Charakter sie überhaupt nutzt: solange es
    // kein „hat ASP"-Flag gibt (siehe TODO Spezialenergien), gilt als Näherung
    // „irgendein AsE-Feld ist gesetzt". So verschwindet die Spalte bei reinen
    // Nicht-Zauberern, ohne einem erschöpften Magier den Chip wegzunehmen.
    const vitals: { key: string; aktuell: number; max: number }[] = [];
    for (const key of RESOURCE_KEYS) {
      const inp = resources[key];
      if (key === 'ase' && !(inp.aktuell || inp.permanent || inp.kauf || inp.kaufMax || inp.maxPlus)) continue;
      const r = computeResource(attributes, key, inp);
      vitals.push({ key, aktuell: inp.aktuell, max: r.nutzbar });
    }
    // Psyche ist kein echter Vorrat (keine Ausbaugrenze); Max aus Rassenwert +
    // Bonus + MU-Anteil — dieselbe Formel wie im Heldenbrief.
    vitals.push({
      key: 'psyche',
      aktuell: meta.psycheAkt ?? 0,
      max: psycheMax(attributes, meta.psycheBase ?? 0, stats.psycheBonus),
    });
    // Spezialenergien reihen sich als weitere Vital-Chips ein — der Schlüssel ist
    // der frei gewählte Name (dient zugleich als Chip-Beschriftung). Kein eigener
    // Chip-Typ nötig: sie färben wie die anderen (Überladung), zeigen aktuell/max.
    // stats.special trägt bereits das LIVE-Maximum (Formel + Bonus) statt des
    // gespeicherten Snapshots — vorher zeigte diese Übersicht bei Formel-
    // Energien einen veralteten Wert (siehe loadStats/spezialenergieMax).
    for (const sr of stats.special) {
      vitals.push({ key: sr.name, aktuell: sr.aktuell, max: sr.max });
    }
    // Schicksalspunkte: erlauben eine komplette Probe neu zu würfeln, wenn die
    // Spielleitung zustimmt (siehe DicePanel — Spieler verwalten sie dort selbst).
    // Chip hier ist reine Anzeige, damit die Übersicht den Stand jedes Charakters
    // zeigt, ohne dessen Bogen zu öffnen.
    vitals.push({
      key: 'schicksalspunkte',
      aktuell: meta.schicksalspunkteAktuell ?? 0,
      max: meta.schicksalspunkteMax ?? 0,
    });

    return {
      id: c.id,
      name: c.name,
      // Für „Probe anfordern" auf der Übersicht: die Anfrage geht an den Besitzer.
      ownerUserId: c.ownerUserId,
      ownerName: c.ownerName,
      stufe: meta.stufe ?? 0,
      portrait: hasPortrait(c.id),
      vitals,
      thresholds: { wund: baseValues.wundschwelle.ergebnis, tod: baseValues.todesschwelle.ergebnis },
      attributes: ATTR_CODES.map((code) => ({ code, value: attributes[code].akt + attributes[code].mod })),
      // Nur AUSGEBILDETE Talente (TaW ≠ 0), je Talent-ID auf den TaW verdichtet.
      // Der Katalog (Namen) reist getrennt mit, damit die GM-Abfrage jeden Namen
      // vorschlagen kann — auch einen, den in der Gruppe niemand kann.
      talents: loadTalents(c.id)
        .filter((t) => t.taw !== 0)
        .map((t) => ({ id: t.talentId, taw: t.taw })),
      tags: db
        .prepare(
          `SELECT t.id, t.name FROM char_tags ct JOIN tags_catalog t ON t.id = ct.tag_id
           WHERE ct.character_id = ? ORDER BY t.sort, t.name`,
        )
        .all(c.id) as { id: number; name: string }[],
      gmNotiz: (db.prepare('SELECT notiz FROM char_gm_notes WHERE character_id = ?').get(c.id) as { notiz: string } | undefined)
        ?.notiz ?? '',
    };
  });
}

// Katalog-Namen für die GM-Talentabfrage (Autovervollständigung). Global, also
// einmal pro Übersicht mitgeliefert, nicht pro Charakter.
export function talentCatalogList() {
  return db
    .prepare('SELECT id, name, gruppe FROM talents_catalog ORDER BY name')
    .all() as { id: number; name: string; gruppe: string }[];
}

// Merkmale-Katalog für die GM-Übersicht (Zuweis-Auswahl je Karte).
export function tagCatalogList() {
  return db.prepare('SELECT id, name FROM tags_catalog ORDER BY sort, name').all() as { id: number; name: string }[];
}

// Merkmal-Zuweisung und GM-Notiz sind bewusst NICHT über den normalen
// section-save-Weg (dort hat der Charakterbesitzer 'edit') — eigene,
// requireGm-geschützte Schreiboperationen (siehe routes.ts).
export function addCharTag(charId: number, tagId: number) {
  db.prepare('INSERT OR IGNORE INTO char_tags (character_id, tag_id) VALUES (?, ?)').run(charId, tagId);
}

export function removeCharTag(charId: number, tagId: number) {
  db.prepare('DELETE FROM char_tags WHERE character_id = ? AND tag_id = ?').run(charId, tagId);
}

export function setGmNotiz(charId: number, notiz: string) {
  db.prepare(
    `INSERT INTO char_gm_notes (character_id, notiz) VALUES (?, ?)
     ON CONFLICT(character_id) DO UPDATE SET notiz = excluded.notiz`,
  ).run(charId, notiz);
}
