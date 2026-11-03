import { describe, expect, it } from 'vitest';
import {
  collectNames,
  countDice,
  diceSidesFor,
  evaluateProbeFormula,
  evaluateRolled,
  evaluateStatic,
  formulaToText,
  mapNames,
  parseFormula,
  type FormulaNode,
  type ProbeTerm,
} from '../src/formula.js';

describe('parseFormula', () => {
  it('parses a plain number', () => {
    expect(parseFormula('5')).toEqual({ kind: 'num', value: 5 });
  });

  it('parses an identifier', () => {
    expect(parseFormula('MU')).toEqual({ kind: 'id', name: 'MU' });
  });

  it('lower-cases input is upper-cased for identifiers', () => {
    expect(parseFormula('mu')).toEqual({ kind: 'id', name: 'MU' });
  });

  it('parses a dice block with implicit count 1', () => {
    expect(parseFormula('w20')).toEqual({ kind: 'dice', count: 1, sides: 20 });
    expect(parseFormula('d20')).toEqual({ kind: 'dice', count: 1, sides: 20 });
  });

  it('respects operator precedence: * binds tighter than +', () => {
    expect(parseFormula('1+2*3')).toEqual({
      kind: 'bin',
      op: '+',
      left: { kind: 'num', value: 1 },
      right: { kind: 'bin', op: '*', left: { kind: 'num', value: 2 }, right: { kind: 'num', value: 3 } },
    });
  });

  it('parens override precedence', () => {
    expect(parseFormula('(1+2)*3')).toEqual({
      kind: 'bin',
      op: '*',
      left: { kind: 'bin', op: '+', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } },
      right: { kind: 'num', value: 3 },
    });
  });

  it('unary minus', () => {
    expect(parseFormula('-5')).toEqual({ kind: 'neg', operand: { kind: 'num', value: 5 } });
  });

  it('rejects garbage and unbalanced parens', () => {
    expect(parseFormula('')).toBeNull();
    expect(parseFormula('1+')).toBeNull();
    expect(parseFormula('(1+2')).toBeNull();
    expect(parseFormula('1+2)')).toBeNull();
    expect(parseFormula('1 2')).toBeNull();
  });

  it('rejects an out-of-range dice block', () => {
    expect(parseFormula('1w1')).toBeNull(); // sides < 2
    expect(parseFormula('1w1001')).toBeNull(); // sides > 1000
  });

  it('rejects input over the length cap', () => {
    expect(parseFormula('1+'.repeat(150))).toBeNull();
  });
});

describe('countDice / diceSidesFor', () => {
  it('counts dice and groups across nested arithmetic', () => {
    const ast = parseFormula('2*(1w6+2w4)+3')!;
    expect(countDice(ast)).toEqual({ totalDice: 3, groups: 2 });
    expect(diceSidesFor(ast)).toEqual([6, 4, 4]);
  });

  it('is zero for a dice-free formula', () => {
    const ast = parseFormula('(MU+KL)/2')!;
    expect(countDice(ast)).toEqual({ totalDice: 0, groups: 0 });
    expect(diceSidesFor(ast)).toEqual([]);
  });
});

describe('evaluateStatic', () => {
  const resolveId = (name: string): number | null => ({ MU: 16, KL: 12 })[name] ?? null;

  it('evaluates plain arithmetic with rounding up', () => {
    expect(evaluateStatic(parseFormula('(MU+KL)/4')!, resolveId)).toBe(7); // 28/4 = 7
    expect(evaluateStatic(parseFormula('(MU+KL)/3')!, resolveId)).toBe(10); // 28/3 = 9.33 -> 10
  });

  it('rejects an unresolvable identifier', () => {
    expect(evaluateStatic(parseFormula('FOO')!, resolveId)).toBeNull();
  });

  it('rejects a dice block outright — no rolling in a static formula', () => {
    expect(evaluateStatic(parseFormula('1w6+MU')!, resolveId)).toBeNull();
  });

  it('rejects division by zero', () => {
    expect(evaluateStatic(parseFormula('MU/0')!, resolveId)).toBeNull();
  });
});

describe('evaluateRolled', () => {
  it('rolls each dice block and combines per operator, dice accumulate in encounter order', () => {
    const ast = parseFormula('2*(1w6+3)')!;
    const rolls = [4];
    let i = 0;
    const result = evaluateRolled(ast, () => null, () => rolls[i++]);
    expect(result).toEqual({ total: 14, dice: [4] }); // (4+3)*2
  });

  it('resolves identifiers alongside dice — free chat rolls with a selected character', () => {
    const ast = parseFormula('1w6+MU')!;
    const result = evaluateRolled(ast, (name) => (name === 'MU' ? 5 : null), () => 3);
    expect(result).toEqual({ total: 8, dice: [3] });
  });

  it('fails closed when an identifier is unresolvable (no character selected)', () => {
    const ast = parseFormula('1w6+MU')!;
    const result = evaluateRolled(ast, () => null, () => 3);
    expect(result).toBeNull();
  });

  it('accumulates dice left-to-right across a mixed pool', () => {
    const ast = parseFormula('1w6+1w20')!;
    const rolls = [2, 15];
    let i = 0;
    const result = evaluateRolled(ast, () => null, () => rolls[i++]);
    expect(result).toEqual({ total: 17, dice: [2, 15] });
  });

  it('rounds a fractional total up', () => {
    const ast = parseFormula('1w6/2')!;
    const result = evaluateRolled(ast, () => null, () => 3);
    expect(result).toEqual({ total: 2, dice: [3] }); // 3/2 = 1.5 -> 2
  });
});

describe('formulaToText', () => {
  it('renders a plain dice block with the given code', () => {
    expect(formulaToText({ kind: 'dice', count: 2, sides: 6 }, 'w')).toBe('2w6');
    expect(formulaToText({ kind: 'dice', count: 2, sides: 6 }, 'd')).toBe('2d6');
  });

  it('renders addition without parens', () => {
    const ast: FormulaNode = { kind: 'bin', op: '+', left: { kind: 'dice', count: 1, sides: 6 }, right: { kind: 'num', value: 3 } };
    expect(formulaToText(ast, 'w')).toBe('1w6+3');
  });

  it('adds parens only where precedence would otherwise change meaning', () => {
    const ast: FormulaNode = {
      kind: 'bin',
      op: '*',
      left: { kind: 'num', value: 2 },
      right: { kind: 'bin', op: '+', left: { kind: 'dice', count: 1, sides: 6 }, right: { kind: 'num', value: 3 } },
    };
    expect(formulaToText(ast, 'w')).toBe('2*(1w6+3)');
  });

  it('round-trips through parseFormula for a nested expression', () => {
    const ast = parseFormula('2*(1w6+3)-1w4')!;
    expect(parseFormula(formulaToText(ast, 'w'))).toEqual(ast);
  });
});

describe('names: bare, spaced and quoted', () => {
  it('reads a bare name with inner spaces as ONE identifier', () => {
    expect(parseFormula('Heilkunde Wunden+FF')).toEqual({
      kind: 'bin',
      op: '+',
      left: { kind: 'id', name: 'HEILKUNDE WUNDEN' },
      right: { kind: 'id', name: 'FF' },
    });
  });

  it('collapses extra whitespace inside a name', () => {
    expect(parseFormula('Heilkunde   Wunden')).toEqual({ kind: 'id', name: 'HEILKUNDE WUNDEN' });
  });

  it('accepts sharp s in a bare name', () => {
    expect(parseFormula('Großschilde')).toEqual({ kind: 'id', name: 'GROSSSCHILDE' });
  });

  it('reads a quoted name with operator characters inside', () => {
    expect(parseFormula('"Hämmer/Keulen"+5')).toEqual({
      kind: 'bin',
      op: '+',
      left: { kind: 'id', name: 'HÄMMER/KEULEN' },
      right: { kind: 'num', value: 5 },
    });
    expect(parseFormula('"Schwert (AT)"')).toEqual({ kind: 'id', name: 'SCHWERT (AT)' });
  });

  it('rejects an unterminated or empty quote', () => {
    expect(parseFormula('"Athletik')).toBeNull();
    expect(parseFormula('""')).toBeNull();
  });

  it('still rejects two terms with no operator between them', () => {
    expect(parseFormula('MU 5')).toBeNull();
    expect(parseFormula('(MU)(KL)')).toBeNull();
  });

  it('keeps dice blocks and names apart', () => {
    expect(parseFormula('1w20+Athletik')).toEqual({
      kind: 'bin',
      op: '+',
      left: { kind: 'dice', count: 1, sides: 20 },
      right: { kind: 'id', name: 'ATHLETIK' },
    });
  });

  it('renders plain names bare and others quoted, and round-trips', () => {
    const ast = parseFormula('Heilkunde Wunden+"Hämmer/Keulen"*2')!;
    expect(formulaToText(ast, 'w')).toBe('HEILKUNDE WUNDEN+"HÄMMER/KEULEN"*2');
    expect(parseFormula(formulaToText(ast, 'w'))).toEqual(ast);
  });

  it('collects each name once and can rename them', () => {
    const ast = parseFormula('FF+FF+"A-B"')!;
    expect(collectNames(ast)).toEqual(['FF', 'A-B']);
    expect(formulaToText(mapNames(ast, (n) => n.toLowerCase()), 'w')).toBe('ff+ff+"a-b"');
  });
});

describe('evaluateProbeFormula', () => {
  const terms: Record<string, ProbeTerm> = {
    ATHLETIK: { n: 3, probeZahl: 40 },
    AKROBATIK: { n: 3, probeZahl: 36 },
    FF: { n: 1, probeZahl: 12 },
  };
  const resolve = (name: string): ProbeTerm | null => terms[name] ?? null;
  const run = (text: string) => evaluateProbeFormula(parseFormula(text)!, resolve);
  const part = (name: string, n: number, probeZahl: number) => ({ name, n, probeZahl });

  it('adds targets and counts one d20 per attribute term, listing each name as a part', () => {
    expect(run('Athletik+FF')).toEqual({
      ok: true,
      n: 4,
      probeZahl: 52,
      parts: [part('ATHLETIK', 3, 40), part('FF', 1, 12)],
    });
  });

  it('a lone name is its own probe with one part', () => {
    expect(run('Athletik')).toEqual({ ok: true, n: 3, probeZahl: 40, parts: [part('ATHLETIK', 3, 40)] });
  });

  it('k*name repeats the name: dice AND target, one part per copy', () => {
    expect(run('2*Athletik')).toEqual({
      ok: true,
      n: 6,
      probeZahl: 80,
      parts: [part('ATHLETIK', 3, 40), part('ATHLETIK', 3, 40)],
    });
    expect(run('Athletik*2')).toEqual(run('2*Athletik'));
    expect(run('Athletik+FF+(2*Akrobatik)')).toMatchObject({ n: 10, probeZahl: 124 });
    expect((run('Athletik+FF+(2*Akrobatik)') as { parts: unknown[] }).parts).toHaveLength(4);
  });

  it('k*name is the same as writing the name k times', () => {
    expect(run('3*FF')).toEqual(run('FF+FF+FF'));
  });

  it('a repeated group repeats every name in it', () => {
    expect(run('2*(Athletik+FF)')).toMatchObject({ n: 8, probeZahl: 104 });
  });

  it('constants only shift the target and are no part', () => {
    expect(run('Athletik+5')).toEqual({ ok: true, n: 3, probeZahl: 45, parts: [part('ATHLETIK', 3, 40)] });
    expect(run('5+Athletik')).toMatchObject({ n: 3, probeZahl: 45 });
    expect(run('Athletik-5')).toMatchObject({ n: 3, probeZahl: 35 });
    expect(run('(1+1)*Athletik')).toMatchObject({ n: 6, probeZahl: 80 });
  });

  it('division by a constant scales the target (and the parts), not the dice, rounding up', () => {
    expect(run('FF/5')).toEqual({ ok: true, n: 1, probeZahl: 3, parts: [part('FF', 1, 3)] });
    expect(run('Athletik/2+FF')).toMatchObject({ n: 4, probeZahl: 32, parts: [part('ATHLETIK', 3, 20), part('FF', 1, 12)] });
  });

  it('rejects shapes without a meaningful dice count', () => {
    expect(run('Athletik-FF')).toEqual({ ok: false, reason: 'shape' });
    expect(run('Athletik*FF')).toEqual({ ok: false, reason: 'shape' });
    expect(run('5/FF')).toEqual({ ok: false, reason: 'shape' });
    expect(run('-Athletik')).toEqual({ ok: false, reason: 'shape' });
    expect(run('Athletik/0')).toEqual({ ok: false, reason: 'shape' });
  });

  it('rejects a fractional, zero, negative or absurd repeat count', () => {
    expect(run('0.5*Athletik')).toEqual({ ok: false, reason: 'shape' });
    expect(run('0*Athletik')).toEqual({ ok: false, reason: 'shape' });
    expect(run('(0-1)*Athletik')).toEqual({ ok: false, reason: 'shape' });
    expect(run('1000000*Athletik')).toEqual({ ok: false, reason: 'shape' });
  });

  it('rejects a formula without any name, and one with a dice block', () => {
    expect(run('5+3')).toEqual({ ok: false, reason: 'shape' });
    expect(run('2*3')).toEqual({ ok: false, reason: 'shape' });
    expect(run('Athletik+1w6')).toEqual({ ok: false, reason: 'shape' });
  });

  it('reports the first unknown name', () => {
    expect(run('Athletik+Fliegen')).toEqual({ ok: false, reason: 'unknown', name: 'FLIEGEN' });
  });
});
