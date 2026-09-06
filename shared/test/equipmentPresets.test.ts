import { describe, expect, it } from 'vitest';
import { applyEquipmentPreset, equipmentPresetItemsFromWorn, makeEquipmentPreset, missingPresetItems } from '../src/equipmentPresets.js';
import type { EquipmentPreset } from '../src/equipmentPresets.js';
import { makeItem } from '../src/items.js';
import type { Item } from '../src/items.js';

describe('equipmentPresetItemsFromWorn', () => {
  it('captures only currently worn items, with their uid/zone/beidseitig', () => {
    const worn = makeItem({ uid: 'a', name: 'Schwert', location: 'getragen', zone: 'Hand rechts', beidseitig: false });
    const alsoWorn = makeItem({ uid: 'b', name: 'Schild', location: 'getragen', zone: 'Arm links', beidseitig: true });
    const benched = makeItem({ uid: 'c', name: 'Dolch', location: 'bench' });
    const inInventory = makeItem({ uid: 'd', name: 'Seil', location: 'inventar' });

    const items = equipmentPresetItemsFromWorn([worn, alsoWorn, benched, inInventory]);

    expect(items).toEqual([
      { itemUid: 'a', itemName: 'Schwert', zone: 'Hand rechts', beidseitig: false },
      { itemUid: 'b', itemName: 'Schild', zone: 'Arm links', beidseitig: true },
    ]);
  });
});

describe('missingPresetItems', () => {
  it('returns preset entries whose uid is not in the current items', () => {
    const preset: EquipmentPreset = {
      id: 1,
      name: 'Kampf',
      items: [
        { itemUid: 'a', itemName: 'Schwert', zone: 'Hand rechts', beidseitig: false },
        { itemUid: 'gone', itemName: 'Verschollener Dolch', zone: 'Gürtel', beidseitig: false },
      ],
    };
    const items: Item[] = [makeItem({ uid: 'a', name: 'Schwert', location: 'getragen', zone: 'Hand rechts' })];

    expect(missingPresetItems(items, preset)).toEqual([
      { itemUid: 'gone', itemName: 'Verschollener Dolch', zone: 'Gürtel', beidseitig: false },
    ]);
  });

  it('returns nothing when every entry still has a matching item', () => {
    const preset = makeEquipmentPreset('Freizeit');
    expect(missingPresetItems([], preset)).toEqual([]);
  });
});

describe('applyEquipmentPreset', () => {
  it('equips every item the preset lists, at its recorded zone', () => {
    const sword = makeItem({ uid: 'a', name: 'Schwert', location: 'bench' });
    const preset: EquipmentPreset = {
      id: 1,
      name: 'Kampf',
      items: [{ itemUid: 'a', itemName: 'Schwert', zone: 'Hand rechts', beidseitig: false }],
    };

    const next = applyEquipmentPreset([sword], preset);

    expect(next[0]).toMatchObject({ location: 'getragen', zone: 'Hand rechts', beidseitig: false, containerUid: '' });
  });

  it('benches everything currently worn that is not in the preset (full outfit swap)', () => {
    const ring = makeItem({ uid: 'ring', name: 'Ring', location: 'getragen', zone: 'Hand links' });
    const cloak = makeItem({ uid: 'cloak', name: 'Umhang', location: 'getragen', zone: 'Rücken' });
    const preset: EquipmentPreset = {
      id: 1,
      name: 'Kampf',
      items: [{ itemUid: 'ring', itemName: 'Ring', zone: 'Hand links', beidseitig: false }],
    };

    const next = applyEquipmentPreset([ring, cloak], preset);

    const nextByUid = new Map(next.map((it) => [it.uid, it]));
    expect(nextByUid.get('ring')).toMatchObject({ location: 'getragen', zone: 'Hand links' });
    expect(nextByUid.get('cloak')).toMatchObject({ location: 'bench', zone: '', beidseitig: false });
  });

  it('pulls an item out of a container it was stashed in since the preset was saved', () => {
    const bag = makeItem({ uid: 'bag', name: 'Beutel', location: 'getragen', zone: 'Gürtel', istBehaelter: true });
    const dagger = makeItem({ uid: 'dagger', name: 'Dolch', location: 'behaelter', containerUid: 'bag' });
    const preset: EquipmentPreset = {
      id: 1,
      name: 'Kampf',
      items: [{ itemUid: 'dagger', itemName: 'Dolch', zone: 'Bein rechts', beidseitig: false }],
    };

    const next = applyEquipmentPreset([bag, dagger], preset);

    const nextDagger = next.find((it) => it.uid === 'dagger');
    expect(nextDagger).toMatchObject({ location: 'getragen', zone: 'Bein rechts', containerUid: '' });
  });

  it('leaves a preset entry with no matching item alone (skips it, does not throw)', () => {
    const preset: EquipmentPreset = {
      id: 1,
      name: 'Kampf',
      items: [{ itemUid: 'gone', itemName: 'Verschollen', zone: 'Kopf', beidseitig: false }],
    };
    expect(applyEquipmentPreset([], preset)).toEqual([]);
  });

  it('leaves items untouched that are neither worn nor in the preset', () => {
    const rope = makeItem({ uid: 'rope', name: 'Seil', location: 'inventar' });
    const preset = makeEquipmentPreset('Kampf');
    const next = applyEquipmentPreset([rope], preset);
    expect(next[0]).toEqual(rope);
  });
});
