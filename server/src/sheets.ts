// Mehrere Bögen pro Charakter (docs/concepts/shapeshifting.md).
//
// Begriffe (siehe auch den Kommentarblock in characterData.ts):
//  - Identität = characters-Zeile der Grundform. Quelle der Wahrheit, nie einzeln
//    löschbar (sie löschen heißt den Charakter löschen).
//  - Bogen = characters-Zeile, deren char_*-Zeilen den Inhalt tragen. Eine weitere
//    Form ist eine eigene characters-Zeile, markiert in character_forms.
//  - aktiver Bogen = der, den VTT, Gruppe, Feed und Würfe sehen (nur der Besitzer
//    wechselt ihn). Der betrachtete Bogen im Editor ist davon unabhängig.
import { db, initCharacterRows } from './db.js';
import { loescheAssetsFuer } from './assets/store.js';
import {
  activeSheetId,
  displayName,
  identityOf,
  instantiateBlankSheet,
  loadFullCharacter,
  writeSheetData,
} from './characterData.js';

export const MAX_FORMS = 20;
export const MAX_FORM_LABEL = 40;

export interface SheetInfo {
  /** characters-ID des Bogens (= Identität für die Grundform). */
  id: number;
  label: string;
  isBase: boolean;
  active: boolean;
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
    ...forms.map((f) => ({ id: f.id, label: f.label, isBase: false, active: activeId === f.id })),
  ];
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
 * Legt eine weitere Form an. `copy` übernimmt Heldenbrief und alle Reiter der
 * Grundform einmalig (danach laufen beide unabhängig); `blank` startet leer.
 * Gegenstände, Geld, Ausrüstungs-Sets und GM-Notizen gehören zum Charakter und
 * werden nie kopiert.
 */
export function createForm(identityId: number, rawLabel: unknown, mode: 'copy' | 'blank'): CreateFormResult {
  const label = cleanLabel(rawLabel);
  if (!label) return { ok: false, error: `Formname fehlt oder ist länger als ${MAX_FORM_LABEL} Zeichen` };
  const base = db.prepare('SELECT name, owner_user_id AS owner FROM characters WHERE id = ?').get(identityId) as
    | { name: string; owner: number }
    | undefined;
  if (!base) return { ok: false, error: 'Charakter nicht gefunden' };
  if (listSheets(identityId).length - 1 >= MAX_FORMS) return { ok: false, error: `Höchstens ${MAX_FORMS} Formen pro Charakter` };

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
    if (mode === 'copy') {
      writeSheetData(newId, loadFullCharacter(identityId, true), false);
    } else {
      instantiateBlankSheet(newId);
    }
    return newId;
  });
  return { ok: true, id: tx() };
}

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
  // Alle char_*-Tabellen hängen per ON DELETE CASCADE an characters(id); Gegenstände
  // und Beutel einer Form gibt es nicht (sie gehören der Identität).
  db.prepare('DELETE FROM characters WHERE id = ?').run(formId);
}
