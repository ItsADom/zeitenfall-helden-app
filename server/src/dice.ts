// RNG orchestration for the group feed's dice rolls. crypto.randomInt calls
// live here; the actual crit/confirmation resolution math is pure and lives
// in shared/src/dice.ts so it can be unit-tested without touching Node's
// crypto module.
import crypto from 'node:crypto';
import {
  resolveExpressionRoll,
  resolveProbeRoll,
  type DiceExpression,
  type ExpressionRollResult,
  type ProbeRollResult,
} from 'shared';

export function rollDie(sides: number): number {
  return crypto.randomInt(1, sides + 1);
}

export function rollD20(): number {
  return rollDie(20);
}

// Bestätigungswürfe werden hier NICHT mitgewürfelt — sie löst der Spieler
// später einzeln aus (siehe roll.confirm in ws.ts). Der frische Wurf kommt
// deshalb mit leerer Bestätigungsliste und meldet die offenen Auslöser.
export function performProbeRoll(n: number, probeZahl: number, modifier = 0): ProbeRollResult {
  const dice = Array.from({ length: n }, () => rollD20());
  return resolveProbeRoll(dice, [], probeZahl, modifier);
}

export function performExpressionRoll(expression: DiceExpression): ExpressionRollResult {
  const dice = Array.from({ length: expression.count }, () => rollDie(expression.sides));
  return resolveExpressionRoll(expression, dice, []);
}
