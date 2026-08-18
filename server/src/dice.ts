// RNG orchestration for the group feed's dice rolls. crypto.randomInt calls
// live here; the actual crit/confirmation resolution math is pure and lives
// in shared/src/dice.ts so it can be unit-tested without touching Node's
// crypto module.
import crypto from 'node:crypto';
import {
  confirmationsNeeded,
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

export function performProbeRoll(n: number, probeZahl: number): ProbeRollResult {
  const dice = Array.from({ length: n }, () => rollD20());
  const confirmationCount = confirmationsNeeded(dice, 20);
  const confirmationRolls = Array.from({ length: confirmationCount }, () => rollD20());
  return resolveProbeRoll(dice, confirmationRolls, probeZahl);
}

export function performExpressionRoll(expression: DiceExpression): ExpressionRollResult {
  const dice = Array.from({ length: expression.count }, () => rollDie(expression.sides));
  const confirmationCount = confirmationsNeeded(dice, expression.sides);
  const confirmationRolls = Array.from({ length: confirmationCount }, () => rollD20());
  return resolveExpressionRoll(expression, dice, confirmationRolls);
}
