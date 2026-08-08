import { describe, expect, it } from 'vitest';
import {
  canStepTab,
  defaultTabKeys,
  dynTabId,
  dynTabKey,
  isFixedTab,
  moveTabKey,
  normalizeTabOrder,
  orderTabKeys,
  stepTabKey,
} from '../src/tabOrder.js';

const DEFAULT = defaultTabKeys([7, 8]);

describe('Schlüssel', () => {
  it('bildet selbst angelegte Reiter hin und zurück ab', () => {
    expect(dynTabKey(12)).toBe('c12');
    expect(dynTabId('c12')).toBe(12);
  });

  it('erkennt eingebaute Reiter nicht als selbst angelegte', () => {
    expect(dynTabId('Talente')).toBeNull();
    expect(dynTabId('c')).toBeNull();
    expect(dynTabId('c1x')).toBeNull();
  });

  it('kennt genau zwei feste Reiter', () => {
    expect(isFixedTab('Übersicht')).toBe(true);
    expect(isFixedTab('Heldenbrief')).toBe(true);
    expect(isFixedTab('Talente')).toBe(false);
    expect(isFixedTab('c7')).toBe(false);
  });
});

describe('defaultTabKeys', () => {
  it('setzt die selbst angelegten zwischen Sprachen und Sichtbarkeit', () => {
    expect(DEFAULT).toEqual(['Übersicht', 'Heldenbrief', 'Talente', 'Waffen', 'Sprachen', 'c7', 'c8', 'Sichtbarkeit']);
  });
});

describe('normalizeTabOrder', () => {
  it('wirft Doppelte, Leeres und Fremdtypen weg', () => {
    expect(normalizeTabOrder(['Talente', 'Talente', '', '  ', 3, null, 'c7'])).toEqual(['Talente', 'c7']);
  });

  it('kappt übermäßig lange Schlüssel', () => {
    expect(normalizeTabOrder(['x'.repeat(61), 'Waffen'])).toEqual(['Waffen']);
  });
});

describe('orderTabKeys', () => {
  it('gibt ohne gespeicherte Reihenfolge die Voreinstellung zurück', () => {
    expect(orderTabKeys(DEFAULT, [])).toEqual(DEFAULT);
  });

  it('folgt der gespeicherten Reihenfolge', () => {
    const stored = ['Sichtbarkeit', 'c8', 'Waffen', 'Talente', 'Sprachen', 'c7'];
    expect(orderTabKeys(DEFAULT, stored)).toEqual(['Übersicht', 'Heldenbrief', ...stored]);
  });

  it('hält die festen Reiter vorn, auch wenn die gespeicherte Liste sie hinten führt', () => {
    const out = orderTabKeys(DEFAULT, ['Talente', 'Übersicht', 'Waffen', 'Heldenbrief']);
    expect(out.slice(0, 2)).toEqual(['Übersicht', 'Heldenbrief']);
    expect(out).toHaveLength(DEFAULT.length);
  });

  it('lässt gelöschte Reiter weg', () => {
    expect(orderTabKeys(DEFAULT, ['c99', 'Waffen'])).not.toContain('c99');
  });

  it('hängt neu angelegte Reiter hinten an', () => {
    const stored = ['Talente', 'Waffen', 'Sprachen', 'c7', 'Sichtbarkeit'];
    const withNew = defaultTabKeys([7, 9]);
    expect(orderTabKeys(withNew, stored)).toEqual([...['Übersicht', 'Heldenbrief'], ...stored, 'c9']);
  });

  it('verliert und erfindet keine Reiter', () => {
    const out = orderTabKeys(DEFAULT, ['c8', 'Sprachen', 'c99']);
    expect([...out].sort()).toEqual([...DEFAULT].sort());
  });
});

describe('moveTabKey', () => {
  it('setzt einen Reiter vor einen anderen', () => {
    expect(moveTabKey(DEFAULT, 'Sichtbarkeit', 'Talente', 'before')).toEqual([
      'Übersicht', 'Heldenbrief', 'Sichtbarkeit', 'Talente', 'Waffen', 'Sprachen', 'c7', 'c8',
    ]);
  });

  it('setzt einen Reiter hinter einen anderen', () => {
    expect(moveTabKey(DEFAULT, 'Talente', 'c8', 'after')).toEqual([
      'Übersicht', 'Heldenbrief', 'Waffen', 'Sprachen', 'c7', 'c8', 'Talente', 'Sichtbarkeit',
    ]);
  });

  it('verschiebt die festen Reiter nicht', () => {
    expect(moveTabKey(DEFAULT, 'Übersicht', 'c8', 'after')).toEqual(DEFAULT);
    expect(moveTabKey(DEFAULT, 'Heldenbrief', 'Talente', 'before')).toEqual(DEFAULT);
  });

  it('lässt niemanden vor die festen Reiter — ein Wurf auf „Übersicht" landet davor', () => {
    const out = moveTabKey(DEFAULT, 'c8', 'Übersicht', 'before');
    expect(out).toEqual(['Übersicht', 'Heldenbrief', 'c8', 'Talente', 'Waffen', 'Sprachen', 'c7', 'Sichtbarkeit']);
  });

  it('ändert nichts bei unbekanntem Ziel oder Reiter', () => {
    expect(moveTabKey(DEFAULT, 'Talente', 'c99', 'before')).toEqual(DEFAULT);
    expect(moveTabKey(DEFAULT, 'c99', 'Talente', 'before')).toEqual(DEFAULT);
    expect(moveTabKey(DEFAULT, 'Talente', 'Talente', 'after')).toEqual(DEFAULT);
  });

  it('behält Länge und Bestand', () => {
    const out = moveTabKey(DEFAULT, 'Sprachen', 'Waffen', 'before');
    expect([...out].sort()).toEqual([...DEFAULT].sort());
  });
});

describe('stepTabKey', () => {
  it('tauscht mit dem Nachbarn', () => {
    expect(stepTabKey(DEFAULT, 'Waffen', -1)).toEqual([
      'Übersicht', 'Heldenbrief', 'Waffen', 'Talente', 'Sprachen', 'c7', 'c8', 'Sichtbarkeit',
    ]);
    expect(stepTabKey(DEFAULT, 'Waffen', 1)).toEqual([
      'Übersicht', 'Heldenbrief', 'Talente', 'Sprachen', 'Waffen', 'c7', 'c8', 'Sichtbarkeit',
    ]);
  });

  it('stoppt am festen Block und am Ende', () => {
    expect(canStepTab(DEFAULT, 'Talente', -1)).toBe(false);
    expect(stepTabKey(DEFAULT, 'Talente', -1)).toEqual(DEFAULT);
    expect(canStepTab(DEFAULT, 'Sichtbarkeit', 1)).toBe(false);
    expect(stepTabKey(DEFAULT, 'Sichtbarkeit', 1)).toEqual(DEFAULT);
  });

  it('bewegt die festen Reiter überhaupt nicht', () => {
    expect(canStepTab(DEFAULT, 'Heldenbrief', 1)).toBe(false);
    expect(canStepTab(DEFAULT, 'Übersicht', 1)).toBe(false);
  });
});
