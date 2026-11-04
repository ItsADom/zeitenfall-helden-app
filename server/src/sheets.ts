// Mehrere Bögen pro Charakter (docs/concepts/shapeshifting.md).
//
// Begriffe (siehe auch den Kommentarblock in characterData.ts):
//  - Identität = characters-Zeile der Grundform. Quelle der Wahrheit, nie einzeln
//    löschbar (sie löschen heißt den Charakter löschen).
//  - Bogen = characters-Zeile, deren char_*-Zeilen den Inhalt tragen. Eine weitere
//    Form ist eine eigene characters-Zeile, markiert in character_forms.
//  - aktiver Bogen = der, den VTT, Gruppe, Feed und Würfe sehen (nur der Besitzer
//    wechselt ihn). Der betrachtete Bogen im Editor ist davon unabhängig.
//  - Phase 2: eine Form kann einzelne Teile (Domänen, siehe shared/sheetDomains.ts) mit
//    der Grundform TEILEN („verknüpft"): sie liest und schreibt dann deren Zeilen. Die
//    eigenen Zeilen einer verknüpften Domäne bleiben liegen (zurückgelegt).
import {
  SYNCABLE_DOMAINS,
  detachAction,
  isSyncable,
  normalizeCarryOver,
  uniformCarryOver,
} from 'shared';
import type { SheetDomain } from 'shared';
import { db, initCharacterRows } from './db.js';
import { loescheAssetsFuer } from './assets/store.js';
import {
  activeSheetId,
  displayName,
  identityOf,
  instantiateBlankSheet,
  loadAbilities,
  loadAbilityLists,
  loadFullCharacter,
  loadLanguages,
  loadList,
  loadTalents,
  manageAbilityList,
  saveAbilities,
  saveSection,
  writeSheetData,
} from './characterData.js';
import { copyTabSections, createTab, ownSectionCount } from './dynSections.js';

export const MAX_FORMS = 20;
export const MAX_FORM_LABEL = 40;

export interface DomainState {
  mode: 'linked' | 'own';
  /** Verknüpft, aber mit einer zurückgelegten eigenen Kopie darunter. */
  dormant: boolean;
  /** Wie viele eigene Zeilen die Form hier hat (bei verknüpft: die zurückgelegte Kopie). */
  rows: number;
}

export interface TabLinkState {
  id: number;
  name: string;
  linked: boolean;
  hasDormant: boolean;
  /** Eigene Sektionen des Reiters (bei verknüpft: die zurückgelegte Kopie). */
  ownSections: number;
}

export interface SheetInfo {
  /** characters-ID des Bogens (= Identität für die Grundform). */
  id: number;
  label: string;
  isBase: boolean;
  active: boolean;
  /** Nur bei einer Form: Zustand der teilbaren Domänen. */
  domains?: Partial<Record<SheetDomain, DomainState>>;
  /** Nur bei einer Form: ihre Reiter, die aus der Grundform stammen (wieder verknüpfbar). */
  tabs?: TabLinkState[];
}

const modeOf = (formId: number, domain: SheetDomain): 'linked' | 'own' =>
  (db.prepare('SELECT mode FROM sheet_domain_mode WHERE character_id = ? AND domain = ?').get(formId, domain) as { mode: 'linked' | 'own' } | undefined)
    ?.mode ?? 'own';

const setMode = (formId: number, domain: SheetDomain, mode: 'linked' | 'own'): void => {
  db.prepare(
    'INSERT INTO sheet_domain_mode (character_id, domain, mode) VALUES (?, ?, ?) ON CONFLICT (character_id, domain) DO UPDATE SET mode = excluded.mode',
  ).run(formId, domain, mode);
};

const count = (sql: string, id: number): number => (db.prepare(sql).get(id) as { n: number }).n;

/** Wie viele eigene Zeilen hat die Form in dieser Domäne (bei verknüpfter Domäne: die zurückgelegte Kopie)? */
function ownRowCount(formId: number, domain: SheetDomain): number {
  switch (domain) {
    case 'talente':
      return count('SELECT COUNT(*) AS n FROM char_talents WHERE character_id = ?', formId);
    case 'sprachen':
      return count('SELECT COUNT(*) AS n FROM char_languages WHERE character_id = ?', formId);
    case 'waffen':
      return (
        count('SELECT COUNT(*) AS n FROM sec_waffenlos WHERE character_id = ?', formId) +
        count('SELECT COUNT(*) AS n FROM sec_kampfstile WHERE character_id = ?', formId)
      );
    case 'faehigkeiten':
      return (
        count('SELECT COUNT(*) AS n FROM char_abilities WHERE character_id = ?', formId) +
        count('SELECT COUNT(*) AS n FROM char_ability_lists WHERE character_id = ?', formId)
      );
    default:
      return 0;
  }
}

/** Bögen eines Charakters: Grundform zuerst, dann die Formen nach Position. */
export function listSheets(identityId: number): SheetInfo[] {
  const base = db.prepare('SELECT base_form_label AS label, active_form_id AS active FROM characters WHERE id = ?').get(identityId) as
    | { label: string; active: number | null }
    | undefined;
  if (!base) return [];
  const forms = db
    .prepare('SELECT character_id AS id, label FROM character_forms WHERE base_character_id = ? ORDER BY position, character_id')
    .all(identityId) as { id: number; label: string }[];
  const activeId = base.active ?? identityId;
  return [
    { id: identityId, label: base.label, isBase: true, active: activeId === identityId },
    ...forms.map((f) => {
      const domains: Partial<Record<SheetDomain, DomainState>> = {};
      for (const d of SYNCABLE_DOMAINS) {
        const mode = modeOf(f.id, d);
        const rows = ownRowCount(f.id, d);
        domains[d] = { mode, dormant: mode === 'linked' && rows > 0, rows };
      }
      const tabs = (
        db
          .prepare('SELECT id, name, linked FROM char_tabs WHERE character_id = ? AND source_tab_id IS NOT NULL ORDER BY pos, id')
          .all(f.id) as { id: number; name: string; linked: number }[]
      ).map((t) => {
        const own = ownSectionCount(t.id);
        return { id: t.id, name: t.name, linked: !!t.linked, hasDormant: !!t.linked && own > 0, ownSections: own };
      });
      return { id: f.id, label: f.label, isBase: false, active: activeId === f.id, domains, tabs };
    }),
  ];
}

/** Die selbst angelegten Reiter der Grundform (für den Übernehmen-Dialog). */
export function baseTabList(identityId: number): { id: number; name: string; locked: boolean }[] {
  return (db.prepare('SELECT id, name, locked FROM char_tabs WHERE character_id = ? ORDER BY pos, id').all(identityId) as {
    id: number;
    name: string;
    locked: number;
  }[]).map((t) => ({ id: t.id, name: t.name, locked: !!t.locked }));
}

/**
 * Welcher Bogen gemeint ist: der ausdrücklich angefragte (muss zu diesem
 * Charakter gehören) oder sonst der aktive. `null` = ungültige Anfrage.
 */
export function resolveSheet(identityId: number, requested: unknown): number | null {
  if (requested === undefined || requested === null || requested === '') return activeSheetId(identityId);
  const id = Number(requested);
  if (!Number.isInteger(id)) return null;
  if (id === identityId) return id;
  return identityOf(id) === identityId && id !== identityId ? id : null;
}

function cleanLabel(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!s || s.length > MAX_FORM_LABEL) return null;
  return s;
}

export type CreateFormResult = { ok: true; id: number } | { ok: false; error: string };

/**
 * Legt eine weitere Form an. Was aus der Grundform übernommen wird, bestimmt der Plan:
 * je Teil kopieren (einmalig, danach unabhängig), synchron halten (die Form liest und
 * schreibt die Zeilen der Grundform) oder überspringen (leer). Ohne Plan zählt `mode`:
 * 'copy' kopiert alles, 'blank' überspringt alles. Gegenstände, Geld, Ausrüstungs-Sets
 * und GM-Notizen gehören zum Charakter und werden nie kopiert.
 */
export function createForm(identityId: number, rawLabel: unknown, mode: 'copy' | 'blank', rawPlan?: unknown): CreateFormResult {
  const label = cleanLabel(rawLabel);
  if (!label) return { ok: false, error: `Formname fehlt oder ist länger als ${MAX_FORM_LABEL} Zeichen` };
  const base = db.prepare('SELECT name, owner_user_id AS owner FROM characters WHERE id = ?').get(identityId) as
    | { name: string; owner: number }
    | undefined;
  if (!base) return { ok: false, error: 'Charakter nicht gefunden' };
  if (listSheets(identityId).length - 1 >= MAX_FORMS) return { ok: false, error: `Höchstens ${MAX_FORMS} Formen pro Charakter` };

  const baseTabs = baseTabList(identityId);
  const tabIds = baseTabs.map((t) => t.id);
  const plan = rawPlan ? normalizeCarryOver(rawPlan, tabIds) : uniformCarryOver(mode === 'blank' ? 'skip' : 'copy', tabIds);

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, NULL)').run(base.name, base.owner);
    const newId = Number(r.lastInsertRowid);
    const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM character_forms WHERE base_character_id = ?').get(identityId) as { p: number }).p;
    // Zuerst markieren: ab jetzt weiß saveSection, dass dies eine Form ist.
    db.prepare('INSERT INTO character_forms (character_id, base_character_id, label, position) VALUES (?, ?, ?, ?)').run(
      newId,
      identityId,
      label,
      pos,
    );
    initCharacterRows(newId, false);

    // Synchron gehaltene Teile zuerst eintragen: ab hier lesen und schreiben alle Lader dorthin.
    for (const d of SYNCABLE_DOMAINS) if (plan.domains[d] === 'sync') setMode(newId, d, 'linked');

    const full = loadFullCharacter(identityId, true);
    const data: Parameters<typeof writeSheetData>[1] = {};
    const d = plan.domains;
    if (d.heldenbrief === 'copy') {
      Object.assign(data, {
        bio: full.bio,
        // Wunden gehören zum Bogen und fangen bei einer neuen Form bei null an.
        meta: { ...full.meta, small_wounds: 0, big_wounds: 0 },
        attributes: full.attributes,
        baseValues: full.baseValues,
        resources: full.resources,
        special: full.special,
        attrExtern: full.attrExtern,
        visibility: full.visibility,
        tableWidths: full.tableWidths,
      });
    }
    // Listen-Sektionen ohne eigene Domäne (Altbestand) laufen mit dem Heldenbrief, die beiden
    // Waffen-Listen mit der Waffen-Domäne.
    const lists: Record<string, Record<string, unknown>[]> = {};
    for (const [sid, rows] of Object.entries(full.lists)) {
      const isWaffen = sid === 'waffenlos' || sid === 'kampfstile';
      if (isWaffen ? d.waffen === 'copy' : d.heldenbrief === 'copy') lists[sid] = rows;
    }
    data.lists = lists;
    if (d.talente === 'copy') data.talents = full.talents;
    if (d.sprachen === 'copy') data.languages = full.languages;
    if (d.faehigkeiten === 'copy') {
      data.abilities = full.abilities;
      data.abilityLists = full.abilityLists;
    }

    // Reiter: synchron = eigener Reiter, der dem der Grundform folgt; kopieren = Kopie samt Inhalt.
    const pre = new Map<number, number>();
    for (const bt of baseTabs) {
      if (plan.tabs[bt.id] !== 'sync') continue;
      const tabId = createTab(newId, bt.name, bt.locked);
      db.prepare('UPDATE char_tabs SET source_tab_id = ?, linked = 1 WHERE id = ?').run(bt.id, tabId);
      pre.set(bt.id, tabId);
    }
    data.tabs = full.tabs.filter((t) => plan.tabs[t.id] === 'copy');
    data.tabOrder = full.tabOrder;
    const map = writeSheetData(newId, data, false, pre);
    // Jeder Reiter merkt sich, woher er stammt (zum späteren Wiederverknüpfen).
    for (const [oldId, newTab] of map) if (!pre.has(oldId)) db.prepare('UPDATE char_tabs SET source_tab_id = ? WHERE id = ?').run(oldId, newTab);

    // Pflicht-Reiter (z. B. „Vorteile & Nachteile") darf nie fehlen.
    const hasLocked = db.prepare('SELECT 1 FROM char_tabs WHERE character_id = ? AND locked = 1').get(newId);
    if (!hasLocked) instantiateBlankSheet(newId);
    return newId;
  });
  return { ok: true, id: tx() };
}

// --- Entkoppeln und wieder Verknüpfen (Phase 2) ---

export type ChangeResult = { ok: true } | { ok: false; error: string };
const isFormOf = (identityId: number, formId: number) => formId !== identityId && identityOf(formId) === identityId;

/**
 * Entkoppeln: die Form bekommt eine eigene Kopie der geteilten Daten und verlässt die Verknüpfung;
 * die Grundform und andere Formen bleiben unverändert. Gibt es noch eine zurückgelegte eigene Kopie
 * und `resume` ist gesetzt, wird sie stattdessen weiterverwendet (keine neue Kopie).
 */
export function detachDomain(identityId: number, formId: number, domain: SheetDomain, resume: boolean): ChangeResult {
  if (!isFormOf(identityId, formId) || !isSyncable(domain)) return { ok: false, error: 'Unbekannter Bogen oder Teil' };
  if (modeOf(formId, domain) !== 'linked') return { ok: false, error: 'Dieser Teil ist nicht verknüpft' };
  const action = detachAction(ownRowCount(formId, domain) > 0, resume);
  const tx = db.transaction(() => {
    // Erst auf 'own' stellen: die Lader und Speicher unten treffen dann die EIGENEN Zeilen der Form.
    setMode(formId, domain, 'own');
    if (action === 'snapshot') copyDomain(identityId, formId, domain);
  });
  tx();
  return { ok: true };
}

/** Wieder verknüpfen: die eigenen Zeilen werden zurückgelegt (nicht gelöscht), die Form liest die der Grundform. */
export function linkDomain(identityId: number, formId: number, domain: SheetDomain): ChangeResult {
  if (!isFormOf(identityId, formId) || !isSyncable(domain)) return { ok: false, error: 'Unbekannter Bogen oder Teil' };
  if (modeOf(formId, domain) === 'linked') return { ok: false, error: 'Dieser Teil ist schon verknüpft' };
  setMode(formId, domain, 'linked');
  return { ok: true };
}

/** Ersetzt die eigenen Zeilen der Form (Modus 'own') durch eine Kopie der Grundform; nutzt die normalen Speicher (Validierung inklusive). */
function copyDomain(identityId: number, formId: number, domain: SheetDomain): void {
  switch (domain) {
    case 'talente':
      saveSection(formId, 'talents', loadTalents(identityId));
      break;
    case 'sprachen':
      saveSection(formId, 'languages', loadLanguages(identityId));
      break;
    case 'waffen':
      saveSection(formId, 'waffenlos', loadList('waffenlos', identityId));
      saveSection(formId, 'kampfstile', loadList('kampfstile', identityId));
      break;
    case 'faehigkeiten': {
      saveAbilities(formId, loadAbilities(identityId));
      const lists = loadAbilityLists(identityId);
      manageAbilityList(formId, 'element', { order: lists.element });
      manageAbilityList(formId, 'kategorie', { order: lists.kategorie });
      break;
    }
    default:
      break;
  }
}

interface TabRow {
  id: number;
  source: number | null;
  linked: number;
}
const tabOf = (formId: number, tabId: number): TabRow | undefined =>
  db.prepare('SELECT id, source_tab_id AS source, linked FROM char_tabs WHERE id = ? AND character_id = ?').get(tabId, formId) as TabRow | undefined;

/** Entkoppeln für einen selbst angelegten Reiter; gleiche Regeln wie detachDomain. */
export function detachTab(identityId: number, formId: number, tabId: number, resume: boolean): ChangeResult {
  const tab = isFormOf(identityId, formId) ? tabOf(formId, tabId) : undefined;
  if (!tab || !tab.linked || tab.source == null) return { ok: false, error: 'Dieser Reiter ist nicht verknüpft' };
  const action = detachAction(ownSectionCount(tab.id) > 0, resume);
  const tx = db.transaction(() => {
    if (action === 'snapshot') {
      // Eine zurückgelegte Kopie wird ersetzt (der Dialog hat danach gefragt).
      db.prepare('DELETE FROM char_sections WHERE tab_id = ?').run(tab.id);
      copyTabSections(tab.source!, tab.id, formId);
    }
    db.prepare('UPDATE char_tabs SET linked = 0 WHERE id = ?').run(tab.id);
  });
  tx();
  return { ok: true };
}

/** Wieder verknüpfen für einen Reiter, der aus der Grundform stammt; die eigenen Sektionen bleiben liegen. */
export function linkTab(identityId: number, formId: number, tabId: number): ChangeResult {
  const tab = isFormOf(identityId, formId) ? tabOf(formId, tabId) : undefined;
  if (!tab || tab.source == null) return { ok: false, error: 'Dieser Reiter stammt nicht aus der Grundform' };
  if (tab.linked) return { ok: false, error: 'Dieser Reiter ist schon verknüpft' };
  db.prepare('UPDATE char_tabs SET linked = 1 WHERE id = ?').run(tab.id);
  return { ok: true };
}

/**
 * Löscht die Grundform einen Reiter, dem Formen folgen, behält jede dieser Formen eine Kopie als
 * eigenen Reiter (vor dem Löschen aufrufen). Eine zurückgelegte eigene Kopie bleibt daneben stehen.
 */
export function releaseTabFollowers(baseTabId: number): void {
  const followers = db.prepare('SELECT id, character_id AS owner FROM char_tabs WHERE source_tab_id = ? AND linked = 1').all(baseTabId) as {
    id: number;
    owner: number;
  }[];
  const tx = db.transaction(() => {
    for (const f of followers) {
      copyTabSections(baseTabId, f.id, f.owner);
      db.prepare('UPDATE char_tabs SET linked = 0 WHERE id = ?').run(f.id);
    }
  });
  tx();
}

/** Anzeigename mit Form-Zusatz (siehe characterData.ts). */
export { displayName };

/** Aktiven Bogen wechseln. `sheetId` = Identität selbst (Grundform) oder eine ihrer Formen. */
export function setActiveSheet(identityId: number, sheetId: number): boolean {
  if (sheetId !== identityId && identityOf(sheetId) !== identityId) return false;
  db.prepare('UPDATE characters SET active_form_id = ? WHERE id = ?').run(sheetId === identityId ? null : sheetId, identityId);
  return true;
}

export function renameSheet(identityId: number, sheetId: number, rawLabel: unknown): boolean {
  const label = typeof rawLabel === 'string' ? rawLabel.trim().replace(/\s+/g, ' ') : '';
  if (label.length > MAX_FORM_LABEL) return false;
  if (sheetId === identityId) {
    // Der Name der Grundform darf leer sein (die Oberfläche zeigt dann „Grundform").
    db.prepare('UPDATE characters SET base_form_label = ? WHERE id = ?').run(label, identityId);
    return true;
  }
  if (!label || identityOf(sheetId) !== identityId) return false;
  db.prepare('UPDATE character_forms SET label = ? WHERE character_id = ?').run(label, sheetId);
  return true;
}

/** Löscht eine Form. Die Grundform ist nie einzeln löschbar. */
export function deleteForm(identityId: number, formId: number): boolean {
  if (formId === identityId || identityOf(formId) !== identityId) return false;
  const tx = db.transaction(() => {
    // War sie aktiv, fällt der aktive Bogen auf die Grundform zurück.
    db.prepare('UPDATE characters SET active_form_id = NULL WHERE id = ? AND active_form_id = ?').run(identityId, formId);
    removeFormRow(formId);
  });
  tx();
  loescheAssetsFuer('character', formId);
  return true;
}

/** Beim Löschen eines Charakters: alle seine Formen mitnehmen (kein DB-Kaskadenweg, die Formen sind eigene Zeilen). */
export function deleteAllForms(identityId: number): void {
  const ids = db.prepare('SELECT character_id AS id FROM character_forms WHERE base_character_id = ?').all(identityId) as { id: number }[];
  const tx = db.transaction(() => {
    db.prepare('UPDATE characters SET active_form_id = NULL WHERE id = ?').run(identityId);
    for (const { id } of ids) removeFormRow(id);
  });
  tx();
  for (const { id } of ids) loescheAssetsFuer('character', id);
}

function removeFormRow(formId: number): void {
  // Alle char_*-Tabellen (auch sheet_domain_mode) hängen per ON DELETE CASCADE an characters(id);
  // Gegenstände und Beutel einer Form gibt es nicht (sie gehören der Identität).
  db.prepare('DELETE FROM characters WHERE id = ?').run(formId);
}
