// Namensräume: „Kategorie:Orte" is a real wiki page.
//
// The alternative was a separate table holding a description text per category.
// Making a category an ordinary page instead means it inherits everything the
// wiki already does — history, permissions, search, the change log, images —
// for the price of one column. A second store would have needed all of that
// built again, worse.
//
// Which namespace a page is in follows from its TITLE, the way it does on
// Wikipedia. That keeps creating one ordinary („Kategorie:Orte" in the new-page
// dialog) and keeps rename honest: drop the prefix and the page really does
// become a normal page again.
//
// The type itself lives in wikiTypen.ts: this module imports wikiTags, which
// imports wikiTypen, so declaring it here would close a cycle.
import type { WikiNamensraum } from './wikiTypen.js';
import { wikiTagKey } from './wikiTags.js';

/** Spelling used when the app writes a category title itself. */
export const KATEGORIE_PRAEFIX = 'Kategorie';

// Tolerant on the way in („kategorie:orte", „Kategorie : Orte"), canonical on
// the way out — otherwise two spellings of the same category drift apart.
const KATEGORIE_TITEL = /^\s*kategorie\s*:\s*(.+)$/i;

export interface WikiTitelTeile {
  namensraum: WikiNamensraum;
  /** The title without its namespace prefix — what gets shown as the heading. */
  name: string;
}

/**
 * Splits „Kategorie:Orte" into its namespace and its name. A title that is only
 * the prefix („Kategorie:") is NOT a category — it would be a category with no
 * name — and stays an ordinary page.
 */
export function teileTitel(titelRoh: string): WikiTitelTeile {
  const titel = (titelRoh ?? '').trim();
  const treffer = KATEGORIE_TITEL.exec(titel);
  const name = treffer?.[1].trim();
  if (!name) return { namensraum: 'seite', name: titel };
  return { namensraum: 'kategorie', name };
}

/** The stored title for a namespace and name — the inverse of teileTitel. */
export function vollerTitel(namensraum: WikiNamensraum, name: string): string {
  const rein = (name ?? '').trim();
  return namensraum === 'kategorie' ? `${KATEGORIE_PRAEFIX}:${rein}` : rein;
}

export function kategorieTitel(name: string): string {
  return vollerTitel('kategorie', name);
}

export function istKategorieTitel(titel: string): boolean {
  return teileTitel(titel).namensraum === 'kategorie';
}

/**
 * The folded key linking a category PAGE to the category TAG that pages carry.
 * Null for anything that is not a category page.
 *
 * Deliberately not derived from the slug: freierSlug() may hand „Kategorie:Orte"
 * the address `kategorie-orte-2` if something already sits on `kategorie-orte`,
 * and a lookup built on the slug would then silently stop finding the page. The
 * key is computed from the name and stored, so the link cannot come apart.
 */
export function kategorieKeyFuerTitel(titel: string): string | null {
  const { namensraum, name } = teileTitel(titel);
  if (namensraum !== 'kategorie') return null;
  return wikiTagKey(name) || null;
}
