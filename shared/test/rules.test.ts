import { describe, expect, it } from 'vitest';
import {
  apThresholdForLevel,
  computeBaseValues,
  computeResource,
  erleichterung,
  evaluateEnergyFormula,
  levelForAp,
  MAX_LEVEL,
  maximaleLast,
  nextLevelAp,
  probeExprZahl,
  psycheMax,
  psycheMuAnteil,
  schreibenProbe,
  sprechenProbe,
  talentProbeZahl,
  weaponProbes,
  wurfweiten,
} from '../src/rules.js';
import type { EnergyFormulaVars } from '../src/rules.js';
import { BASE_VALUE_LABELS, RESOURCE_LABELS } from '../src/types.js';
import type { AttrCode, Attributes, BaseValueInputs, BaseValueKey, ResourceKey, Resources } from '../src/types.js';
import reference from './reference.json';

// Alle Referenzwerte (Formeln + erwartete Ergebnisse) stehen in reference.json.
// Neue Fälle dort ergänzen — hier wird nur darüber iteriert.
const raskir = reference.charakter.attribute as Attributes;
const raskirResources = reference.charakter.energienEingaben as Resources;
const raskirBaseInputs = reference.charakter.basiswerteEingaben as BaseValueInputs;

describe('Energien', () => {
  for (const e of reference.energien) {
    it(`${e.label}: Vorergebnis ${e.vorergebnis}, Ergebnis ${e.ergebnis}, Max ${e.max ?? 'kein'}`, () => {
      const r = computeResource(raskir, e.key as ResourceKey, raskirResources[e.key as ResourceKey]);
      expect(r.vorergebnis).toBe(e.vorergebnis);
      expect(r.ergebnis).toBe(e.ergebnis);
      expect(r.max).toBe(e.max);
    });
    it(`${e.label}: Formel in der App entspricht der Referenz`, () => {
      expect(RESOURCE_LABELS[e.key as ResourceKey].formel).toBe(e.formel);
    });
  }

  // Die Referenzwerte liegen alle unter der Ausbaugrenze — die Kappung wird
  // deshalb eigens geprüft.
  describe('Kappung an der Ausbaugrenze', () => {
    it('unterhalb der Ausbaugrenze bleibt die Rohsumme unangetastet', () => {
      const r = computeResource(raskir, 'ase', raskirResources.ase);
      expect(r.ergebnis).toBe(27);
      expect(r.max).toBe(77);
      expect(r.nutzbar).toBe(27);
      expect(r.gekappt).toBe(false);
    });

    it('genau auf der Ausbaugrenze gilt noch nicht als gekappt', () => {
      // ase: Vorergebnis 23, Ausbaugrenze 77 → permanent 54 trifft sie genau
      const r = computeResource(raskir, 'ase', { ...raskirResources.ase, permanent: 54 });
      expect(r.ergebnis).toBe(77);
      expect(r.nutzbar).toBe(77);
      expect(r.gekappt).toBe(false);
    });

    it('über der Ausbaugrenze wird gekappt, die Rohsumme bleibt erhalten', () => {
      const r = computeResource(raskir, 'ase', { ...raskirResources.ase, permanent: 100 });
      expect(r.ergebnis).toBe(123);
      expect(r.max).toBe(77);
      expect(r.nutzbar).toBe(77);
      expect(r.gekappt).toBe(true);
    });

    it('Kauf-Max hebt die Ausbaugrenze und damit die Kappung', () => {
      const input = { ...raskirResources.ase, permanent: 100, kaufMax: 50 };
      const r = computeResource(raskir, 'ase', input);
      expect(r.max).toBe(127);
      expect(r.nutzbar).toBe(123);
      expect(r.gekappt).toBe(false);
    });
  });

  describe('Rassenbonus', () => {
    it('hebt Ergebnis und Ausbaugrenze an, aber nicht den Formelwert (Vorergebnis)', () => {
      const r = computeResource(raskir, 'ase', { ...raskirResources.ase, raceBase: 10 });
      expect(r.vorergebnis).toBe(23);
      expect(r.ergebnis).toBe(37);
      expect(r.max).toBe(87);
    });
  });
});

describe('Basiswerte', () => {
  const bv = computeBaseValues(raskir, raskirBaseInputs);

  for (const b of reference.basiswerte) {
    it(`${b.label}: Basis ${b.base} → Ergebnis ${b.ergebnis}`, () => {
      const key = b.key as BaseValueKey;
      expect(bv[key].base).toBe(b.base);
      expect(bv[key].ergebnis).toBe(b.ergebnis);
    });
    it(`${b.label}: Formel in der App entspricht der Referenz`, () => {
      expect(BASE_VALUE_LABELS[b.key as BaseValueKey].formel).toBe(b.formel);
    });
  }
});

describe('Psyche', () => {
  // Raskir hat MU 16 → MU-Anteil = 5·(16−10) = 30.
  it('MU-Anteil: fünf Punkte je MU-Punkt über zehn', () => {
    expect(psycheMuAnteil(raskir)).toBe(30);
  });
  it('MU-Anteil kappt bei zehn nach unten (kein negativer Anteil)', () => {
    const schwach: Attributes = { ...raskir, MU: { akt: 8, mod: 0 } };
    expect(psycheMuAnteil(schwach)).toBe(0);
  });
  it('Maximum = Rassengrundwert + Bonus + MU-Anteil', () => {
    expect(psycheMax(raskir, 20, 5)).toBe(55);
  });
  it('Maximum ohne Bonus/Rassenwert ist nur der MU-Anteil', () => {
    expect(psycheMax(raskir, 0, 0)).toBe(30);
  });
});

describe('Spezialenergien-Formeln (special_energies_catalog)', () => {
  // Raskir: MU 16, KL 12, IN 15, CH 15, FF 16, GE 12, KO 44, KK 26 (reference.json).
  // Pool-Maxima frei gewählt, um Lp/Adp/Asp/Psyche unabhängig von den echten
  // Ressourcen-Formeln zu prüfen.
  const vars: EnergyFormulaVars = { attrs: raskir, leMax: 10, auMax: 20, aseMax: 30, psycheMax: 40 };

  const faelle: [string, number | null][] = [
    ['(KO+KK)/2', 35], // Gift: (44+26)/2 = 35
    ['(KO+KK)/4', 18], // Sporen: 70/4 = 17.5 → aufgerundet 18
    ['(MU+MU+CH)/3', 16], // Wut: 47/3 = 15,66… → aufgerundet 16
    ['(KO+KO+KK)/3', 38], // Wärme: 114/3 = 38
    ['(CH+MU+KL)/3', 15], // Fluchkraft: 43/3 = 14,33… → aufgerundet 15
    ['Psyche*2', 80], // Angst
    ['Asp/8', 4], // Antimagie: 30/8 = 3,75 → aufgerundet 4
    ['Lp*2', 20], // Blut
    ['(ADP+MU+KL)/2', 24], // Chakra: (20+16+12)/2 = 24
    ['(ASP+MU+CH)/4', 16], // Chi: 61/4 = 15,25 → aufgerundet 16
    ['(KO+KK+ADP)/3', 30], // Brutmenge/zustand: 90/3 = 30
    ['', null], // manuelle Katalog-Einträge haben keine Formel
    ['   ', null],
    ['FOO', null], // unbekannte Variable
    ['(KO+', null], // kaputte Klammer
    ['KO*', null], // fehlender rechter Operand
  ];

  for (const [formula, erwartet] of faelle) {
    it(`"${formula || '(leer)'}" → ${erwartet ?? 'null'}`, () => {
      expect(evaluateEnergyFormula(formula, vars)).toBe(erwartet);
    });
  }
});

describe('Talente', () => {
  it(`Erleichterung (${reference.erleichterung.formel})`, () => {
    for (const f of reference.erleichterung.faelle) {
      expect(erleichterung(f.taw)).toBe(f.erwartet);
    }
  });

  for (const t of reference.talentProben) {
    it(`${t.name} (${t.probe.join('/')}, TaW ${t.taw}) → Probe ${t.erwartet}`, () => {
      expect(talentProbeZahl(raskir, t.probe as [AttrCode, AttrCode, AttrCode], t.taw)).toBe(t.erwartet);
    });
  }
});

describe('Waffen-Proben', () => {
  const base = reference.waffen.basis;

  for (const w of reference.waffen.faelle) {
    it(`${w.name}`, () => {
      const p = weaponProbes(w.waffe, base, w.talent);
      const erwartet = w.erwartet as Partial<Record<'at' | 'pa' | 'bl', number>>;
      for (const [feld, wert] of Object.entries(erwartet)) {
        expect(p[feld as 'at' | 'pa' | 'bl']).toBe(wert);
      }
    });
  }
});

describe('Proben-Ausdrücke', () => {
  for (const p of reference.probeAusdruecke) {
    it(`"${p.ausdruck}" → ${p.erwartet ?? 'null'}`, () => {
      expect(probeExprZahl(raskir, p.ausdruck)).toBe(p.erwartet);
    });
  }
});

describe('Sprachen-Proben', () => {
  it(`Sprechen (${reference.sprachen.sprechen.formel}) → ${reference.sprachen.sprechen.erwartet}`, () => {
    expect(sprechenProbe(raskir)).toBe(reference.sprachen.sprechen.erwartet);
  });
  it(`Lesen/Schreiben (${reference.sprachen.schreiben.formel}) → ${reference.sprachen.schreiben.erwartet}`, () => {
    expect(schreibenProbe(raskir)).toBe(reference.sprachen.schreiben.erwartet);
  });
});

describe('Stufen-Ableitung (LVLUP)', () => {
  it(`Schwellen ${reference.stufen.formel}`, () => {
    for (const s of reference.stufen.schwellen) {
      expect(apThresholdForLevel(s.stufe)).toBe(s.ap);
    }
  });

  for (const s of reference.stufen.stufeFuerAp) {
    it(`${s.ap} AP → Stufe ${s.stufe}${s.hinweis ? ` (${s.hinweis})` : ''}`, () => {
      expect(levelForAp(s.ap)).toBe(s.stufe);
    });
  }

  for (const n of reference.stufen.naechsteStufeAp) {
    it(`nextLevelAp(${n.ap}) → ${n.erwartet}`, () => {
      expect(nextLevelAp(n.ap)).toBe(n.erwartet);
    });
  }

  // Verhalten an der Obergrenze — leitet sich aus MAX_LEVEL ab, nicht aus festen Werten
  it(`Stufe ${MAX_LEVEL} ist die Obergrenze`, () => {
    const cap = apThresholdForLevel(MAX_LEVEL);
    expect(levelForAp(cap)).toBe(MAX_LEVEL);
    expect(levelForAp(cap + 1)).toBe(MAX_LEVEL);
    expect(levelForAp(cap * 10)).toBe(MAX_LEVEL);
    expect(nextLevelAp(cap)).toBeNull();
    expect(nextLevelAp(cap * 10)).toBeNull();
  });
});

describe('Gewicht & Sonstiges', () => {
  it(`Maximale Last ${reference.sonstiges.maximaleLast.formel} → ${reference.sonstiges.maximaleLast.erwartet}`, () => {
    expect(maximaleLast(raskir)).toBe(reference.sonstiges.maximaleLast.erwartet);
  });
  it(`Wurfweiten → ${reference.sonstiges.wurfweiten.erwartet.join(', ')}`, () => {
    expect(wurfweiten(raskir)).toEqual(reference.sonstiges.wurfweiten.erwartet);
  });
});
