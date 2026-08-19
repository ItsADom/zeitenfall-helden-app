// Helpers around SQLite's FTS5 full-text search.
//
// Two things here are not optional, both verified against this repo's own
// better-sqlite3 build:
//
//   1. Raw user input in MATCH THROWS. `NEAR("a` is an unterminated string, a
//      bare `-` is a syntax error. Every query goes through ftsAnfrage().
//   2. The tokenizer's `remove_diacritics 2` folds ü→u but leaves ß alone, so
//      "Straße" is not findable as "strasse". wikiSuchtext() indexes a folded
//      copy alongside the original to close that gap.
import { faltDeutsch } from './wikiSlug.js';
import { WIKI_LIMITS } from './wikiTypen.js';

/**
 * Turns whatever the user typed into a syntactically valid FTS5 query.
 *
 * Every term is wrapped in double quotes, which makes it a literal and strips
 * all operator meaning from `-`, `^`, `OR`, `NEAR(` and friends. The `*` stays
 * OUTSIDE the quotes — that is the only position where it still means "prefix".
 *
 * Returns '' for input with nothing usable in it; the caller short-circuits
 * rather than sending an empty MATCH.
 */
export function ftsAnfrage(eingabe: string): string {
  return faltDeutsch(eingabe ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, WIKI_LIMITS.SUCHE_TERME_MAX)
    .map((t) => `"${t}"*`)
    .join(' ');
}

/**
 * What goes into the FTS `text` column: the readable text plus a written-out
 * copy, so both „Straße" and „strasse" find the page. The duplicate costs a
 * little index size and buys the ß case, which German prose hits constantly.
 */
export function wikiSuchtext(titel: string, klartext: string): string {
  return `${klartext}\n${faltDeutsch(titel)}\n${faltDeutsch(klartext)}`;
}

export interface SchnipselTeil {
  mark: boolean;
  text: string;
}

/**
 * Splits an FTS `snippet()` result on the guillemets we ask SQLite to wrap
 * matches in. Guillemets rather than HTML tags on purpose: nothing in this app
 * renders HTML from data, and a snippet is data.
 */
export function schnipselTeile(schnipsel: string): SchnipselTeil[] {
  const out: SchnipselTeil[] = [];
  let rest = schnipsel ?? '';
  while (rest) {
    const auf = rest.indexOf('«');
    if (auf === -1) break;
    const zu = rest.indexOf('»', auf + 1);
    if (zu === -1) break;
    if (auf > 0) out.push({ mark: false, text: rest.slice(0, auf) });
    out.push({ mark: true, text: rest.slice(auf + 1, zu) });
    rest = rest.slice(zu + 1);
  }
  if (rest) out.push({ mark: false, text: rest });
  return out;
}
