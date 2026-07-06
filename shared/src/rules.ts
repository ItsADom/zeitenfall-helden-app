import type {
  AttrCode,
  Attributes,
  BaseValueInputs,
  BaseValueKey,
  ResourceInput,
  ResourceKey,
  Resources,
} from './types.js';

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

export function computeBaseValueBases(attrs: Attributes, mrErgebnis: number, gsBase: number): Record<BaseValueKey, number> {
  const v = (c: AttrCode) => attrMax(attrs, c);
  const wundschwelle = ceil(v('KO') / 2);
  return {
    at: ceil((v('MU') + v('GE') + v('KK')) / 5),
    pa: ceil((v('IN') + v('GE') + v('FF')) / 5),
    bl: ceil((v('KO') + v('KK') + v('IN')) / 5),
    fk: ceil((v('IN') + v('FF') + v('KK')) / 5),
    ini: ceil((v('MU') + v('MU') + v('IN') + v('GE')) / 5),
    artefaktkontrolle: v('IN') + mrErgebnis + v('MU'),
    todesschwelle: ceil((wundschwelle + v('MU')) / 4),
    wundschwelle,
    ausweichen: ceil((v('GE') + v('GE') + v('IN')) / 3),
    resilienz: ceil((v('MU') + v('MU') + mrErgebnis) / 5),
    gs: gsBase,
  };
}

export function computeBaseValues(attrs: Attributes, inputs: BaseValueInputs, mrErgebnis: number): Record<BaseValueKey, BaseValueResult> {
  const bases = computeBaseValueBases(attrs, mrErgebnis, inputs.gsBase);
  const out = {} as Record<BaseValueKey, BaseValueResult>;
  for (const key of Object.keys(bases) as BaseValueKey[]) {
    const mod = inputs.mods[key] ?? 0;
    out[key] = { base: bases[key], mod, ergebnis: bases[key] + mod };
  }
  return out;
}

// --- Energien (LE, AUS, AsE, MR) ---

export interface ResourceResult {
  vorergebnis: number;
  ergebnis: number;
  max: number | null; // MR hat kein Maximum
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
    case 'mr':
      return ceil((v('MU') + v('KL') + v('KO')) / 5);
  }
}

export function computeResource(attrs: Attributes, key: ResourceKey, input: ResourceInput): ResourceResult {
  const v = (c: AttrCode) => attrMax(attrs, c);
  const vor = computeResourceVorergebnis(attrs, key);
  const ergebnis = vor + input.permanent + input.kauf;
  let max: number | null = null;
  switch (key) {
    case 'le':
      max = ceil(vor + (v('KK') + v('KO')) / 1.5 + input.kaufMax + input.maxPlus);
      break;
    case 'aus':
      max = vor + (v('KO') + v('GE')) + input.kaufMax + input.maxPlus;
      break;
    case 'ase':
      max = vor + (v('CH') + v('KL')) * 2 + input.kaufMax + input.maxPlus;
      break;
    case 'mr':
      max = null;
      break;
  }
  return { vorergebnis: vor, ergebnis, max };
}

export function mrErgebnis(attrs: Attributes, resources: Resources): number {
  return computeResource(attrs, 'mr', resources.mr).ergebnis;
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

// atMax > 0 deckelt die Angriffs-Probe (z. B. Nachteil „Schildträger: AT maximal 10")
export function weaponProbes(
  weapon: { at: number; pa: number; bl: number; atMax?: number },
  base: { at: number; pa: number; bl: number },
  talent: WeaponTalentSplit,
): WeaponTalentSplit {
  const at = weaponProbe(weapon.at, base.at, talent.at);
  return {
    at: weapon.atMax && weapon.atMax > 0 ? Math.min(at, weapon.atMax) : at,
    pa: weaponProbe(weapon.pa, base.pa, talent.pa),
    bl: weaponProbe(weapon.bl, base.bl, talent.bl),
  };
}

// --- Techniken / Zauber: Probenausdrücke wie "KO+KO+KO" oder "FF+FF" ---

const ATTR_SET = new Set(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);

export function parseProbeExpr(expr: string): AttrCode[] | null {
  const parts = expr.split('+').map((p) => p.trim().toUpperCase());
  if (parts.length === 0 || !parts.every((p) => ATTR_SET.has(p))) return null;
  return parts as AttrCode[];
}

export function probeExprZahl(attrs: Attributes, expr: string): number | null {
  const parts = parseProbeExpr(expr);
  if (!parts) return null;
  return parts.reduce((sum, c) => sum + attrMax(attrs, c), 0);
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
  return (attrMax(attrs, 'KO') + attrMax(attrs, 'KK')) * 2 * 1.5;
}

export function gGewicht(anzahl: number, eGewicht: number): number {
  return anzahl * eGewicht;
}

// --- Sonstiges ---

export function psycheProzent(akt: number, max: number): number | null {
  if (!max) return null;
  return (akt / max) * 100;
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
