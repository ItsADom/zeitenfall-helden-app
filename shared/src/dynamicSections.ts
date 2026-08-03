// Datengesteuerte Charakter-Sektionen: jeder Charakter besitzt eine geordnete
// Liste eigener Sektionen (Tabellen oder Notizen) mit selbst definierten Spalten.
// Der berechnete Kern (Heldenbrief, Talente, Sprachen) bleibt davon unberührt.
import type { Attributes } from './types.js';
import { erleichterung, probeExprZahl } from './rules.js';

export type DynSectionType = 'table' | 'notes';

// Spaltentypen: text/number/bool sind Eingaben, 'probe' wird aus einem
// Attribut-Ausdruck (z. B. "FF+KL+GE") berechnet. 'container' macht die Zeile
// aufklappbar: der Zahlenwert der Zelle ist die Zahl fester Fächer (z. B. ein
// Gürtel mit 4 Steckplätzen), die je einen Gegenstand (nur Name) aufnehmen.
export type DynColType = 'text' | 'number' | 'bool' | 'probe' | 'container';

export interface DynColumn {
  key: string; // stabile Kennung innerhalb der Sektion
  label: string;
  type: DynColType;
  width?: number;
  // Nur für type === 'probe':
  probeExprKey?: string; // Schlüssel der Textspalte mit dem Attribut-Ausdruck
  probeTawKey?: string; // optionaler Schlüssel einer Zahlenspalte mit TaW (+ ⌈TaW/5⌉)
}

export type DynRow = Record<string, unknown>; // Zellwerte inkl. optionaler 'notiz'

export interface DynSection {
  id: number;
  name: string;
  type: DynSectionType;
  columns: DynColumn[]; // bei type 'notes' leer
  rows: DynRow[];
  pos: number;
  visible: boolean; // für Gruppenmitglieder sichtbar
}

// Konfigurierbarer Inhalts-Tab: gruppiert mehrere Sektionen (z. B. Ausrüstung).
// locked = Pflicht-Tab, kann nicht gelöscht werden.
export interface DynTab {
  id: number;
  name: string;
  locked: boolean;
  pos: number;
  sections: DynSection[];
}

// Freitext-Notiz je Zeile (wie bei den bisherigen Listen)
export const DYN_NOTIZ_KEY = 'notiz';

// Behälter-Fächer werden pro Zeile unter einem reservierten, spaltenbezogenen
// Schlüssel abgelegt (getrennt von den sichtbaren Spaltenwerten), damit sie beim
// Speichern unverändert mitwandern und nie mit einer Nutzerspalte kollidieren.
const SLOT_PREFIX = '__slots:';
export const slotDataKey = (colKey: string): string => SLOT_PREFIX + colKey;

// Obergrenze, damit ein Tippfehler nicht 10.000 Felder rendert.
const MAX_SLOTS = 60;

// Anzahl fester Fächer, die diese Behälter-Zelle vorgibt (0, wenn kein Behälter).
export function containerSlotCount(col: DynColumn, row: DynRow): number {
  if (col.type !== 'container') return 0;
  const n = Math.floor(Number(row[col.key]));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_SLOTS);
}

// Die Fächer-Inhalte (nur Namen) einer Behälter-Spalte, auf die Fächerzahl
// aufgefüllt/gekürzt.
export function readSlots(col: DynColumn, row: DynRow): string[] {
  const count = containerSlotCount(col, row);
  const raw = row[slotDataKey(col.key)];
  const arr = Array.isArray(raw) ? raw.map((v) => String(v ?? '')) : [];
  const out = arr.slice(0, count);
  while (out.length < count) out.push('');
  return out;
}

// Wert einer Probe-Spalte für eine Zeile; null, wenn kein gültiger Ausdruck.
export function computeProbeCell(attrs: Attributes, col: DynColumn, row: DynRow): number | null {
  if (col.type !== 'probe' || !col.probeExprKey) return null;
  const base = probeExprZahl(attrs, String(row[col.probeExprKey] ?? ''));
  if (base == null) return null;
  if (!col.probeTawKey) return base;
  const taw = Number(row[col.probeTawKey]) || 0;
  return base + erleichterung(taw);
}

// Validierung/Normalisierung einer Spaltendefinition (serverseitig genutzt)
export function normalizeColumn(raw: unknown): DynColumn | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const key = String(c.key ?? '').trim();
  const label = String(c.label ?? '').trim();
  if (!key) return null;
  const type: DynColType = (['text', 'number', 'bool', 'probe', 'container'] as const).includes(c.type as DynColType)
    ? (c.type as DynColType)
    : 'text';
  const col: DynColumn = { key, label: label || key, type };
  if (typeof c.width === 'number') col.width = c.width;
  if (type === 'probe') {
    if (c.probeExprKey) col.probeExprKey = String(c.probeExprKey);
    if (c.probeTawKey) col.probeTawKey = String(c.probeTawKey);
  }
  return col;
}

export function normalizeColumns(raw: unknown): DynColumn[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeColumn).filter((c): c is DynColumn => c !== null);
}
