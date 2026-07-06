import { describe, expect, it } from 'vitest';
import {
  computeBaseValues,
  computeResource,
  erleichterung,
  maximaleLast,
  mrErgebnis,
  probeExprZahl,
  schreibenProbe,
  sprechenProbe,
  talentProbeZahl,
  weaponProbes,
  wurfweiten,
} from '../src/rules.js';
import type { Attributes, BaseValueInputs, Resources } from '../src/types.js';

// Werte aus Raskir.xlsx (Heldenbrief)
const a = (akt: number, mod = 0) => ({ akt, mod });
const raskir: Attributes = {
  MU: a(16), KL: a(12), IN: a(15), CH: a(15),
  FF: a(16), GE: a(12), KO: a(44), KK: a(26), SO: a(10),
};

const raskirResources: Resources = {
  le: { permanent: 118, kauf: 63, kaufMax: 0, maxPlus: 135, aktuell: 238, besonderes: '0' },
  aus: { permanent: 39, kauf: 65, kaufMax: 0, maxPlus: 50, aktuell: 140, besonderes: '↑ Schmerz ↑' },
  ase: { permanent: 4, kauf: 0, kaufMax: 0, maxPlus: 0, aktuell: 0, besonderes: '' },
  mr: { permanent: 54, kauf: 0, kaufMax: 0, maxPlus: 0, aktuell: 0, besonderes: '' },
};

const raskirBaseInputs: BaseValueInputs = {
  mods: {
    at: 1, pa: 0, bl: 3, fk: 0, ini: -2, artefaktkontrolle: 5,
    todesschwelle: 2, wundschwelle: 5, ausweichen: 0, resilienz: 10, gs: 0,
  },
  gsBase: 8,
};

describe('Energien (Heldenbrief Zeilen 25-28)', () => {
  it('Lebensenergie: Vorergebnis 57, Ergebnis 238, Max 239', () => {
    const r = computeResource(raskir, 'le', raskirResources.le);
    expect(r.vorergebnis).toBe(57);
    expect(r.ergebnis).toBe(238);
    expect(r.max).toBe(239);
  });
  it('Ausdauer: Vorergebnis 36, Ergebnis 140, Max 142', () => {
    const r = computeResource(raskir, 'aus', raskirResources.aus);
    expect(r.vorergebnis).toBe(36);
    expect(r.ergebnis).toBe(140);
    expect(r.max).toBe(142);
  });
  it('Astralenergie: Vorergebnis 23, Ergebnis 27, Max 77', () => {
    const r = computeResource(raskir, 'ase', raskirResources.ase);
    expect(r.vorergebnis).toBe(23);
    expect(r.ergebnis).toBe(27);
    expect(r.max).toBe(77);
  });
  it('Magieresistenz: Vorergebnis 15, Ergebnis 69, kein Max', () => {
    const r = computeResource(raskir, 'mr', raskirResources.mr);
    expect(r.vorergebnis).toBe(15);
    expect(r.ergebnis).toBe(69);
    expect(r.max).toBeNull();
  });
});

describe('Basiswerte (Heldenbrief Zeilen 9-19)', () => {
  const mr = mrErgebnis(raskir, raskirResources);
  const bv = computeBaseValues(raskir, raskirBaseInputs, mr);

  it('Attacke-Basis 11 → Ergebnis 12', () => {
    expect(bv.at.base).toBe(11);
    expect(bv.at.ergebnis).toBe(12);
  });
  it('Parade-Basis 9', () => {
    expect(bv.pa.base).toBe(9);
    expect(bv.pa.ergebnis).toBe(9);
  });
  it('Blocken-Basis 17 → Ergebnis 20', () => {
    expect(bv.bl.base).toBe(17);
    expect(bv.bl.ergebnis).toBe(20);
  });
  it('Fernkampf-Basis 12', () => {
    expect(bv.fk.base).toBe(12);
    expect(bv.fk.ergebnis).toBe(12);
  });
  it('Initiative-Basis 12 → Ergebnis 10', () => {
    expect(bv.ini.base).toBe(12);
    expect(bv.ini.ergebnis).toBe(10);
  });
  it('Artefaktkontrolle 100 → Ergebnis 105', () => {
    expect(bv.artefaktkontrolle.base).toBe(100);
    expect(bv.artefaktkontrolle.ergebnis).toBe(105);
  });
  it('Todesschwelle 10 → Ergebnis 12', () => {
    expect(bv.todesschwelle.base).toBe(10);
    expect(bv.todesschwelle.ergebnis).toBe(12);
  });
  it('Wundschwelle 22 → Ergebnis 27', () => {
    expect(bv.wundschwelle.base).toBe(22);
    expect(bv.wundschwelle.ergebnis).toBe(27);
  });
  it('Ausweichen 13', () => {
    expect(bv.ausweichen.base).toBe(13);
  });
  it('Resilienz 21 → Ergebnis 31', () => {
    expect(bv.resilienz.base).toBe(21);
    expect(bv.resilienz.ergebnis).toBe(31);
  });
  it('Geschwindigkeit 8', () => {
    expect(bv.gs.ergebnis).toBe(8);
  });
});

describe('Talente', () => {
  it('Erleichterung = TaW/5 aufgerundet, negative TaW direkt', () => {
    expect(erleichterung(74)).toBe(15);
    expect(erleichterung(100)).toBe(20);
    expect(erleichterung(1)).toBe(1);
    expect(erleichterung(0)).toBe(0);
    expect(erleichterung(-3)).toBe(-3);
  });
  it('Athletik (GE/KO/KK, TaW 74) → Probe 97', () => {
    expect(talentProbeZahl(raskir, ['GE', 'KO', 'KK'], 74)).toBe(97);
  });
  it('Körperbeherrschung (KO/IN/GE, TaW 100) → Probe 91', () => {
    expect(talentProbeZahl(raskir, ['KO', 'IN', 'GE'], 100)).toBe(91);
  });
  it('Zechen (IN/KO/KK, TaW 25) → Probe 90', () => {
    expect(talentProbeZahl(raskir, ['IN', 'KO', 'KK'], 25)).toBe(90);
  });
  it('Einschüchtern (KK/IN/CH, TaW 35) → Probe 63', () => {
    expect(talentProbeZahl(raskir, ['KK', 'IN', 'CH'], 35)).toBe(63);
  });
});

describe('Waffen-Proben (Waffen Zeilen 7/9)', () => {
  const base = { at: 12, pa: 9, bl: 20 };
  it('Drachenturmschild (Großschilde AT4/PA10/BL56): AT 15, PA 15', () => {
    const p = weaponProbes({ at: 2, pa: 4, bl: 8 }, base, { at: 4, pa: 10, bl: 56 });
    expect(p.at).toBe(15);
    expect(p.pa).toBe(15);
    // Hinweis: Blatt zeigt BL 29 (nutzt dort versehentlich das Parade-Ergebnis);
    // kanonisch mit Blocken-Ergebnis 20: 8+20+12 = 40
    expect(p.bl).toBe(40);
  });
  it('Sühne (Hämmer/Keulen AT36/PA14/BL0): PA 13, BL 21', () => {
    const p = weaponProbes({ at: 5, pa: 1, bl: 1 }, base, { at: 36, pa: 14, bl: 0 });
    expect(p.pa).toBe(13);
    expect(p.bl).toBe(21);
  });
  it('AT-Deckel begrenzt die Angriffs-Probe (Schildträger: max 10)', () => {
    const p = weaponProbes({ at: 5, pa: 1, bl: 1, atMax: 10 }, base, { at: 36, pa: 14, bl: 0 });
    expect(p.at).toBe(10);
    // Deckel über dem Ergebnis ändert nichts
    expect(weaponProbes({ at: 5, pa: 1, bl: 1, atMax: 99 }, base, { at: 36, pa: 14, bl: 0 }).at).toBe(25);
    // Deckel 0 = kein Deckel
    expect(weaponProbes({ at: 5, pa: 1, bl: 1, atMax: 0 }, base, { at: 36, pa: 14, bl: 0 }).at).toBe(25);
  });
});

describe('Proben-Ausdrücke (Zauber-Blatt)', () => {
  it('"KO+KO+KO" → 132', () => {
    expect(probeExprZahl(raskir, 'KO+KO+KO')).toBe(132);
  });
  it('"FF+FF" → 32', () => {
    expect(probeExprZahl(raskir, 'FF+FF')).toBe(32);
  });
  it('"CH+CH" → 30', () => {
    expect(probeExprZahl(raskir, 'CH+CH')).toBe(30);
  });
  it('"FF+KO+KK+GE" → 98 (Gegenhalten)', () => {
    expect(probeExprZahl(raskir, 'FF+KO+KK+GE')).toBe(98);
  });
  it('nicht parsebare Ausdrücke → null', () => {
    expect(probeExprZahl(raskir, 'GE, dann Schild-BL')).toBeNull();
    expect(probeExprZahl(raskir, 'Athletik')).toBeNull();
  });
});

describe('Sprachen-Proben', () => {
  it('Sprechen (KL+IN+CH) → 42', () => {
    expect(sprechenProbe(raskir)).toBe(42);
  });
  it('Lesen/Schreiben (KL+KL+FF) → 40', () => {
    expect(schreibenProbe(raskir)).toBe(40);
  });
});

describe('Gewicht & Sonstiges', () => {
  it('Maximale Last = ((KO+KK)*2)*1.5 → 210', () => {
    expect(maximaleLast(raskir)).toBe(210);
  });
  it('Wurfhöhe zu Wurfweite: 13, 7, 4, 2', () => {
    expect(wurfweiten(raskir)).toEqual([13, 7, 4, 2]);
  });
});
