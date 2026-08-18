// Pure dice-resolution math for the group feed's roll mechanic. No I/O: RNG
// calls (crypto.randomInt) and DB/WS orchestration stay server-only — this
// module only turns already-rolled numbers into a result.
//
// Crit/confirmation semantics: each natural 20 gets its own confirmation
// d20 — confirmation >=10 confirms it as an instant critical failure
// (overrides the sum/target-number comparison entirely; criticalFailureCount
// tracks how many, since 2+ stack into a worse failure); confirmation <10
// leaves it unconfirmed and its value is added to the sum instead. Each
// natural 1 also gets its own confirmation d20, but that value is always
// subtracted from the sum, unconditionally (no >=10/<10 branch for 1s —
// asymmetric with 20s by design). Confirmation rolls are never themselves
// re-confirmed. Applies identically at N=1 (weapon Proben) and N=3+
// (Talente/Zauber/Sprachen). Only triggers on d20s (sides === 20) — other
// dice never crit/fumble.
//
// Confirmations are NOT rolled together with the dice: each one is triggered
// by the player afterwards, one die at a time (that little bit of ceremony is
// the point — see the roll flow in docs/concepts/dice-rolls-and-chat.md). The
// resolvers therefore take however many confirmations have been rolled SO FAR
// and report the rest as `pending`; a roll counts as `resolved` only once
// nothing is pending. Until then its success/failure is deliberately not
// decided, since a confirmed 20 would override it anyway.

export const MAX_DICE_COUNT = 20;
export const MAX_DICE_SIDES = 1000;

/**
 * Knapper Erfolg: ein Wurf aus MEHREREN Würfeln gilt noch als gelungen, wenn
 * er die Probe-Zahl um höchstens so viel überschreitet.
 *
 * Würfe mit nur einem Würfel (Waffen-, Eigenschaftsproben) kennen diesen
 * Spielraum überhaupt nicht — dort gibt es kein „knapp", auch nicht über eine
 * unbestätigte 20. Sie gelingen oder sie misslingen.
 */
export const NARROW_PASS_MARGIN = 4;

export interface DieConfirmation {
  dieIndex: number;
  trigger: 20 | 1;
  /** null, wenn der Spieler die Bestätigung verworfen hat (siehe skipped). */
  value: number | null;
  confirmed?: boolean; // only meaningful for trigger===20
  /**
   * Verworfen statt geworfen: nicht jeder W20-Wurf kennt überhaupt Patzer —
   * ein Glückswurf oder eine Zufallstabelle will keine Bestätigung. Zählt
   * weder in die Summe noch als Patzer.
   */
  skipped?: boolean;
  /** Von einem Gegenstück aufgehoben — siehe CritTrigger.cancelled. */
  cancelled?: boolean;
}

/** Ein noch offener Bestätigungswurf — der Spieler löst ihn selbst aus. */
export interface PendingConfirmation {
  dieIndex: number;
  trigger: 20 | 1;
}

/**
 * Erledigte Bestätigung, wie sie hereingereicht wird (Reihenfolge egal):
 * eine Zahl = geworfen, null = vom Spieler verworfen.
 */
export interface RolledConfirmation {
  dieIndex: number;
  value: number | null;
}

export interface CritTrigger {
  dieIndex: number;
  trigger: 20 | 1;
  /**
   * Von einem Gegenstück aufgehoben: zählt NICHT mehr als Patzer bzw. als
   * kritischer Erfolg. Der Bestätigungswurf wird trotzdem geworfen und wirkt
   * ganz normal auf die Summe — aufgehoben ist nur die Sonderbedeutung.
   */
  cancelled: boolean;
}

/**
 * Welche Würfel eines Wurfs eine Bestätigung auslösen — das sind ALLE
 * natürlichen 20er und 1er.
 *
 * 20er und 1er heben sich paarweise auf, und zwar in Wurfreihenfolge, als
 * würfelte man nacheinander: eine 1 löscht die erste noch offene 20 vor ihr
 * (und umgekehrt), unabhängig davon, ob diese später bestätigt wird. Was sich
 * so aufhebt, verliert seine Sonderbedeutung — nicht aber seinen
 * Bestätigungswurf: der wird geworfen und verrechnet wie jeder andere.
 */
export function findCritTriggers(dice: number[], sides: number): CritTrigger[] {
  if (sides !== 20) return [];
  const openTwenties: number[] = [];
  const openOnes: number[] = [];
  const cancelled = new Set<number>();
  dice.forEach((v, dieIndex) => {
    if (v === 20) {
      const match = openOnes.shift();
      if (match === undefined) openTwenties.push(dieIndex);
      else {
        cancelled.add(match);
        cancelled.add(dieIndex);
      }
    } else if (v === 1) {
      const match = openTwenties.shift();
      if (match === undefined) openOnes.push(dieIndex);
      else {
        cancelled.add(match);
        cancelled.add(dieIndex);
      }
    }
  });
  const out: CritTrigger[] = [];
  dice.forEach((v, dieIndex) => {
    if (v === 20 || v === 1) out.push({ dieIndex, trigger: v as 20 | 1, cancelled: cancelled.has(dieIndex) });
  });
  return out;
}

export function confirmationsNeeded(dice: number[], sides: number): number {
  return findCritTriggers(dice, sides).length;
}

export interface ProbeRollResult {
  dice: number[];
  confirmations: DieConfirmation[];
  pending: PendingConfirmation[];
  /** true, sobald keine Bestätigung mehr offen ist — erst dann gilt success/criticalFailure. */
  resolved: boolean;
  rawSum: number;
  adjustedSum: number;
  probeZahl: number;
  criticalFailureCount: number;
  criticalFailure: boolean;
  /** Bestanden — schließt „knapp" mit ein. */
  success: boolean;
  /** Bestanden, aber nur knapp (Spielraum ausgereizt oder unbestätigte 20). */
  narrow: boolean;
  /**
   * Sauber bestanden UND mit stehengebliebener natürlicher 1 — das Gegenstück
   * zum Patzer. Hängt nur am Würfel, nicht an seiner Bestätigung. Ein nur
   * knapp bestandener Wurf zählt nicht.
   */
  criticalSuccess: boolean;
}

// Teilt die Auslöser in „schon geworfen" und „noch offen" und verrechnet die
// geworfenen. Gemeinsam genutzt von Proben- und Ausdruckswürfen, weil die
// Bestätigungsmechanik in beiden identisch ist.
function applyConfirmations(
  triggers: CritTrigger[],
  rolled: RolledConfirmation[],
  startSum: number,
): { confirmations: DieConfirmation[]; pending: PendingConfirmation[]; adjustedSum: number; criticalFailureCount: number } {
  const byDie = new Map(rolled.map((r) => [r.dieIndex, r.value]));
  const confirmations: DieConfirmation[] = [];
  const pending: PendingConfirmation[] = [];
  let adjustedSum = startSum;
  let criticalFailureCount = 0;
  for (const t of triggers) {
    if (!byDie.has(t.dieIndex)) {
      pending.push({ dieIndex: t.dieIndex, trigger: t.trigger });
      continue;
    }
    const value = byDie.get(t.dieIndex) as number | null;
    if (value === null) {
      // Verworfen: erledigt, aber ohne jede Wirkung auf Summe oder Patzer.
      confirmations.push({ dieIndex: t.dieIndex, trigger: t.trigger, value: null, skipped: true, cancelled: t.cancelled });
    } else if (t.trigger === 20) {
      const confirmed = value >= 10;
      // Aufgehobene 20er sind kein Patzer — ihre Bestätigung wirkt aber
      // ganz normal auf die Summe.
      if (confirmed) {
        if (!t.cancelled) criticalFailureCount += 1;
      } else adjustedSum += value;
      confirmations.push({ dieIndex: t.dieIndex, trigger: t.trigger, value, confirmed, cancelled: t.cancelled });
    } else {
      adjustedSum -= value;
      confirmations.push({ dieIndex: t.dieIndex, trigger: t.trigger, value, cancelled: t.cancelled });
    }
  }
  return { confirmations, pending, adjustedSum, criticalFailureCount };
}

/**
 * Resolves a Probe roll: N d20 summed against a precomputed target number
 * (probeZahl). `rolled` carries the confirmations triggered so far (any
 * order, keyed by dieIndex); the rest come back as `pending`.
 */
export function resolveProbeRoll(dice: number[], rolled: RolledConfirmation[], probeZahl: number): ProbeRollResult {
  const triggers = findCritTriggers(dice, 20);
  const rawSum = dice.reduce((a, b) => a + b, 0);
  const { confirmations, pending, adjustedSum, criticalFailureCount } = applyConfirmations(triggers, rolled, rawSum);
  const resolved = pending.length === 0;
  const criticalFailure = criticalFailureCount > 0;
  // Der ganze Spielraum ist eine Sache von Würfen aus MEHREREN Würfeln —
  // bei einem einzelnen Würfel (Waffen-, Eigenschaftsprobe) gibt es kein
  // „knapp", weder über die Punktegrenze noch über eine unbestätigte 20.
  const multiDie = dice.length > 1;
  const withinMargin = multiDie && adjustedSum > probeZahl && adjustedSum <= probeZahl + NARROW_PASS_MARGIN;
  // Eine stehengebliebene (nicht bestätigte) 20 lässt keinen sauberen Erfolg
  // mehr zu — bestenfalls einen knappen. Verworfene Bestätigungen zählen
  // hier nicht mit, die sind ja gerade als wirkungslos erklärt worden.
  // Aufgehobene 20er drücken nicht auf „knapp" — sie sind für die Bewertung
  // gar nicht da (ihr Bestätigungswert steckt aber schon in adjustedSum).
  const unconfirmedTwenty = confirmations.some((c) => c.trigger === 20 && c.confirmed === false && !c.cancelled);
  // Solange etwas offen ist, gilt der Wurf als nicht entschieden: eine noch
  // ausstehende 20 könnte ihn ohnehin zum Patzer machen.
  const success = resolved && !criticalFailure && (adjustedSum <= probeZahl || withinMargin);
  const narrow = success && multiDie && (withinMargin || unconfirmedTwenty);
  // Eine stehengebliebene natürliche 1 macht aus einem sauberen Erfolg einen
  // kritischen. Das hängt allein am Würfel selbst: die Bestätigung wird zwar
  // geworfen und ihr Wert wie immer abgezogen, aber sie hat bei 1ern keine
  // Schwelle, an der sich etwas entscheiden könnte — eine 1 ist eine 1.
  // Aufgehobene 1er zählen dafür nicht mehr mit.
  const keptOne = triggers.some((t) => t.trigger === 1 && !t.cancelled);
  return {
    dice,
    confirmations,
    pending,
    resolved,
    rawSum,
    adjustedSum,
    probeZahl,
    criticalFailureCount,
    criticalFailure,
    success,
    narrow,
    criticalSuccess: success && !narrow && keptOne,
  };
}

export interface DiceExpression {
  count: number;
  sides: number;
  modifier: number;
}

/** Parses "2w6+5", "w20", "1W20-1" (case-insensitive "w", modifier optional). */
export function parseDiceExpression(expr: string): DiceExpression | null {
  const m = /^\s*(\d*)[wW](\d+)\s*([+-]\s*\d+)?\s*$/.exec(expr);
  if (!m) return null;
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
  if (count < 1 || count > MAX_DICE_COUNT) return null;
  if (sides < 2 || sides > MAX_DICE_SIDES) return null;
  return { count, sides, modifier };
}

export interface ExpressionRollResult {
  expression: DiceExpression;
  dice: number[];
  confirmations: DieConfirmation[];
  pending: PendingConfirmation[];
  resolved: boolean;
  rawSum: number;
  adjustedSum: number;
  flagged: boolean;
}

/**
 * Resolves a raw expression roll (shortcut or free-form). No success/fail
 * concept — the crit/confirmation mechanic still applies when sides===20,
 * but only to flag the entry for display, not to override an outcome.
 */
export function resolveExpressionRoll(
  expression: DiceExpression,
  dice: number[],
  rolled: RolledConfirmation[],
): ExpressionRollResult {
  const triggers = findCritTriggers(dice, expression.sides);
  const rawSum = dice.reduce((a, b) => a + b, 0) + expression.modifier;
  const { confirmations, pending, adjustedSum } = applyConfirmations(triggers, rolled, rawSum);
  return {
    expression,
    dice,
    confirmations,
    pending,
    resolved: pending.length === 0,
    rawSum,
    adjustedSum,
    flagged: triggers.length > 0,
  };
}

export type DiceShortcutLine =
  | { kind: 'separator' }
  | { kind: 'shortcut'; label: string; expression: string; valid: boolean };

/** Parses the Einstellungen shortcuts textarea: one "Label: expr" per line, "---" = separator. */
export function parseDiceShortcuts(raw: string): DiceShortcutLine[] {
  const out: DiceShortcutLine[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (/^-{3,}$/.test(line)) {
      out.push({ kind: 'separator' });
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) {
      out.push({ kind: 'shortcut', label: line, expression: '', valid: false });
      continue;
    }
    const label = line.slice(0, idx).trim();
    const expression = line.slice(idx + 1).trim();
    const valid = label !== '' && parseDiceExpression(expression) !== null;
    out.push({ kind: 'shortcut', label, expression, valid });
  }
  return out;
}
