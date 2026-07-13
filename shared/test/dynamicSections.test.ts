import { describe, expect, it } from 'vitest';
import { computeProbeCell, normalizeColumns } from '../src/dynamicSections.js';
import type { Attributes } from '../src/types.js';

const a = (akt: number) => ({ akt, mod: 0 });
const raskir: Attributes = {
  MU: a(16), KL: a(12), IN: a(15), CH: a(15),
  FF: a(16), GE: a(12), KO: a(44), KK: a(26), SO: a(10),
};

describe('computeProbeCell', () => {
  const col = { key: 'p', label: 'P', type: 'probe' as const, probeExprKey: 'expr', probeTawKey: 'taw' };

  it('Attribut-Ausdruck + ⌈TaW/5⌉', () => {
    expect(computeProbeCell(raskir, col, { expr: 'IN+CH+CH', taw: 8 })).toBe(47);
    expect(computeProbeCell(raskir, col, { expr: 'FF+KL+GE', taw: 0 })).toBe(40);
  });
  it('ohne TaW-Spalte nur Attributsumme', () => {
    expect(computeProbeCell(raskir, { key: 'p', label: 'P', type: 'probe', probeExprKey: 'expr' }, { expr: 'IN+CH+CH' })).toBe(45);
  });
  it('unparsebarer Ausdruck → null', () => {
    expect(computeProbeCell(raskir, col, { expr: 'Athletik', taw: 5 })).toBeNull();
  });
  it('nicht-probe Spalte → null', () => {
    expect(computeProbeCell(raskir, { key: 'x', label: 'X', type: 'text' }, { expr: 'IN+CH+CH' })).toBeNull();
  });
});

describe('normalizeColumns', () => {
  it('verwirft ungültige, ergänzt Standardwerte', () => {
    const cols = normalizeColumns([
      { key: 'name', label: 'Name', type: 'text' },
      { key: '', label: 'leer', type: 'text' }, // ohne key → verworfen
      { key: 'p', type: 'probe', probeExprKey: 'name' }, // label fehlt → key als label
      { label: 'ohneKey' }, // verworfen
    ]);
    expect(cols.map((c) => c.key)).toEqual(['name', 'p']);
    expect(cols[1].label).toBe('p');
    expect(cols[1].probeExprKey).toBe('name');
  });
  it('nicht-Array → leer', () => {
    expect(normalizeColumns('nope')).toEqual([]);
  });
});
