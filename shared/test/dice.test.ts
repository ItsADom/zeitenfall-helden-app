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

  it('findet eine einzelne natürliche 20 bzw. 1 am richtigen Würfel', () => {
    expect(findCritTriggers([20, 5, 7], 20)).toEqual([{ dieIndex: 0, trigger: 20, cancelled: false }]);
    expect(findCritTriggers([5, 7, 1], 20)).toEqual([{ dieIndex: 2, trigger: 1, cancelled: false }]);
  });

  it('never triggers on non-d20 dice, even at matching face values', () => {
    expect(findCritTriggers([20, 1], 6)).toEqual([]);
  });
});

// 20er und 1er heben sich paarweise auf — in WURFREIHENFOLGE, als würfelte
// man nacheinander. Aufgehoben ist dabei nur die Sonderbedeutung (Patzer /
// kritischer Erfolg); der Bestätigungswurf wird trotzdem geworfen und wirkt
// ganz normal auf die Summe.
describe('findCritTriggers: 20er und 1er heben sich auf', () => {
  it('eine 20 und eine 1 heben sich auf, lösen aber beide eine Bestätigung aus', () => {
    expect(findCritTriggers([20, 5, 1], 20)).toEqual([
      { dieIndex: 0, trigger: 20, cancelled: true },
      { dieIndex: 2, trigger: 1, cancelled: true },
    ]);
    expect(confirmationsNeeded([20, 5, 1], 20)).toBe(2);
  });

  it('die 1 hebt die ZUERST geworfene offene 20 auf', () => {
    expect(findCritTriggers([20, 20, 1], 20)).toEqual([
      { dieIndex: 0, trigger: 20, cancelled: true },
      { dieIndex: 1, trigger: 20, cancelled: false },
      { dieIndex: 2, trigger: 1, cancelled: true },
    ]);
  });

  it('umgekehrt genauso: die 20 hebt die zuerst geworfene offene 1 auf', () => {
    expect(findCritTriggers([1, 1, 20], 20)).toEqual([
      { dieIndex: 0, trigger: 1, cancelled: true },
      { dieIndex: 1, trigger: 1, cancelled: false },
      { dieIndex: 2, trigger: 20, cancelled: true },
    ]);
  });

  it('gleich viele heben sich vollständig auf', () => {
    expect(findCritTriggers([20, 20, 1, 1, 9], 20).every((t) => t.cancelled)).toBe(true);
  });

  it('ohne Gegenstück bleibt alles stehen', () => {
    expect(findCritTriggers([20, 20, 9], 20)).toEqual([
      { dieIndex: 0, trigger: 20, cancelled: false },
      { dieIndex: 1, trigger: 20, cancelled: false },
    ]);
  });

  it('aufgehobene Würfel wirken weiter auf die Summe, nur nicht mehr als Patzer', () => {
    // 20 und 1 heben sich auf. Die 20 bestätigt (14 ≥ 10) — trotzdem kein
    // Patzer; die 1 zieht ihre 8 ganz normal ab.
    const r = resolveProbeRoll(
      [20, 5, 1],
      [
        { dieIndex: 0, value: 14 },
        { dieIndex: 2, value: 8 },
      ],
      30,
    );
    expect(r.resolved).toBe(true);
    expect(r.criticalFailure).toBe(false);
    expect(r.criticalSuccess).toBe(false);
    expect(r.adjustedSum).toBe(32); // 26 + 14 − 8 (aufgehobene, bestätigte 20 zählt normal mit)
  });

  it('eine aufgehobene UNbestätigte 20 addiert ihren Wert weiterhin', () => {
    const r = resolveProbeRoll(
      [20, 5, 1],
      [
        { dieIndex: 0, value: 3 },
        { dieIndex: 2, value: 4 },
      ],
      30,
    );
    expect(r.adjustedSum).toBe(25); // 26 + 3 − 4
    expect(r.criticalFailure).toBe(false);
  });

  it('eine bestätigte 20, die stehen bleibt, ist weiterhin ein Patzer', () => {
    // Zwei 20er, eine 1: die 1 hebt die ERSTE 20 auf, die zweite bleibt.
    const r = resolveProbeRoll(
      [20, 20, 1],
      [
        { dieIndex: 0, value: 12 },
        { dieIndex: 1, value: 15 },
        { dieIndex: 2, value: 6 },
      ],
      60,
    );
    expect(r.criticalFailureCount).toBe(1); // nur die zweite zählt
    expect(r.criticalFailure).toBe(true);
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
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 15, confirmed: true, cancelled: false }]);
    expect(r.criticalFailureCount).toBe(1);
    expect(r.criticalFailure).toBe(true);
    // The confirmation value moves the sum like any other, but success is
    // false regardless via criticalFailure.
    expect(r.adjustedSum).toBe(43); // 28 + 15
    expect(r.success).toBe(false);
  });

  it('single unconfirmed 20: its confirmation value is added to the sum, no override', () => {
    const r = resolveProbeRoll([20, 5, 3], [{ dieIndex: 0, value: 7 }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 7, confirmed: false, cancelled: false }]);
    expect(r.criticalFailure).toBe(false);
    expect(r.adjustedSum).toBe(35); // 28 + 7
    expect(r.success).toBe(false); // 35 > 30
  });

  it('single natural 1: its confirmation value is always subtracted, regardless of value', () => {
    const r = resolveProbeRoll([1, 10, 10], [{ dieIndex: 0, value: 17 }], 25);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 1, value: 17, confirmed: true, cancelled: false }]);
    expect(r.adjustedSum).toBe(4); // 21 - 17
    expect(r.success).toBe(true);
  });

  it('two confirmed 20s stack into a worse failure (count tracked, still one criticalFailure flag)', () => {
    const r = resolveProbeRoll([20, 20, 5], [{ dieIndex: 0, value: 12 }, { dieIndex: 1, value: 18 }], 30);
    expect(r.criticalFailureCount).toBe(2);
    expect(r.criticalFailure).toBe(true);
    expect(r.success).toBe(false);
  });

  it('mehrere gleichartige Auslöser bekommen je eine eigene Bestätigung, in Würfelreihenfolge', () => {
    const r = resolveProbeRoll([20, 20, 8], [{ dieIndex: 0, value: 5 }, { dieIndex: 1, value: 4 }], 60);
    expect(r.confirmations).toEqual([
      { dieIndex: 0, trigger: 20, value: 5, confirmed: false, cancelled: false },
      { dieIndex: 1, trigger: 20, value: 4, confirmed: false, cancelled: false },
    ]);
    expect(r.adjustedSum).toBe(48 + 5 + 4); // rawSum=48, beide unbestätigt
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
    const r = resolveProbeRoll([1, 1, 8], [], 30);
    expect(r.pending).toEqual([
      { dieIndex: 0, trigger: 1 },
      { dieIndex: 1, trigger: 1 },
    ]);
    expect(r.confirmations).toEqual([]);
    expect(r.resolved).toBe(false);
    // Unentschieden, solange etwas offen ist — auch wenn die Summe reichen würde.
    expect(r.adjustedSum).toBe(10);
    expect(r.success).toBe(false);
  });

  it('verrechnet Teil-Bestätigungen und lässt den Rest offen', () => {
    const r = resolveProbeRoll([1, 1, 8], [{ dieIndex: 1, value: 9 }], 30);
    expect(r.confirmations).toEqual([{ dieIndex: 1, trigger: 1, value: 9, confirmed: false, cancelled: false }]);
    expect(r.pending).toEqual([{ dieIndex: 0, trigger: 1 }]);
    expect(r.resolved).toBe(false);
    expect(r.adjustedSum).toBe(1); // 10 - 9
    expect(r.success).toBe(false); // noch offen
  });

  it('gilt erst als entschieden, wenn nichts mehr offen ist', () => {
    const r = resolveProbeRoll(
      [1, 1, 8],
      [
        { dieIndex: 1, value: 9 },
        { dieIndex: 0, value: 4 },
      ],
      30,
    );
    expect(r.pending).toEqual([]);
    expect(r.resolved).toBe(true);
    expect(r.adjustedSum).toBe(-3); // 10 - 9 - 4
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
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: null, skipped: true, cancelled: false }]);
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
    const expr = { groups: [{ count: 1, sides: 20 }], modifier: 0 };
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

// Ein Wurf aus mehreren Würfeln gilt noch als bestanden, wenn er die
// Probe-Zahl um höchstens NARROW_PASS_MARGIN überschreitet.
describe('Knapp gelungen', () => {
  it('überschreitet die Probe-Zahl um bis zu 4 und gilt trotzdem als bestanden', () => {
    const r = resolveProbeRoll([14, 14, 14], [], 38); // 42 = 38 + 4
    expect(r.adjustedSum).toBe(42);
    expect(r.success).toBe(true);
    expect(r.narrow).toBe(true);
  });

  it('bei 5 darüber ist Schluss', () => {
    const r = resolveProbeRoll([14, 14, 15], [], 38); // 43 = 38 + 5
    expect(r.success).toBe(false);
  });

  it('genau auf der Probe-Zahl ist ein sauberer Erfolg, nicht nur ein knapper', () => {
    const r = resolveProbeRoll([12, 13, 13], [], 38);
    expect(r.adjustedSum).toBe(38);
    expect(r.success).toBe(true);
    expect(r.narrow).toBe(false);
  });

  it('gibt es bei Würfen mit nur einem Würfel nicht', () => {
    // Waffen-/Eigenschaftsprobe: 14 gegen 12 ist schlicht misslungen.
    const r = resolveProbeRoll([14], [], 12);
    expect(r.success).toBe(false);
    expect(r.narrow).toBe(false);
  });

  it('auch eine unbestätigte 20 macht einen Einzelwürfel nicht „knapp"', () => {
    // 20 + Bestätigung 3 = 23, unter der Probe-Zahl: schlicht gelungen.
    // Der Spielraum ist bei einem Würfel gar nicht vorhanden, also darf hier
    // auch nicht „Knapper Erfolg" stehen.
    const r = resolveProbeRoll([20], [{ dieIndex: 0, value: 3 }], 25);
    expect(r.adjustedSum).toBe(23);
    expect(r.success).toBe(true);
    expect(r.narrow).toBe(false);
  });

  it('eine unbestätigte 20 drückt einen sauberen Erfolg auf „knapp"', () => {
    // 20+4+7 = 31, Bestätigung 5 nicht bestätigt → 36, unter der Probe-Zahl.
    const r = resolveProbeRoll([20, 4, 7], [{ dieIndex: 0, value: 5 }], 38);
    expect(r.adjustedSum).toBe(36);
    expect(r.success).toBe(true);
    expect(r.narrow).toBe(true);
  });
});

describe('Kritischer Erfolg', () => {
  it('eine stehengebliebene 1 mit Bestätigung ≥10 macht aus einem sauberen Erfolg einen kritischen', () => {
    const r = resolveProbeRoll([1, 10, 10], [{ dieIndex: 0, value: 14 }], 25);
    expect(r.adjustedSum).toBe(7); // 21 - 14
    expect(r.success).toBe(true);
    expect(r.criticalSuccess).toBe(true);
  });

  it('unter 10 bleibt es beim sauberen Erfolg, kein krit. Erfolg — mirrors the 20 threshold', () => {
    const r = resolveProbeRoll([1, 10, 10], [{ dieIndex: 0, value: 7 }], 25);
    expect(r.adjustedSum).toBe(14); // 21 - 7, Wert wirkt trotzdem
    expect(r.success).toBe(true);
    expect(r.criticalSuccess).toBe(false);
  });

  it('nicht bei einem nur knapp bestandenen Wurf, selbst mit bestätigter 1', () => {
    // 1+19+19 = 39, bestätigte (≥10) Bestätigung 14 zieht ab → 25, genau 4
    // über der Probe-Zahl 21: bestanden, aber eben nur knapp.
    const r = resolveProbeRoll([1, 19, 19], [{ dieIndex: 0, value: 14 }], 21);
    expect(r.adjustedSum).toBe(25);
    expect(r.success).toBe(true);
    expect(r.narrow).toBe(true);
    expect(r.criticalSuccess).toBe(false);
  });

  it('nicht bei einem misslungenen Wurf, selbst mit bestätigter 1', () => {
    const r = resolveProbeRoll([1, 19, 19], [{ dieIndex: 0, value: 15 }], 10);
    expect(r.success).toBe(false);
    expect(r.criticalSuccess).toBe(false);
  });

  it('nicht, wenn die bestätigte 1 von einer 20 aufgehoben wurde', () => {
    // Beide werfen weiterhin eine Bestätigung und wirken auf die Summe —
    // aufgehoben ist nur die Sonderbedeutung, auch wenn die 1 ≥10 bestätigt hätte.
    const r = resolveProbeRoll(
      [1, 20, 5],
      [
        { dieIndex: 0, value: 14 },
        { dieIndex: 1, value: 3 },
      ],
      30,
    );
    expect(r.adjustedSum).toBe(15); // 26 − 14 + 3
    expect(r.success).toBe(true);
    expect(r.criticalSuccess).toBe(false);
  });

  it('steht erst fest, wenn nichts mehr offen ist', () => {
    const r = resolveProbeRoll([1, 10, 10], [], 25);
    expect(r.resolved).toBe(false);
    expect(r.criticalSuccess).toBe(false);
  });
});

describe('parseDiceExpression', () => {
  it('parses "2w6+5"', () => {
    expect(parseDiceExpression('2w6+5')).toEqual({ groups: [{ count: 2, sides: 6 }], modifier: 5 });
  });

  it('parses "w20" with an implicit count of 1', () => {
    expect(parseDiceExpression('w20')).toEqual({ groups: [{ count: 1, sides: 20 }], modifier: 0 });
  });

  it('is case-insensitive on the "w"', () => {
    expect(parseDiceExpression('1W20-1')).toEqual({ groups: [{ count: 1, sides: 20 }], modifier: -1 });
  });

  it('also accepts "d" as an alias for "w"', () => {
    expect(parseDiceExpression('2d6+5')).toEqual({ groups: [{ count: 2, sides: 6 }], modifier: 5 });
    expect(parseDiceExpression('1D20-1')).toEqual({ groups: [{ count: 1, sides: 20 }], modifier: -1 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDiceExpression('  3w8 + 2  ')).toEqual({ groups: [{ count: 3, sides: 8 }], modifier: 2 });
  });

  it('rejects garbage', () => {
    expect(parseDiceExpression('not a roll')).toBeNull();
    expect(parseDiceExpression('')).toBeNull();
  });

  it('rejects out-of-range count/sides', () => {
    expect(parseDiceExpression('0w6')).toBeNull();
    expect(parseDiceExpression('21w6')).toBeNull();
    expect(parseDiceExpression('1w1')).toBeNull();
    expect(parseDiceExpression('1w1001')).toBeNull();
  });

  it('parses mixed dice pools, adding multiple groups', () => {
    expect(parseDiceExpression('1w6+1w20')).toEqual({
      groups: [
        { count: 1, sides: 6 },
        { count: 1, sides: 20 },
      ],
      modifier: 0,
    });
    expect(parseDiceExpression('2w6+1w4+3')).toEqual({
      groups: [
        { count: 2, sides: 6 },
        { count: 1, sides: 4 },
      ],
      modifier: 3,
    });
  });

  it('rejects subtracting a dice group — only the flat modifier may be negative', () => {
    expect(parseDiceExpression('1w6-1w20')).toBeNull();
  });

  it('caps the total dice count across all groups combined, not per group', () => {
    expect(parseDiceExpression('10w6+11w6')).toBeNull(); // 21 total > MAX_DICE_COUNT
    expect(parseDiceExpression('10w6+10w6')).not.toBeNull(); // 20 total is fine
  });

  it('rejects more than the allowed number of dice groups', () => {
    expect(parseDiceExpression('1w2+1w3+1w4+1w5+1w6+1w7+1w8')).toBeNull(); // 7 groups
  });

  it('rejects a bare modifier with no dice group at all', () => {
    expect(parseDiceExpression('5')).toBeNull();
  });
});

describe('resolveExpressionRoll', () => {
  it('sums dice plus modifier with no success/fail concept', () => {
    const expr = { groups: [{ count: 2, sides: 6 }], modifier: 3 };
    const r = resolveExpressionRoll(expr, [4, 5], []);
    expect(r.rawSum).toBe(12);
    expect(r.adjustedSum).toBe(12);
    expect(r.flagged).toBe(false);
  });

  it('flags but does not override on a confirmed 20 in a d20 expression', () => {
    const expr = { groups: [{ count: 1, sides: 20 }], modifier: 0 };
    const r = resolveExpressionRoll(expr, [20], [{ dieIndex: 0, value: 14 }]);
    expect(r.flagged).toBe(true);
    expect(r.confirmations).toEqual([{ dieIndex: 0, trigger: 20, value: 14, confirmed: true, cancelled: false }]);
    expect(r.adjustedSum).toBe(34); // 20 + 14 — the confirmation value moves the sum like any other
  });

  it('adds an unconfirmed 20 confirmation value into the sum', () => {
    const expr = { groups: [{ count: 1, sides: 20 }], modifier: 0 };
    const r = resolveExpressionRoll(expr, [20], [{ dieIndex: 0, value: 3 }]);
    expect(r.adjustedSum).toBe(23);
  });

  it('subtracts a natural-1 confirmation value unconditionally', () => {
    const expr = { groups: [{ count: 1, sides: 20 }], modifier: 5 };
    const r = resolveExpressionRoll(expr, [1], [{ dieIndex: 0, value: 16 }]);
    expect(r.adjustedSum).toBe(1 + 5 - 16);
  });

  it('never triggers confirmations on a non-d20 expression', () => {
    const expr = { groups: [{ count: 2, sides: 6 }], modifier: 0 };
    const r = resolveExpressionRoll(expr, [6, 1], []);
    expect(r.flagged).toBe(false);
    expect(r.confirmations).toEqual([]);
    expect(r.adjustedSum).toBe(7);
  });

  it('only the d20 group triggers confirmations in a mixed pool', () => {
    // Gruppe 0: 1w6 (Index 0) — Gruppe 1: 1w20 (Index 1). Die 1 auf dem W6
    // darf keine Bestätigung auslösen, nur die 20 auf dem W20.
    const expr = { groups: [{ count: 1, sides: 6 }, { count: 1, sides: 20 }], modifier: 0 };
    const r = resolveExpressionRoll(expr, [1, 20], []);
    expect(r.flagged).toBe(true);
    expect(r.pending).toEqual([{ dieIndex: 1, trigger: 20 }]);
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
