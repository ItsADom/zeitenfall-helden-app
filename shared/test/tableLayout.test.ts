import { describe, expect, it } from 'vitest';
import { MIN_COL_PERCENT, evenWidths, minPercent, normalizeWidths, resizeAgainstNeighbour } from '../src/tableLayout.js';

const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;

describe('normalizeWidths', () => {
  it('summiert immer auf 100', () => {
    expect(sum(normalizeWidths([1, 1, 1]))).toBe(100);
    expect(sum(normalizeWidths([240, 72, 90, 300]))).toBe(100);
    expect(sum(normalizeWidths([7]))).toBe(100);
  });

  it('ist maßstabsunabhängig — Pixelwerte ergeben dieselben Anteile wie Verhältniszahlen', () => {
    expect(normalizeWidths([2, 1, 1])).toEqual(normalizeWidths([240, 120, 120]));
  });

  it('gibt fehlenden Spalten den Durchschnitt der bekannten', () => {
    const w = normalizeWidths([50, 50, undefined]);
    // Die neue Spalte ist so breit wie die vorhandenen — nicht das Minimum.
    // Bis auf die Rundungsstufe von einem Hundertstel gleich breit.
    expect(w[2]).toBeCloseTo(w[0], 1);
    expect(sum(w)).toBe(100);
  });

  it('verteilt gleich, wenn gar nichts bekannt ist', () => {
    expect(normalizeWidths([undefined, undefined, undefined, undefined])).toEqual([25, 25, 25, 25]);
  });

  it('ignoriert unbrauchbare Werte', () => {
    expect(sum(normalizeWidths([NaN, -5, 0, 10]))).toBe(100);
  });

  it('hebt zu schmale Spalten auf das Minimum', () => {
    const w = normalizeWidths([1000, 1, 1]);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(MIN_COL_PERCENT);
    expect(sum(w)).toBe(100);
  });

  it('verteilt bei sehr vielen Spalten gleichmäßig statt unter das Minimum zu fallen', () => {
    const w = normalizeWidths(new Array(50).fill(1));
    expect(sum(w)).toBe(100);
    expect(Math.min(...w)).toBeGreaterThan(0);
  });

  it('liefert für keine Spalte ein leeres Ergebnis', () => {
    expect(normalizeWidths([])).toEqual([]);
  });
});

describe('resizeAgainstNeighbour', () => {
  it('setzt die gewünschte Breite und hält die Summe bei 100', () => {
    const w = resizeAgainstNeighbour([25, 25, 25, 25], 0, 40);
    expect(w[0]).toBe(40);
    expect(sum(w)).toBe(100);
  });

  it('nimmt den Platz ausschließlich vom rechten Nachbarn', () => {
    const w = resizeAgainstNeighbour([25, 25, 25, 25], 0, 40);
    expect(w[1]).toBe(10); // 25 + 25 = 50, davon 40 nach links
    // Die übrigen Spalten bleiben unangetastet — das ist der Kern des
    // Trennstrich-Gedankens.
    expect(w[2]).toBe(25);
    expect(w[3]).toBe(25);
  });

  it('funktioniert auch beim Verkleinern', () => {
    const w = resizeAgainstNeighbour([40, 20, 20, 20], 0, 10);
    expect(w[0]).toBe(10);
    expect(w[1]).toBe(50);
    expect(w[2]).toBe(20);
    expect(sum(w)).toBe(100);
  });

  it('lässt weder die Spalte noch ihren Nachbarn unter die Mindestbreite fallen', () => {
    const links = resizeAgainstNeighbour([25, 25, 25, 25], 1, 0);
    expect(links[1]).toBeGreaterThanOrEqual(MIN_COL_PERCENT);
    const rechts = resizeAgainstNeighbour([25, 25, 25, 25], 1, 999);
    expect(rechts[2]).toBeGreaterThanOrEqual(MIN_COL_PERCENT);
    expect(sum(rechts)).toBe(100);
  });

  it('bleibt bei einer einzigen Spalte bei 100', () => {
    expect(resizeAgainstNeighbour([100], 0, 12)).toEqual([100]);
  });

  it('lehnt den Trennstrich hinter der letzten Spalte ab — den gibt es nicht', () => {
    expect(resizeAgainstNeighbour([50, 50], 1, 30)).toEqual([50, 50]);
    expect(sum(resizeAgainstNeighbour([50, 50], 7, 30))).toBe(100);
  });

  it('bleibt über viele Änderungen hinweg stabil', () => {
    let w = evenWidths(6);
    for (let i = 0; i < 60; i++) w = resizeAgainstNeighbour(w, i % 5, 5 + ((i * 7) % 40));
    expect(sum(w)).toBe(100);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(MIN_COL_PERCENT);
  });

  it('räumt auch unbereinigte Eingaben auf', () => {
    const w = resizeAgainstNeighbour([240, 120, 120], 0, 60);
    expect(sum(w)).toBe(100);
    expect(w[0]).toBe(60);
  });
});

describe('evenWidths und minPercent', () => {
  it('verteilt gleichmäßig', () => {
    expect(evenWidths(4)).toEqual([25, 25, 25, 25]);
    expect(sum(evenWidths(7))).toBe(100);
  });

  it('nennt die Mindestbreite einer Spalte', () => {
    expect(minPercent(4)).toBe(MIN_COL_PERCENT);
    expect(minPercent(1)).toBe(100);
    // Bei sehr vielen Spalten greift die Gleichverteilung statt der 3 %.
    expect(minPercent(50)).toBe(2);
  });
});
