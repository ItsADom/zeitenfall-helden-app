import { describe, expect, it } from 'vitest';
import { diffAbschnitte, diffZusammenfassung, zeilenBilanz, zeilenDiff } from '../src/wikiDiff.js';

const arten = (alt: string, neu: string) => zeilenDiff(alt, neu).map((z) => z.art);

describe('zeilenDiff', () => {
  it('marks identical texts as unchanged throughout', () => {
    expect(arten('a\nb\nc', 'a\nb\nc')).toEqual(['gleich', 'gleich', 'gleich']);
  });

  it('finds a pure insertion at the start, middle and end', () => {
    expect(arten('a\nb', 'neu\na\nb')).toEqual(['plus', 'gleich', 'gleich']);
    expect(arten('a\nb', 'a\nneu\nb')).toEqual(['gleich', 'plus', 'gleich']);
    expect(arten('a\nb', 'a\nb\nneu')).toEqual(['gleich', 'gleich', 'plus']);
  });

  it('finds a pure deletion', () => {
    expect(arten('a\nweg\nb', 'a\nb')).toEqual(['gleich', 'minus', 'gleich']);
  });

  it('handles a replacement in the middle', () => {
    expect(arten('a\nalt\nb', 'a\nneu\nb')).toEqual(['gleich', 'minus', 'plus', 'gleich']);
  });

  it('handles empty input on either side', () => {
    expect(arten('', 'a')).toEqual(['minus', 'plus']);
    expect(arten('a', '')).toEqual(['minus', 'plus']);
  });

  // The invariant that catches nearly every LCS backtracking bug.
  it('accounts for every line of both sides exactly once', () => {
    const faelle: [string, string][] = [
      ['a\nb\nc', 'a\nx\nc'],
      ['eins\nzwei\ndrei\nvier', 'eins\ndrei\nvier\nfuenf'],
      ['', 'a\nb'],
      ['a\nb', ''],
      ['gleich', 'gleich'],
      ['a\nb\nc\nd\ne', 'e\nd\nc\nb\na'],
    ];
    for (const [alt, neu] of faelle) {
      const zeilen = zeilenDiff(alt, neu);
      const { plus, minus } = diffZusammenfassung(zeilen);
      const gleich = zeilen.filter((z) => z.art === 'gleich').length;
      expect(gleich + minus).toBe(alt.split('\n').length);
      expect(gleich + plus).toBe(neu.split('\n').length);
    }
  });

  it('reconstructs both sides by filtering one direction out', () => {
    const alt = 'eins\nzwei\ndrei';
    const neu = 'eins\ndrei\nvier';
    const zeilen = zeilenDiff(alt, neu);
    expect(
      zeilen
        .filter((z) => z.art !== 'plus')
        .map((z) => z.text)
        .join('\n'),
    ).toBe(alt);
    expect(
      zeilen
        .filter((z) => z.art !== 'minus')
        .map((z) => z.text)
        .join('\n'),
    ).toBe(neu);
  });

  it('numbers lines against the side they belong to', () => {
    const zeilen = zeilenDiff('a\nalt', 'a\nneu');
    expect(zeilen[0]).toMatchObject({ art: 'gleich', nrAlt: 1, nrNeu: 1 });
    const minus = zeilen.find((z) => z.art === 'minus');
    const plus = zeilen.find((z) => z.art === 'plus');
    expect(minus).toMatchObject({ nrAlt: 2 });
    expect(minus?.nrNeu).toBeUndefined();
    expect(plus).toMatchObject({ nrNeu: 2 });
    expect(plus?.nrAlt).toBeUndefined();
  });

  it('stays fast on a large page with one small change', () => {
    const alt = Array.from({ length: 3000 }, (_, i) => `Zeile ${i}`).join('\n');
    const neu = alt.replace('Zeile 1500', 'Zeile 1500 geändert');
    const start = Date.now();
    const { plus, minus } = zeilenBilanz(alt, neu);
    expect({ plus, minus }).toEqual({ plus: 1, minus: 1 });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('degrades to a whole-block replacement beyond the size guard', () => {
    // Two large, entirely different texts blow past MAX_ZELLEN.
    const alt = Array.from({ length: 2200 }, (_, i) => `a${i}`).join('\n');
    const neu = Array.from({ length: 2200 }, (_, i) => `b${i}`).join('\n');
    const zeilen = zeilenDiff(alt, neu);
    expect(zeilen.filter((z) => z.art === 'gleich')).toHaveLength(0);
    expect(diffZusammenfassung(zeilen)).toEqual({ plus: 2200, minus: 2200 });
  });
});

describe('zeilenBilanz', () => {
  it('counts what the change log stores', () => {
    expect(zeilenBilanz('a\nb', 'a\nb\nc\nd')).toEqual({ plus: 2, minus: 0 });
    expect(zeilenBilanz('a\nb\nc', 'a')).toEqual({ plus: 0, minus: 2 });
  });
});

describe('diffAbschnitte', () => {
  it('returns one hunk for one change', () => {
    const lang = Array.from({ length: 50 }, (_, i) => `Zeile ${i}`).join('\n');
    const zeilen = zeilenDiff(lang, lang.replace('Zeile 25', 'geändert'));
    expect(diffAbschnitte(zeilen)).toHaveLength(1);
  });

  it('returns two hunks for two changes far apart', () => {
    const lang = Array.from({ length: 80 }, (_, i) => `Zeile ${i}`).join('\n');
    const neu = lang.replace('Zeile 5', 'A').replace('Zeile 70', 'B');
    expect(diffAbschnitte(zeilenDiff(lang, neu))).toHaveLength(2);
  });

  it('keeps the requested amount of context around a change', () => {
    const lang = Array.from({ length: 50 }, (_, i) => `Zeile ${i}`).join('\n');
    const zeilen = zeilenDiff(lang, lang.replace('Zeile 25', 'geändert'));
    const [hunk] = diffAbschnitte(zeilen, 2);
    // 2 lines of context on each side, plus the minus/plus pair.
    expect(hunk).toHaveLength(6);
  });
});
