// Mehrere Bögen pro Charakter, Phase 2 (docs/concepts/shapeshifting.md): welche
// Teile eines Bogens es gibt (Domänen), wer ihre Zeilen besitzt (Grundform oder
// die Form selbst) und was beim Anlegen einer Form übernommen wird. Reine
// Regeln ohne Datenbank, damit sie sich testen lassen.

/**
 * Die Teile eines Bogens, die als Ganzes kopiert oder (außer dem Heldenbrief)
 * mit der Grundform geteilt werden. Selbst angelegte Reiter sind eigene
 * Domänen, die nach ihrer Reiter-ID laufen (siehe CarryOverPlan.tabs).
 *
 * Gegenstände, Geld, Ausrüstungs-Sets, GM-Notizen, Tags und Schicksalspunkte
 * gehören zum Charakter und kommen hier nicht vor: sie sind ohnehin in jeder Form
 * dieselben. Die Waffen-Domäne sind nur die beiden Listen des Waffen-Reiters
 * (waffenlos, kampfstile); die Waffen selbst sind Gegenstände.
 */
export const SHEET_DOMAINS = ['heldenbrief', 'talente', 'sprachen', 'waffen', 'faehigkeiten'] as const;
export type SheetDomain = (typeof SHEET_DOMAINS)[number];

/** Der Heldenbrief IST der Bogen (Attribute, Energien, Bio): er wird kopiert, nie geteilt. */
export const SYNCABLE_DOMAINS: readonly SheetDomain[] = SHEET_DOMAINS.filter((d) => d !== 'heldenbrief');

export const DOMAIN_LABELS: Record<SheetDomain, string> = {
  heldenbrief: 'Heldenbrief',
  talente: 'Talente',
  sprachen: 'Sprachen',
  waffen: 'Waffen (Listen)',
  faehigkeiten: 'Zauber & Fähigkeiten',
};

export const isSheetDomain = (v: unknown): v is SheetDomain => (SHEET_DOMAINS as readonly unknown[]).includes(v);
export const isSyncable = (d: SheetDomain): boolean => SYNCABLE_DOMAINS.includes(d);

/** 'linked' = die Form liest und schreibt die Zeilen der Grundform; 'own' = ihre eigenen. */
export type DomainMode = 'linked' | 'own';

/**
 * Wessen Zeilen eine Form für eine Domäne liest und schreibt. Die Grundform hat
 * immer ihre eigenen; bei einer Form entscheidet der Modus. Kein Eintrag = eigene
 * (so verhalten sich alle Formen aus Phase 1, die noch keinen Modus haben).
 */
export function domainOwnerId(sheetId: number, baseId: number, mode: DomainMode | null | undefined): number {
  return sheetId !== baseId && mode === 'linked' ? baseId : sheetId;
}

/** Zu welcher Domäne gehört der Speicher-Bereich (saveSection)? null = immer die eigenen Zeilen. */
export function sectionDomain(section: string): SheetDomain | null {
  if (section === 'talents') return 'talente';
  if (section === 'languages') return 'sprachen';
  if (section === 'waffenlos' || section === 'kampfstile') return 'waffen';
  return null;
}

/** Zu welcher Domäne gehört ein eingebauter Reiter (Schlüssel wie in tabOrder.ts)? */
export function tabKeyDomain(key: string): SheetDomain | null {
  if (key === 'Heldenbrief') return 'heldenbrief';
  if (key === 'Talente') return 'talente';
  if (key === 'Sprachen') return 'sprachen';
  if (key === 'WaffenNeu') return 'waffen';
  if (key === 'Zauber' || key === 'Fähigkeiten') return 'faehigkeiten';
  return null;
}

/** Was beim Anlegen einer Form mit einem Teil geschieht. */
export type CarryChoice = 'copy' | 'sync' | 'skip';

export interface CarryOverPlan {
  domains: Record<SheetDomain, CarryChoice>;
  /** Selbst angelegte Reiter der Grundform, nach ihrer Reiter-ID. */
  tabs: Record<number, CarryChoice>;
}

const CHOICES: readonly string[] = ['copy', 'sync', 'skip'];

/**
 * Macht aus der Eingabe des Dialogs einen gültigen Plan. Fehlendes oder Ungültiges
 * wird zu „kopieren" (die sichere Voreinstellung: nichts geht verloren, nichts
 * hängt an der Grundform); der Heldenbrief lässt sich nicht synchronisieren
 * (→ kopieren); unbekannte Reiter-IDs fallen weg.
 */
export function normalizeCarryOver(raw: unknown, baseTabIds: readonly number[]): CarryOverPlan {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { domains?: unknown; tabs?: unknown };
  const dom = (obj.domains && typeof obj.domains === 'object' ? obj.domains : {}) as Record<string, unknown>;
  const tabsIn = (obj.tabs && typeof obj.tabs === 'object' ? obj.tabs : {}) as Record<string, unknown>;
  const pick = (v: unknown): CarryChoice => (typeof v === 'string' && CHOICES.includes(v) ? (v as CarryChoice) : 'copy');

  const domains = {} as Record<SheetDomain, CarryChoice>;
  for (const d of SHEET_DOMAINS) {
    const c = pick(dom[d]);
    domains[d] = c === 'sync' && !isSyncable(d) ? 'copy' : c;
  }
  const tabs: Record<number, CarryChoice> = {};
  for (const id of baseTabIds) tabs[id] = pick(tabsIn[String(id)]);
  return { domains, tabs };
}

/** Ein Plan, der überall dasselbe wählt (Phase-1-Verhalten: alles kopieren bzw. nichts übernehmen). */
export function uniformCarryOver(choice: 'copy' | 'skip', baseTabIds: readonly number[]): CarryOverPlan {
  const domains = {} as Record<SheetDomain, CarryChoice>;
  for (const d of SHEET_DOMAINS) domains[d] = choice;
  const tabs: Record<number, CarryChoice> = {};
  for (const id of baseTabIds) tabs[id] = choice;
  return { domains, tabs };
}

/**
 * Entkoppeln: gibt es noch eine zurückgelegte eigene Kopie (aus einem früheren
 * Entkoppeln) und wurde sie ausdrücklich weiterverwendet, wird nur der Modus
 * umgelegt ('resume'). Sonst entsteht eine frische Kopie der geteilten Daten
 * ('snapshot'), die eine zurückgelegte ersetzt.
 */
export function detachAction(hasDormantCopy: boolean, resume: boolean): 'resume' | 'snapshot' {
  return hasDormantCopy && resume ? 'resume' : 'snapshot';
}
