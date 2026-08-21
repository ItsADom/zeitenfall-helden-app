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
    todesschwelle: ceil((wundschwelle + v('MU')) / 4),
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
  // Rassenbonus (races_catalog.le/.au/.ae) fließt wie ein Attributbonus direkt
  // in den Formelwert ein — hebt damit auch die Ausbaugrenze mit an, analog zu
  // resilienzBase bei den Basiswerten.
  const vor = computeResourceVorergebnis(attrs, key) + (input.raceBase ?? 0);
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
