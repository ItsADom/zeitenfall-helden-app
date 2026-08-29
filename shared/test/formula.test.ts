import { describe, expect, it } from 'vitest';
import { countDice, diceSidesFor, evaluateRolled, evaluateStatic, formulaToText, parseFormula, type FormulaNode } from '../src/formula.js';

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
