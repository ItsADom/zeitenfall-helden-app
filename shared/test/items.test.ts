import { describe, expect, it } from 'vitest';
import { getrageneLast, itemGewicht, lastInfo, zaehltZurLast } from '../src/items.js';
import type { Item, ItemLocation } from '../src/items.js';
import type { AttrCode, Attributes } from '../src/types.js';
import { ATTR_ROW_CODES } from '../src/types.js';

// Attribute-Fixture: alle Codes auf 10, KO/KK gesetzt, damit maximaleLast
// = (KO+KK)×2×1.5 = (8+6)×3 = 42 kg ergibt.
function attrs(ko = 8, kk = 6): Attributes {
  const out = {} as Attributes;
  for (const code of ATTR_ROW_CODES) out[code as AttrCode] = { akt: 10, mod: 0 };
  out.KO = { akt: ko, mod: 0 };
  out.KK = { akt: kk, mod: 0 };
  return out;
}

let nextId = 1;
function item(partial: Partial<Item> & { location?: ItemLocation }): Item {
  return {
    id: nextId++,
    name: 'x',
    anzahl: 1,
    gewicht: 0,
    kategorie: '',
    location: 'inventar',
    notiz: '',
    ...partial,
  };
}

describe('itemGewicht', () => {
  it('multipliziert Stückzahl mit Einzelgewicht (Dezimalzahlen)', () => {
    expect(itemGewicht({ anzahl: 3, gewicht: 0.5 })).toBe(1.5);
    expect(itemGewicht({ anzahl: 0, gewicht: 5 })).toBe(0);
  });
  it('behandelt kaputte Werte als 0', () => {
    expect(itemGewicht({ anzahl: NaN, gewicht: 2 })).toBe(0);
  });
});

describe('zaehltZurLast', () => {
  it('zählt Inventar und Behälter-Inhalt, nicht Getragenes/Tier', () => {
    expect(zaehltZurLast({ location: 'inventar' })).toBe(true);
    expect(zaehltZurLast({ location: 'behaelter' })).toBe(true);
    expect(zaehltZurLast({ location: 'getragen' })).toBe(false);
    expect(zaehltZurLast({ location: 'tier' })).toBe(false);
  });
});

describe('getrageneLast', () => {
  it('summiert nur die zählenden Gegenstände', () => {
    const items = [
      item({ anzahl: 2, gewicht: 3 }), // 6, inventar
      item({ anzahl: 1, gewicht: 4, location: 'behaelter' }), // 4
      item({ anzahl: 1, gewicht: 100, location: 'getragen' }), // 0 (am Körper)
      item({ anzahl: 1, gewicht: 50, location: 'tier' }), // 0 (Tier)
    ];
    expect(getrageneLast(items)).toBe(10);
  });
});

describe('lastInfo', () => {
  it('meldet Überladung, sobald die getragene Last das Maximum übersteigt', () => {
    const under = lastInfo([item({ anzahl: 1, gewicht: 42 })], attrs());
    expect(under.max).toBe(42);
    expect(under.getragen).toBe(42);
    expect(under.ueberladen).toBe(false);

    const over = lastInfo([item({ anzahl: 1, gewicht: 42.5 })], attrs());
    expect(over.ueberladen).toBe(true);
  });
});
