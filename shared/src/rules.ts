import type {
  AttrCode,
  Attributes,
  BaseValueInputs,
  BaseValueKey,
  ExternalAttrPoint,
  ResourceInput,
  ResourceKey,
  Resources,
} from './types.js';
import { ATTR_ROW_CODES } from './types.js';

const ceil = Math.ceil;

export function attrMax(attrs: Attributes, code: AttrCode | 'SO'): number {
  const a = attrs[code];
  return (a?.akt ?? 0) + (a?.mod ?? 0);
}

// --- Basiswerte (Heldenbrief H-Spalte) ---

export interface BaseValueResult {
  base: number;
  mod: number;
  ergebnis: number;
}

export function computeBaseValueBases(attrs: Attributes, inputs: BaseValueInputs): Record<BaseValueKey, number> {
  const v = (c: AttrCode) => attrMax(attrs, c);
  const wundschwelle = ceil(v('KO') / 2);
  const wundschwelleErgebnis = wundschwelle + (inputs.mods.wundschwelle ?? 0);

  // Die MR ist Eingang für Artefaktkontrolle und Resilienz und muss deshalb
  // zuerst fertig gerechnet sein (Basis + Rassenbonus + eigener Modifikator).
  const mr = ceil((v('MU') + v('KL') + v('KO')) / 5) + (inputs.mrBase ?? 0);
  const mrErgebnis = mr + (inputs.mods.mr ?? 0);

  return {
    at: ceil((v('MU') + v('GE') + v('KK')) / 5),
    pa: ceil((v('IN') + v('GE') + v('FF')) / 5),
    bl: ceil((v('KO') + v('KK') + v('IN')) / 5),
    fk: ceil((v('IN') + v('FF') + v('KK')) / 5),
    ini: ceil((v('MU') + v('MU') + v('IN') + v('GE')) / 5),
    artefaktkontrolle: v('IN') + mrErgebnis + v('MU') + (inputs.akBase ?? 0),
    todesschwelle: ceil((wundschwelleErgebnis + v('MU')) / 4),
    wundschwelle,
    ausweichen: ceil((v('GE') + v('GE') + v('IN')) / 3),
    resilienz: ceil((v('MU') + v('MU') + mrErgebnis) / 5) + (inputs.resilienzBase ?? 0),
    mr,
    gs: inputs.gsBase,
  };
}

export function computeBaseValues(attrs: Attributes, inputs: BaseValueInputs): Record<BaseValueKey, BaseValueResult> {
  const bases = computeBaseValueBases(attrs, inputs);
  const out = {} as Record<BaseValueKey, BaseValueResult>;
  for (const key of Object.keys(bases) as BaseValueKey[]) {
    const mod = inputs.mods[key] ?? 0;
    out[key] = { base: bases[key], mod, ergebnis: bases[key] + mod };
  }
  return out;
}

// --- Energien (LE, AUS, AsE) ---

export interface ResourceResult {
  vorergebnis: number;
  /** Rechnerische Summe aus Formelwert + Gewährt + Gekauft — ungekappt. */
  ergebnis: number;
  /** Ausbaugrenze: so hoch kann das Maximum überhaupt steigen. */
  max: number | null;
  /**
   * Das tatsächlich nutzbare Maximum: `ergebnis`, an der Ausbaugrenze gekappt.
   * Die Rohsumme bleibt daneben erhalten — sie ist die Buchführung darüber, was
   * eingetragen wurde, und darf nicht stillschweigend verschwinden. Angezeigt
   * wird `nutzbar`, und wo gekappt wurde, zusätzlich die Rohsumme.
   */
  nutzbar: number;
  /** true, wenn die Rohsumme über der Ausbaugrenze liegt. */
  gekappt: boolean;
}

export function computeResourceVorergebnis(attrs: Attributes, key: ResourceKey): number {
  const v = (c: AttrCode) => attrMax(attrs, c);
  switch (key) {
    case 'le':
      return ceil((v('KO') + v('KO') + v('KK')) / 2);
    case 'aus':
      return ceil((v('MU') + v('GE') + v('KO')) / 2);
    case 'ase':
      return ceil((v('MU') + v('IN') + v('CH')) / 2);
  }
}

export function computeResource(attrs: Attributes, key: ResourceKey, input: ResourceInput): ResourceResult {
  const v = (c: AttrCode) => attrMax(attrs, c);
  // Rassenbonus (races_catalog.le/.au/.ae) ist ein normaler Bonus auf Maximum
  // und Ausbaugrenze, kein Bestandteil des Formelwerts — anders als
  // resilienzBase bei den Basiswerten fließt er NICHT in vor/Formelwert ein.
  const vor = computeResourceVorergebnis(attrs, key);
  const raceBase = input.raceBase ?? 0;
  const ergebnis = vor + raceBase + input.permanent + input.kauf;
  let max: number | null = null;
  switch (key) {
    case 'le':
      max = ceil(vor + raceBase + (v('KK') + v('KO')) / 1.5 + input.kaufMax + input.maxPlus);
      break;
    case 'aus':
      max = vor + raceBase + (v('KO') + v('GE')) + input.kaufMax + input.maxPlus;
      break;
    case 'ase':
      max = vor + raceBase + (v('CH') + v('KL')) * 2 + input.kaufMax + input.maxPlus;
      break;
  }
  const nutzbar = max === null ? ergebnis : Math.min(ergebnis, max);
  return { vorergebnis: vor, ergebnis, max, nutzbar, gekappt: nutzbar < ergebnis };
}

// --- Talente ---

// Erleichterung: TaW/5 aufgerundet (negativer TaW zählt direkt)
export function erleichterung(taw: number): number {
  return taw > 0 ? ceil(taw / 5) : taw;
}

// Probe (Zahl) für normale Talente: Summe der drei Probenattribute + Erleichterung
export function talentProbeZahl(attrs: Attributes, probe: [AttrCode, AttrCode, AttrCode], taw: number): number {
  return attrMax(attrs, probe[0]) + attrMax(attrs, probe[1]) + attrMax(attrs, probe[2]) + erleichterung(taw);
}

// --- Waffen-Proben ---
// Probe = Waffen-Modifikator + Heldenbrief-Ergebnis + (Kampftalent-Spalte / 5, aufgerundet)
export interface WeaponTalentSplit {
  at: number;
  pa: number;
  bl: number;
}

export function weaponProbe(weaponMod: number, baseErgebnis: number, talentSplitValue: number): number {
  return ceil(weaponMod + baseErgebnis + ceil(talentSplitValue / 5));
}

export function weaponProbes(
  weapon: { at: number; pa: number; bl: number },
  base: { at: number; pa: number; bl: number },
  talent: WeaponTalentSplit,
): WeaponTalentSplit {
  return {
    at: weaponProbe(weapon.at, base.at, talent.at),
    pa: weaponProbe(weapon.pa, base.pa, talent.pa),
    bl: weaponProbe(weapon.bl, base.bl, talent.bl),
  };
}

// --- Techniken / Zauber: Probenausdrücke wie "KO+KO+KO" oder "FF+FF" ---
//
// Fähigkeiten dürfen zusätzlich AT/PA/BL als Term führen (z. B. "KK+AT") —
// die fertige Probe der Waffe, mit der gerade gekämpft wird, statt eines
// Attributs. Welche Waffe das ist (oder Unbewaffnet), wählt der Spieler erst
// beim Würfeln (siehe ProbeSource 'ability' in diceProtocol.ts); ohne diese
// Wahl lässt sich der Ausdruck nicht auf eine Zahl reduzieren — deshalb bleibt
// `probeExprZahl` (rein attributbasiert) für diesen Fall bei `null`, und nur
// eine Stelle, die die Waffe schon kennt (siehe `abilityProbeZahl`), rechnet
// wirklich fertig.

const ATTR_SET = new Set(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
const WEAPON_PROBE_CODES = new Set(['AT', 'PA', 'BL']);
export type WeaponProbeCode = 'AT' | 'PA' | 'BL';
export type ProbeExprToken = AttrCode | WeaponProbeCode;

function isWeaponProbeCode(p: string): p is WeaponProbeCode {
  return WEAPON_PROBE_CODES.has(p);
}

export function parseProbeExpr(expr: string): ProbeExprToken[] | null {
  const parts = expr.split('+').map((p) => p.trim().toUpperCase());
  if (parts.length === 0 || !parts.every((p) => ATTR_SET.has(p) || isWeaponProbeCode(p))) return null;
  return parts as ProbeExprToken[];
}

export function probeExprHasWeaponTerm(expr: string): boolean {
  const parts = parseProbeExpr(expr);
  return !!parts && parts.some((p) => isWeaponProbeCode(p));
}

// Rein attributbasiert — liefert `null` sowohl bei einem ungültigen Ausdruck
// als auch, wenn er einen AT/PA/BL-Term enthält (dafür fehlt hier die Waffe).
export function probeExprZahl(attrs: Attributes, expr: string): number | null {
  const parts = parseProbeExpr(expr);
  if (!parts || parts.some((p) => isWeaponProbeCode(p))) return null;
  return parts.reduce((sum, c) => sum + attrMax(attrs, c as AttrCode), 0);
}

// Fertige Fähigkeiten-Probe inklusive AT/PA/BL-Term(en) — `weapon` ist die
// bereits fertig gerechnete Probe der gewählten Waffe (oder von Raufen/Ringen
// bei Unbewaffnet, siehe diceSource.ts), `null` nur zulässig, wenn der
// Ausdruck gar keinen Waffen-Term enthält.
export function abilityProbeZahl(
  attrs: Attributes,
  expr: string,
  weapon: { at: number; pa: number; bl: number } | null,
): number | null {
  const parts = parseProbeExpr(expr);
  if (!parts) return null;
  let sum = 0;
  for (const p of parts) {
    if (isWeaponProbeCode(p)) {
      if (!weapon) return null;
      sum += weapon[p.toLowerCase() as 'at' | 'pa' | 'bl'];
    } else {
      sum += attrMax(attrs, p);
    }
  }
  return sum;
}

// --- Sprachen ---

export function sprechenProbe(attrs: Attributes): number {
  return attrMax(attrs, 'KL') + attrMax(attrs, 'IN') + attrMax(attrs, 'CH');
}

export function schreibenProbe(attrs: Attributes): number {
  return attrMax(attrs, 'KL') + attrMax(attrs, 'KL') + attrMax(attrs, 'FF');
}

// --- Inventar / Gewicht ---

export function maximaleLast(attrs: Attributes): number {
  return (attrMax(attrs, 'KO') + attrMax(attrs, 'KK')) * 2;
}

export function gGewicht(anzahl: number, eGewicht: number): number {
  return anzahl * eGewicht;
}

// --- Stufen-Ableitung aus Abenteuerpunkten (LVLUP-Tabelle) ---

// Stufe 50 ist die Obergrenze; darüber hinaus gesammelte AP erhöhen die Stufe nicht mehr.
export const MAX_LEVEL = 50;

// Kumulierte AP-Schwelle, um eine Stufe zu erreichen: EPges(L) = 75·(L−1)·L
export function apThresholdForLevel(level: number): number {
  return 75 * (level - 1) * level;
}

// Höchste Stufe, deren Schwelle ≤ den Abenteuerpunkten ist (gedeckelt bei MAX_LEVEL).
export function levelForAp(ap: number): number {
  if (ap <= 0) return 1;
  // Geschlossene Näherung, danach gegen Rundungsfehler korrigiert.
  let level = Math.max(1, Math.floor(0.5 + Math.sqrt(5625 + 300 * ap) / 150));
  while (level < MAX_LEVEL && apThresholdForLevel(level + 1) <= ap) level++;
  while (level > 1 && apThresholdForLevel(level) > ap) level--;
  return Math.min(level, MAX_LEVEL);
}

// AP-Schwelle für die nächste Stufe, oder null, wenn Stufe 50 bereits erreicht ist.
export function nextLevelAp(ap: number): number | null {
  const level = levelForAp(ap);
  if (level >= MAX_LEVEL) return null;
  return apThresholdForLevel(level + 1);
}

// --- Attributspunkte: theoretisch verfügbar vs. tatsächlich gesetzt ---

// Baseline auf Stufe 1: 9 Punkte je Attributzeile (8 Attribute + Sozialstatus) = 81.
// Je weitere Stufe kommt automatisch 1 Punkt hinzu (retrotraceable aus der Stufe).
export const ATTR_POINTS_BASELINE = 81;

export function attrPointsFromLevel(level: number): number {
  return ATTR_POINTS_BASELINE + Math.max(0, level - 1);
}

export function attrPointsTheoreticalTotal(level: number, external: ExternalAttrPoint[]): number {
  const externalSum = external.reduce((sum, e) => sum + (Number(e.punkte) || 0), 0);
  return attrPointsFromLevel(level) + externalSum;
}

// Summe aller `akt`-Werte über die Attributzeilen (MU..KK + SO) — `mod` zählt
// nicht mit, das ist kein dauerhaft investierter Punkt.
export function attrPointsActualTotal(attrs: Attributes): number {
  return ATTR_ROW_CODES.reduce((sum, code) => sum + (attrs[code]?.akt ?? 0), 0);
}

// --- Sonstiges ---

export function psycheProzent(akt: number, max: number): number | null {
  if (!max) return null;
  return (akt / max) * 100;
}

// Psyche-Maximum: Rassengrundwert + optionaler Bonus + fünf Punkte je MU-Punkt
// über zehn ("Rassengrundwert plus fünf Punkte pro Punkt über zehn in Mut").
// Anders als LE/AUS/AsE hat die Psyche KEINE Ausbaugrenze. Der Rassengrundwert
// kommt vorerst manuell vom Spieler; künftig könnte ihn ein Rassen-Katalog liefern.
export function psycheMuAnteil(attrs: Attributes): number {
  return 5 * Math.max(0, attrMax(attrs, 'MU') - 10);
}

export function psycheMax(attrs: Attributes, base: number, bonus: number): number {
  return base + bonus + psycheMuAnteil(attrs);
}

// Wurfhöhe → Wurfweite: 1m = KK/2 aufgerundet, jede weitere Stufe halbiert
export function wurfweiten(attrs: Attributes, stufen = 4): number[] {
  const out: number[] = [];
  let w = ceil(attrMax(attrs, 'KK') / 2);
  for (let i = 0; i < stufen; i++) {
    out.push(w);
    w = ceil(w / 2);
  }
  return out;
}

// --- Spezialenergien-Katalog: Formel-Maxima ---
//
// Anders als parseProbeExpr (nur `+`, feste Attribut-/Waffen-Codes) brauchen
// die GM-Formeln für Spezialenergien echte Arithmetik (+ - * / Klammern) über
// einem größeren Variablensatz: die acht Attribute UND die bereits berechneten
// Maxima von LE/AUS/AsE/Psyche (Aliase Lp/Adp/Asp/Psyche — GM-Sprache, siehe
// server/data/specialEnergies.json). Deshalb ein eigener kleiner Parser statt
// parseProbeExpr zu verbiegen; beide bleiben unabhängig.
export interface EnergyFormulaVars {
  attrs: Attributes;
  /** Nutzbares Maximum (Resources[key].nutzbar), NICHT die rohe Ausbaugrenze. */
  leMax: number;
  auMax: number;
  aseMax: number;
  psycheMax: number;
}

type EnergyToken = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenizeEnergyFormula(expr: string): EnergyToken[] | null {
  const toks: EnergyToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ('+-*/()'.includes(c)) {
      toks.push({ t: 'op', v: c as '+' | '-' | '*' | '/' | '(' | ')' });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const v = Number(expr.slice(i, j));
      if (Number.isNaN(v)) return null;
      toks.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[A-Za-zÄÖÜäöü]/.test(c)) {
      let j = i;
      while (j < expr.length && /[A-Za-zÄÖÜäöü]/.test(expr[j])) j++;
      toks.push({ t: 'id', v: expr.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    return null;
  }
  return toks;
}

// Rekursiver Abstieg statt Shunting-Yard, weil die Grammatik winzig bleibt:
// Summe → Produkt (('+'|'-') Produkt)*, Produkt → Primär (('*'|'/') Primär)*,
// Primär → Zahl | Bezeichner | '(' Summe ')' | '-' Primär (unäres Minus).
function parseEnergyAst(toks: EnergyToken[], resolve: (id: string) => number | null): number | null {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.t === 'num') {
      next();
      return t.v;
    }
    if (t.t === 'id') {
      next();
      return resolve(t.v);
    }
    if (t.t === 'op' && t.v === '(') {
      next();
      const v = sum();
      const close = next();
      if (v === null || !close || close.t !== 'op' || close.v !== ')') return null;
      return v;
    }
    if (t.t === 'op' && t.v === '-') {
      next();
      const v = primary();
      return v === null ? null : -v;
    }
    return null;
  }

  function product(): number | null {
    let v = primary();
    if (v === null) return null;
    for (let t = peek(); t && t.t === 'op' && (t.v === '*' || t.v === '/'); t = peek()) {
      next();
      const rhs = primary();
      if (rhs === null) return null;
      v = t.v === '*' ? v * rhs : v / rhs;
    }
    return v;
  }

  function sum(): number | null {
    let v = product();
    if (v === null) return null;
    for (let t = peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = peek()) {
      next();
      const rhs = product();
      if (rhs === null) return null;
      v = t.v === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = sum();
  return pos === toks.length ? result : null;
}

const ENERGY_ATTR_ALIASES = new Set(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
// GM-Kürzel aus dem Ursprungsdokument (server/data/specialEnergies.json), nicht
// die Attribut-Codes: Lp=LE, Adp=Ausdauer, Asp=Astralenergie.
const ENERGY_POOL_ALIASES: Record<string, keyof Omit<EnergyFormulaVars, 'attrs'>> = {
  LP: 'leMax',
  LE: 'leMax',
  ADP: 'auMax',
  AU: 'auMax',
  ASP: 'aseMax',
  ASE: 'aseMax',
  PSYCHE: 'psycheMax',
};

// Wertet eine GM-Formel (z. B. "(KO+KK)/4", "Asp/8") aus, `null` bei leerer
// oder unbekannter Formel/Variable. Rundet am Ende AUF (wie MR/Resilienz/AK) —
// eine einzige Stelle statt pro Division, damit Rundungsfehler sich nicht
// aufschaukeln.
export function evaluateEnergyFormula(formula: string, vars: EnergyFormulaVars): number | null {
  const trimmed = formula.trim();
  if (!trimmed) return null;
  const toks = tokenizeEnergyFormula(trimmed);
  if (!toks || toks.length === 0) return null;
  const resolve = (id: string): number | null => {
    if (ENERGY_ATTR_ALIASES.has(id)) return attrMax(vars.attrs, id as AttrCode);
    const poolKey = ENERGY_POOL_ALIASES[id];
    return poolKey ? vars[poolKey] : null;
  };
  const result = parseEnergyAst(toks, resolve);
  return result === null ? null : ceil(result);
}
