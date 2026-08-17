// The wiki's markup: source text in, typed syntax tree out.
//
// The client renders that tree to React elements, so NO HTML STRING IS EVER
// PRODUCED and markup injection is impossible by construction rather than by
// sanitising afterwards. The one hole a tree does not close is `href`, which is
// why `istSichereUrl` is applied in the PARSER — an unsafe URL never becomes a
// link node in the first place.
//
// Shared on purpose: the expanded bio page needs the same renderer and the same
// ```gm fence, so this module is not wiki-private.
//
// The inline scanner is deliberately a single pass over indices, never nested
// regexes. `/\*\*(.+?)\*\*/g`-style parsing is where catastrophic backtracking
// lives, and any player can save a page — this is attacker-influenced input.
import { wikiSlug } from './wikiSlug.js';
import { WIKI_LIMITS } from './wikiTypen.js';

export type WikiInline =
  | { typ: 'text'; text: string }
  | { typ: 'fett'; kinder: WikiInline[] }
  | { typ: 'kursiv'; kinder: WikiInline[] }
  | { typ: 'code'; text: string }
  | { typ: 'umbruch' }
  | { typ: 'wikilink'; slug: string; text: string }
  | { typ: 'extlink'; url: string; text: string };

export type WikiBlock =
  | { typ: 'absatz'; kinder: WikiInline[] }
  | { typ: 'ueberschrift'; ebene: 1 | 2 | 3; anker: string; kinder: WikiInline[] }
  | { typ: 'liste'; geordnet: boolean; punkte: WikiInline[][] }
  | { typ: 'zitat'; kinder: WikiInline[] }
  | { typ: 'trenner' }
  | { typ: 'code'; text: string }
  | { typ: 'tabelle'; kopf: WikiInline[][]; zeilen: WikiInline[][][] }
  | { typ: 'bild'; slug: string; unterschrift: string }
  | { typ: 'gmblock'; bloecke: WikiBlock[] }
  /**
   * Stands in for a GM-only region in an editor that may not see its content.
   * Never produced by the read path — see verbergeGmBloecke().
   */
  | { typ: 'gmplatzhalter'; nr: number };

export interface WikiDoc {
  bloecke: WikiBlock[];
}

/** Nesting depth for emphasis. Beyond this the markers stay literal text. */
const MAX_TIEFE = 8;

/**
 * Only http(s) links become link nodes. An allow-list, never a blacklist:
 * `java\tscript:` and friends make "strip the bad ones" a losing game. Anything
 * else — javascript:, data:, vbscript:, file:, protocol-relative //host —
 * degrades to plain text.
 */
export function istSichereUrl(url: string): boolean {
  const s = url.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

// --- Inline ---

function wikilinkKnoten(inner: string): WikiInline | null {
  // [[bild:…]] and [[gm:…]] are blocks, not inlines: mid-sentence they stay
  // literal text rather than becoming a link to a page named „bild".
  if (/^(bild|gm):/i.test(inner.trim())) return null;
  const strich = inner.indexOf('|');
  const ziel = (strich === -1 ? inner : inner.slice(0, strich)).trim();
  const text = (strich === -1 ? inner : inner.slice(strich + 1)).trim();
  if (!ziel) return null;
  return { typ: 'wikilink', slug: wikiSlug(ziel), text: text || ziel };
}

function externerLink(s: string, i: number): { knoten: WikiInline; next: number } | null {
  const zu = s.indexOf(']', i + 1);
  if (zu === -1 || s[zu + 1] !== '(') return null;
  const klammer = s.indexOf(')', zu + 2);
  if (klammer === -1) return null;
  const url = s.slice(zu + 2, klammer).trim();
  // Returning null leaves the '[' as literal text, so an unsafe URL renders as
  // the characters the author typed instead of a link.
  if (!istSichereUrl(url)) return null;
  const text = s.slice(i + 1, zu);
  return {
    knoten: { typ: 'extlink', url, text: text.trim() || url },
    next: klammer + 1,
  };
}

function parseInline(s: string, tiefe = 0): WikiInline[] {
  const out: WikiInline[] = [];
  let puffer = '';
  const spuele = () => {
    if (puffer) {
      out.push({ typ: 'text', text: puffer });
      puffer = '';
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === '\n') {
      spuele();
      out.push({ typ: 'umbruch' });
      i += 1;
      continue;
    }

    if (s.startsWith('[[', i)) {
      const zu = s.indexOf(']]', i + 2);
      if (zu !== -1) {
        const knoten = wikilinkKnoten(s.slice(i + 2, zu));
        if (knoten) {
          spuele();
          out.push(knoten);
          i = zu + 2;
          continue;
        }
      }
    }

    if (c === '[') {
      const link = externerLink(s, i);
      if (link) {
        spuele();
        out.push(link.knoten);
        i = link.next;
        continue;
      }
    }

    if (c === '`') {
      const zu = s.indexOf('`', i + 1);
      if (zu !== -1) {
        spuele();
        out.push({ typ: 'code', text: s.slice(i + 1, zu) });
        i = zu + 1;
        continue;
      }
    }

    if (tiefe < MAX_TIEFE && s.startsWith('**', i)) {
      const zu = s.indexOf('**', i + 2);
      if (zu !== -1) {
        spuele();
        out.push({ typ: 'fett', kinder: parseInline(s.slice(i + 2, zu), tiefe + 1) });
        i = zu + 2;
        continue;
      }
    }

    if (tiefe < MAX_TIEFE && c === '*') {
      const zu = s.indexOf('*', i + 1);
      // `zu > i + 1` keeps an unclosed `**fett` literal: without it the second
      // star of the opener would be taken as this one's closer, silently
      // swallowing both into an empty emphasis node.
      if (zu > i + 1) {
        spuele();
        out.push({ typ: 'kursiv', kinder: parseInline(s.slice(i + 1, zu), tiefe + 1) });
        i = zu + 1;
        continue;
      }
    }

    // No opener matched, or none of them found a closer: the character is just
    // a character.
    puffer += c;
    i += 1;
  }

  spuele();
  return out;
}

// --- Blocks ---

const UEBERSCHRIFT = /^(#{1,3})\s+(.*)$/;
const AUFZAEHLUNG = /^[-*]\s+(.*)$/;
const NUMMERIERT = /^\d+\.\s+(.*)$/;
const ZITAT = /^>\s?(.*)$/;
const TRENNER = /^-{3,}\s*$/;
const ZAUN = /^```(.*)$/;
const BILD = /^\[\[bild:([^\]|]+)(?:\|([^\]]*))?\]\]$/i;
const GM_PLATZHALTER = /^\[\[gm:(\d{1,4})\]\]$/i;
const TABELLEN_TRENNER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Does this line start a block of its own? Used to end a paragraph. */
function istBlockAnfang(zeile: string): boolean {
  return (
    !zeile.trim() ||
    UEBERSCHRIFT.test(zeile) ||
    AUFZAEHLUNG.test(zeile) ||
    NUMMERIERT.test(zeile) ||
    ZITAT.test(zeile) ||
    TRENNER.test(zeile) ||
    ZAUN.test(zeile) ||
    BILD.test(zeile.trim()) ||
    GM_PLATZHALTER.test(zeile.trim())
  );
}

function tabellenZellen(zeile: string): string[] {
  let s = zeile.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((z) => z.trim());
}

/**
 * Anchors are handed out per document so the table of contents and the rendered
 * headings agree, including the -2 suffix on a repeated heading.
 */
function ankerFuer(text: string, vergeben: Map<string, number>): string {
  const basis = wikiSlug(text);
  const n = (vergeben.get(basis) ?? 0) + 1;
  vergeben.set(basis, n);
  return n === 1 ? basis : `${basis}-${n}`;
}

function parseBloecke(zeilen: string[], anker: Map<string, number>, tiefe: number): WikiBlock[] {
  const out: WikiBlock[] = [];
  let i = 0;

  while (i < zeilen.length) {
    const zeile = zeilen[i];

    if (!zeile.trim()) {
      i += 1;
      continue;
    }

    const zaun = ZAUN.exec(zeile);
    if (zaun) {
      const info = zaun[1].trim().toLowerCase();
      const inhalt: string[] = [];
      i += 1;
      while (i < zeilen.length && !ZAUN.test(zeilen[i])) {
        inhalt.push(zeilen[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of input)
      if (info === 'gm' && tiefe === 0) {
        // A container, not verbatim code: GM-only regions hold real prose.
        // Only at top level — a gm block inside a gm block adds nothing.
        out.push({ typ: 'gmblock', bloecke: parseBloecke(inhalt, anker, tiefe + 1) });
      } else {
        out.push({ typ: 'code', text: inhalt.join('\n') });
      }
      continue;
    }

    const ueber = UEBERSCHRIFT.exec(zeile);
    if (ueber) {
      const ebene = ueber[1].length as 1 | 2 | 3;
      const text = ueber[2].trim();
      out.push({ typ: 'ueberschrift', ebene, anker: ankerFuer(text, anker), kinder: parseInline(text) });
      i += 1;
      continue;
    }

    if (TRENNER.test(zeile)) {
      out.push({ typ: 'trenner' });
      i += 1;
      continue;
    }

    const bild = BILD.exec(zeile.trim());
    if (bild) {
      out.push({ typ: 'bild', slug: bild[1].trim(), unterschrift: (bild[2] ?? '').trim() });
      i += 1;
      continue;
    }

    const platzhalter = GM_PLATZHALTER.exec(zeile.trim());
    if (platzhalter) {
      out.push({ typ: 'gmplatzhalter', nr: Number(platzhalter[1]) });
      i += 1;
      continue;
    }

    if (ZITAT.test(zeile)) {
      const teile: string[] = [];
      while (i < zeilen.length && ZITAT.test(zeilen[i])) {
        teile.push((ZITAT.exec(zeilen[i]) as RegExpExecArray)[1]);
        i += 1;
      }
      out.push({ typ: 'zitat', kinder: parseInline(teile.join('\n')) });
      continue;
    }

    const geordnet = NUMMERIERT.test(zeile);
    if (geordnet || AUFZAEHLUNG.test(zeile)) {
      const muster = geordnet ? NUMMERIERT : AUFZAEHLUNG;
      const punkte: WikiInline[][] = [];
      while (i < zeilen.length && muster.test(zeilen[i])) {
        punkte.push(parseInline((muster.exec(zeilen[i]) as RegExpExecArray)[1]));
        i += 1;
      }
      out.push({ typ: 'liste', geordnet, punkte });
      continue;
    }

    // A table needs a separator row directly under its header, otherwise the
    // pipes are just characters in a paragraph.
    if (zeile.includes('|') && i + 1 < zeilen.length && TABELLEN_TRENNER.test(zeilen[i + 1])) {
      const kopf = tabellenZellen(zeile).map((z) => parseInline(z));
      i += 2;
      const reihen: WikiInline[][][] = [];
      while (i < zeilen.length && zeilen[i].includes('|') && zeilen[i].trim()) {
        reihen.push(tabellenZellen(zeilen[i]).map((z) => parseInline(z)));
        i += 1;
      }
      out.push({ typ: 'tabelle', kopf, zeilen: reihen });
      continue;
    }

    const absatz: string[] = [];
    while (i < zeilen.length && !istBlockAnfang(zeilen[i])) {
      absatz.push(zeilen[i]);
      i += 1;
    }
    // istBlockAnfang() is true for the very first line only if it is a table
    // header we did not take; guard against an empty paragraph looping forever.
    if (absatz.length === 0) {
      absatz.push(zeilen[i]);
      i += 1;
    }
    out.push({ typ: 'absatz', kinder: parseInline(absatz.join('\n')) });
  }

  return out;
}

export function parseWiki(quelle: string): WikiDoc {
  const text = (quelle ?? '').slice(0, WIKI_LIMITS.TEXT_MAX);
  const zeilen = text.replace(/\r\n?/g, '\n').split('\n').slice(0, WIKI_LIMITS.ZEILEN_MAX);
  return { bloecke: parseBloecke(zeilen, new Map(), 0) };
}

// --- Walking the tree ---

function inlineSammeln(kinder: WikiInline[], fn: (k: WikiInline) => void): void {
  for (const k of kinder) {
    fn(k);
    if (k.typ === 'fett' || k.typ === 'kursiv') inlineSammeln(k.kinder, fn);
  }
}

function blockSammeln(bloecke: WikiBlock[], fn: (b: WikiBlock) => void): void {
  for (const b of bloecke) {
    fn(b);
    if (b.typ === 'gmblock') blockSammeln(b.bloecke, fn);
  }
}

/**
 * Walks blocks and their inline children together, in document order — which
 * matters for the teaser, where "first 180 characters" has to mean the first
 * 180 the reader would see.
 */
function alleKnoten(
  bloecke: WikiBlock[],
  aufBlock: (b: WikiBlock) => void,
  aufInline: (k: WikiInline) => void,
): void {
  for (const b of bloecke) {
    aufBlock(b);
    switch (b.typ) {
      case 'absatz':
      case 'ueberschrift':
      case 'zitat':
        inlineSammeln(b.kinder, aufInline);
        break;
      case 'liste':
        for (const p of b.punkte) inlineSammeln(p, aufInline);
        break;
      case 'tabelle':
        for (const z of b.kopf) inlineSammeln(z, aufInline);
        for (const r of b.zeilen) for (const z of r) inlineSammeln(z, aufInline);
        break;
      case 'gmblock':
        alleKnoten(b.bloecke, aufBlock, aufInline);
        break;
      default:
        break;
    }
  }
}

const KEIN_BLOCK = () => {};
const KEIN_INLINE = () => {};

function inlineText(kinder: WikiInline[]): string {
  const teile: string[] = [];
  inlineSammeln(kinder, (k) => {
    if (k.typ === 'text' || k.typ === 'code') teile.push(k.text);
    if (k.typ === 'wikilink' || k.typ === 'extlink') teile.push(k.text);
  });
  return teile.join(' ').replace(/\s+/g, ' ').trim();
}

/** Every [[Wikilink]] target, deduplicated, in document order. */
export function sammleLinks(doc: WikiDoc): string[] {
  const out: string[] = [];
  const gesehen = new Set<string>();
  alleKnoten(doc.bloecke, KEIN_BLOCK, (k) => {
    if (k.typ === 'wikilink' && !gesehen.has(k.slug)) {
      gesehen.add(k.slug);
      out.push(k.slug);
    }
  });
  return out;
}

/** Every [[bild:…]] slug, deduplicated, in document order. */
export function sammleBilder(doc: WikiDoc): string[] {
  const out: string[] = [];
  const gesehen = new Set<string>();
  blockSammeln(doc.bloecke, (b) => {
    if (b.typ === 'bild' && !gesehen.has(b.slug)) {
      gesehen.add(b.slug);
      out.push(b.slug);
    }
  });
  return out;
}

/** Markers stripped — feeds the search index and the list teaser. */
export function alsKlartext(doc: WikiDoc): string {
  const teile: string[] = [];
  alleKnoten(
    doc.bloecke,
    (b) => {
      if (b.typ === 'code') teile.push(b.text);
      if (b.typ === 'bild' && b.unterschrift) teile.push(b.unterschrift);
    },
    (k) => {
      if (k.typ === 'text' || k.typ === 'code') teile.push(k.text);
      if (k.typ === 'wikilink' || k.typ === 'extlink') teile.push(k.text);
    },
  );
  return teile.join(' ').replace(/\s+/g, ' ').trim();
}

export function auszug(doc: WikiDoc, max: number = WIKI_LIMITS.AUSZUG_MAX): string {
  const text = alsKlartext(doc);
  if (text.length <= max) return text;
  const schnitt = text.slice(0, max);
  const luecke = schnitt.lastIndexOf(' ');
  return `${(luecke > max * 0.6 ? schnitt.slice(0, luecke) : schnitt).trimEnd()}…`;
}

export interface WikiInhaltsZeile {
  anker: string;
  ebene: 1 | 2 | 3;
  text: string;
}

export function inhaltsverzeichnis(doc: WikiDoc): WikiInhaltsZeile[] {
  const out: WikiInhaltsZeile[] = [];
  blockSammeln(doc.bloecke, (b) => {
    if (b.typ === 'ueberschrift') {
      out.push({ anker: b.anker, ebene: b.ebene, text: inlineText(b.kinder) });
    }
  });
  return out;
}

export function hatGmBloecke(doc: WikiDoc): boolean {
  return doc.bloecke.some((b) => b.typ === 'gmblock');
}

/**
 * The document as a reader without GM rights may see it. Used on the SERVER
 * before responding — a client that merely declined to render GM regions would
 * still have shipped the text, and anyone could read it in the network tab.
 */
export function ohneGmBloecke(doc: WikiDoc): WikiDoc {
  return { bloecke: doc.bloecke.filter((b) => b.typ !== 'gmblock' && b.typ !== 'gmplatzhalter') };
}

/**
 * Splits raw source into "everything a non-GM may see" and the GM-only regions.
 *
 * `text` keeps one `[[gm:n]]` line where each region stood; `bloecke[n-1]` is
 * that region's source INCLUDING its fences. Two different callers need the two
 * halves:
 *
 *   * the read view takes `text` with the markers dropped (quelleOhneGm),
 *   * the editor takes `text` as it is, so a player who cannot see a secret
 *     section can still see THAT one is there and keep it in place.
 *
 * Without the marker a player's save would silently delete the GM's notes: they
 * would receive text without those regions, edit it, and send back exactly what
 * they received. Nothing a player typed is ever dropped, and neither is
 * anything the GM typed.
 */
export function verbergeGmBloecke(quelle: string): { text: string; bloecke: string[] } {
  const zeilen = (quelle ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const bloecke: string[] = [];
  let aktuell: string[] | null = null;

  for (const zeile of zeilen) {
    const zaun = ZAUN.exec(zeile);
    if (zaun) {
      const info = zaun[1].trim().toLowerCase();
      if (!aktuell && info === 'gm') {
        aktuell = [zeile];
        continue;
      }
      if (aktuell) {
        aktuell.push(zeile);
        bloecke.push(aktuell.join('\n'));
        out.push(`[[gm:${bloecke.length}]]`);
        aktuell = null;
        continue;
      }
    }
    if (aktuell) aktuell.push(zeile);
    else out.push(zeile);
  }
  // Unterminated fence: keep what there is rather than losing it.
  if (aktuell) {
    bloecke.push(aktuell.join('\n'));
    out.push(`[[gm:${bloecke.length}]]`);
  }
  return { text: out.join('\n'), bloecke };
}

/**
 * Puts the regions back where their markers stand. A marker the author deleted
 * takes its region with it — that is a deliberate, visible act — and a number
 * without a region simply disappears.
 */
export function stelleGmBloeckeHer(text: string, bloecke: readonly string[]): string {
  if (bloecke.length === 0) return text ?? '';
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((zeile) => {
      const treffer = GM_PLATZHALTER.exec(zeile.trim());
      if (!treffer) return zeile;
      return bloecke[Number(treffer[1]) - 1] ?? null;
    })
    .filter((z): z is string => z !== null)
    .join('\n');
}

/**
 * Same removal on the raw source, so the server can send a GM-free source text
 * (the read view renders from source). Markers go too — the reader is not
 * editing anything, so a placeholder would only raise a question it cannot
 * answer.
 */
export function quelleOhneGm(quelle: string): string {
  return verbergeGmBloecke(quelle)
    .text.split('\n')
    .filter((z) => !GM_PLATZHALTER.test(z.trim()))
    .join('\n');
}
