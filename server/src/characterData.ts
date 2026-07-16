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
  erleichterung,
  listSectionById,
  mrErgebnis,
  normalizeColumns,
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
  Resources,
  VisibilitySection,
} from 'shared';
import { db } from './db.js';
import { createDynSection, createTab, loadDynSections, loadDynTabs, saveDynRows } from './dynSections.js';

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
  const out = { le: empty(), aus: empty(), ase: empty(), mr: empty() } as Resources;
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

// --- Standard-Vorlage & Migration der festen Listen in Tabs mit Sektionen ---

// Konfigurierbare Inhalts-Tabs (die berechneten Tabs Heldenbrief/Talente/Waffen/
// Sprachen sind im Client fest). locked = Pflicht-Tab (nicht löschbar).
const STANDARD_TABS: { name: string; locked: boolean; sectionIds: string[] }[] = [
  { name: 'Vorteile & Nachteile', locked: false, sectionIds: ['professionBoni', 'vorteile', 'nachteile', 'titel', 'perks'] },
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

function toDynColumns(defs: { key: string; label: string; type: string; width?: number }[]): DynColumn[] {
  return defs
    .filter((c) => c.key !== 'notiz')
    .map((c) => {
      const type = (['text', 'number', 'bool'] as const).includes(c.type as never) ? (c.type as DynColumn['type']) : 'text';
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
      const secId = createDynSection(charId, tabId, def.label, 'table', toDynColumns(def.columns));
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
  };
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
      const stmt = db.prepare(
        'UPDATE char_resources SET permanent = ?, kauf = ?, kaufMax = ?, maxPlus = ?, aktuell = ?, besonderes = ? WHERE character_id = ? AND key = ?',
      );
      for (const key of RESOURCE_KEYS) {
        const v = body[key];
        if (v) stmt.run(num(v.permanent), num(v.kauf), num(v.kaufMax), num(v.maxPlus), num(v.aktuell), str(v.besonderes), charId, key);
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
        stmt.run(charId, num(r.talentId), num(r.taw), num(r.at), num(r.pa), num(r.bl), str(r.billiger), str(r.spezialisierung), str(r.waffenmeister), str(r.berufsbonus));
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

// --- Zusammenfassung für Gruppenmitglieder (serverseitig berechnet) ---

interface CatalogTalent {
  id: number;
  kategorie: string;
  gruppe: string;
  name: string;
  klasse: string;
  probe: string;
  ableiten: string;
}

export function buildSummary(charId: number) {
  const visibility = loadVisibility(charId);
  const attributes = loadAttributes(charId);
  const resources = loadResources(charId);
  const baseInputs = loadBaseValueInputs(charId);
  const mr = mrErgebnis(attributes, resources);
  const baseValues = computeBaseValues(attributes, baseInputs, mr);
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
      return { key, label: RESOURCE_LABELS[key].label, aktuell: resources[key].aktuell, ergebnis: r.ergebnis, max: r.max };
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

  return { bio, sections, dynSections, attributes, visibility };
}
