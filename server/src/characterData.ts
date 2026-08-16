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
  ITEM_LOCATIONS,
  makeUid,
  listSectionById,
  readSlots,
  normalizeColumns,
  normalizeTabOrder,
  normalizeWidths,
  talentProbeZahl,
  weaponProbes,
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
  ExternalAttrPoint,
  Item,
  ItemLocation,
  ResourceInput,
  Resources,
  SpecialResource,
  VisibilitySection,
} from 'shared';
import { db, initCharacterRows } from './db.js';
import { createDynSection, createTab, loadDynSections, loadDynTabs, saveDynRows, updateDynSection } from './dynSections.js';

// --- Laden ---

export function loadAttributes(charId: number): Attributes {
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

export function loadBaseValueInputs(charId: number): BaseValueInputs {
  const rows = db.prepare('SELECT key, mod, base FROM char_base_values WHERE character_id = ?').all(charId) as {
    key: string;
    mod: number;
    base: number;
  }[];
  const mods = Object.fromEntries(BASE_VALUE_KEYS.map((k) => [k, 0])) as BaseValueInputs['mods'];
  let gsBase = 0;
  let resilienzBase = 0;
  for (const r of rows) {
    if (BASE_VALUE_KEYS.includes(r.key as never)) mods[r.key as keyof typeof mods] = r.mod;
    if (r.key === 'gs') gsBase = r.base;
    if (r.key === 'resilienz') resilienzBase = r.base;
  }
  return { mods, gsBase, resilienzBase };
}

export function loadResources(charId: number): Resources {
  const rows = db
    .prepare('SELECT key, permanent, kauf, kaufMax, maxPlus, aktuell, besonderes FROM char_resources WHERE character_id = ?')
    .all(charId) as ({ key: string } & Resources['le'])[];
  const empty = () => ({ permanent: 0, kauf: 0, kaufMax: 0, maxPlus: 0, aktuell: 0, besonderes: '' });
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
  return (
    db
      .prepare(
        `SELECT talent_id AS talentId, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus
         FROM char_talents WHERE character_id = ?`,
      )
      .all(charId) as CharTalent[]
  );
}

export function loadLanguages(charId: number): CharLanguage[] {
  const rows = db
    .prepare('SELECT language_id AS languageId, taw, muttersprache FROM char_languages WHERE character_id = ?')
    .all(charId) as { languageId: number; taw: number; muttersprache: number }[];
  return rows.map((r) => ({ languageId: r.languageId, taw: r.taw, muttersprache: !!r.muttersprache }));
}

export function loadSpecialResources(charId: number): SpecialResource[] {
  return db
    .prepare('SELECT name, max, aktuell FROM char_special_resources WHERE character_id = ? ORDER BY pos, id')
    .all(charId) as SpecialResource[];
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

// Ein paar sinnvolle Ausgangs-Kategorien für einen neuen Charakter, sofern er
// noch keine hat. Frei änderbar — nur eine Starthilfe, kein Zwang.
export function seedItemCategories(charId: number): void {
  const have = (db.prepare('SELECT COUNT(*) AS n FROM char_item_categories WHERE character_id = ?').get(charId) as { n: number }).n;
  if (have > 0) return;
  const ins = db.prepare('INSERT INTO char_item_categories (character_id, pos, name) VALUES (?, ?, ?)');
  INVENTAR_KATEGORIEN.forEach((name, i) => ins.run(charId, i, name));
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
    kapazitaet: 0, gewichtsreduktion: 0, rs: 0, notiz: '',
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
        kapazitaet: 0, gewichtsreduktion: 0, rs: 0, notiz: '' });
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

export function loadFullCharacter(charId: number) {
  const meta = loadSingleRow('char_meta', charId);
  const attributes = loadAttributes(charId);
  return {
    bio: loadSingleRow('char_bio', charId),
    meta,
    attributes,
    baseValues: loadBaseValueInputs(charId),
    resources: loadResources(charId),
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
    items: loadItems(charId),
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

const clampMin = (v: unknown, min = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

export function loadItems(charId: number): Item[] {
  const rows = db
    .prepare(
      'SELECT id, uid, name, anzahl, gewicht, kategorie, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, notiz FROM char_items WHERE character_id = ? ORDER BY pos, id',
    )
    .all(charId) as {
    id: number;
    uid: string;
    name: string;
    anzahl: number;
    gewicht: number;
    kategorie: string;
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
    notiz: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid || makeUid(),
    name: r.name,
    anzahl: r.anzahl,
    gewicht: r.gewicht,
    kategorie: r.kategorie,
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
    notiz: r.notiz,
  }));
}

export function loadItemCategories(charId: number): string[] {
  return (
    db.prepare('SELECT name FROM char_item_categories WHERE character_id = ? ORDER BY pos, id').all(charId) as { name: string }[]
  ).map((r) => r.name);
}

// Ganze Liste ersetzen (wie die übrigen Sektionen). Serverseitig gedeckelt und
// normalisiert, damit über die Schnittstelle nichts Unsinniges in die DB kommt.
const ZONE_SET = new Set<string>(BODY_ZONES as readonly string[]);
const clampPct = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));

export function saveItems(charId: number, raw: unknown): void {
  const arr = Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : [];
  // uids eindeutig halten: fehlende oder doppelte erzeugen wir neu, damit die
  // Behälter-Verweise (containerUid) verlässlich ein Ziel treffen.
  const seenUids = new Set<string>();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM char_items WHERE character_id = ?').run(charId);
    const ins = db.prepare(
      `INSERT INTO char_items (character_id, pos, uid, name, anzahl, gewicht, kategorie, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, notiz)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    arr.forEach((it, i) => {
      const o = (it ?? {}) as Record<string, unknown>;
      const loc = (ITEM_LOCATIONS as string[]).includes(String(o.location)) ? String(o.location) : 'inventar';
      let uid = String(o.uid ?? '').slice(0, 64);
      if (!uid || seenUids.has(uid)) uid = makeUid();
      seenUids.add(uid);
      // Zone/Behälter passend zum Ort halten: nur getragene Sachen haben eine
      // Zone, nur Behälter-Inhalte einen container_uid. So bleibt der Datensatz
      // widerspruchsfrei, egal was von außen kommt.
      const zoneRaw = String(o.zone ?? '');
      const zone = loc === 'getragen' && ZONE_SET.has(zoneRaw) ? zoneRaw : '';
      // „Beidseitig" nur behalten, wenn der Gegenstand auch wirklich in einer
      // seitengetrennten Körperzone (Arm/Hand/Bein) getragen wird — sonst wäre
      // das Kennzeichen wirkungslos und bliebe als Altlast hängen.
      const beidseitig = isPairedZone(zone) && o.beidseitig ? 1 : 0;
      const containerUid = loc === 'behaelter' ? String(o.containerUid ?? '').slice(0, 64) : '';
      const art = (CONTAINER_ARTEN as string[]).includes(String(o.containerArt)) ? String(o.containerArt) : 'storage';
      const kapArt = (KAPAZITAET_ARTEN as string[]).includes(String(o.kapazitaetArt)) ? String(o.kapazitaetArt) : 'gewicht';
      ins.run(
        charId,
        i,
        uid,
        String(o.name ?? '').slice(0, MAX_ITEM_TEXT),
        clampMin(o.anzahl),
        clampMin(o.gewicht),
        String(o.kategorie ?? '').slice(0, MAX_ITEM_TEXT),
        loc,
        zone,
        beidseitig,
        containerUid,
        o.istBehaelter ? 1 : 0,
        art,
        clampMin(o.kapazitaet),
        kapArt,
        clampPct(o.gewichtsreduktion),
        clampMin(o.rs),
        String(o.notiz ?? '').slice(0, MAX_ITEM_TEXT),
      );
    });
  });
  tx();
}

export function saveItemCategories(charId: number, raw: unknown): void {
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
    db.prepare('DELETE FROM char_item_categories WHERE character_id = ?').run(charId);
    const ins = db.prepare('INSERT INTO char_item_categories (character_id, pos, name) VALUES (?, ?, ?)');
    clean.forEach((name, i) => ins.run(charId, i, name));
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
    const up = db.prepare('UPDATE char_items SET kategorie = ? WHERE character_id = ? AND kategorie = ?');
    for (const r of renames) {
      const from = String((r as { from?: unknown })?.from ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      const to = String((r as { to?: unknown })?.to ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      if (from && to && from !== to) up.run(to, charId, from);
    }
    for (const name of removes) {
      const n = String(name ?? '').trim().slice(0, MAX_CATEGORY_LEN);
      if (n) up.run('', charId, n);
    }
    db.prepare('DELETE FROM char_item_categories WHERE character_id = ?').run(charId);
    const ins = db.prepare('INSERT INTO char_item_categories (character_id, pos, name) VALUES (?, ?, ?)');
    clean.forEach((name, i) => ins.run(charId, i, name));
  });
  tx();
  return loadItemCategories(charId);
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
      'SELECT id, uid, magisch, passiv, signatur, name, element, kategorien, stufe, komplexitaet, kosten, probe, effekt, fortschritt, notiz FROM char_abilities WHERE character_id = ? ORDER BY pos, id',
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
      `INSERT INTO char_abilities (character_id, pos, uid, magisch, passiv, signatur, name, element, kategorien, stufe, komplexitaet, kosten, probe, effekt, fortschritt, notiz)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

// --- Porträt (als Blob in der DB, damit es in den täglichen Sicherungen liegt) ---

export function hasPortrait(charId: number): boolean {
  return !!db.prepare('SELECT 1 FROM char_portraits WHERE character_id = ?').get(charId);
}

export function loadPortrait(charId: number): { mime: string; data: Buffer } | undefined {
  const row = db.prepare('SELECT mime, data FROM char_portraits WHERE character_id = ?').get(charId) as
    | { mime: string; data: Buffer }
    | undefined;
  return row;
}

export function savePortrait(charId: number, mime: string, data: Buffer): void {
  db.prepare(
    `INSERT INTO char_portraits (character_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (character_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(charId, mime, data);
}

export function deletePortrait(charId: number): void {
  db.prepare('DELETE FROM char_portraits WHERE character_id = ?').run(charId);
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
      const body = (data ?? {}) as { mods?: Record<string, unknown>; gsBase?: unknown; resilienzBase?: unknown };
      const stmt = db.prepare('UPDATE char_base_values SET mod = ?, base = ? WHERE character_id = ? AND key = ?');
      for (const key of BASE_VALUE_KEYS) {
        const base = key === 'gs' ? num(body.gsBase) : key === 'resilienz' ? num(body.resilienzBase) : 0;
        stmt.run(num(body.mods?.[key]), base, charId, key);
      }
      return;
    }
    if (section === 'resources') {
      const body = (data ?? {}) as Record<string, Record<string, unknown>>;
      const attributes = loadAttributes(charId);
      const stmt = db.prepare(
        'UPDATE char_resources SET permanent = ?, kauf = ?, kaufMax = ?, maxPlus = ?, aktuell = ?, besonderes = ? WHERE character_id = ? AND key = ?',
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
        };
        // Aktuell kann nie über dem nutzbaren Maximum liegen. Die Oberfläche
        // kappt bereits beim Eintippen; hier nochmal, weil die API auch ohne
        // sie erreichbar ist und die Regel nicht an einem Eingabefeld hängen
        // darf. Nach unten wird nicht gekappt — ein Vorrat darf ins Minus.
        const { nutzbar } = computeResource(attributes, key, input);
        stmt.run(
          input.permanent,
          input.kauf,
          input.kaufMax,
          input.maxPlus,
          Math.min(input.aktuell, nutzbar),
          input.besonderes,
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
        .map((r) => [str(r.name).slice(0, MAX_SPECIAL_RESOURCE_NAME), num(r.max), num(r.aktuell)] as [string, number, number])
        .filter(([name]) => name.trim() !== '')
        .slice(0, MAX_SPECIAL_RESOURCES);
      const cur = (db
        .prepare('SELECT name, max, aktuell FROM char_special_resources WHERE character_id = ? ORDER BY pos, id')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.name, r.max, r.aktuell]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_special_resources WHERE character_id = ?').run(charId);
      const stmt = db.prepare('INSERT INTO char_special_resources (character_id, pos, name, max, aktuell) VALUES (?, ?, ?, ?, ?)');
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
        str(r.billiger), str(r.spezialisierung), str(r.waffenmeister), str(r.berufsbonus),
      ]);
      const cur = (db
        .prepare('SELECT talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus FROM char_talents WHERE character_id = ? ORDER BY rowid')
        .all(charId) as Record<string, unknown>[])
        .map((r) => [r.talent_id, r.taw, r.at, r.pa, r.bl, r.billiger, r.spezialisierung, r.waffenmeister, r.berufsbonus]);
      if (sameRows(cur, next)) return;
      db.prepare('DELETE FROM char_talents WHERE character_id = ?').run(charId);
      const stmt = db.prepare(
        `INSERT INTO char_talents (character_id, talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const attributes = loadAttributes(charId);
  const resources = loadResources(charId);
  const baseInputs = loadBaseValueInputs(charId);
  const baseValues = computeBaseValues(attributes, baseInputs);
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
    sections.talente = loadTalents(charId)
      .filter((t) => t.taw !== 0 || t.at !== 0 || t.pa !== 0 || t.bl !== 0)
      .map((t) => {
        const cat = byId.get(t.talentId);
        const probe = cat?.probe ? (cat.probe.split('/') as AttrCode[]) : null;
        return {
          name: cat?.name ?? '?',
          kategorie: cat?.kategorie ?? '',
          probe: cat?.probe ?? '',
          taw: t.taw,
          probeZahl: probe && probe.length === 3 ? talentProbeZahl(attributes, probe as [AttrCode, AttrCode, AttrCode], t.taw) : null,
          spezialisierung: t.spezialisierung,
        };
      });
  }
  if (visibility.waffen) {
    const talents = new Map(loadTalents(charId).map((t) => [t.talentId, t]));
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
export function buildGroupOverview(groupId: number) {
  const chars = db
    .prepare(
      `SELECT c.id, c.name, u.display_name AS ownerName
       FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.group_id = ? ORDER BY c.name`,
    )
    .all(groupId) as { id: number; name: string; ownerName: string }[];
  return overviewForChars(chars);
}

// Dieselbe Übersicht für eine temporäre/Event-Gruppe — additiv über
// temp_group_members statt der festen characters.group_id, sonst identische
// Aggregation (siehe buildGroupOverview).
export function buildTempGroupOverview(tempGroupId: number) {
  const chars = db
    .prepare(
      `SELECT c.id, c.name, u.display_name AS ownerName
       FROM characters c
       JOIN users u ON u.id = c.owner_user_id
       JOIN temp_group_members tgm ON tgm.character_id = c.id
       WHERE tgm.temp_group_id = ? ORDER BY c.name`,
    )
    .all(tempGroupId) as { id: number; name: string; ownerName: string }[];
  return overviewForChars(chars);
}

function overviewForChars(chars: { id: number; name: string; ownerName: string }[]) {
  return chars.map((c) => {
    const attributes = loadAttributes(c.id);
    const resources = loadResources(c.id);
    const baseValues = computeBaseValues(attributes, loadBaseValueInputs(c.id));
    const meta = loadSingleRow('char_meta', c.id) as {
      stufe?: number;
      psycheAkt?: number;
      psycheBase?: number;
      psycheBonus?: number;
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
      max: psycheMax(attributes, meta.psycheBase ?? 0, meta.psycheBonus ?? 0),
    });
    // Spezialenergien reihen sich als weitere Vital-Chips ein — der Schlüssel ist
    // der frei gewählte Name (dient zugleich als Chip-Beschriftung). Kein eigener
    // Chip-Typ nötig: sie färben wie die anderen (Überladung), zeigen aktuell/max.
    for (const sr of loadSpecialResources(c.id)) {
      vitals.push({ key: sr.name, aktuell: sr.aktuell, max: sr.max });
    }

    return {
      id: c.id,
      name: c.name,
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
