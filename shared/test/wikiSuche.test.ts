import { describe, expect, it } from 'vitest';
import { ftsAnfrage, schnipselTeile, wikiSuchtext } from '../src/wikiSuche.js';
import { normalizeWikiTags, wikiTagKey, wikiTagsAlsText } from '../src/wikiTags.js';

describe('ftsAnfrage', () => {
  it('quotes a term and keeps the prefix star outside the quotes', () => {
    expect(ftsAnfrage('ork')).toBe('"ork"*');
    expect(ftsAnfrage('ork gareth')).toBe('"ork"* "gareth"*');
  });

  it('folds German spelling so the query matches the folded index copy', () => {
    expect(ftsAnfrage('Straße')).toBe('"strasse"*');
    expect(ftsAnfrage('Wäldchen')).toBe('"waeldchen"*');
  });

  // Raw input in MATCH throws in SQLite — these are the shapes that used to.
  it('neutralises every FTS5 operator', () => {
    for (const eingabe of ['NEAR("a', '-', '^ork', 'a OR b', 'a AND b', '"', 'a:b', '*', 'a-b']) {
      const anfrage = ftsAnfrage(eingabe);
      const ohneTerme = anfrage.replace(/"[^"]*"\*/g, '').trim();
      // Whatever survives outside the quoted terms must be plain separators.
      expect(ohneTerme).toBe('');
    }
  });

  it('drops one-character terms and caps the term count', () => {
    expect(ftsAnfrage('a ork')).toBe('"ork"*');
    expect(ftsAnfrage('ein zwei drei vier fuenf sechs sieben acht neun zehn').split(' ')).toHaveLength(8);
  });

  it('returns an empty query when nothing is usable', () => {
    expect(ftsAnfrage('')).toBe('');
    expect(ftsAnfrage('   ')).toBe('');
    expect(ftsAnfrage('- ^ *')).toBe('');
  });
});

describe('wikiSuchtext', () => {
  // The tokenizer folds ü→u but not ß, so both spellings have to be indexed.
  it('indexes the original and a written-out copy', () => {
    const text = wikiSuchtext('Die Straße', 'Ein Wäldchen an der Straße');
    expect(text).toContain('Straße');
    expect(text).toContain('Strasse');
    expect(text).toContain('Wäldchen');
    expect(text).toContain('Waeldchen');
  });
});

describe('schnipselTeile', () => {
  it('splits a snippet on the guillemets SQLite wraps matches in', () => {
    expect(schnipselTeile('a «b» c')).toEqual([
      { mark: false, text: 'a ' },
      { mark: true, text: 'b' },
      { mark: false, text: ' c' },
    ]);
  });

  it('handles several matches', () => {
    expect(schnipselTeile('«a» und «b»').filter((t) => t.mark).map((t) => t.text)).toEqual(['a', 'b']);
  });

  it('degrades gracefully on an unmatched marker', () => {
    expect(schnipselTeile('a «b')).toEqual([{ mark: false, text: 'a «b' }]);
    expect(schnipselTeile('')).toEqual([]);
    expect(schnipselTeile('ohne Marker')).toEqual([{ mark: false, text: 'ohne Marker' }]);
  });
});

describe('normalizeWikiTags', () => {
  it('deduplicates by folded key and keeps the first spelling', () => {
    expect(normalizeWikiTags(['NPCs', 'npcs', 'NPCS'])).toEqual([{ tag: 'NPCs', key: 'npcs' }]);
  });

  it('folds German spelling into the key', () => {
    expect(wikiTagKey('Städte')).toBe('staedte');
    expect(normalizeWikiTags(['Städte', 'staedte'])).toHaveLength(1);
  });

  it('accepts the comma-separated string the editor field produces', () => {
    expect(normalizeWikiTags('Ort, NPCs ,, Stadt').map((t) => t.tag)).toEqual(['Ort', 'NPCs', 'Stadt']);
  });

  it('drops non-strings and empties', () => {
    expect(normalizeWikiTags(['Ort', '', '   ', 3, null, undefined])).toEqual([{ tag: 'Ort', key: 'ort' }]);
    expect(normalizeWikiTags(null)).toEqual([]);
  });

  it('caps the count and the length', () => {
    expect(normalizeWikiTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(12);
    expect(normalizeWikiTags(['x'.repeat(80)])[0].tag).toHaveLength(30);
  });

  it('round-trips back to the field format', () => {
    expect(wikiTagsAlsText(normalizeWikiTags('Ort, NPCs'))).toBe('Ort, NPCs');
  });
});
