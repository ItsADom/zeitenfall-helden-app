import { describe, expect, it } from 'vitest';
import type { WikiBlock, WikiInline } from '../src/wikiMarkup.js';
import {
  alsKlartext,
  auszug,
  hatGmBloecke,
  inhaltsverzeichnis,
  istSichereUrl,
  ohneGmBloecke,
  parseWiki,
  quelleOhneGm,
  sammleBilder,
  sammleLinks,
  stelleGmBloeckeHer,
  verbergeGmBloecke,
  weiterleitungsZiel,
} from '../src/wikiMarkup.js';

const bloecke = (quelle: string): WikiBlock[] => parseWiki(quelle).bloecke;
const ersterBlock = (quelle: string): WikiBlock => bloecke(quelle)[0];

/** Flattens a block's inline children to their plain text, for terse assertions. */
function text(kinder: WikiInline[]): string {
  return kinder
    .map((k) => {
      if (k.typ === 'text' || k.typ === 'code') return k.text;
      if (k.typ === 'fett' || k.typ === 'kursiv') return text(k.kinder);
      if (k.typ === 'wikilink' || k.typ === 'extlink') return k.text;
      return '\n';
    })
    .join('');
}

describe('Blöcke', () => {
  it('parses the three heading levels and stops at four hashes', () => {
    expect(ersterBlock('# Titel')).toMatchObject({ typ: 'ueberschrift', ebene: 1 });
    expect(ersterBlock('## Titel')).toMatchObject({ typ: 'ueberschrift', ebene: 2 });
    expect(ersterBlock('### Titel')).toMatchObject({ typ: 'ueberschrift', ebene: 3 });
    expect(ersterBlock('#### Titel')).toMatchObject({ typ: 'absatz' });
  });

  it('separates paragraphs on a blank line', () => {
    const b = bloecke('Erster Absatz.\n\nZweiter Absatz.');
    expect(b).toHaveLength(2);
    expect(b.every((x) => x.typ === 'absatz')).toBe(true);
  });

  it('keeps a single newline inside a paragraph as a hard break', () => {
    const b = ersterBlock('Zeile eins\nZeile zwei');
    expect(b.typ).toBe('absatz');
    if (b.typ !== 'absatz') return;
    expect(b.kinder.some((k) => k.typ === 'umbruch')).toBe(true);
  });

  it('collects consecutive list lines into one block', () => {
    const b = ersterBlock('- eins\n- zwei\n- drei');
    expect(b).toMatchObject({ typ: 'liste', geordnet: false });
    if (b.typ !== 'liste') return;
    expect(b.punkte).toHaveLength(3);
  });

  it('tells ordered from unordered lists apart', () => {
    expect(ersterBlock('1. eins\n2. zwei')).toMatchObject({ typ: 'liste', geordnet: true });
  });

  it('ends a list at a blank line', () => {
    const b = bloecke('- eins\n\n- zwei');
    expect(b).toHaveLength(2);
  });

  it('parses a quote and a rule', () => {
    expect(ersterBlock('> Zitiert')).toMatchObject({ typ: 'zitat' });
    expect(ersterBlock('---')).toMatchObject({ typ: 'trenner' });
  });

  it('parses a pipe table with its separator row', () => {
    const b = ersterBlock('| Name | Ort |\n|---|---|\n| Alrik | Gareth |');
    expect(b.typ).toBe('tabelle');
    if (b.typ !== 'tabelle') return;
    expect(b.kopf).toHaveLength(2);
    expect(b.zeilen).toHaveLength(1);
    expect(text(b.zeilen[0][0])).toBe('Alrik');
  });

  it('treats pipes without a separator row as ordinary text', () => {
    expect(ersterBlock('| Name | Ort |\n| Alrik | Gareth |')).toMatchObject({ typ: 'absatz' });
  });

  it('parses a fenced code block verbatim', () => {
    const b = ersterBlock('```\n**nicht fett**\n```');
    expect(b).toMatchObject({ typ: 'code', text: '**nicht fett**' });
  });
});

describe('Inline', () => {
  it('parses bold, italic and code', () => {
    const b = ersterBlock('**fett** *kursiv* `code`');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    const arten = b.kinder.map((k) => k.typ);
    expect(arten).toContain('fett');
    expect(arten).toContain('kursiv');
    expect(arten).toContain('code');
  });

  it('nests emphasis', () => {
    const b = ersterBlock('**a *b* c**');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    expect(text(b.kinder)).toBe('a b c');
  });

  // The single most important robustness property: a missing closer must never
  // throw and never swallow the rest of the document.
  it('leaves unclosed delimiters as literal text', () => {
    for (const quelle of ['**fett', '*kursiv', '`code', '[[Seite', '[Text](']) {
      const b = ersterBlock(quelle);
      expect(b.typ).toBe('absatz');
      if (b.typ !== 'absatz') continue;
      expect(text(b.kinder)).toBe(quelle);
    }
  });
});

describe('Verweise', () => {
  it('derives a wikilink slug from the target', () => {
    const b = ersterBlock('Siehe [[Die Straße nach Gareth]].');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    expect(b.kinder).toContainEqual({
      typ: 'wikilink',
      slug: 'die-strasse-nach-gareth',
      text: 'Die Straße nach Gareth',
    });
  });

  it('takes the slug from the left half and the label from the right', () => {
    const b = ersterBlock('[[Gareth|die Hauptstadt]]');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    expect(b.kinder[0]).toEqual({ typ: 'wikilink', slug: 'gareth', text: 'die Hauptstadt' });
  });

  it('collects link targets deduplicated and in document order', () => {
    expect(sammleLinks(parseWiki('[[B]] [[A]] [[B]]'))).toEqual(['b', 'a']);
  });

  it('makes an image its own block only on a line of its own', () => {
    expect(ersterBlock('[[bild:karte|Die Karte]]')).toEqual({
      typ: 'bild',
      slug: 'karte',
      unterschrift: 'Die Karte',
    });
    // Mid-sentence it is not a block, and not a link either.
    expect(ersterBlock('Hier [[bild:karte]] mitten im Satz.')).toMatchObject({ typ: 'absatz' });
    expect(sammleBilder(parseWiki('[[bild:karte]]\n\n[[bild:karte]]'))).toEqual(['karte']);
  });
});

// The syntax tree closes markup injection, but NOT href. This is the hole, and
// these are the cases that have to stay shut.
describe('istSichereUrl', () => {
  it('accepts http and https only', () => {
    expect(istSichereUrl('http://example.org')).toBe(true);
    expect(istSichereUrl('https://example.org')).toBe(true);
    expect(istSichereUrl('HTTPS://example.org')).toBe(true);
  });

  it('rejects every scheme that could execute or spoof', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '\tjavascript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example',
      'mailto:someone@example.org',
    ]) {
      expect(istSichereUrl(url)).toBe(false);
    }
  });

  it('degrades an unsafe link to plain text instead of emitting a link node', () => {
    const b = ersterBlock('[Klick](javascript:alert(1))');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    expect(b.kinder.every((k) => k.typ !== 'extlink')).toBe(true);
    expect(text(b.kinder)).toContain('javascript:alert(1)');
  });

  it('still emits a link node for a safe URL', () => {
    const b = ersterBlock('[Wiki](https://example.org)');
    if (b.typ !== 'absatz') throw new Error('Absatz erwartet');
    expect(b.kinder[0]).toEqual({ typ: 'extlink', url: 'https://example.org', text: 'Wiki' });
  });
});

describe('GM-Blöcke', () => {
  const quelle = 'Öffentlich.\n\n```gm\nGeheim.\n\n- versteckt\n```\n\nWieder öffentlich.';

  it('parses a gm fence as a container of real blocks, not as code', () => {
    const doc = parseWiki(quelle);
    const gm = doc.bloecke.find((b) => b.typ === 'gmblock');
    expect(gm).toBeDefined();
    if (!gm || gm.typ !== 'gmblock') return;
    expect(gm.bloecke.map((b) => b.typ)).toEqual(['absatz', 'liste']);
    expect(hatGmBloecke(doc)).toBe(true);
  });

  it('removes gm blocks from the tree for a reader without GM rights', () => {
    const ohne = ohneGmBloecke(parseWiki(quelle));
    expect(hatGmBloecke(ohne)).toBe(false);
    expect(alsKlartext(ohne)).not.toContain('Geheim');
    expect(alsKlartext(ohne)).toContain('Öffentlich');
  });

  it('removes gm blocks from the SOURCE too — the text must never be sent', () => {
    const gestrippt = quelleOhneGm(quelle);
    expect(gestrippt).not.toContain('Geheim');
    expect(gestrippt).not.toContain('versteckt');
    expect(gestrippt).not.toContain('```gm');
    expect(gestrippt).toContain('Öffentlich');
    expect(gestrippt).toContain('Wieder öffentlich');
  });

  it('leaves an ordinary code fence alone when stripping', () => {
    const mitCode = 'a\n\n```\ncode bleibt\n```\n\nb';
    expect(quelleOhneGm(mitCode)).toContain('code bleibt');
  });
});

// The editor's half of the same rule. A player must be able to edit a page with
// GM-only sections in it WITHOUT deleting them: they never see the text, but
// they do see that something stands there, and a save puts it back.
describe('GM-Blöcke im Editor (Platzhalter)', () => {
  const quelle = 'Oben.\n\n```gm\nGeheim.\n```\n\nUnten.';

  it('replaces each region with a marker and keeps the text out of the payload', () => {
    const { text: sichtbar, bloecke: versteckt } = verbergeGmBloecke(quelle);
    expect(sichtbar).not.toContain('Geheim');
    expect(sichtbar).toContain('[[gm:1]]');
    expect(sichtbar.indexOf('Oben')).toBeLessThan(sichtbar.indexOf('[[gm:1]]'));
    expect(sichtbar.indexOf('[[gm:1]]')).toBeLessThan(sichtbar.indexOf('Unten'));
    expect(versteckt).toEqual(['```gm\nGeheim.\n```']);
  });

  it('round-trips an untouched text back to the original', () => {
    const { text: sichtbar, bloecke: versteckt } = verbergeGmBloecke(quelle);
    expect(stelleGmBloeckeHer(sichtbar, versteckt)).toBe(quelle);
  });

  it('keeps the hidden region when the surrounding text is rewritten', () => {
    const { bloecke: versteckt } = verbergeGmBloecke(quelle);
    const bearbeitet = 'Ganz neuer Text.\n\n[[gm:1]]\n\nUnd noch einer.';
    const zusammen = stelleGmBloeckeHer(bearbeitet, versteckt);
    expect(zusammen).toContain('Geheim.');
    expect(zusammen).toContain('Ganz neuer Text.');
    expect(zusammen).toContain('Und noch einer.');
  });

  it('drops the region only when the author deletes its marker', () => {
    const { bloecke: versteckt } = verbergeGmBloecke(quelle);
    expect(stelleGmBloeckeHer('Nur noch das hier.', versteckt)).toBe('Nur noch das hier.');
  });

  it('ignores a marker number that has no region', () => {
    expect(stelleGmBloeckeHer('a\n[[gm:9]]\nb', ['```gm\nx\n```'])).toBe('a\nb');
  });

  it('numbers several regions in document order', () => {
    const zwei = '```gm\nEins\n```\n\nMitte\n\n```gm\nZwei\n```';
    const { text: sichtbar, bloecke: versteckt } = verbergeGmBloecke(zwei);
    expect(versteckt).toHaveLength(2);
    expect(sichtbar).toBe('[[gm:1]]\n\nMitte\n\n[[gm:2]]');
    expect(stelleGmBloeckeHer(sichtbar, versteckt)).toBe(zwei);
  });

  it('parses a marker line as its own block, so the editor can render a lock', () => {
    expect(ersterBlock('[[gm:2]]')).toEqual({ typ: 'gmplatzhalter', nr: 2 });
  });

  it('leaves a marker mid-sentence as literal text, never as a link', () => {
    const block = ersterBlock('siehe [[gm:1]] dort');
    expect(block.typ).toBe('absatz');
    expect(sammleLinks(parseWiki('siehe [[gm:1]] dort'))).toEqual([]);
  });

  it('keeps the read view free of markers as well', () => {
    expect(quelleOhneGm(quelle)).not.toContain('[[gm:');
  });
});

describe('Ableitungen', () => {
  it('strips markers for the plain-text form, in document order', () => {
    expect(alsKlartext(parseWiki('# Titel\n\n**fett** und *kursiv*'))).toBe('Titel fett und kursiv');
  });

  it('shortens the teaser at a word boundary', () => {
    const lang = auszug(parseWiki('wort '.repeat(100)), 20);
    expect(lang.length).toBeLessThanOrEqual(21);
    expect(lang.endsWith('…')).toBe(true);
  });

  it('numbers repeated headings so anchors stay unique', () => {
    const toc = inhaltsverzeichnis(parseWiki('## Ort\n\n## Ort'));
    expect(toc.map((z) => z.anker)).toEqual(['ort', 'ort-2']);
    expect(toc[0]).toMatchObject({ ebene: 2, text: 'Ort' });
  });
});

// Any player can save a page, so the parser is attacker-influenced input.
describe('Robustheit', () => {
  it('survives pathological input without throwing or hanging', () => {
    for (const quelle of [
      '['.repeat(50_000),
      '['.repeat(25_000) + ']'.repeat(25_000),
      '*'.repeat(50_000),
      '**'.repeat(25_000),
      '`'.repeat(50_000),
      '|'.repeat(50_000),
      '#'.repeat(50_000),
      '> '.repeat(25_000),
      '```gm\n'.repeat(10_000),
    ]) {
      const start = Date.now();
      expect(() => parseWiki(quelle)).not.toThrow();
      expect(Date.now() - start).toBeLessThan(2000);
    }
  });

  it('accepts empty and whitespace-only input', () => {
    expect(parseWiki('').bloecke).toEqual([]);
    expect(parseWiki('   \n\n  ').bloecke).toEqual([]);
  });
});

describe('weiterleitungsZiel', () => {
  it('reads the target as a slug', () => {
    expect(weiterleitungsZiel('#WEITERLEITUNG [[Gareth]]')).toBe('gareth');
    expect(weiterleitungsZiel('#WEITERLEITUNG [[Die Straße nach Gareth]]')).toBe('die-strasse-nach-gareth');
  });

  it('accepts #REDIRECT, spacing and casing', () => {
    expect(weiterleitungsZiel('#REDIRECT [[Gareth]]')).toBe('gareth');
    expect(weiterleitungsZiel('# weiterleitung[[Gareth]]')).toBe('gareth');
    expect(weiterleitungsZiel('  #WEITERLEITUNG  [[Gareth]]  ')).toBe('gareth');
  });

  it('skips leading blank lines but nothing else', () => {
    expect(weiterleitungsZiel('\n\n  \n#WEITERLEITUNG [[Gareth]]')).toBe('gareth');
  });

  it('ignores the marker anywhere but at the top', () => {
    // Otherwise a redirect could hide at the bottom of a long article and
    // teleport readers away from text that is still there.
    expect(weiterleitungsZiel('Ein Absatz.\n\n#WEITERLEITUNG [[Gareth]]')).toBeNull();
    expect(weiterleitungsZiel('# Überschrift\n#WEITERLEITUNG [[Gareth]]')).toBeNull();
  });

  it('is null for an ordinary page', () => {
    expect(weiterleitungsZiel('')).toBeNull();
    expect(weiterleitungsZiel('# Gareth\n\nEine Stadt.')).toBeNull();
    expect(weiterleitungsZiel('#WEITERLEITUNG ohne Ziel')).toBeNull();
    expect(weiterleitungsZiel('#WEITERLEITUNG [[]]')).toBeNull();
  });

  it('does not fall for a pipe — a redirect has no display text', () => {
    expect(weiterleitungsZiel('#WEITERLEITUNG [[Gareth|die Stadt]]')).toBeNull();
  });
});

describe('Bildgrößen und -lage', () => {
  const bild = (quelle: string) => {
    const b = ersterBlock(quelle);
    if (b.typ !== 'bild') throw new Error('Bild erwartet');
    return b;
  };

  it('reads size and position keywords in any order', () => {
    expect(bild('[[bild:karte|klein|rechts|Die Karte]]')).toEqual({
      typ: 'bild',
      slug: 'karte',
      unterschrift: 'Die Karte',
      groesse: 'klein',
      position: 'rechts',
    });
    expect(bild('[[bild:karte|rechts|klein|Die Karte]]')).toMatchObject({
      groesse: 'klein',
      position: 'rechts',
      unterschrift: 'Die Karte',
    });
  });

  it('accepts every documented keyword, and ß as well as ss', () => {
    for (const [wort, erwartet] of [
      ['klein', 'klein'],
      ['mittel', 'mittel'],
      ['gross', 'gross'],
      ['groß', 'gross'],
      ['GROSS', 'gross'],
      ['voll', 'voll'],
    ] as const) {
      expect(bild(`[[bild:karte|${wort}]]`).groesse).toBe(erwartet);
    }
    for (const wort of ['links', 'rechts', 'mitte'] as const) {
      expect(bild(`[[bild:karte|${wort}]]`).position).toBe(wort);
    }
  });

  // The compatibility property: a page written before sizes existed must parse
  // exactly as it did, and a typo must never become an error.
  it('leaves an unknown word as the caption', () => {
    expect(bild('[[bild:karte|Die Karte von Gareth]]')).toEqual({
      typ: 'bild',
      slug: 'karte',
      unterschrift: 'Die Karte von Gareth',
      groesse: undefined,
      position: undefined,
    });
    expect(bild('[[bild:karte|rehcts|Die Karte]]').unterschrift).toBe('rehcts|Die Karte');
    expect(bild('[[bild:karte|rehcts|Die Karte]]').position).toBeUndefined();
  });

  it('keeps a caption that itself contains a pipe', () => {
    expect(bild('[[bild:karte|Norden | Süden]]').unterschrift).toBe('Norden | Süden');
  });

  it('takes only the first keyword of each kind, rest is caption', () => {
    const b = bild('[[bild:karte|klein|mittel|rechts]]');
    expect(b.groesse).toBe('klein');
    expect(b.position).toBe('rechts');
    expect(b.unterschrift).toBe('mittel');
  });

  it('still collects the slug for the image list', () => {
    expect(sammleBilder(parseWiki('[[bild:karte|klein|rechts|Die Karte]]'))).toEqual(['karte']);
  });

  it('keeps only the caption in the plain-text extract, never the keywords', () => {
    // Otherwise a page teaser would read „klein rechts Die Karte".
    expect(alsKlartext(parseWiki('[[bild:karte|klein|rechts|Die Karte]]'))).toBe('Die Karte');
  });
});
