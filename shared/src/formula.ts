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

// A name is compared case-insensitively with collapsed whitespace; the AST
// stores it upper-cased (so "mu" and "MU" are one identifier). "ß" upper-cases
// to "SS" on BOTH sides of a comparison, which is all that matters.
export const MAX_NAME_LENGTH = 60;
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

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
    // Quoted name: anything but a quote, so names with "/", "-", "(" ... work
    // ("Hämmer/Keulen", "Schwert (AT)"). Inserted automatically by the chat's
    // name picker, never needed for plain names.
    const quotedMatch = /^"([^"]+)"/.exec(rest);
    if (quotedMatch) {
      const name = normalizeName(quotedMatch[1]);
      if (name === '' || name.length > MAX_NAME_LENGTH) return null;
      toks.push({ t: 'id', v: name });
      i += quotedMatch[0].length;
      continue;
    }
    // Bare name: letters, and spaces BETWEEN letters ("Heilkunde Wunden").
    // Two names without an operator in between are never valid, so an inner
    // space is unambiguous.
    const idMatch = /^[A-Za-zÄÖÜäöüß]+(?: +[A-Za-zÄÖÜäöüß]+)*/.exec(rest);
    if (idMatch) {
      const name = normalizeName(idMatch[0]);
      if (name.length > MAX_NAME_LENGTH) return null;
      toks.push({ t: 'id', v: name });
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

// --- Wiederholen mit "*" ---
//
// `k*X`, wobei k eine GANZE ZAHL ab 1 ist (aus Zahlen und + - * / gebaut, ohne
// Namen und Würfel) und X einen Würfelblock enthält, heißt: X wird k-mal GEWÜRFELT
// und die Ergebnisse werden addiert. "2*2w6" sind zwei getrennte Würfe von 2w6
// (nicht ein Wurf, der verdoppelt wird), "3*(1w6+2)" dreimal (1w6+2). Dieselbe
// Regel wie bei einer Probe ("2*Athletik" = zweimal Athletik). Welche Ziffer
// zählt als Würfelzahl, entscheidet schon der Tokenizer: nur die Ziffern DIREKT
// vor "w"/"d" ("2*2w6": die erste 2 wiederholt, die zweite ist die Würfelzahl).
// Kein Würfel in X, ein Name als Faktor oder eine gebrochene Zahl bleiben
// gewöhnliche Multiplikation (z. B. "2*Athletik" in einer Würfelsumme, "1.5*1w6").
export const MAX_REPEAT = 20;

function constantValue(n: FormulaNode): number | null {
  switch (n.kind) {
    case 'num':
      return n.value;
    case 'neg': {
      const v = constantValue(n.operand);
      return v === null ? null : -v;
    }
    case 'bin': {
      const l = constantValue(n.left);
      if (l === null) return null;
      const r = constantValue(n.right);
      if (r === null) return null;
      switch (n.op) {
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
    default:
      return null;
  }
}

function containsDice(n: FormulaNode): boolean {
  switch (n.kind) {
    case 'dice':
      return true;
    case 'neg':
      return containsDice(n.operand);
    case 'bin':
      return containsDice(n.left) || containsDice(n.right);
    default:
      return false;
  }
}

/** The repeat a `*` node stands for, or null for an ordinary multiplication. */
export function repeatOf(n: FormulaNode): { count: number; operand: FormulaNode } | null {
  if (n.kind !== 'bin' || n.op !== '*') return null;
  const versuch = (faktor: FormulaNode, x: FormulaNode): { count: number; operand: FormulaNode } | null => {
    if (!containsDice(x)) return null;
    const c = constantValue(faktor);
    return c !== null && Number.isInteger(c) && c >= 1 && c <= MAX_REPEAT ? { count: c, operand: x } : null;
  };
  return versuch(n.left, n.right) ?? versuch(n.right, n.left);
}

/** Total individual dice rolled (repeats counted), and number of distinct dice blocks, across the whole tree. */
export function countDice(ast: FormulaNode): { totalDice: number; groups: number } {
  let totalDice = 0;
  let groups = 0;
  const walk = (n: FormulaNode, mult: number): void => {
    const rep = repeatOf(n);
    if (rep) {
      // Blocks are counted once, however often they repeat: the block limit is
      // about how many different dice an expression mixes, not how many dice roll.
      walk(rep.operand, mult * rep.count);
      return;
    }
    switch (n.kind) {
      case 'dice':
        totalDice += n.count * mult;
        groups += 1;
        return;
      case 'neg':
        walk(n.operand, mult);
        return;
      case 'bin':
        walk(n.left, mult);
        walk(n.right, mult);
        return;
      default:
        return;
    }
  };
  walk(ast, 1);
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
    const rep = repeatOf(n);
    if (rep) {
      for (let i = 0; i < rep.count; i++) walk(rep.operand);
      return;
    }
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

/**
 * One repetition of a `k*X` (see repeatOf): which of the rolled dice it used
 * (`start`, `n`, indices into the flat dice list) and what it came to. Only the
 * OUTERMOST repeats are recorded, so a card can show „Wurf 1, Wurf 2".
 */
export interface RepGroup {
  start: number;
  n: number;
  summe: number;
}

interface EvalCtx {
  resolveId: (name: string) => number | null;
  /** Unset in static (no-dice) mode — a DiceNode then fails evaluation. */
  rollDie?: (sides: number) => number;
  /** Rolled die faces, accumulated in encounter order as a side effect. */
  dice: number[];
  groups: RepGroup[];
  repDepth: number;
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
      const rep = repeatOf(node);
      if (rep) {
        // Roll the operand `count` times and add the results up.
        const aussen = ctx.repDepth === 0;
        ctx.repDepth += 1;
        let summe = 0;
        for (let i = 0; i < rep.count; i++) {
          const start = ctx.dice.length;
          const v = evalNode(rep.operand, ctx);
          if (v === null) {
            ctx.repDepth -= 1;
            return null;
          }
          summe += v;
          if (aussen) ctx.groups.push({ start, n: ctx.dice.length - start, summe: Math.ceil(v) });
        }
        ctx.repDepth -= 1;
        return summe;
      }
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
  const v = evalNode(ast, { resolveId, dice: [], groups: [], repDepth: 0 });
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
): { total: number; dice: number[]; groups: RepGroup[] } | null {
  const ctx: EvalCtx = { resolveId, rollDie, dice: [], groups: [], repDepth: 0 };
  const total = evalNode(ast, ctx);
  if (total === null || !Number.isFinite(total)) return null;
  // One repetition is not worth a row of its own (`1*2w6`).
  return { total: Math.ceil(total), dice: ctx.dice, groups: ctx.groups.length > 1 ? ctx.groups : [] };
}

const BARE_NAME = /^[A-Za-zÄÖÜäöüß]+(?: [A-Za-zÄÖÜäöüß]+)*$/;

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
        return BARE_NAME.test(n.name) ? n.name : `"${n.name}"`;
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

/** Every identifier in the tree, in encounter order, without duplicates. */
export function collectNames(ast: FormulaNode): string[] {
  const seen = new Set<string>();
  const walk = (n: FormulaNode): void => {
    switch (n.kind) {
      case 'id':
        seen.add(n.name);
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
  return [...seen];
}

/** Same tree with every identifier replaced by `fn(name)`, e.g. canonical display names. */
export function mapNames(ast: FormulaNode, fn: (name: string) => string): FormulaNode {
  switch (ast.kind) {
    case 'id':
      return { kind: 'id', name: fn(ast.name) };
    case 'neg':
      return { kind: 'neg', operand: mapNames(ast.operand, fn) };
    case 'bin':
      return { kind: 'bin', op: ast.op, left: mapNames(ast.left, fn), right: mapNames(ast.right, fn) };
    default:
      return ast;
  }
}

/** What a name stands for in a probe formula: how many d20s it brings and its target number. */
export interface ProbeTerm {
  n: number;
  probeZahl: number;
}

/**
 * One name's share of a probe formula, in the order its dice are rolled
 * (`2*Akrobatik` yields TWO parts). `name` is the identifier as written in the
 * formula; `probeZahl` is that part's own target after any division, rounded up.
 */
export interface ProbeFormulaPart {
  name: string;
  n: number;
  probeZahl: number;
}

export type ProbeFormulaResult =
  | { ok: true; n: number; probeZahl: number; parts: ProbeFormulaPart[] }
  | { ok: false; reason: 'shape' }
  | { ok: false; reason: 'unknown'; name: string };

interface RawPart {
  name: string;
  n: number;
  target: number;
}

interface ProbePart {
  value: number;
  n: number;
  parts: RawPart[];
  hasName: boolean;
}

// A name can be repeated at most this often: every name brings at least one
// d20 and a roll holds 20 dice at most, so more could never be rolled anyway,
// and this keeps a typed "1000000*Athletik" from allocating a huge list.
const MAX_PROBE_REPEAT = 20;

/**
 * A formula WITHOUT any dice block, built from probe names, is a probe: the
 * names' targets are combined arithmetically into one target, and one d20 is
 * rolled per attribute term the names stand for (attribute 1, talent 3, ...).
 * The whole formula is judged on its total (all dice against the combined
 * target); `parts` additionally lists every name with its own dice count and
 * target so a roll can show which part was over.
 *
 * `k*X` with a whole number k >= 1 means X k times, dice AND target:
 * `2*Athletik` is `Athletik+Athletik`. Constants with `+`/`-` only shift the
 * target. `/` by a constant scales the target of what stands to its left
 * (same dice). Names combine with `+`; never `name-name`, `name*name`,
 * `5/name`, a negated name, or a fractional/zero multiplier. `resolve` returns
 * null for an unknown name. Rounds the target up, like every other derived
 * value.
 */
export function evaluateProbeFormula(ast: FormulaNode, resolve: (name: string) => ProbeTerm | null): ProbeFormulaResult {
  let unknown: string | null = null;
  const walk = (node: FormulaNode): ProbePart | null => {
    switch (node.kind) {
      case 'num':
        return { value: node.value, n: 0, parts: [], hasName: false };
      case 'dice':
        return null;
      case 'id': {
        const term = resolve(node.name);
        if (!term) {
          unknown = node.name;
          return null;
        }
        return { value: term.probeZahl, n: term.n, parts: [{ name: node.name, n: term.n, target: term.probeZahl }], hasName: true };
      }
      case 'neg': {
        const v = walk(node.operand);
        return v && !v.hasName ? { value: -v.value, n: 0, parts: [], hasName: false } : null;
      }
      case 'bin': {
        const l = walk(node.left);
        const r = l && walk(node.right);
        if (!l || !r) return null;
        switch (node.op) {
          case '+':
            return { value: l.value + r.value, n: l.n + r.n, parts: [...l.parts, ...r.parts], hasName: l.hasName || r.hasName };
          case '-':
            return r.hasName ? null : { value: l.value - r.value, n: l.n, parts: l.parts, hasName: l.hasName };
          case '*': {
            if (l.hasName === r.hasName) return null; // name*name, or two constants (no name at all)
            const [count, X] = l.hasName ? [r.value, l] : [l.value, r];
            if (!Number.isInteger(count) || count < 1 || count > MAX_PROBE_REPEAT) return null;
            return {
              value: X.value * count,
              n: X.n * count,
              parts: Array.from({ length: count }, () => X.parts).flat(),
              hasName: true,
            };
          }
          case '/':
            if (r.hasName || r.value === 0) return null;
            return {
              value: l.value / r.value,
              n: l.n,
              parts: l.parts.map((p) => ({ ...p, target: p.target / r.value })),
              hasName: l.hasName,
            };
        }
      }
    }
  };
  const total = walk(ast);
  if (unknown !== null) return { ok: false, reason: 'unknown', name: unknown };
  if (!total || !total.hasName || total.n < 1 || !Number.isFinite(total.value)) return { ok: false, reason: 'shape' };
  return {
    ok: true,
    n: total.n,
    probeZahl: Math.ceil(total.value),
    parts: total.parts.map((p) => ({ name: p.name, n: p.n, probeZahl: Math.ceil(p.target) })),
  };
}
