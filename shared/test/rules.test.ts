import { describe, expect, it } from 'vitest';
import {
  apThresholdForLevel,
  computeBaseValues,
  computeResource,
  erleichterung,
  levelForAp,
  MAX_LEVEL,
  maximaleLast,
  nextLevelAp,
  probeExprZahl,
  schreibenProbe,
  sprechenProbe,
  talentProbeZahl,
  weaponProbes,
  wurfweiten,
} from '../src/rules.js';
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
