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
