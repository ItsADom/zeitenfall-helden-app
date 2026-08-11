import { describe, expect, it } from 'vitest';
import {
  faehigkeitenOf,
  groupAbilities,
  istTrivial,
  magiepunkte,
  magierEligibility,
  spellPunkte,
  zauberOf,
} from '../src/abilities.js';
import type { Ability } from '../src/abilities.js';

let nextId = 1;
function ability(partial: Partial<Ability>): Ability {
  return {
    id: nextId++,
    uid: `a${nextId}`,
    magisch: true,
    passiv: false,
    signatur: false,
    name: 'x',
    element: '',
    kategorie: '',
    stufe: 1,
    komplexitaet: 1,
    kosten: '',
    probe: '',
    effekt: '',
    fortschritt: 0,
    notiz: '',
    ...partial,
  };
}

describe('spellPunkte / istTrivial', () => {
  it('Punkte = Stufe × Komplexität', () => {
    expect(spellPunkte({ stufe: 5, komplexitaet: 1 })).toBe(5);
    expect(spellPunkte({ stufe: 2, komplexitaet: 3 })).toBe(6);
    expect(spellPunkte({ stufe: 0, komplexitaet: 4 })).toBe(0);
  });
  it('trivial = Stufe 1 UND Komplexität 1', () => {
    expect(istTrivial({ stufe: 1, komplexitaet: 1 })).toBe(true);
    expect(istTrivial({ stufe: 1, komplexitaet: 2 })).toBe(false);
    expect(istTrivial({ stufe: 2, komplexitaet: 1 })).toBe(false);
  });
});

describe('magiepunkte (Trivial-Deckel)', () => {
  it('zählt Nicht-Triviales voll, Triviales nur bis 10×(Rang−1)', () => {
    const spells = [
      ability({ stufe: 5, komplexitaet: 1 }), // 5, nicht trivial
      ability({ stufe: 2, komplexitaet: 3 }), // 6, nicht trivial
      ...Array.from({ length: 15 }, () => ability({ stufe: 1, komplexitaet: 1 })), // 15 triviale
    ];
    // Rang 2 → Deckel 10: 11 (nicht trivial) + 10 (gedeckelt) = 21
    const r2 = magiepunkte(spells, 2);
    expect(r2.trivialGesamt).toBe(15);
    expect(r2.trivialCap).toBe(10);
    expect(r2.trivialGezaehlt).toBe(10);
    expect(r2.summe).toBe(21);
    // Rang 3 → Deckel 20: alle 15 triviale zählen → 11 + 15 = 26
    expect(magiepunkte(spells, 3).summe).toBe(26);
  });
  it('bei Rang 1 und 0 ist der Trivial-Deckel 0', () => {
    const spells = [ability({ stufe: 1, komplexitaet: 1 }), ability({ stufe: 3, komplexitaet: 2 })];
    expect(magiepunkte(spells, 1).summe).toBe(6); // nur der Nicht-Triviale (6), trivial gedeckelt auf 0
    expect(magiepunkte(spells, 0).trivialCap).toBe(0);
  });
  it('ignoriert mundane Fähigkeiten', () => {
    const spells = [ability({ magisch: false, stufe: 3, komplexitaet: 3 }), ability({ stufe: 2, komplexitaet: 2 })];
    expect(magiepunkte(spells, 5).summe).toBe(4);
  });
});

describe('magierEligibility', () => {
  it('prüft den nächsten Rang und meldet Fortschritt je Bedingung', () => {
    const r = magierEligibility(1, { koerper: 18, selbst: 22, magiekunde: 20, krypto: 12, psyche: 88, magiepunkte: 28 });
    expect(r.naechsteStufe).toBe(2);
    const koerper = r.bedingungen.find((b) => b.key === 'koerper')!;
    expect(koerper.ist).toBe(18);
    expect(koerper.soll).toBe(20);
    expect(koerper.erfuellt).toBe(false); // 18 < 20
    expect(r.erfuellt).toBe(false); // Körper + Magiepunkte fehlen
  });
  it('erfüllt, wenn alle sechs Bedingungen halten', () => {
    const r = magierEligibility(1, { koerper: 20, selbst: 20, magiekunde: 20, krypto: 10, psyche: 80, magiepunkte: 16 });
    expect(r.erfuellt).toBe(true);
  });
  it('kein nächster Rang oberhalb von Stufe 5', () => {
    const r = magierEligibility(5, { koerper: 99, selbst: 99, magiekunde: 99, krypto: 99, psyche: 100, magiepunkte: 999 });
    expect(r.naechsteStufe).toBeNull();
    expect(r.erfuellt).toBe(false);
  });
});

describe('Sichten & Gruppieren', () => {
  const list = [
    ability({ magisch: true, kategorie: 'Heilmagie', element: 'Licht' }),
    ability({ magisch: true, kategorie: 'Heilmagie', element: 'Neutral' }),
    ability({ magisch: true, kategorie: 'Kampfmagie', element: 'Licht' }),
    ability({ magisch: false, kategorie: 'Kampffertigkeiten', element: '' }),
  ];
  it('zauberOf / faehigkeitenOf trennen nach magisch', () => {
    expect(zauberOf(list)).toHaveLength(3);
    expect(faehigkeitenOf(list)).toHaveLength(1);
  });
  it('groupAbilities gruppiert nach Feld, Reihenfolge = erstes Auftreten', () => {
    const byKategorie = groupAbilities(zauberOf(list), 'kategorie');
    expect([...byKategorie.keys()]).toEqual(['Heilmagie', 'Kampfmagie']);
    expect(byKategorie.get('Heilmagie')).toHaveLength(2);
    const byElement = groupAbilities(zauberOf(list), 'element');
    expect([...byElement.keys()]).toEqual(['Licht', 'Neutral']);
    expect(byElement.get('Licht')).toHaveLength(2);
  });
});
