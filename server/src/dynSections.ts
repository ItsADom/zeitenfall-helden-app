import { normalizeColumns } from 'shared';
import type { DynColumn, DynSection, DynTab } from 'shared';
import { db } from './db.js';

// Engine für datengesteuerte Tabs/Sektionen. Besitzer ist entweder ein
// Charakter oder eine Gruppe — beide nutzen dieselbe Logik, nur andere
// Tabellen. Die Tabellennamen sind Konstanten (kein Nutzer-Input).

export interface DynTables {
  tabs: string;
  sections: string;
  rows: string;
  owner: 'character_id' | 'group_id';
}

export const CHAR_DYN: DynTables = {
  tabs: 'char_tabs',
  sections: 'char_sections',
  rows: 'char_section_rows',
  owner: 'character_id',
};

export const GROUP_DYN: DynTables = {
  tabs: 'group_tabs',
  sections: 'group_sections',
  rows: 'group_section_rows',
  owner: 'group_id',
};

interface DynSectionRow {
  id: number;
  pos: number;
  name: string;
  type: string;
  columns: string;
  visible: number;
}

function mapSection(s: DynSectionRow, rowStmt: import('better-sqlite3').Statement): DynSection {
  let columns: DynColumn[] = [];
  try {
    columns = normalizeColumns(JSON.parse(s.columns));
  } catch {
    columns = [];
  }
  const rows = (rowStmt.all(s.id) as { id: number; pos: number; data: string }[]).map((r) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.data);
    } catch {
      data = {};
    }
    return { id: r.id, ...data } as Record<string, unknown>;
  });
  return { id: s.id, pos: s.pos, name: s.name, type: s.type as DynSection['type'], columns, rows, visible: !!s.visible };
}

// Alle Sektionen eines Besitzers (flach, für die Zusammenfassung)
export function loadDynSections(ownerId: number, t: DynTables = CHAR_DYN): DynSection[] {
  const rowStmt = db.prepare(`SELECT id, pos, data FROM ${t.rows} WHERE section_id = ? ORDER BY pos, id`);
  const sections = db
    .prepare(`SELECT id, pos, name, type, columns, visible FROM ${t.sections} WHERE ${t.owner} = ? ORDER BY pos, id`)
    .all(ownerId) as DynSectionRow[];
  return sections.map((s) => mapSection(s, rowStmt));
}

// Tabs mit ihren Sektionen
export function loadDynTabs(ownerId: number, t: DynTables = CHAR_DYN): DynTab[] {
  const rowStmt = db.prepare(`SELECT id, pos, data FROM ${t.rows} WHERE section_id = ? ORDER BY pos, id`);
  const secStmt = db.prepare(`SELECT id, pos, name, type, columns, visible FROM ${t.sections} WHERE tab_id = ? ORDER BY pos, id`);
  const tabs = db.prepare(`SELECT id, pos, name, locked FROM ${t.tabs} WHERE ${t.owner} = ? ORDER BY pos, id`).all(ownerId) as {
    id: number;
    pos: number;
    name: string;
    locked: number;
  }[];
  return tabs.map((tab) => ({
    id: tab.id,
    pos: tab.pos,
    name: tab.name,
    locked: !!tab.locked,
    sections: (secStmt.all(tab.id) as DynSectionRow[]).map((s) => mapSection(s, rowStmt)),
  }));
}

export function createTab(ownerId: number, name: string, locked = false, t: DynTables = CHAR_DYN): number {
  const pos = (db.prepare(`SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM ${t.tabs} WHERE ${t.owner} = ?`).get(ownerId) as { p: number }).p;
  const r = db
    .prepare(`INSERT INTO ${t.tabs} (${t.owner}, pos, name, locked) VALUES (?, ?, ?, ?)`)
    .run(ownerId, pos, name, locked ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function tabBelongsTo(tabId: number, ownerId: number, t: DynTables = CHAR_DYN): boolean {
  return !!db.prepare(`SELECT 1 FROM ${t.tabs} WHERE id = ? AND ${t.owner} = ?`).get(tabId, ownerId);
}

export function tabIsLocked(tabId: number, t: DynTables = CHAR_DYN): boolean {
  const row = db.prepare(`SELECT locked FROM ${t.tabs} WHERE id = ?`).get(tabId) as { locked: number } | undefined;
  return !!row?.locked;
}

export function renameTab(tabId: number, name: string, t: DynTables = CHAR_DYN): void {
  db.prepare(`UPDATE ${t.tabs} SET name = ? WHERE id = ?`).run(name, tabId);
}

export function deleteTab(tabId: number, t: DynTables = CHAR_DYN): void {
  db.prepare(`DELETE FROM ${t.tabs} WHERE id = ?`).run(tabId);
}

export function reorderTabs(ownerId: number, order: number[], t: DynTables = CHAR_DYN): void {
  const stmt = db.prepare(`UPDATE ${t.tabs} SET pos = ? WHERE id = ? AND ${t.owner} = ?`);
  const tx = db.transaction(() => order.forEach((id, i) => stmt.run(i, id, ownerId)));
  tx();
}

export function createDynSection(
  ownerId: number,
  tabId: number,
  name: string,
  type: string,
  columns: DynColumn[],
  t: DynTables = CHAR_DYN,
): number {
  const pos = (db.prepare(`SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM ${t.sections} WHERE tab_id = ?`).get(tabId) as { p: number }).p;
  const r = db
    .prepare(`INSERT INTO ${t.sections} (${t.owner}, tab_id, pos, name, type, columns) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ownerId, tabId, pos, name, type === 'notes' ? 'notes' : 'table', JSON.stringify(columns));
  return Number(r.lastInsertRowid);
}

export function sectionBelongsTo(sectionId: number, ownerId: number, t: DynTables = CHAR_DYN): boolean {
  return !!db.prepare(`SELECT 1 FROM ${t.sections} WHERE id = ? AND ${t.owner} = ?`).get(sectionId, ownerId);
}

export function updateDynSection(
  sectionId: number,
  patch: { name?: string; columns?: DynColumn[]; visible?: boolean },
  t: DynTables = CHAR_DYN,
): void {
  if (patch.name !== undefined) db.prepare(`UPDATE ${t.sections} SET name = ? WHERE id = ?`).run(patch.name, sectionId);
  if (patch.columns !== undefined)
    db.prepare(`UPDATE ${t.sections} SET columns = ? WHERE id = ?`).run(JSON.stringify(patch.columns), sectionId);
  if (patch.visible !== undefined) db.prepare(`UPDATE ${t.sections} SET visible = ? WHERE id = ?`).run(patch.visible ? 1 : 0, sectionId);
}

export function deleteDynSection(sectionId: number, t: DynTables = CHAR_DYN): void {
  db.prepare(`DELETE FROM ${t.sections} WHERE id = ?`).run(sectionId);
}

export function reorderDynSections(ownerId: number, order: number[], t: DynTables = CHAR_DYN): void {
  const stmt = db.prepare(`UPDATE ${t.sections} SET pos = ? WHERE id = ? AND ${t.owner} = ?`);
  const tx = db.transaction(() => order.forEach((id, i) => stmt.run(i, id, ownerId)));
  tx();
}

export function saveDynRows(sectionId: number, rows: Record<string, unknown>[], t: DynTables = CHAR_DYN): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${t.rows} WHERE section_id = ?`).run(sectionId);
    const stmt = db.prepare(`INSERT INTO ${t.rows} (section_id, pos, data) VALUES (?, ?, ?)`);
    rows.forEach((r, i) => {
      const { id, ...data } = r; // interne Zeilen-id nicht mitspeichern
      void id;
      stmt.run(sectionId, i, JSON.stringify(data));
    });
  });
  tx();
}

// --- Gruppen-Standardinhalte ---

const t = (key: string, label: string, width: number): DynColumn => ({ key, label, type: 'text', width });
const n = (key: string, label: string, width: number): DynColumn => ({ key, label, type: 'number', width });

const STANDARD_GROUP_TABS: { name: string; section: string; columns: DynColumn[] }[] = [
  {
    name: 'Gruppen-Inventar',
    section: 'Gemeinsamer Besitz',
    columns: [t('name', 'Gegenstand', 260), n('anzahl', 'Anzahl', 90), t('traeger', 'Bei wem', 160), t('wert', 'Wert', 120)],
  },
  {
    name: 'Questlog',
    section: 'Aufträge',
    columns: [t('titel', 'Auftrag', 260), t('status', 'Status', 120), t('auftraggeber', 'Auftraggeber', 160), t('belohnung', 'Belohnung', 140), t('details', 'Details', 320)],
  },
  {
    name: 'NPCs',
    section: 'Bekannte Personen',
    columns: [t('name', 'Name', 200), t('ort', 'Ort', 160), t('beziehung', 'Beziehung', 160), t('notizen', 'Notizen', 320)],
  },
  {
    name: 'Sitzungslog',
    section: 'Sitzungen',
    columns: [t('datum', 'Datum', 120), t('titel', 'Titel', 220), t('verlauf', 'Verlauf', 460)],
  },
];

// Spalten des Sitzungslogs — einzeln, damit der Nachbau bestehender Gruppen
// dieselbe Definition nutzt wie die Standard-Vorlage.
const SESSION_LOG = STANDARD_GROUP_TABS.find((tab) => tab.name === 'Sitzungslog')!;

// Standard-Tabs einer Gruppe anlegen — idempotent: passiert nur, wenn die
// Gruppe noch gar keine Tabs hat.
export function instantiateGroupTabs(groupId: number): number {
  const already = (db.prepare(`SELECT COUNT(*) AS n FROM ${GROUP_DYN.tabs} WHERE group_id = ?`).get(groupId) as { n: number }).n;
  if (already > 0) return 0;
  let created = 0;
  const tx = db.transaction(() => {
    for (const def of STANDARD_GROUP_TABS) {
      const tabId = createTab(groupId, def.name, false, GROUP_DYN);
      createDynSection(groupId, tabId, def.section, 'table', def.columns, GROUP_DYN);
      created++;
    }
  });
  tx();
  return created;
}

// Einmaliger Nachbau: bestehende Gruppen bekommen den nachträglich eingeführten
// Sitzungslog-Tab. Läuft genau einmal, über PRAGMA user_version als
// Migrationszähler (1 = Sitzungslog nachgetragen). Danach nicht mehr — ein
// bewusst gelöschter Sitzungslog taucht also nicht beim nächsten Start wieder auf.
// Frisch angelegte Gruppen erhalten ihn ohnehin über STANDARD_GROUP_TABS.
export function backfillGroupSessionLog(): void {
  if (Number(db.pragma('user_version', { simple: true })) >= 1) return;
  const groups = db.prepare('SELECT id FROM groups').all() as { id: number }[];
  const tx = db.transaction(() => {
    for (const g of groups) {
      const tabCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${GROUP_DYN.tabs} WHERE group_id = ?`).get(g.id) as { n: number }).n;
      if (tabCount === 0) continue; // noch nie geladen — wird beim ersten Laden komplett geseedet
      const has = db.prepare(`SELECT 1 FROM ${GROUP_DYN.tabs} WHERE group_id = ? AND name = ?`).get(g.id, SESSION_LOG.name);
      if (has) continue;
      const tabId = createTab(g.id, SESSION_LOG.name, false, GROUP_DYN);
      createDynSection(g.id, tabId, SESSION_LOG.section, 'table', SESSION_LOG.columns, GROUP_DYN);
    }
    db.pragma('user_version = 1');
  });
  tx();
}
