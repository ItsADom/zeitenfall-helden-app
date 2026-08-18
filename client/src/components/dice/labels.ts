// Alle Wortlaute, die im Würfel-Feed erscheinen — an EINER Stelle, damit sie
// sich ändern lassen, ohne die Anzeige-Logik anzufassen. Nur Text hier drin,
// keine Regeln: WANN welcher Ausgang gilt, entscheidet shared/src/dice.ts.
//
// Die Funktionen bekommen die Zahlen übergeben, damit auch die Satzstellung
// frei ist (z. B. „Patzer ×2" ↔ „Zweifacher Patzer").

/** Ausgang einer Probe — die Zeile rechts neben dem Ergebnis. */
export const OUTCOME = {
  /** Bestätigter Patzer. count = Anzahl bestätigter 20er (2+ stapeln sich). */
  criticalFailure: (count: number): string => (count > 1 ? `Patzer ×${count}` : 'Patzer'),
  /** Sauber bestanden mit stehengebliebener natürlicher 1. */
  criticalSuccess: 'Kritischer Erfolg',
  /** Sauber bestanden. */
  success: 'Gelungen',
  /** Bestanden, aber nur knapp (Spielraum ausgereizt oder unbestätigte 20). */
  narrow: 'Knapp gelungen',
  /** Nicht bestanden. */
  failure: 'Misslungen',
};

/** Bestätigungswürfe unter dem Ergebnis. */
export const CONFIRM = {
  /** Bestätigung verworfen („Ohne") — der Wurf kennt keinen Patzer. */
  skipped: 'keine Bestätigung',
  /** 20 bestätigt (Wurf ≥ 10) → Patzer. */
  confirmed: '· bestätigt (Patzer)',
  /** 20 nicht bestätigt (Wurf < 10) → Wert wird addiert. */
  unconfirmed: (value: number): string => `· nicht bestätigt (+${value})`,
  /** Natürliche 1 → Wert wird immer abgezogen. */
  subtracted: (value: number): string => `· −${value}`,
  /**
   * Von einem Gegenstück aufgehoben. Der Wert wirkt weiter auf die Summe,
   * nur Patzer bzw. kritischer Erfolg entfallen.
   */
  cancelled: '· aufgehoben',
  cancelledConfirmed: '· aufgehoben (kein Patzer)',
};

/** Offene Bestätigungen (nur beim Werfer). */
export const PENDING = {
  roll: 'Bestätigen',
  skip: 'Ohne',
  skipHint: 'Dieser Wurf kennt keine Bestätigung',
  /** Hinweis für alle anderen, solange der Werfer noch nicht gewürfelt hat. */
  waiting: (count: number): string =>
    count === 1 ? 'Bestätigung ausstehend …' : `${count} Bestätigungen ausstehend …`,
};

/** Hinweis an Einträgen, die nicht alle sehen. */
export const VISIBILITY = {
  hidden: '🔒 nur für dich',
  gmPlayer: '🔒 SL + Spieler',
};
