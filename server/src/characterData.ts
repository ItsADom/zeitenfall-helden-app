import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  LIST_SECTIONS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  VISIBILITY_SECTIONS,
  computeBaseValues,
  computeResource,
  dynTabId,
  dynTabKey,
  erleichterung,
  ITEM_LOCATIONS,
  listSectionById,
  normalizeColumns,
  normalizeTabOrder,
  normalizeWidths,
  talentProbeZahl,
  weaponProbes,
} from 'shared';
import type {
  AttrCode,
  Attributes,
  BaseValueInputs,
  CharTalent,
  CharLanguage,
  DynColumn,
  Item,
  ItemLocation,
  ResourceInput,
  Resources,
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
  for (const r of rows) {
    if (BASE_VALUE_KEYS.includes(r.key as never)) mods[r.key as keyof typeof mods] = r.mod;
    if (r.key === 'gs') gsBase = r.base;
  }
  return { mods, gsBase };
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

const STANDARD_TABS: { name: string; locked: boolean; sectionIds: string[] }[] = [
  { name: VORTEILE_TAB, locked: true, sectionIds: ['professionBoni', 'vorteile', 'nachteile', 'titel', 'perks'] },
  { name: 'Ausrüstung', locked: true, sectionIds: ['ausruestungSlots', 'behaelter', 'proviant', 'kleidungen', 'tierAusruestung'] },
  { name: 'Inventar', locked: true, sectionIds: ['inventar'] },
  { name: 'Zauber/Fähigkeiten', locked: true, sectionIds: [] },
  { name: 'Bibliothek', locked: true, sectionIds: ['bibliothek'] },
  { name: 'Artefakte', locked: false, sectionIds: ['kraftspeicher', 'artefakte'] },
  { name: 'Besitz', locked: false, sectionIds: ['waehrungen', 'schulden', 'wertgegenstaende', 'einnahmequellen', 'immobilien', 'besitzSonstiges'] },
  { name: 'Boni', locked: false, sectionIds: ['boni'] },
  { name: 'Vorlieben', locked: false, sectionIds: ['vorlieben'] },
];

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
function buildStandardTabs(charId: number, getRows: (sectionId: string) => Record<string, unknown>[]): number {
  let created = 0;
  for (const tabDef of STANDARD_TABS) {
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
  const tx = db.transaction(() => buildStandardTabs(charId, () => []));
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

export function loadFullCharacter(charId: number) {
  return {
    bio: loadSingleRow('char_bio', charId),
    meta: loadSingleRow('char_meta', charId),
    attributes: loadAttributes(charId),
    baseValues: loadBaseValueInputs(charId),
    resources: loadResources(charId),
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
    .prepare('SELECT id, name, anzahl, gewicht, kategorie, location, notiz FROM char_items WHERE character_id = ? ORDER BY pos, id')
    .all(charId) as { id: number; name: string; anzahl: number; gewicht: number; kategorie: string; location: string; notiz: string }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    anzahl: r.anzahl,
    gewicht: r.gewicht,
    kategorie: r.kategorie,
    location: (ITEM_LOCATIONS as string[]).includes(r.location) ? (r.location as ItemLocation) : 'inventar',
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
export function saveItems(charId: number, raw: unknown): void {
  const arr = Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM char_items WHERE character_id = ?').run(charId);
    const ins = db.prepare(
      'INSERT INTO char_items (character_id, pos, name, anzahl, gewicht, kategorie, location, notiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    arr.forEach((it, i) => {
      const o = (it ?? {}) as Record<string, unknown>;
      const loc = (ITEM_LOCATIONS as string[]).includes(String(o.location)) ? String(o.location) : 'inventar';
      ins.run(
        charId,
        i,
        String(o.name ?? '').slice(0, MAX_ITEM_TEXT),
        clampMin(o.anzahl),
        clampMin(o.gewicht),
        String(o.kategorie ?? '').slice(0, MAX_ITEM_TEXT),
        loc,
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

export function saveSection(charId: number, section: string, data: unknown): void {
  const tx = db.transaction(() => {
    if (section === 'bio' || section === 'meta') {
      const table = section === 'bio' ? 'char_bio' : 'char_meta';
      const existing = db.prepare(`SELECT * FROM ${table} WHERE character_id = ?`).get(charId) as Record<string, unknown>;
      const body = (data ?? {}) as Record<string, unknown>;
      const cols = Object.keys(existing).filter((k) => k !== 'character_id');
      const assignments = cols.map((c) => `${c} = ?`).join(', ');
      const values = cols.map((c) => (section === 'meta' ? num(body[c]) : str(body[c])));
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
      const body = (data ?? {}) as { mods?: Record<string, unknown>; gsBase?: unknown };
      const stmt = db.prepare('UPDATE char_base_values SET mod = ?, base = ? WHERE character_id = ? AND key = ?');
      for (const key of BASE_VALUE_KEYS) {
        stmt.run(num(body.mods?.[key]), key === 'gs' ? num(body.gsBase) : 0, charId, key);
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
    if (section === 'talents') {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      db.prepare('DELETE FROM char_talents WHERE character_id = ?').run(charId);
      const stmt = db.prepare(
        `INSERT INTO char_talents (character_id, talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        // TaW ist bei 100 gedeckelt (Meisterschaft). Oberfläche kappt bereits beim
        // Eintippen; hier nochmal, weil die API auch direkt erreichbar ist.
        const taw = Math.min(100, num(r.taw));
        stmt.run(charId, num(r.talentId), taw, num(r.at), num(r.pa), num(r.bl), str(r.billiger), str(r.spezialisierung), str(r.waffenmeister), str(r.berufsbonus));
      }
      return;
    }
    if (section === 'languages') {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      db.prepare('DELETE FROM char_languages WHERE character_id = ?').run(charId);
      const stmt = db.prepare('INSERT INTO char_languages (character_id, language_id, taw, muttersprache) VALUES (?, ?, ?, ?)');
      for (const r of rows) stmt.run(charId, num(r.languageId), num(r.taw), r.muttersprache ? 1 : 0);
      return;
    }
    const def = listSectionById(section);
    if (!def) throw new Error(`Unbekannte Sektion: ${section}`);
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    db.prepare(`DELETE FROM sec_${section} WHERE character_id = ?`).run(charId);
    const cols = def.columns.map((c) => c.key);
    const stmt = db.prepare(
      `INSERT INTO sec_${section} (character_id, pos, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
    );
    rows.forEach((r, i) => {
      const values = def.columns.map((c) => (c.type === 'number' ? num(r[c.key]) : c.type === 'bool' ? (r[c.key] ? 1 : 0) : str(r[c.key])));
      stmt.run(charId, i, ...values);
    });
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
        const probes = weaponProbes(
          { at: Number(w.at), pa: Number(w.pa), bl: Number(w.bl), atMax: Number(w.atMax) || 0 },
          base,
          split,
        );
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
