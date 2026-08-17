// Full-text search over the wiki, plus the categories view.
//
// Three things about SQLite's FTS5 that were verified against this repo's own
// better-sqlite3 build, and that the code below depends on:
//
//   1. RAW USER INPUT IN `MATCH` THROWS. `NEAR("a` is an unterminated string, a
//      bare `-` a syntax error. Everything goes through ftsAnfrage() first —
//      that is not defensive style, it is the difference between a search box
//      and a 500.
//   2. `bm25()` returns NEGATIVE numbers, more negative = better, so the sort
//      is ASC. Written down because it looks like a bug and invites a "fix".
//   3. `remove_diacritics 2` folds ü→u but NOT ß, so „Straße" would not be
//      findable as „strasse". wikiSuchtext() indexes a written-out copy
//      alongside; see wikiSuche.ts.
//
// Which index gets queried is decided by role, in SQL: wiki_fts holds the
// public text, wiki_fts_gm the full text. A player's snippet therefore cannot
// quote a GM-only block even by accident, because that text is not in the
// table they searched.
import { ftsAnfrage, parseWiki, wikiTagKey } from 'shared';
import type { WikiKategorie, WikiTreffer } from 'shared';
import { db } from '../db.js';
import { HAT_FTS } from './schema.js';
import { schreibeIndex } from './seiten.js';
import type { WikiLeser } from './zugriff.js';
import { sichtbarkeitsFilter } from './zugriff.js';

const TREFFER_MAX = 30;

/**
 * Fallback when FTS5 is not compiled in: a substring match over title and
 * teaser. Deliberately NOT over the body — the teaser is public text by
 * construction, the body is not, and a LIKE over raw source would be the one
 * place in the wiki where a GM block could leak.
 */
function likeSuche(user: WikiLeser, roh: string): WikiTreffer[] {
  const filter = sichtbarkeitsFilter(user);
  const muster = `%${roh.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT p.slug AS slug, p.titel AS titel, p.auszug AS auszug
         FROM wiki_pages p
        WHERE (p.titel LIKE ? ESCAPE '\\' OR p.auszug LIKE ? ESCAPE '\\')
          AND ${filter.sql} AND p.geloescht_at IS NULL
        ORDER BY p.titel COLLATE NOCASE
        LIMIT ?`,
    )
    .all(muster, muster, ...filter.args, TREFFER_MAX) as { slug: string; titel: string; auszug: string }[];
  return rows.map((r) => ({ slug: r.slug, titel: r.titel, schnipsel: r.auszug }));
}

export function sucheSeiten(user: WikiLeser, roh: string): WikiTreffer[] {
  const eingabe = (roh ?? '').trim();
  if (!eingabe) return [];
  if (!HAT_FTS) return likeSuche(user, eingabe);

  const anfrage = ftsAnfrage(eingabe);
  // Nothing usable left (single letters, only punctuation) — a MATCH with an
  // empty string is a syntax error, so answer "no hits" instead.
  if (!anfrage) return [];

  const tabelle = user.isGm ? 'wiki_fts_gm' : 'wiki_fts';
  const filter = sichtbarkeitsFilter(user);
  try {
    return db
      .prepare(
        `SELECT p.slug AS slug, p.titel AS titel,
                snippet(${tabelle}, 1, '«', '»', '…', 12) AS schnipsel
           FROM ${tabelle} JOIN wiki_pages p ON p.id = ${tabelle}.rowid
          WHERE ${tabelle} MATCH ? AND ${filter.sql} AND p.geloescht_at IS NULL
          ORDER BY bm25(${tabelle}, 10.0, 1.0) ASC
          LIMIT ?`,
      )
      .all(anfrage, ...filter.args, TREFFER_MAX) as WikiTreffer[];
  } catch (err) {
    // ftsAnfrage() should make this unreachable. If some input still gets
    // through, a search box that finds less beats one that returns a 500.
    console.warn('[wiki] FTS-Abfrage fehlgeschlagen, weiche auf LIKE aus:', err);
    return likeSuche(user, eingabe);
  }
}

/** Every category with the number of visible pages in it. */
export function kategorien(user: WikiLeser): WikiKategorie[] {
  const filter = sichtbarkeitsFilter(user);
  return db
    .prepare(
      `SELECT t.tag_key AS key, MIN(t.tag) AS tag, COUNT(*) AS anzahl
         FROM wiki_page_tags t JOIN wiki_pages p ON p.id = t.page_id
        WHERE ${filter.sql} AND p.geloescht_at IS NULL
        GROUP BY t.tag_key
        ORDER BY tag COLLATE NOCASE`,
    )
    .all(...filter.args) as WikiKategorie[];
}

/** The pages in one category, matched on the folded key („NPCs" = „npcs"). */
export function seitenInKategorie(user: WikiLeser, tag: string): { slug: string; titel: string; auszug: string }[] {
  const filter = sichtbarkeitsFilter(user);
  return db
    .prepare(
      `SELECT p.slug AS slug, p.titel AS titel, p.auszug AS auszug
         FROM wiki_page_tags t JOIN wiki_pages p ON p.id = t.page_id
        WHERE t.tag_key = ? AND ${filter.sql} AND p.geloescht_at IS NULL
        ORDER BY p.titel COLLATE NOCASE`,
    )
    .all(wikiTagKey(tag), ...filter.args) as { slug: string; titel: string; auszug: string }[];
}

/**
 * Rebuilds both indexes from the current text of every live page.
 *
 * Also the answer to a question a `user_version` bump could not have solved:
 * the index arrives a phase later than the pages, and a database restored from
 * a pre-wiki backup, or one that survived a release rollback, has pages without
 * index rows. Comparing the two counts at boot repairs all of those cases; a
 * version counter would only have caught the first.
 */
export function neuIndizieren(): number {
  if (!HAT_FTS) return 0;
  const seiten = db
    .prepare(
      `SELECT p.id AS id, p.titel AS titel, COALESCE(r.text, '') AS text
         FROM wiki_pages p LEFT JOIN wiki_revisions r ON r.id = p.aktuelle_rev
        WHERE p.geloescht_at IS NULL`,
    )
    .all() as { id: number; titel: string; text: string }[];

  const lauf = db.transaction(() => {
    db.exec('DELETE FROM wiki_fts; DELETE FROM wiki_fts_gm;');
    for (const s of seiten) schreibeIndex(s.id, s.titel, parseWiki(s.text));
  });
  lauf();
  return seiten.length;
}

/** Rebuild only if the index has drifted from the pages. Runs at boot. */
export function indexNachziehen(): void {
  if (!HAT_FTS) return;
  const seiten = (db.prepare('SELECT COUNT(*) AS n FROM wiki_pages WHERE geloescht_at IS NULL').get() as { n: number })
    .n;
  const indiziert = (db.prepare('SELECT COUNT(*) AS n FROM wiki_fts').get() as { n: number }).n;
  if (seiten === indiziert) return;
  const anzahl = neuIndizieren();
  console.log(`[wiki] Suchindex nachgezogen: ${anzahl} Seiten (vorher ${indiziert} indiziert)`);
}
