// One shared arithmetic grammar for every formula in the app — chat/`/r`
// free rolls, weapon-damage formulas, and the GM's Spezialenergien-Katalog
// formulas. Replaces three previously independent, inconsistent parsers (see
// TODO.md "Dice formula overhaul"). Deliberately NOT used for Talent/Ability
// Probe formulas (`parseProbeExpr` in rules.ts) — those stay `+`-only on
// purpose, since their term count IS the number of d20s rolled, and real
// arithmetic would make that count ambiguous.
//
// Split into a pure parse step (text -> AST, no evaluation) and two
// evaluators over the same tree: `evaluateStatic` (rejects any dice block —
// energy formulas) and `evaluateRolled` (rolls dice blocks via an injected
// `rollDie`, so this module itself stays RNG-free/testable). "Roll first,
// then apply the arithmetic to the result" falls out for free from ordinary
// operator precedence — a dice block is just a leaf that becomes a concrete
// number the moment it's visited, exactly like a number literal or a
// resolved identifier.

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'dice'; count: number; sides: number }
  | { kind: 'id'; name: string }
  | { kind: 'neg'; operand: FormulaNode }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

// Guards against pathological input (e.g. hundreds of nested parens) blowing
// the recursive-descent parser's stack — each token consumes at least one
// character, so a length cap also bounds recursion depth.
export const MAX_FORMULA_LENGTH = 200;
// Same reasoning as the old MAX_DICE_MODIFIER comment: an absurdly long digit
// string would otherwise parse to Infinity.
const MAX_NUMBER_LITERAL_DIGITS = 15;
// A dice block's side count is bounded at the grammar level — 1-sided or
// negative-sided dice are nonsensical in any context, not just chat.
const MIN_DICE_SIDES = 2;
const MAX_DICE_SIDES = 1000;

type Token =
  | { t: 'num'; v: number }
  | { t: 'dice'; count: number; sides: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenize(expr: string): Token[] | null {
  const toks: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const rest = expr.slice(i);
    if (/^\s/.test(rest)) {
      i++;
      continue;
    }
    if ('+-*/()'.includes(rest[0])) {
      toks.push({ t: 'op', v: rest[0] as '+' | '-' | '*' | '/' | '(' | ')' });
      i++;
      continue;
    }
    // Dice block BEFORE plain number/identifier, so "2w6" isn't misread as
    // number "2" followed by identifier "w6", and "w20" (implicit count 1)
    // isn't misread as a bare identifier.
    const diceMatch = /^(\d*)[wWdD](\d+)/.exec(rest);
    if (diceMatch) {
      const count = diceMatch[1] === '' ? 1 : parseInt(diceMatch[1], 10);
      const sides = parseInt(diceMatch[2], 10);
      if (count < 1 || sides < MIN_DICE_SIDES || sides > MAX_DICE_SIDES) return null;
      toks.push({ t: 'dice', count, sides });
      i += diceMatch[0].length;
      continue;
    }
    const numMatch = /^\d+(\.\d+)?/.exec(rest);
    if (numMatch) {
      if (numMatch[0].replace('.', '').length > MAX_NUMBER_LITERAL_DIGITS) return null;
      toks.push({ t: 'num', v: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-zÄÖÜäöü]+/.exec(rest);
    if (idMatch) {
      toks.push({ t: 'id', v: idMatch[0].toUpperCase() });
      i += idMatch[0].length;
      continue;
    }
    return null; // unbekanntes Zeichen
  }
  return toks;
}

// Rekursiver Abstieg: Summe -> Produkt (('+'|'-') Produkt)*,
// Produkt -> Primär (('*'|'/') Primär)*,
// Primär -> Zahl | Würfelblock | Bezeichner | '(' Summe ')' | '-' Primär | '+' Primär.
function parseTokens(tokens: Token[]): FormulaNode | null {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function primary(): FormulaNode | null {
    const t = peek();
    if (!t) return null;
    if (t.t === 'num') {
      next();
      return { kind: 'num', value: t.v };
    }
    if (t.t === 'dice') {
      next();
      return { kind: 'dice', count: t.count, sides: t.sides };
    }
    if (t.t === 'id') {
      next();
      return { kind: 'id', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      next();
      const inner = sum();
      const close = next();
      if (!inner || !close || close.t !== 'op' || close.v !== ')') return null;
      return inner;
    }
    if (t.t === 'op' && t.v === '-') {
      next();
      const operand = primary();
      return operand ? { kind: 'neg', operand } : null;
    }
    if (t.t === 'op' && t.v === '+') {
      next();
      return primary();
    }
    return null;
  }

  function product(): FormulaNode | null {
    let node = primary();
    if (!node) return null;
    for (let t = peek(); t && t.t === 'op' && (t.v === '*' || t.v === '/'); t = peek()) {
      next();
      const rhs = primary();
      if (!rhs) return null;
      node = { kind: 'bin', op: t.v as '*' | '/', left: node, right: rhs };
    }
    return node;
  }

  function sum(): FormulaNode | null {
    let node = product();
    if (!node) return null;
    for (let t = peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = peek()) {
      next();
      const rhs = product();
      if (!rhs) return null;
      node = { kind: 'bin', op: t.v as '+' | '-', left: node, right: rhs };
    }
    return node;
  }

  const result = sum();
  return pos === tokens.length ? result : null;
}

/** Pure parse — no evaluation, no RNG. `null` on any syntax error. */
export function parseFormula(text: string): FormulaNode | null {
  if (text.length === 0 || text.length > MAX_FORMULA_LENGTH) return null;
  const toks = tokenize(text);
  if (!toks || toks.length === 0) return null;
  return parseTokens(toks);
}

/** Total individual dice rolled, and number of distinct dice blocks, across the whole tree. */
export function countDice(ast: FormulaNode): { totalDice: number; groups: number } {
  let totalDice = 0;
  let groups = 0;
  const walk = (n: FormulaNode): void => {
    switch (n.kind) {
      case 'dice':
        totalDice += n.count;
        groups += 1;
        return;
      case 'neg':
        walk(n.operand);
        return;
      case 'bin':
        walk(n.left);
        walk(n.right);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return { totalDice, groups };
}

/**
 * Every die's side count, in the same left-to-right order `evaluateRolled`
 * would roll them — purely structural, no RNG needed, so this can also
 * reconstruct `sides` for an already-rolled expression at confirm-time
 * without re-evaluating anything.
 */
export function diceSidesFor(ast: FormulaNode): number[] {
  const out: number[] = [];
  const walk = (n: FormulaNode): void => {
    switch (n.kind) {
      case 'dice':
        for (let i = 0; i < n.count; i++) out.push(n.sides);
        return;
      case 'neg':
        walk(n.operand);
        return;
      case 'bin':
        walk(n.left);
        walk(n.right);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return out;
}

interface EvalCtx {
  resolveId: (name: string) => number | null;
  /** Unset in static (no-dice) mode — a DiceNode then fails evaluation. */
  rollDie?: (sides: number) => number;
  /** Rolled die faces, accumulated in encounter order as a side effect. */
  dice: number[];
}

function evalNode(node: FormulaNode, ctx: EvalCtx): number | null {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'id':
      return ctx.resolveId(node.name);
    case 'dice': {
      if (!ctx.rollDie) return null;
      let total = 0;
      for (let i = 0; i < node.count; i++) {
        const v = ctx.rollDie(node.sides);
        ctx.dice.push(v);
        total += v;
      }
      return total;
    }
    case 'neg': {
      const v = evalNode(node.operand, ctx);
      return v === null ? null : -v;
    }
    case 'bin': {
      const l = evalNode(node.left, ctx);
      if (l === null) return null;
      const r = evalNode(node.right, ctx);
      if (r === null) return null;
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? null : l / r;
      }
    }
  }
}

/**
 * Pure arithmetic, no dice allowed — `null` if the tree contains a dice
 * block, an unresolvable identifier, a division by zero, or an otherwise
 * non-finite result. Rounds UP at the end, matching every other derived
 * value in the app (MR/Resilienz/Artefaktkontrolle/energy formulas).
 */
export function evaluateStatic(ast: FormulaNode, resolveId: (name: string) => number | null): number | null {
  const v = evalNode(ast, { resolveId, dice: [] });
  return v === null || !Number.isFinite(v) ? null : Math.ceil(v);
}

/**
 * Rolls every dice block via `rollDie` (injected so this module stays
 * RNG-free) and evaluates the whole tree, returning the final total plus the
 * flat list of individual die faces (for crit-trigger detection/display).
 * Rounds the total UP, same as evaluateStatic — a division can otherwise
 * leave a fractional damage/result, which nothing in this app displays.
 */
export function evaluateRolled(
  ast: FormulaNode,
  resolveId: (name: string) => number | null,
  rollDie: (sides: number) => number,
): { total: number; dice: number[] } | null {
  const ctx: EvalCtx = { resolveId, rollDie, dice: [] };
  const total = evalNode(ast, ctx);
  return total === null || !Number.isFinite(total) ? null : { total: Math.ceil(total), dice: ctx.dice };
}

function precedence(op: '+' | '-' | '*' | '/'): number {
  return op === '+' || op === '-' ? 1 : 2;
}

/**
 * Canonical notation for display — reconstructed from the tree rather than
 * echoing the original typed text, so the live `/dicecode w|d` preference
 * always applies, even to a roll typed before the setting was changed.
 * Minimal parens: only where precedence would otherwise change the meaning.
 */
export function formulaToText(node: FormulaNode, diceCode: 'w' | 'd'): string {
  return render(node, 0);

  function render(n: FormulaNode, parentPrec: number): string {
    switch (n.kind) {
      case 'num':
        return String(n.value);
      case 'id':
        return n.name;
      case 'dice':
        return `${n.count}${diceCode}${n.sides}`;
      case 'neg':
        return `-${render(n.operand, 3)}`;
      case 'bin': {
        const myPrec = precedence(n.op);
        // Right side of a non-commutative op needs a strictly higher
        // "parent precedence" than the node's own, so e.g. "a-(b-c)" keeps
        // its parens (dropping them would silently change the value).
        const text = `${render(n.left, myPrec)}${n.op}${render(n.right, myPrec + 1)}`;
        return myPrec < parentPrec ? `(${text})` : text;
      }
    }
  }
}
