import { describe, expect, it } from 'vitest';
import {
  RESERVIERTE_SLUGS,
  SLUG_MAX,
  faltDeutsch,
  freierSlug,
  istReservierterSlug,
  wikiSlug,
} from '../src/wikiSlug.js';

describe('faltDeutsch', () => {
  it('spells umlauts out instead of stripping them', () => {
    expect(faltDeutsch('Wäldchen')).toBe('Waeldchen');
    expect(faltDeutsch('Ölberg')).toBe('Oelberg');
    expect(faltDeutsch('Übermut')).toBe('Uebermut');
    expect(faltDeutsch('Straße')).toBe('Strasse');
  });

  it('drops accents that are not German umlauts', () => {
    expect(faltDeutsch('Hôtel')).toBe('Hotel');
    expect(faltDeutsch('café')).toBe('cafe');
  });
});

describe('wikiSlug', () => {
  it('folds German titles the way they are spoken', () => {
    expect(wikiSlug('Die Straße nach Gareth')).toBe('die-strasse-nach-gareth');
    expect(wikiSlug('Ölberg')).toBe('oelberg');
    expect(wikiSlug('Hôtel')).toBe('hotel');
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(wikiSlug('„Der Schwarze Ritter"')).toBe('der-schwarze-ritter');
    expect(wikiSlug('Ork   —   Angriff!')).toBe('ork-angriff');
  });

  it('never starts or ends with a hyphen', () => {
    expect(wikiSlug('---Gareth---')).toBe('gareth');
    expect(wikiSlug('  Gareth  ')).toBe('gareth');
  });

  it('falls back to a usable slug for empty input', () => {
    expect(wikiSlug('')).toBe('seite');
    expect(wikiSlug('   ')).toBe('seite');
    expect(wikiSlug('!!!')).toBe('seite');
  });

  it('is idempotent', () => {
    for (const titel of ['Die Straße nach Gareth', 'Ölberg', '„Zitat"', 'A B  C']) {
      expect(wikiSlug(wikiSlug(titel))).toBe(wikiSlug(titel));
    }
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = wikiSlug('wort '.repeat(60));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('reservierte Slugs', () => {
  // Guards against adding a /wiki/<segment> route and forgetting that a page of
  // the same name would shadow it.
  it('covers every static route segment under /wiki', () => {
    for (const segment of ['neu', 'suche', 'kategorie', 'aenderungen', 'papierkorb', 'bilder', 'bearbeiten', 'verlauf']) {
      expect(RESERVIERTE_SLUGS.has(segment)).toBe(true);
    }
  });

  it('reports reserved slugs', () => {
    expect(istReservierterSlug('neu')).toBe(true);
    expect(istReservierterSlug('gareth')).toBe(false);
  });
});

describe('freierSlug', () => {
  it('uses the plain slug when nothing is in the way', () => {
    expect(freierSlug('Gareth', () => false)).toBe('gareth');
  });

  it('steps around a collision', () => {
    const vergeben = new Set(['gareth', 'gareth-2']);
    expect(freierSlug('Gareth', (s) => vergeben.has(s))).toBe('gareth-3');
  });

  it('steps around a reserved segment even when nothing is stored yet', () => {
    expect(freierSlug('Neu', () => false)).toBe('neu-2');
  });
});
