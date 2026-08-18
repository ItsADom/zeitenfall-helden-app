// Alle Wortlaute, die im Würfel-Feed erscheinen — an EINER Stelle, damit sie
// sich ändern lassen, ohne die Anzeige-Logik anzufassen. Nur Text hier drin,
// keine Regeln: WANN welcher Ausgang gilt, entscheidet shared/src/dice.ts.
//
// Wo eine Zahl im Satz steckt, ist der Eintrag eine Funktion, die sie
// bekommt — so bleibt auch die Satzstellung frei.

/** Ausgang einer Probe — die Zeile rechts neben dem Ergebnis. */
export const OUTCOME = {
  /**
   * Mindestens eine bestätigte 20. Bewusst ohne Anzahl: ob einer oder mehrere
   * bestätigt haben, steht ohnehin in den Bestätigungszeilen darunter.
   */
  criticalFailure: 'Krit. Fehlschlag',
  /** Sauber bestanden mit stehengebliebener natürlicher 1. */
  criticalSuccess: 'Krit. Erfolg',
  /** Sauber bestanden. */
  success: 'Erfolg',
  /** Bestanden, aber nur knapp (Spielraum ausgereizt oder unbestätigte 20). */
  narrow: 'Knapper Erfolg',
  /** Nicht bestanden. */
  failure: 'Fehlschlag',
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
