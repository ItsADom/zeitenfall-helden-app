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

  it('kennt genau einen festen Reiter', () => {
    expect(isFixedTab('Heldenbrief')).toBe(true);
    expect(isFixedTab('Talente')).toBe(false);
    expect(isFixedTab('Inventar')).toBe(false);
    expect(isFixedTab('c7')).toBe(false);
  });
});

describe('defaultTabKeys', () => {
  it('hängt die selbst angelegten hinter die eingebauten', () => {
    expect(DEFAULT).toEqual(['Heldenbrief', 'Talente', 'Waffen', 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7', 'c8']);
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

  it('folgt der gespeicherten Reihenfolge und hängt Unbekanntes hinten an', () => {
    const stored = ['c8', 'Waffen', 'Talente', 'Sprachen', 'c7'];
    // 'Zauber'/'Fähigkeiten'/'Inventar'/'Ausrüstung' fehlen in der gespeicherten Liste → hinten angehängt.
    expect(orderTabKeys(DEFAULT, stored)).toEqual(['Heldenbrief', ...stored, 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung']);
  });

  it('hält den festen Reiter vorn, auch wenn die gespeicherte Liste ihn hinten führt', () => {
    const out = orderTabKeys(DEFAULT, ['Talente', 'Waffen', 'Heldenbrief']);
    expect(out.slice(0, 1)).toEqual(['Heldenbrief']);
    expect(out).toHaveLength(DEFAULT.length);
  });

  it('lässt gelöschte Reiter weg', () => {
    expect(orderTabKeys(DEFAULT, ['c99', 'Waffen'])).not.toContain('c99');
  });

  it('hängt neu angelegte Reiter hinten an', () => {
    const stored = ['Talente', 'Waffen', 'Sprachen', 'c7'];
    const withNew = defaultTabKeys([7, 9]);
    expect(orderTabKeys(withNew, stored)).toEqual([...['Heldenbrief'], ...stored, 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'c9']);
  });

  it('verliert und erfindet keine Reiter', () => {
    const out = orderTabKeys(DEFAULT, ['c8', 'Sprachen', 'c99']);
    expect([...out].sort()).toEqual([...DEFAULT].sort());
  });
});

describe('moveTabKey', () => {
  it('setzt einen Reiter vor einen anderen', () => {
    expect(moveTabKey(DEFAULT, 'c8', 'Talente', 'before')).toEqual([
      'Heldenbrief', 'c8', 'Talente', 'Waffen', 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7',
    ]);
  });

  it('setzt einen Reiter hinter einen anderen', () => {
    expect(moveTabKey(DEFAULT, 'Talente', 'c8', 'after')).toEqual([
      'Heldenbrief', 'Waffen', 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7', 'c8', 'Talente',
    ]);
  });

  it('verschiebt den festen Reiter nicht', () => {
    expect(moveTabKey(DEFAULT, 'Heldenbrief', 'Talente', 'before')).toEqual(DEFAULT);
  });

  it('lässt niemanden vor den festen Reiter — ein Wurf auf „Heldenbrief" landet dahinter', () => {
    const out = moveTabKey(DEFAULT, 'c8', 'Heldenbrief', 'before');
    expect(out).toEqual(['Heldenbrief', 'c8', 'Talente', 'Waffen', 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7']);
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
      'Heldenbrief', 'Waffen', 'Talente', 'Zauber', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7', 'c8',
    ]);
    expect(stepTabKey(DEFAULT, 'Waffen', 1)).toEqual([
      'Heldenbrief', 'Talente', 'Zauber', 'Waffen', 'Fähigkeiten', 'Inventar', 'Ausrüstung', 'Sprachen', 'c7', 'c8',
    ]);
  });

  it('stoppt am festen Block und am Ende', () => {
    expect(canStepTab(DEFAULT, 'Talente', -1)).toBe(false);
    expect(stepTabKey(DEFAULT, 'Talente', -1)).toEqual(DEFAULT);
    expect(canStepTab(DEFAULT, 'c8', 1)).toBe(false);
    expect(stepTabKey(DEFAULT, 'c8', 1)).toEqual(DEFAULT);
  });

  it('bewegt den festen Reiter überhaupt nicht', () => {
    expect(canStepTab(DEFAULT, 'Heldenbrief', 1)).toBe(false);
  });
});
