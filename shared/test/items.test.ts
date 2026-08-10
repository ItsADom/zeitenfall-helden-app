import { describe, expect, it } from 'vitest';
import {
  containerFuellung,
  containers,
  getrageneLast,
  itemGewicht,
  itemsInContainer,
  itemsInZone,
  lastInfo,
  makeUid,
  zaehltZurLast,
} from '../src/items.js';
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
    uid: `u${nextId}`,
    name: 'x',
    anzahl: 1,
    gewicht: 0,
    kategorie: '',
    location: 'inventar',
    zone: '',
    containerUid: '',
    istBehaelter: false,
    kapazitaet: 0,
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

describe('makeUid', () => {
  it('gibt jedes Mal eine andere, nicht-leere Kennung', () => {
    const a = makeUid();
    const b = makeUid();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('Ausrüstungs-Sichten', () => {
  const bag = item({ uid: 'bag', name: 'Rucksack', istBehaelter: true, kapazitaet: 20 });
  const inBag1 = item({ location: 'behaelter', containerUid: 'bag', anzahl: 1, gewicht: 3 });
  const inBag2 = item({ location: 'behaelter', containerUid: 'bag', anzahl: 2, gewicht: 1 });
  const wornL = item({ location: 'getragen', zone: 'Arm links' });
  const wornL2 = item({ location: 'getragen', zone: 'Arm links' });
  const wornR = item({ location: 'getragen', zone: 'Arm rechts' });
  const list = [bag, inBag1, inBag2, wornL, wornL2, wornR];

  it('itemsInZone: mehrere Gegenstände je Zone', () => {
    expect(itemsInZone(list, 'Arm links')).toEqual([wornL, wornL2]);
    expect(itemsInZone(list, 'Arm rechts')).toEqual([wornR]);
    expect(itemsInZone(list, 'Kopf')).toEqual([]);
  });

  it('itemsInContainer + containerFuellung', () => {
    expect(itemsInContainer(list, 'bag')).toEqual([inBag1, inBag2]);
    expect(containerFuellung(list, 'bag')).toBe(5); // 3 + 2×1
  });

  it('containers: nur als Behälter markierte Gegenstände', () => {
    expect(containers(list)).toEqual([bag]);
  });
});
