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

/**
 * The random core of one „großer Wurf" performance („/i", see
 * shared/src/diceCinematic.ts).
 *
 * Drives the ANIMATION only, never the result: which numbers fall is decided by
 * performExpressionRoll above, exactly as for any other roll. It still belongs
 * here, because this module's own header states that crypto.randomInt calls
 * live in this file.
 *
 * A uint32 rather than a hex string: shorter on the wire and nothing to parse
 * at the other end.
 */
export function rollSeed(): number {
  return crypto.randomInt(0, 2 ** 32);
}

// Bestätigungswürfe werden hier NICHT mitgewürfelt — sie löst der Spieler
// später einzeln aus (siehe roll.confirm in ws.ts). Der frische Wurf kommt
// deshalb mit leerer Bestätigungsliste und meldet die offenen Auslöser.
export function performProbeRoll(n: number, probeZahl: number, modifier = 0): ProbeRollResult {
  const dice = Array.from({ length: n }, () => rollD20());
  return resolveProbeRoll(dice, [], probeZahl, modifier);
}

export function performExpressionRoll(expression: DiceExpression): ExpressionRollResult {
  // Gruppen der Reihe nach würfeln und flach aneinanderhängen — dieselbe
  // Reihenfolge, die diceSidesForExpression beim Auflösen erwartet.
  const dice = expression.groups.flatMap((g) => Array.from({ length: g.count }, () => rollDie(g.sides)));
  return resolveExpressionRoll(expression, dice, []);
}
