// Pure dice-resolution math for the group feed's roll mechanic. No I/O: RNG
// calls (crypto.randomInt) and DB/WS orchestration stay server-only — this
// module only turns already-rolled numbers into a result.
//
// Crit/confirmation semantics: each natural 20 or natural 1 gets its own
// confirmation d20, same >=10 threshold for both, just mirrored to the
// opposite outcome. A confirmed (>=10) 20 is an instant critical failure
// (overrides the sum/target-number comparison entirely; criticalFailureCount
// tracks how many, since 2+ stack into a worse failure). A confirmed (>=10)
// lone surviving 1 turns a clean success into a critical one. Either way the
// confirmation's rolled VALUE always moves the sum too (20 adds, 1
// subtracts) regardless of whether it confirmed — confirmed only decides the
// crit/fumble special meaning. Confirmation rolls are never themselves
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

import { countDice, diceSidesFor, parseFormula, type FormulaNode } from './formula.js';

export const MAX_DICE_COUNT = 20;
export const MAX_DICE_GROUPS = 6;
// A leading "Nx" repeats the whole roll N times as one grouped/summarized
// feed card (chat-only — see TODO.md "Dice formula overhaul").
export const MAX_REPEAT_COUNT = 10;

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
  /**
   * Confirmation >=10 confirms the die's special meaning — instant critical
   * failure for a 20, critical success for a lone surviving 1 (same
   * threshold, mirrored to the opposite outcome). Unset for a skipped
   * confirmation.
   */
  confirmed?: boolean;
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
 *
 * `sides` ist entweder EIN Wert für den ganzen Pool (Probe: immer W20) oder,
 * bei einem gemischten Ausdruck (z. B. „1w6+1w20"), ein zu `dice` paralleles
 * Array — ein W6 in einem gemischten Wurf kritet nie, auch wenn er eine 1
 * zeigt, nur die W20-Anteile zählen.
 */
export function findCritTriggers(dice: number[], sides: number | number[]): CritTrigger[] {
  const sidesFor = (i: number): number => (typeof sides === 'number' ? sides : sides[i]);
  const openTwenties: number[] = [];
  const openOnes: number[] = [];
  const cancelled = new Set<number>();
  dice.forEach((v, dieIndex) => {
    if (sidesFor(dieIndex) !== 20) return;
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
    if (sidesFor(dieIndex) !== 20) return;
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
      // Der Bestätigungswert wirkt immer normal auf die Summe, unabhängig
      // davon, ob er bestätigt oder aufgehoben ist — "confirmed" entscheidet
      // nur, ob es (bei einer nicht aufgehobenen 20) ein Patzer wird.
      if (confirmed && !t.cancelled) criticalFailureCount += 1;
      adjustedSum += value;
      confirmations.push({ dieIndex: t.dieIndex, trigger: t.trigger, value, confirmed, cancelled: t.cancelled });
    } else {
      // Der Bestätigungswert wirkt immer auf die Summe — "confirmed" (gleiche
      // >=10-Schwelle wie bei der 20) entscheidet nur, ob die stehengebliebene
      // 1 auch tatsächlich zum kritischen Erfolg wird.
      adjustedSum -= value;
      confirmations.push({ dieIndex: t.dieIndex, trigger: t.trigger, value, confirmed: value >= 10, cancelled: t.cancelled });
    }
  }
  return { confirmations, pending, adjustedSum, criticalFailureCount };
}

/**
 * Resolves a Probe roll: N d20 summed against a precomputed target number
 * (probeZahl). `rolled` carries the confirmations triggered so far (any
 * order, keyed by dieIndex); the rest come back as `pending`.
 *
 * `modifier` is a situational adjustment to the ROLLED SUM, not the target —
 * positive makes the roll worse (harder to stay under probeZahl), negative
 * makes it better, since success means under-rolling. `rawSum` stays the
 * untouched dice total; `modifier` is folded into `adjustedSum` alongside
 * the confirmation math, so it survives a later roll.confirm re-resolve as
 * long as the same `modifier` is passed again (see server/src/ws.ts).
 */
export function resolveProbeRoll(
  dice: number[],
  rolled: RolledConfirmation[],
  probeZahl: number,
  modifier = 0,
): ProbeRollResult {
  const triggers = findCritTriggers(dice, 20);
  const rawSum = dice.reduce((a, b) => a + b, 0);
  const { confirmations, pending, adjustedSum, criticalFailureCount } = applyConfirmations(triggers, rolled, rawSum + modifier);
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
  // kritischen — aber erst, wenn ihre Bestätigung das (mit derselben >=10-
  // Schwelle wie bei der 20, nur in die andere Richtung gedeutet) bestätigt.
  // Aufgehobene 1er zählen dafür nicht mehr mit.
  const keptOne = confirmations.some((c) => c.trigger === 1 && c.confirmed && !c.cancelled);
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

/**
 * Structural subset of ProbeRollPayload that computeCoopVerdict needs —
 * defined locally instead of importing from diceProtocol.ts to avoid a
 * circular import (diceProtocol.ts already imports from this file).
 */
export interface CoopRollLike {
  probeZahl: number;
  adjustedSum: number;
  criticalFailure: boolean;
  criticalSuccess: boolean;
  resolved: boolean;
}

export interface CoopVerdict {
  targetSum: number;
  rolledSum: number;
  success: boolean;
  /** True while any participant's roll still has an unresolved confirmation die. */
  provisional: boolean;
  /** Confirmed crit-fails not cancelled by a confirmed crit-success — >0 forces failure regardless of the sums. */
  unrescuedFailures: number;
}

/**
 * Kooperationsprobe verdict (see TODO.md/docs concept): pool every
 * participant's probeZahl and adjustedSum, "roll low to succeed" on the
 * totals — same logic as a single Probe, just applied to the pooled
 * numbers. A confirmed crit-fail auto-fails the whole group unless rescued
 * 1:1 by a confirmed crit-success elsewhere; a rescue only cancels that
 * crit-fail's auto-fail, the sum-check still decides afterwards.
 */
export function computeCoopVerdict(rolls: CoopRollLike[]): CoopVerdict {
  const targetSum = rolls.reduce((sum, r) => sum + r.probeZahl, 0);
  const rolledSum = rolls.reduce((sum, r) => sum + r.adjustedSum, 0);
  const fails = rolls.filter((r) => r.criticalFailure).length;
  const successes = rolls.filter((r) => r.criticalSuccess).length;
  const unrescuedFailures = fails - Math.min(fails, successes);
  return {
    targetSum,
    rolledSum,
    unrescuedFailures,
    provisional: rolls.some((r) => !r.resolved),
    success: unrescuedFailures === 0 && rolledSum <= targetSum,
  };
}

/** Wie CoopRollLike, plus eine vom Aufrufer vergebene Kennung (z. B. charId), um Gewinner zurückzumelden. */
export interface CompetitiveEntrant extends CoopRollLike {
  id: number;
}

/** Rangstufe eines Teilnehmers — höher gewinnt gegen jede niedrigere Stufe, unabhängig vom Margin. */
export type CompetitiveTier = 'critFail' | 'normal' | 'critSuccess';

export interface CompetitiveResult {
  id: number;
  tier: CompetitiveTier;
  /** probeZahl - adjustedSum: je größer, desto deutlicher unter dem Zielwert geblieben (kann negativ sein). */
  margin: number;
}

export interface CompetitiveVerdict {
  /** Jeder Teilnehmer mit seiner Stufe/seinem Margin, absteigend sortiert (Stufe zuerst, dann Margin). */
  results: CompetitiveResult[];
  /** Bestes Margin in der höchsten belegten Stufe — mehrere ids bei einem echten Gleichstand. */
  winnerIds: number[];
  /** True, solange irgendein Teilnehmer noch eine offene Bestätigung hat. */
  provisional: boolean;
}

const TIER_RANK: Record<CompetitiveTier, number> = { critFail: 0, normal: 1, critSuccess: 2 };

function tierOf(r: CoopRollLike): CompetitiveTier {
  if (r.criticalFailure) return 'critFail';
  if (r.criticalSuccess) return 'critSuccess';
  return 'normal';
}

/**
 * Wettstreit-Verdikt (siehe TODO.md „Competitive check"): anders als die
 * Kooperationsprobe wird nichts gepoolt — jeder Teilnehmer tritt für sich an,
 * und genau eine Person (oder ein echt gleichstehendes Grüppchen) gewinnt.
 *
 * 1. Ein bestätigter kritischer Erfolg schlägt jeden gewöhnlichen Wurf, der
 *    wiederum jeden bestätigten kritischen Fehlschlag schlägt — eine Krit-
 *    Stufe sticht jede andere Stufe unabhängig vom Margin.
 * 2. Innerhalb einer Stufe entscheidet das Margin (probeZahl - adjustedSum,
 *    größer = besser) — die beste Stufe muss dabei nicht selbst bestanden
 *    haben: wer am wenigsten misslang, gewinnt trotzdem.
 * 3. Ein echtes Gleichstand (gleiche Stufe, gleiches Margin) in der
 *    Gewinner-Stufe zählt als gemeinsamer Sieg, kein weiterer Tie-Break.
 */
export function computeCompetitiveVerdict(rolls: CompetitiveEntrant[]): CompetitiveVerdict {
  const results: CompetitiveResult[] = rolls
    .map((r) => ({ id: r.id, tier: tierOf(r), margin: r.probeZahl - r.adjustedSum }))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.margin - a.margin);
  const topTierRank = results.length > 0 ? Math.max(...results.map((r) => TIER_RANK[r.tier])) : -1;
  const inTopTier = results.filter((r) => TIER_RANK[r.tier] === topTierRank);
  const bestMargin = inTopTier.length > 0 ? Math.max(...inTopTier.map((r) => r.margin)) : 0;
  const winnerIds = inTopTier.filter((r) => r.margin === bestMargin).map((r) => r.id);
  return {
    results,
    winnerIds,
    provisional: rolls.some((r) => !r.resolved),
  };
}

// Ein freier Würfel-Ausdruck ist ab jetzt derselbe Baum wie überall sonst
// (siehe formula.ts) — der Name bleibt "DiceExpression" für Bestandscode/
// -Kommentare in diesem Modul, ist aber nur noch ein Alias.
export type DiceExpression = FormulaNode;

/**
 * Ein `sides`-Wert je Würfel, parallel zum flachen `dice`-Array — für
 * findCritTriggers/Anzeige. Rein strukturell (kein Würfeln nötig), deshalb
 * auch am Bestätigungswurf-Zeitpunkt aus dem gespeicherten Ausdruck erneut
 * ableitbar, ohne den Wurf selbst zu wiederholen.
 */
export function diceSidesForExpression(expression: DiceExpression): number[] {
  return diceSidesFor(expression);
}

/**
 * Parses "2w6+5", "w20", "1W20-1", "2d6+5" (case-insensitive "w"/"d"), real
 * Klammer-/Vorrangs-Arithmetik ("2*(1w6+3)") und gemischte Pools
 * ("1w6+1w20"). Ein Würfel-Block unter Multiplikation wird zuerst geworfen,
 * die Arithmetik wirkt danach auf das Ergebnis — fällt aus der normalen
 * Auswertungsreihenfolge heraus, siehe formula.ts. Muss mindestens einen
 * Würfel-Block enthalten ("5" allein ist kein Wurf) und hält sich an dieselben
 * Gesamt-Obergrenzen wie zuvor (Würfelzahl, Anzahl Blöcke).
 */
export function parseDiceExpression(expr: string): DiceExpression | null {
  const ast = parseFormula(expr.trim());
  if (!ast) return null;
  const { totalDice, groups } = countDice(ast);
  if (totalDice < 1 || totalDice > MAX_DICE_COUNT) return null;
  if (groups > MAX_DICE_GROUPS) return null;
  return ast;
}

// Ein führendes "Nx" wiederholt den ganzen Wurf N-mal als eine gemeinsame,
// zusammengefasste Feed-Karte (Chat-only, siehe TODO.md). Wird VOR dem
// eigentlichen Ausdruck abgetrennt — unabhängig vom Label-Trenner "#", der am
// Ende steht (siehe splitInlineTitle in FeedColumn.tsx), und unabhängig von
// "*", das schon die Bedeutung "geworfenes Ergebnis skalieren" trägt.
export function stripRepeatPrefix(text: string): { repeat: number; rest: string } {
  const m = /^(\d+)[xX](.*)$/.exec(text.trim());
  if (!m) return { repeat: 1, rest: text };
  const repeat = parseInt(m[1], 10);
  if (repeat < 1 || repeat > MAX_REPEAT_COUNT) return { repeat: 1, rest: text };
  return { repeat, rest: m[2] };
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
 * concept — the crit/confirmation mechanic still applies to jedem W20-Anteil
 * (auch innerhalb eines gemischten Pools), aber nur um den Eintrag zu
 * markieren, nie um ein Ergebnis zu überschreiben.
 *
 * `rawSum` kommt von außen (aus `evaluateRolled` beim ersten Wurf, oder aus
 * dem gespeicherten Eintrag bei einem nachgereichten Bestätigungswurf) statt
 * hier aus `dice` neu berechnet zu werden — anders als beim alten rein
 * additiven Modell lässt sich die Summe bei echter Arithmetik (*, /, Klammern)
 * nicht mehr allein aus den flachen Würfelwerten zurückgewinnen.
 */
export function resolveExpressionRoll(
  expression: DiceExpression,
  dice: number[],
  rolled: RolledConfirmation[],
  rawSum: number,
): ExpressionRollResult {
  const triggers = findCritTriggers(dice, diceSidesForExpression(expression));
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

// „/master" und „/wild": ein W6 gegen eine feste Ergebnisliste, Index 0 = Auge
// 1. Serverseitig gewürfelt und nachgeschlagen wie probeZahl — der Spieler
// wählt nur den Befehl, nie das Ergebnis. Bei „/wild" bleibt der zusätzlich
// gewürfelte W20 ein reiner Zahlenwert (Unterergebnis in der jeweiligen
// Kategorie), den Spieler/Spielleitung im Regelwerk nachschlagen.
export const MASTER_TABLE: readonly string[] = [
  'Positive Götterinteraktion',
  'Positive Zusatzhandlung',
  'Positive Zustandsänderung',
  'Zufällige Götterinteraktion',
  'Negative Götterinteraktion',
  'Nichts',
];

export const WILD_MAGIC_TABLE: readonly string[] = ['Schaden', 'Beschwörung', 'Buff', 'Debuff', 'Beschwörung (Wesen)', 'Heilung'];

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
