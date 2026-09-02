import { describe, expect, it } from 'vitest';
import {
  attrsMitBoni,
  baseInputsMitBoni,
  containerEffektiveFuellung,
  containerFuellung,
  containerFuellungAnzeige,
  containerFuellungStueck,
  containers,
  diffItems,
  duplicateItem,
  effektiverRs,
  getrageneLast,
  haltbarkeitPct,
  itemGewicht,
  itemsInContainer,
  itemsInZone,
  lastInfo,
  makeItem,
  makeUid,
  ohneVerborgeneItems,
  resourceInputMitBoni,
  specialMitBoni,
  talentMitBoni,
  talentProbeBonus,
  wornBoni,
  zaehltZurLast,
  zoneView,
} from '../src/items.js';
import type { Item, ItemBonus, ItemLocation } from '../src/items.js';
import type { AttrCode, Attributes, BaseValueInputs, CharTalent, ResourceInput, SpecialResource } from '../src/types.js';
import { ATTR_ROW_CODES, BASE_VALUE_KEYS } from '../src/types.js';

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
    haus: '',
    raum: '',
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
    bonusse: [],
    rsVerborgen: false,
    haltbarkeitVerborgen: false,
    waffenArt: '',
    waffenStats: [],
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

  it('addiert einen Item-Traglast-Bonus zusätzlich zum gespeicherten Bonus', () => {
    const belt = item({
      location: 'getragen',
      name: 'Gürtel der Kraft',
      bonusse: [{ uid: makeUid(), kind: 'traglast', code: '', feld: '', wert: 5, verborgen: false }],
    });
    expect(lastInfo([belt], attrs(), 12).max).toBe(45); // 28 + 12 (gespeichert) + 5 (Item)
  });

  it('ein Item-Attribut-Bonus hebt die Traglast-Formel selbst mit an', () => {
    const gauntlets = item({
      location: 'getragen',
      name: 'Handschuhe der Kraft',
      bonusse: [{ uid: makeUid(), kind: 'attr', code: 'KK', feld: '', wert: 4, verborgen: false }],
    });
    // maximaleLast = (KO+KK)*2, siehe attrs()-Fixture (ko=8, kk=6) -> ohne Bonus 28
    expect(lastInfo([gauntlets], attrs()).max).toBe(36); // KK 6+4=10 -> (8+10)*2
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

describe('bonusse (Item-Boni-Datenmodell)', () => {
  it('makeItem startet mit einer leeren Bonusliste', () => {
    expect(makeItem({ name: 'Ring' }).bonusse).toEqual([]);
  });

  it('duplicateItem kopiert die Bonusliste mit, statt sie zu leeren — mit frischen Bonus-uids', () => {
    const ring = item({
      name: 'Ring der Stärke',
      bonusse: [{ uid: makeUid(), kind: 'attr', code: 'KK', feld: '', wert: 1, verborgen: false }],
    });
    const copy = duplicateItem(ring);
    expect(copy.bonusse).toEqual([{ ...ring.bonusse[0], uid: copy.bonusse[0].uid }]);
    expect(copy.bonusse[0].uid).not.toBe(ring.bonusse[0].uid);
    expect(copy.id).toBe(0);
    expect(copy.uid).not.toBe(ring.uid);
  });
});

function baseInputs(): BaseValueInputs {
  const mods = Object.fromEntries(BASE_VALUE_KEYS.map((k) => [k, 0])) as BaseValueInputs['mods'];
  return { mods, gsBase: 0, resilienzBase: 0, mrBase: 0, akBase: 0 };
}

function resourceInput(over: Partial<ResourceInput> = {}): ResourceInput {
  return { permanent: 0, kauf: 0, kaufMax: 0, maxPlus: 0, aktuell: 0, besonderes: '', raceBase: 0, ...over };
}

function talent(over: Partial<CharTalent> = {}): CharTalent {
  return { talentId: 1, taw: 0, at: 0, pa: 0, bl: 0, spezialisierung: '', waffenmeister: '', berufsbonus: '', notiz: '', favorit: false, ...over };
}

function specialResource(over: Partial<SpecialResource> = {}): SpecialResource {
  return { catalogId: null, name: 'x', max: 0, bonus: 0, aktuell: 0, ...over };
}

describe('wornBoni', () => {
  it('summiert gleiches Ziel über mehrere getragene Items', () => {
    const ring = item({ location: 'getragen', name: 'Ring', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 1, verborgen: false }] });
    const amulett = item({ location: 'getragen', name: 'Amulett', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 2, verborgen: false }] });
    const boni = wornBoni([ring, amulett]);
    expect(boni.attrs.MU).toBe(3);
  });

  it('ein nicht getragenes Item trägt nichts bei', () => {
    const ringImRucksack = item({
      location: 'behaelter',
      name: 'Ring',
      bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 5, verborgen: false }],
    });
    const boni = wornBoni([ringImRucksack]);
    expect(boni.attrs.MU).toBeUndefined();
  });

  it('negative Werte ziehen ab (verfluchter Gegenstand)', () => {
    const fluch = item({ location: 'getragen', name: 'Fluchring', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: -3, verborgen: false }] });
    expect(wornBoni([fluch]).attrs.MU).toBe(-3);
  });

  it('quellen nennt die richtigen Items je Ziel, ohne Dopplung', () => {
    const ring = item({ location: 'getragen', name: 'Ring', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 1, verborgen: false }] });
    const amulett = item({
      location: 'getragen',
      name: 'Amulett',
      bonusse: [
        { uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 2, verborgen: false },
        { uid: makeUid(), kind: 'baseValue', code: 'at', feld: '', wert: 1, verborgen: false },
      ],
    });
    const boni = wornBoni([ring, amulett]);
    expect(boni.quellen['attr:MU']).toEqual(['Ring (+1)', 'Amulett (+2)']);
    expect(boni.quellen['baseValue:at']).toEqual(['Amulett (+1)']);
  });

  it('ein wert:0-Bonus trägt weder zur Summe noch zu quellen bei', () => {
    const leer = item({ location: 'getragen', name: 'Unbestimmt', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 0, verborgen: false }] });
    const boni = wornBoni([leer]);
    expect(boni.attrs.MU).toBeUndefined();
    expect(boni.quellen['attr:MU']).toBeUndefined();
  });

  it('talent-Boni landen unter der talentId, getrennt nach Feld', () => {
    const ring = item({
      location: 'getragen',
      name: 'Kampfring',
      bonusse: [
        { uid: makeUid(), kind: 'talent', code: '42', feld: 'taw', wert: 2, verborgen: false },
        { uid: makeUid(), kind: 'talent', code: '42', feld: 'at', wert: 1, verborgen: false },
      ],
    });
    const boni = wornBoni([ring]);
    expect(boni.talente[42]).toEqual({ taw: 2, at: 1 });
  });

  it('spezial-, psyche- und traglast-Boni landen in ihren eigenen Feldern', () => {
    const amulett = item({
      location: 'getragen',
      name: 'Amulett',
      bonusse: [
        { uid: makeUid(), kind: 'spezial', code: '7', feld: '', wert: 4, verborgen: false },
        { uid: makeUid(), kind: 'psyche', code: '', feld: '', wert: 5, verborgen: false },
        { uid: makeUid(), kind: 'traglast', code: '', feld: '', wert: 6, verborgen: false },
      ],
    });
    const boni = wornBoni([amulett]);
    expect(boni.spezial[7]).toBe(4);
    expect(boni.psyche).toBe(5);
    expect(boni.traglast).toBe(6);
  });
});

describe('attrsMitBoni', () => {
  it('legt den Bonus auf mod, akt bleibt unangetastet', () => {
    const attrsFixture = attrs();
    const boni = wornBoni([item({ location: 'getragen', name: 'Ring', bonusse: [{ uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 3, verborgen: false }] })]);
    const out = attrsMitBoni(attrsFixture, boni);
    expect(out.MU).toEqual({ akt: attrsFixture.MU.akt, mod: attrsFixture.MU.mod + 3 });
    expect(out.KL).toEqual(attrsFixture.KL);
  });
});

describe('baseInputsMitBoni', () => {
  it('addiert auf mods[key], andere Keys bleiben unverändert', () => {
    const inputs = baseInputs();
    const boni = wornBoni([item({ location: 'getragen', name: 'Stiefel', bonusse: [{ uid: makeUid(), kind: 'baseValue', code: 'gs', feld: '', wert: 2, verborgen: false }] })]);
    const out = baseInputsMitBoni(inputs, boni);
    expect(out.mods.gs).toBe(2);
    expect(out.mods.at).toBe(0);
  });
});

describe('resourceInputMitBoni', () => {
  it('hebt das nutzbare Maximum an, ohne aktuell zu verändern', () => {
    const input = resourceInput({ aktuell: 5 });
    const boni = wornBoni([item({ location: 'getragen', name: 'Ring', bonusse: [{ uid: makeUid(), kind: 'resource', code: 'le', feld: '', wert: 2, verborgen: false }] })]);
    const out = resourceInputMitBoni(input, 'le', boni);
    expect(out.permanent).toBe(2);
    expect(out.maxPlus).toBe(2);
    expect(out.aktuell).toBe(5);
  });

  it('ohne Bonus wird dieselbe Referenz zurückgegeben', () => {
    const input = resourceInput();
    expect(resourceInputMitBoni(input, 'le', wornBoni([]))).toBe(input);
  });
});

describe('specialMitBoni', () => {
  it('addiert auf bonus, wenn catalogId trifft', () => {
    const sr = specialResource({ catalogId: 7, bonus: 1 });
    const boni = wornBoni([item({ location: 'getragen', name: 'Amulett', bonusse: [{ uid: makeUid(), kind: 'spezial', code: '7', feld: '', wert: 4, verborgen: false }] })]);
    expect(specialMitBoni(sr, boni).bonus).toBe(5);
  });

  it('ohne passenden catalogId bleibt bonus unverändert', () => {
    const sr = specialResource({ catalogId: 9, bonus: 1 });
    const boni = wornBoni([item({ location: 'getragen', name: 'Amulett', bonusse: [{ uid: makeUid(), kind: 'spezial', code: '7', feld: '', wert: 4, verborgen: false }] })]);
    expect(specialMitBoni(sr, boni).bonus).toBe(1);
  });
});

describe('talentMitBoni', () => {
  it('legt den Bonus auf die Anzeige, das gespeicherte Talent bleibt unangetastet', () => {
    const t = talent({ talentId: 42, taw: 8 });
    const boni = wornBoni([item({ location: 'getragen', name: 'Kampfring', bonusse: [{ uid: makeUid(), kind: 'talent', code: '42', feld: 'taw', wert: 2, verborgen: false }] })]);
    const out = talentMitBoni(t, boni);
    expect(out.taw).toBe(10);
    expect(t.taw).toBe(8);
  });

  it('ohne Bonus wird dieselbe Referenz zurückgegeben', () => {
    const t = talent({ talentId: 1 });
    expect(talentMitBoni(t, wornBoni([]))).toBe(t);
  });

  it('feld "probe" fließt NICHT in taw/at/pa/bl ein — dafür gibt es kein CharTalent-Feld', () => {
    const t = talent({ talentId: 42, taw: 8 });
    const boni = wornBoni([item({ location: 'getragen', name: 'Amulett', bonusse: [{ uid: makeUid(), kind: 'talent', code: '42', feld: 'probe', wert: 2, verborgen: false }] })]);
    const out = talentMitBoni(t, boni);
    expect(out.taw).toBe(8);
    expect(out.at).toBe(0);
  });
});

describe('talentProbeBonus', () => {
  it('liefert den direkten Probe-Bonus eines Talents', () => {
    const boni = wornBoni([item({ location: 'getragen', name: 'Amulett', bonusse: [{ uid: makeUid(), kind: 'talent', code: '42', feld: 'probe', wert: 2, verborgen: false }] })]);
    expect(talentProbeBonus(42, boni)).toBe(2);
  });

  it('summiert über mehrere getragene Items', () => {
    const a = item({ location: 'getragen', name: 'A', bonusse: [{ uid: makeUid(), kind: 'talent', code: '42', feld: 'probe', wert: 1, verborgen: false }] });
    const b = item({ location: 'getragen', name: 'B', bonusse: [{ uid: makeUid(), kind: 'talent', code: '42', feld: 'probe', wert: -3, verborgen: false }] });
    expect(talentProbeBonus(42, wornBoni([a, b]))).toBe(-2);
  });

  it('ohne Bonus 0', () => {
    expect(talentProbeBonus(42, wornBoni([]))).toBe(0);
  });

  it('taw- und probe-Boni auf demselben Talent bleiben unabhängig', () => {
    const boni = wornBoni([
      item({
        location: 'getragen',
        name: 'Ring',
        bonusse: [
          { uid: makeUid(), kind: 'talent', code: '42', feld: 'taw', wert: 5, verborgen: false },
          { uid: makeUid(), kind: 'talent', code: '42', feld: 'probe', wert: 2, verborgen: false },
        ],
      }),
    ]);
    expect(talentMitBoni(talent({ talentId: 42, taw: 8 }), boni).taw).toBe(13);
    expect(talentProbeBonus(42, boni)).toBe(2);
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

function bonus(over: Partial<ItemBonus> = {}): ItemBonus {
  return { uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 1, verborgen: false, ...over };
}

describe('ohneVerborgeneItems (Hidden/revealable Ausrüstung stats)', () => {
  it('nullt rs/haltbarkeit, wenn verdeckt, behält aber die *Verborgen-Flags', () => {
    const it1 = item({ rs: 7, rsVerborgen: true, haltbarkeitMax: 10, haltbarkeitAktuell: 8, haltbarkeitVerborgen: true });
    const [out] = ohneVerborgeneItems([it1]);
    expect(out.rs).toBe(0);
    expect(out.rsVerborgen).toBe(true);
    expect(out.haltbarkeitMax).toBe(0);
    expect(out.haltbarkeitAktuell).toBe(0);
    expect(out.haltbarkeitVerborgen).toBe(true);
  });

  it('lässt sichtbare rs/haltbarkeit unangetastet', () => {
    const it1 = item({ rs: 7, haltbarkeitMax: 10, haltbarkeitAktuell: 8 });
    const [out] = ohneVerborgeneItems([it1]);
    expect(out.rs).toBe(7);
    expect(out.haltbarkeitMax).toBe(10);
    expect(out.haltbarkeitAktuell).toBe(8);
  });

  it('entfernt eine verdeckte Bonus-Zeile vollständig, behält sichtbare', () => {
    const hidden = bonus({ code: 'MU', wert: 3, verborgen: true });
    const visible = bonus({ code: 'KL', wert: 1, verborgen: false });
    const [out] = ohneVerborgeneItems([item({ bonusse: [hidden, visible] })]);
    expect(out.bonusse).toEqual([visible]);
  });
});

describe('diffItems (incremental item saves)', () => {
  it('erzeugt keine Ops, wenn sich nichts geändert hat', () => {
    const a = item({ name: 'Schwert' });
    expect(diffItems([a], [a])).toEqual([]);
  });

  it('neues Item -> add', () => {
    const a = item({ name: 'Schwert' });
    expect(diffItems([], [a])).toEqual([{ op: 'add', item: a }]);
  });

  it('entferntes Item -> remove', () => {
    const a = item({ name: 'Schwert' });
    expect(diffItems([a], [])).toEqual([{ op: 'remove', uid: a.uid }]);
  });

  it('geändertes Feld -> patch mit NUR den geänderten Feldern', () => {
    const a = item({ name: 'Schwert', gewicht: 2 });
    const b = { ...a, name: 'Alt-Schwert' };
    expect(diffItems([a], [b])).toEqual([{ op: 'patch', uid: a.uid, patch: { name: 'Alt-Schwert' } }]);
  });

  it('geänderte Reihenfolge -> reorder mit der vollen neuen uid-Liste', () => {
    const a = item({ name: 'A' });
    const b = item({ name: 'B' });
    expect(diffItems([a, b], [b, a])).toEqual([{ op: 'reorder', uids: [b.uid, a.uid] }]);
  });

  it('neue/entfernte/geänderte Bonus-Zeile -> addBonus/removeBonus/patchBonus, adressiert per Bonus-uid', () => {
    const kept = bonus({ code: 'MU', wert: 1 });
    const removed = bonus({ code: 'KL', wert: 2 });
    const a = item({ bonusse: [kept, removed] });
    const added = bonus({ code: 'IN', wert: 3 });
    const b = { ...a, bonusse: [{ ...kept, wert: 5 }, added] };
    const ops = diffItems([a], [b]);
    expect(ops).toContainEqual({ op: 'removeBonus', itemUid: a.uid, bonusUid: removed.uid });
    expect(ops).toContainEqual({ op: 'addBonus', itemUid: a.uid, bonus: added });
    expect(ops).toContainEqual({ op: 'patchBonus', itemUid: a.uid, bonusUid: kept.uid, patch: { wert: 5 } });
    expect(ops).toHaveLength(3);
  });

  // Die eigentliche Motivation für diffItems (Hidden/revealable Ausrüstung
  // stats, TODO.md): ein Nicht-SL-Client hat eine verdeckte Bonus-Zeile NIE
  // gesehen — weder in prev noch in next fehlt ihm dieselbe Zeile also nicht
  // "neu", sondern schlicht "keine Änderung". Der alte Ganze-Liste-Ersatz
  // hätte diesen Fall nicht von einer echten Löschung unterscheiden können.
  it('eine Zeile, die weder in prev noch in next auftaucht, erzeugt KEINEN Op (strukturelle Sicherheit)', () => {
    const visible = bonus({ code: 'KL', wert: 1 });
    // "prev" und "next" sind beide die Sicht eines Nicht-SL: eine verdeckte
    // Zeile, die die SL inzwischen serverseitig angelegt/aufgedeckt hat,
    // steckt in KEINEM von beiden — der Client weiß schlicht nichts von ihr.
    const a = item({ name: 'Schwert', bonusse: [visible] });
    const b = { ...a, name: 'Schwert (umbenannt)' };
    const ops = diffItems([a], [b]);
    expect(ops).toEqual([{ op: 'patch', uid: a.uid, patch: { name: 'Schwert (umbenannt)' } }]);
    // Insbesondere: kein removeBonus/addBonus für irgendeine unbekannte uid.
    expect(ops.some((o) => o.op === 'removeBonus' || o.op === 'addBonus')).toBe(false);
  });

  it('rs/haltbarkeit, die in prev UND next 0 sind (verdeckt & genullt), erzeugen keinen patch dafür', () => {
    // Simuliert die Sicht eines Nicht-SL auf ein Item mit verdeckter RS: der
    // Wert ist in BEIDEN Ständen 0 (serverseitig genullt), also "unverändert".
    const a = item({ name: 'Schwert', rs: 0, rsVerborgen: true });
    const b = { ...a, name: 'Schwert (umbenannt)' };
    const ops = diffItems([a], [b]);
    expect(ops).toEqual([{ op: 'patch', uid: a.uid, patch: { name: 'Schwert (umbenannt)' } }]);
  });
});
