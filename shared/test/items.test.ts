import { describe, expect, it } from 'vitest';
import {
  containerEffektiveFuellung,
  containerFuellung,
  containerFuellungAnzeige,
  containerFuellungStueck,
  containers,
  effektiverRs,
  getrageneLast,
  haltbarkeitPct,
  itemGewicht,
  itemsInContainer,
  itemsInZone,
  lastInfo,
  makeUid,
  zaehltZurLast,
  zoneView,
} from '../src/items.js';
import type { Item, ItemLocation } from '../src/items.js';
import type { AttrCode, Attributes } from '../src/types.js';
import { ATTR_ROW_CODES } from '../src/types.js';

// Attribute-Fixture: alle Codes auf 10, KO/KK gesetzt, damit maximaleLast
// = (KO+KK)×2 = (8+6)×2 = 28 kg ergibt.
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
    beidseitig: false,
    containerUid: '',
    istBehaelter: false,
    containerArt: 'storage',
    kapazitaet: 0,
    kapazitaetArt: 'gewicht',
    gewichtsreduktion: 0,
    rs: 0,
    haltbarkeitMax: 0,
    haltbarkeitAktuell: 0,
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
  it('zählt Inventar, Behälter-Inhalt und Getragenes, nicht Abgelegtes', () => {
    expect(zaehltZurLast({ location: 'inventar' })).toBe(true);
    expect(zaehltZurLast({ location: 'behaelter' })).toBe(true);
    expect(zaehltZurLast({ location: 'getragen' })).toBe(true);
    expect(zaehltZurLast({ location: 'bench' })).toBe(false);
  });
});

describe('getrageneLast', () => {
  it('summiert nur die zählenden Gegenstände, Getragenes mit halbem Gewicht', () => {
    const items = [
      item({ anzahl: 2, gewicht: 3 }), // 6, inventar
      item({ uid: 'bag', name: 'Sack', istBehaelter: true }),
      item({ anzahl: 1, gewicht: 4, location: 'behaelter', containerUid: 'bag' }), // 4 (keine Reduktion)
      item({ anzahl: 1, gewicht: 100, location: 'getragen' }), // 50 (halb, am Körper)
      item({ anzahl: 1, gewicht: 20, location: 'bench' }), // 0 (abgelegt)
    ];
    expect(getrageneLast(items)).toBe(60);
  });

  it('mindert Behälter-Inhalt um die Reduktion; 100 % zählt gar nicht', () => {
    const erztasche = item({ uid: 'erz', name: 'Erztasche', gewicht: 5, istBehaelter: true, gewichtsreduktion: 100 });
    const halb = item({ uid: 'halb', name: 'Reduktionsbeutel', gewicht: 1, istBehaelter: true, gewichtsreduktion: 50 });
    const items = [
      erztasche, // 5 zählt (der Beutel selbst)
      item({ gewicht: 1000, location: 'behaelter', containerUid: 'erz' }), // 0 (100 %)
      halb, // 1 zählt
      item({ gewicht: 10, location: 'behaelter', containerUid: 'halb' }), // 5 (50 %)
    ];
    expect(getrageneLast(items)).toBe(11); // 5 + 0 + 1 + 5
  });

  it('Stück-Behälter: Inhalt zählt nie zur Last, egal was gewichtsreduktion sagt', () => {
    const koecher = item({ uid: 'koe', name: 'Köcher', gewicht: 0.5, istBehaelter: true, kapazitaetArt: 'stueck', gewichtsreduktion: 0 });
    const items = [
      koecher, // 0.5 zählt (der Köcher selbst)
      item({ anzahl: 20, gewicht: 0.05, location: 'behaelter', containerUid: 'koe' }), // 0 trotz Gewicht > 0
    ];
    expect(getrageneLast(items)).toBe(0.5);
  });

  it('Schnellzugriff-Behälter (Quickslots): Inhalt zählt voll, halbiert sich mit dem Behälter beim Tragen', () => {
    const gurt = item({
      uid: 'gurt',
      name: 'Bandelier',
      gewicht: 1,
      location: 'getragen',
      istBehaelter: true,
      containerArt: 'quick',
      kapazitaetArt: 'stueck',
    });
    const items = [
      gurt, // 0.5 zählt (getragen, halbiert)
      item({ anzahl: 1, gewicht: 2, location: 'behaelter', containerUid: 'gurt' }), // 1 (halbiert mit dem Behälter)
    ];
    expect(getrageneLast(items)).toBe(1.5);

    // Abgelegter (nicht getragener) Quickslot-Behälter: Inhalt zählt voll, keine Halbierung.
    const bench = items.map((it) => (it.uid === 'gurt' ? { ...it, location: 'bench' as ItemLocation } : it));
    expect(getrageneLast(bench)).toBe(2); // 0 (Behälter abgelegt) + 2 (Inhalt voll)
  });
});

describe('lastInfo', () => {
  it('meldet Überladung, sobald die getragene Last das Maximum übersteigt', () => {
    const under = lastInfo([item({ anzahl: 1, gewicht: 28 })], attrs());
    expect(under.max).toBe(28);
    expect(under.getragen).toBe(28);
    expect(under.ueberladen).toBe(false);

    const over = lastInfo([item({ anzahl: 1, gewicht: 28.5 })], attrs());
    expect(over.ueberladen).toBe(true);
  });

  it('addiert den Traglast-Bonus (kann negativ sein, aber nie unter 0)', () => {
    expect(lastInfo([], attrs(), 12).max).toBe(40); // 28 + 12
    expect(lastInfo([], attrs(), -10).max).toBe(18); // 28 − 10
    expect(lastInfo([], attrs(), -100).max).toBe(0); // gekappt bei 0
  });
});

describe('effektiverRs', () => {
  it('nimmt den höchsten RS unter den getragenen Teilen (kein Summieren)', () => {
    const items = [
      item({ location: 'getragen', rs: 3 }),
      item({ location: 'getragen', rs: 5 }),
      item({ location: 'bench', rs: 8 }), // abgelegt zählt nicht
      item({ location: 'behaelter', rs: 9 }),
    ];
    expect(effektiverRs(items)).toBe(5);
  });
  it('ist 0 ohne getragene Rüstung', () => {
    expect(effektiverRs([item({ rs: 4 })])).toBe(0);
  });
});

describe('haltbarkeitPct', () => {
  it('ist null, solange nichts verfolgt wird (Maximum 0)', () => {
    expect(haltbarkeitPct(item({}))).toBeNull();
  });
  it('rechnet aktuell/Maximum als gerundeten Prozentsatz', () => {
    expect(haltbarkeitPct(item({ haltbarkeitMax: 10, haltbarkeitAktuell: 10 }))).toBe(100);
    expect(haltbarkeitPct(item({ haltbarkeitMax: 10, haltbarkeitAktuell: 3 }))).toBe(30);
    expect(haltbarkeitPct(item({ haltbarkeitMax: 3, haltbarkeitAktuell: 1 }))).toBe(33); // gerundet
  });
  it('kappt aktuell auf [0, Maximum], auch bei kaputten Werten', () => {
    expect(haltbarkeitPct(item({ haltbarkeitMax: 10, haltbarkeitAktuell: 999 }))).toBe(100);
    expect(haltbarkeitPct(item({ haltbarkeitMax: 10, haltbarkeitAktuell: -5 }))).toBe(0);
    expect(haltbarkeitPct(item({ haltbarkeitMax: 10, haltbarkeitAktuell: NaN }))).toBe(0);
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

describe('Sichten', () => {
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

  it('itemsInContainer + containerFuellung (ohne Reduktion)', () => {
    expect(itemsInContainer(list, 'bag')).toEqual([inBag1, inBag2]);
    expect(containerFuellung(list, 'bag')).toBe(5); // 3 + 2×1
  });

  it('containerEffektiveFuellung: Inhalt um die Reduktion des Behälters gemindert', () => {
    const redBag = item({ uid: 'red', istBehaelter: true, kapazitaet: 60, gewichtsreduktion: 50 });
    const cargo = item({ location: 'behaelter', containerUid: 'red', anzahl: 1, gewicht: 120 });
    const items = [redBag, cargo];
    expect(containerFuellung(items, 'red')).toBe(120); // roh
    expect(containerEffektiveFuellung(items, 'red')).toBe(60); // 120 × (1 − 50 %)
  });

  it('containerFuellungStueck: summiert die Stückzahl statt des Gewichts', () => {
    const koecher = item({ uid: 'koe', istBehaelter: true, kapazitaetArt: 'stueck', kapazitaet: 20 });
    const items = [
      koecher,
      item({ location: 'behaelter', containerUid: 'koe', anzahl: 12, gewicht: 0.05 }),
      item({ location: 'behaelter', containerUid: 'koe', anzahl: 3, gewicht: 0.05 }),
    ];
    expect(containerFuellungStueck(items, 'koe')).toBe(15);
  });

  it('containerFuellungAnzeige: wählt die Einheit passend zu kapazitaetArt', () => {
    const koecher = item({ uid: 'koe', istBehaelter: true, kapazitaetArt: 'stueck', kapazitaet: 20 });
    const rucksack = item({ uid: 'ruck', istBehaelter: true, kapazitaetArt: 'gewicht', kapazitaet: 20, gewichtsreduktion: 50 });
    const items = [
      koecher,
      item({ location: 'behaelter', containerUid: 'koe', anzahl: 5, gewicht: 0.05 }),
      rucksack,
      item({ location: 'behaelter', containerUid: 'ruck', anzahl: 1, gewicht: 10 }),
    ];
    expect(containerFuellungAnzeige(items, koecher)).toBe(5); // Stück
    expect(containerFuellungAnzeige(items, rucksack)).toBe(5); // kg, 10 × (1 − 50 %)
  });

  it('containers: nur als Behälter markierte Gegenstände', () => {
    expect(containers(list)).toEqual([bag]);
  });
});

describe('zoneView (beidseitig)', () => {
  it('spiegelt beidseitig Getragenes auf die Gegenseite, einseitiges nicht', () => {
    const both = item({ location: 'getragen', zone: 'Arm links', beidseitig: true });
    const oneSide = item({ location: 'getragen', zone: 'Arm links' });
    const other = item({ location: 'getragen', zone: 'Arm rechts' });
    const list = [both, oneSide, other];
    // Eigene Seite: beide dort abgelegten Gegenstände.
    expect(zoneView(list, 'Arm links')).toEqual([both, oneSide]);
    // Gegenseite: der dort abgelegte PLUS der gespiegelte beidseitige.
    expect(zoneView(list, 'Arm rechts')).toEqual([other, both]);
  });

  it('spiegelt nicht in fremde Paare und nicht bei unpaarigen Zonen', () => {
    const arm = item({ location: 'getragen', zone: 'Arm links', beidseitig: true });
    const head = item({ location: 'getragen', zone: 'Kopf', beidseitig: true });
    const list = [arm, head];
    expect(zoneView(list, 'Bein rechts')).toEqual([]); // anderes Paar
    expect(zoneView(list, 'Kopf')).toEqual([head]); // unpaarig: keine Spiegelung
  });

  it('zählt beidseitig Getragenes trotz Doppelanzeige nur einmal für RS', () => {
    const both = item({ location: 'getragen', zone: 'Bein links', beidseitig: true, rs: 4 });
    // In der Anzeige zweimal, im Bestand einmal → effektiverRs bleibt 4.
    expect(zoneView([both], 'Bein links')).toHaveLength(1);
    expect(zoneView([both], 'Bein rechts')).toHaveLength(1);
    expect(effektiverRs([both])).toBe(4);
  });
});
