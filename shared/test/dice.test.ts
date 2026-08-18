import { describe, expect, it } from 'vitest';
import {
  confirmationsNeeded,
  findCritTriggers,
  parseDiceExpression,
  parseDiceShortcuts,
  resolveExpressionRoll,
  resolveProbeRoll,
} from '../src/dice.js';

describe('findCritTriggers / confirmationsNeeded', () => {
  it('finds no triggers on a plain roll', () => {
    expect(findCritTriggers([5, 12, 8], 20)).toEqual([]);
    expect(confirmationsNeeded([5, 12, 8], 20)).toBe(0);
  });

  it('finds a natural 20 and a natural 1 by index', () => {
    const triggers = findCritTriggers([20, 5, 1], 20);
    expect(triggers).toEqual([
      { dieIndex: 0, trigger: 20 },
      { dieIndex: 2, trigger: 1 },
    ]);
    expect(confirmationsNeeded([20, 5, 1], 20)).toBe(2);
  });

  it('never triggers on non-d20 dice, even at matching face values', () => {
    expect(findCritTriggers([20, 1], 6)).toEqual([]);
  });
});

describe('resolveProbeRoll', () => {
  it('plain success: sum under probeZahl, no crits', () => {
    const r = resolveProbeRoll([5, 6, 4], [], 20);
    expect(r.rawSum).toBe(15);
    expect(r.adjustedSum).toBe(15);
    expect(r.criticalFailureCount).toBe(0);
    expect(r.criticalFailure).toBe(false);
    expect(r.success).toBe(true);
  });

  it('plain failure: sum over probeZahl, no crits', () => {
    const r = resolveProbeRoll([15, 12, 10], [], 20);
    expect(r.adjustedSum).toBe(37);
    expect(r.success).toBe(false);
    expect(r.criticalFailure).toBe(false);
  });

  it('single confirmed 20: instant critical failure, overrides the sum comparison', () => {
    const r = resolveProbeRoll([20, 5, 3], [{ dieIndex: 0, value: 15 }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 15, confirmed: true }]);
    expect(r.criticalFailureCount).toBe(1);
    expect(r.criticalFailure).toBe(true);
    // adjustedSum stays the raw sum for a confirmed 20 (no add), but success is still false via criticalFailure
    expect(r.adjustedSum).toBe(28);
    expect(r.success).toBe(false);
  });

  it('single unconfirmed 20: its confirmation value is added to the sum, no override', () => {
    const r = resolveProbeRoll([20, 5, 3], [{ dieIndex: 0, value: 7 }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 7, confirmed: false }]);
    expect(r.criticalFailure).toBe(false);
    expect(r.adjustedSum).toBe(35); // 28 + 7
    expect(r.success).toBe(false); // 35 > 30
  });

  it('single natural 1: its confirmation value is always subtracted, regardless of value', () => {
    const r = resolveProbeRoll([1, 10, 10], [{ dieIndex: 0, value: 17 }], 25);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 1, value: 17 }]);
    expect(r.adjustedSum).toBe(4); // 21 - 17
    expect(r.success).toBe(true);
  });

  it('two confirmed 20s stack into a worse failure (count tracked, still one criticalFailure flag)', () => {
    const r = resolveProbeRoll([20, 20, 5], [{ dieIndex: 0, value: 12 }, { dieIndex: 1, value: 18 }], 30);
    expect(r.criticalFailureCount).toBe(2);
    expect(r.criticalFailure).toBe(true);
    expect(r.success).toBe(false);
  });

  it('mixed 20s and 1s each get their own independent confirmation, in dice order', () => {
    const r = resolveProbeRoll([20, 1, 8], [{ dieIndex: 0, value: 5 }, { dieIndex: 1, value: 9 }], 30);
    // die 0 = 20 unconfirmed (+5), die 1 = 1 (-9 always)
    expect(r.confirmations).toEqual([
      { dieIndex: 0, trigger: 20, value: 5, confirmed: false },
      { dieIndex: 1, trigger: 1, value: 9 },
    ]);
    expect(r.adjustedSum).toBe(29 + 5 - 9); // rawSum=29
  });

  it('N=1 weapon Probe can crit/fumble on its own', () => {
    const critFail = resolveProbeRoll([20], [{ dieIndex: 0, value: 11 }], 12);
    expect(critFail.criticalFailure).toBe(true);
    expect(critFail.success).toBe(false);

    const fumbleHelped = resolveProbeRoll([1], [{ dieIndex: 0, value: 9 }], 12);
    expect(fumbleHelped.adjustedSum).toBe(-8);
    expect(fumbleHelped.success).toBe(true);
  });
});

describe('Bestätigungen werden einzeln nachgereicht', () => {
  it('meldet jeden Auslöser als offen, solange nichts geworfen wurde', () => {
    const r = resolveProbeRoll([20, 1, 8], [], 30);
    expect(r.pending).toEqual([
      { dieIndex: 0, trigger: 20 },
      { dieIndex: 1, trigger: 1 },
    ]);
    expect(r.confirmations).toEqual([]);
    expect(r.resolved).toBe(false);
    // Unentschieden, solange etwas offen ist — auch wenn die Summe reichen würde.
    expect(r.adjustedSum).toBe(29);
    expect(r.success).toBe(false);
  });

  it('verrechnet Teil-Bestätigungen und lässt den Rest offen', () => {
    const r = resolveProbeRoll([20, 1, 8], [{ dieIndex: 1, value: 9 }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 1, trigger: 1, value: 9 }]);
    expect(r.pending).toEqual([{ dieIndex: 0, trigger: 20 }]);
    expect(r.resolved).toBe(false);
    expect(r.adjustedSum).toBe(20); // 29 - 9
    expect(r.success).toBe(false); // noch offen
  });

  it('gilt erst als entschieden, wenn nichts mehr offen ist', () => {
    const r = resolveProbeRoll(
      [20, 1, 8],
      [
        { dieIndex: 1, value: 9 },
        { dieIndex: 0, value: 4 },
      ],
      30,
    );
    expect(r.pending).toEqual([]);
    expect(r.resolved).toBe(true);
    expect(r.adjustedSum).toBe(24); // 29 + 4 - 9
    expect(r.success).toBe(true);
  });

  it('die Reihenfolge der nachgereichten Würfe spielt keine Rolle', () => {
    const a = resolveProbeRoll([20, 20], [{ dieIndex: 0, value: 12 }, { dieIndex: 1, value: 3 }], 30);
    const b = resolveProbeRoll([20, 20], [{ dieIndex: 1, value: 3 }, { dieIndex: 0, value: 12 }], 30);
    expect(a.adjustedSum).toBe(b.adjustedSum);
    expect(a.criticalFailureCount).toBe(b.criticalFailureCount);
    expect(a.confirmations).toEqual(b.confirmations);
  });

  it('eine verworfene Bestätigung erledigt den Auslöser wirkungslos', () => {
    // Glückswurf/Zufallstabelle: die 20 soll gar kein Patzer-Potenzial haben.
    const r = resolveProbeRoll([20, 5, 3], [{ dieIndex: 0, value: null }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: null, skipped: true }]);
    expect(r.pending).toEqual([]);
    expect(r.resolved).toBe(true);
    expect(r.criticalFailure).toBe(false);
    expect(r.adjustedSum).toBe(28); // unverändert
    expect(r.success).toBe(true);
  });

  it('verwerfen wirkt auch bei einer natürlichen 1 (kein Abzug)', () => {
    const r = resolveProbeRoll([1, 10, 10], [{ dieIndex: 0, value: null }], 25);
    expect(r.adjustedSum).toBe(21); // ohne den sonst üblichen Abzug
    expect(r.resolved).toBe(true);
    expect(r.success).toBe(true);
  });

  it('greift genauso bei Ausdruckswürfen', () => {
    const expr = { count: 1, sides: 20, modifier: 0 };
    const open = resolveExpressionRoll(expr, [20], []);
    expect(open.pending).toEqual([{ dieIndex: 0, trigger: 20 }]);
    expect(open.resolved).toBe(false);

    const skipped = resolveExpressionRoll(expr, [20], [{ dieIndex: 0, value: null }]);
    expect(skipped.resolved).toBe(true);
    expect(skipped.adjustedSum).toBe(20);
    // Die 20 ist trotzdem passiert — der Eintrag bleibt hervorgehoben.
    expect(skipped.flagged).toBe(true);
  });
});

describe('parseDiceExpression', () => {
  it('parses "2w6+5"', () => {
    expect(parseDiceExpression('2w6+5')).toEqual({ count: 2, sides: 6, modifier: 5 });
  });

  it('parses "w20" with an implicit count of 1', () => {
    expect(parseDiceExpression('w20')).toEqual({ count: 1, sides: 20, modifier: 0 });
  });

  it('is case-insensitive on the "w"', () => {
    expect(parseDiceExpression('1W20-1')).toEqual({ count: 1, sides: 20, modifier: -1 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDiceExpression('  3w8 + 2  ')).toEqual({ count: 3, sides: 8, modifier: 2 });
  });

  it('rejects garbage', () => {
    expect(parseDiceExpression('not a roll')).toBeNull();
    expect(parseDiceExpression('2d6')).toBeNull(); // "d" not "w"
    expect(parseDiceExpression('')).toBeNull();
  });

  it('rejects out-of-range count/sides', () => {
    expect(parseDiceExpression('0w6')).toBeNull();
    expect(parseDiceExpression('21w6')).toBeNull();
    expect(parseDiceExpression('1w1')).toBeNull();
    expect(parseDiceExpression('1w1001')).toBeNull();
  });
});

describe('resolveExpressionRoll', () => {
  it('sums dice plus modifier with no success/fail concept', () => {
    const expr = { count: 2, sides: 6, modifier: 3 };
    const r = resolveExpressionRoll(expr, [4, 5], []);
    expect(r.rawSum).toBe(12);
    expect(r.adjustedSum).toBe(12);
    expect(r.flagged).toBe(false);
  });

  it('flags but does not override on a confirmed 20 in a d20 expression', () => {
    const expr = { count: 1, sides: 20, modifier: 0 };
    const r = resolveExpressionRoll(expr, [20], [{ dieIndex: 0, value: 14 }]);
    expect(r.flagged).toBe(true);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 14, confirmed: true }]);
    expect(r.adjustedSum).toBe(20); // confirmed 20 adds nothing extra
  });

  it('adds an unconfirmed 20 confirmation value into the sum', () => {
    const expr = { count: 1, sides: 20, modifier: 0 };
    const r = resolveExpressionRoll(expr, [20], [{ dieIndex: 0, value: 3 }]);
    expect(r.adjustedSum).toBe(23);
  });

  it('subtracts a natural-1 confirmation value unconditionally', () => {
    const expr = { count: 1, sides: 20, modifier: 5 };
    const r = resolveExpressionRoll(expr, [1], [{ dieIndex: 0, value: 16 }]);
    expect(r.adjustedSum).toBe(1 + 5 - 16);
  });

  it('never triggers confirmations on a non-d20 expression', () => {
    const expr = { count: 2, sides: 6, modifier: 0 };
    const r = resolveExpressionRoll(expr, [6, 1], []);
    expect(r.flagged).toBe(false);
    expect(r.confirmations).toEqual([]);
    expect(r.adjustedSum).toBe(7);
  });
});

describe('parseDiceShortcuts', () => {
  it('parses one "Label: expr" per line', () => {
    const lines = parseDiceShortcuts('Dolch-Schaden: 2w6+5\nFaustschlag: w6');
    expect(lines).toEqual([
      { kind: 'shortcut', label: 'Dolch-Schaden', expression: '2w6+5', valid: true },
      { kind: 'shortcut', label: 'Faustschlag', expression: 'w6', valid: true },
    ]);
  });

  it('treats a line of 3+ dashes as a separator', () => {
    const lines = parseDiceShortcuts('A: w6\n---\nB: w20');
    expect(lines).toEqual([
      { kind: 'shortcut', label: 'A', expression: 'w6', valid: true },
      { kind: 'separator' },
      { kind: 'shortcut', label: 'B', expression: 'w20', valid: true },
    ]);
  });

  it('flags a line with an unparseable expression as invalid, not dropped', () => {
    const lines = parseDiceShortcuts('Kaputt: not-a-roll');
    expect(lines).toEqual([{ kind: 'shortcut', label: 'Kaputt', expression: 'not-a-roll', valid: false }]);
  });

  it('flags a line with no colon as invalid, not dropped', () => {
    const lines = parseDiceShortcuts('kein Doppelpunkt hier');
    expect(lines).toEqual([{ kind: 'shortcut', label: 'kein Doppelpunkt hier', expression: '', valid: false }]);
  });

  it('skips blank lines', () => {
    const lines = parseDiceShortcuts('A: w6\n\n\nB: w20');
    expect(lines).toEqual([
      { kind: 'shortcut', label: 'A', expression: 'w6', valid: true },
      { kind: 'shortcut', label: 'B', expression: 'w20', valid: true },
    ]);
  });
});
