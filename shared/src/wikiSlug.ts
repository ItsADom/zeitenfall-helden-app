// Slugs: the address a wiki page lives under, and the target a [[Wikilink]]
// resolves to.
//
// Client and server both call THIS function — a second implementation would
// eventually disagree about some title and silently break every link to it.

const UMLAUTE: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
};

export const SLUG_MAX = 80;

/**
 * German umlauts are SPELLED OUT (ä → ae), not stripped (ä → a): "Waeldchen"
 * reads the way it is meant, "Waldchen" does not. Whatever accents remain
 * afterwards (é, ô) fall away via NFD.
 *
 * Also used by the search index, where it patches a real gap: SQLite's
 * `remove_diacritics 2` folds ü→u but leaves ß alone, so "Straße" would not be
 * findable as "strasse" without a folded copy.
 */
export function faltDeutsch(s: string): string {
  return s
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTE[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Route segments under /wiki. A page titled "Neu" must not shadow /wiki/neu,
 * so the allocator skips these and hands out `neu-2` instead.
 *
 * Keep in step with the route table — the test asserts every static segment is
 * listed, which is what stops a new route from quietly colliding later.
 */
export const RESERVIERTE_SLUGS: ReadonlySet<string> = new Set([
  'neu',
  'suche',
  'kategorie',
  'kategorien',
  'aenderungen',
  'papierkorb',
  'bilder',
  'bearbeiten',
  'verlauf',
]);

export function istReservierterSlug(slug: string): boolean {
  return RESERVIERTE_SLUGS.has(slug);
}

export function wikiSlug(titel: string): string {
  const s = faltDeutsch(titel)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    // Cutting at SLUG_MAX can land mid-separator and leave a trailing hyphen.
    .replace(/-+$/, '');
  return s || 'seite';
}

/**
 * First free slug for a title. `istVergeben` is injected rather than queried
 * here so the rule stays a pure function and the database stays on the server.
 */
export function freierSlug(titel: string, istVergeben: (slug: string) => boolean): string {
  const basis = wikiSlug(titel);
  if (!istReservierterSlug(basis) && !istVergeben(basis)) return basis;
  for (let n = 2; n <= 1000; n++) {
    const kandidat = `${basis}-${n}`;
    if (!istVergeben(kandidat)) return kandidat;
  }
  // A thousand pages sharing one title is not a case worth a silent fallback.
  throw new Error(`Kein freier Slug für „${titel}" gefunden`);
}
