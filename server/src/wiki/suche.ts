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
import { ftsAnfrage, parseWiki, teileTitel, wikiTagKey } from 'shared';
import type { WikiKategorie, WikiKategorieAnsicht, WikiTreffer } from 'shared';
import { db } from '../db.js';
import { neueSeiten } from './neuigkeiten.js';
import { HAT_FTS } from './schema.js';
import { kategorieSeite, ladeSeite, schreibeIndex } from './seiten.js';
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

/**
 * Every category, with its own description page and its place in the tree.
 *
 * A category exists as soon as one page carries the tag — and also as soon as
 * somebody writes „Kategorie:Orte" without anything being in it yet, which is
 * how you build a structure before filling it. Hence the UNION: the tag table
 * alone would miss the empty ones, the page table alone the undescribed ones.
 *
 * Pages and subcategories are counted apart, the way Wikipedia lists them.
 */
export function kategorien(user: WikiLeser): WikiKategorie[] {
  const filter = sichtbarkeitsFilter(user);
  const zeilen = db
    .prepare(
      `SELECT t.tag_key AS key,
              MIN(t.tag)                                        AS tag,
              SUM(CASE WHEN p.namensraum = 'seite'     THEN 1 ELSE 0 END) AS anzahl,
              SUM(CASE WHEN p.namensraum = 'kategorie' THEN 1 ELSE 0 END) AS unterAnzahl
         FROM wiki_page_tags t JOIN wiki_pages p ON p.id = t.page_id
        WHERE ${filter.sql} AND p.geloescht_at IS NULL
        GROUP BY t.tag_key`,
    )
    .all(...filter.args) as { key: string; tag: string; anzahl: number; unterAnzahl: number }[];

  const nachKey = new Map(zeilen.map((z) => [z.key, { ...z, seitenSlug: null as string | null, eltern: [] as string[] }]));

  // The description pages: they supply the display spelling for an empty
  // category, and their own tags are what makes the tree a tree.
  const seiten = db
    .prepare(
      `SELECT p.kategorie_key AS key, p.slug AS slug, p.titel AS titel
         FROM wiki_pages p
        WHERE p.namensraum = 'kategorie' AND p.kategorie_key IS NOT NULL
          AND ${filter.sql} AND p.geloescht_at IS NULL`,
    )
    .all(...filter.args) as { key: string; slug: string; titel: string }[];

  for (const s of seiten) {
    const vorhanden = nachKey.get(s.key);
    if (vorhanden) {
      vorhanden.seitenSlug = s.slug;
      continue;
    }
    nachKey.set(s.key, {
      key: s.key,
      tag: teileTitel(s.titel).name,
      anzahl: 0,
      unterAnzahl: 0,
      seitenSlug: s.slug,
      eltern: [],
    });
  }

  // Parents, read off the description pages' own categories.
  const eltern = db
    .prepare(
      `SELECT p.kategorie_key AS kind, t.tag_key AS elternKey
         FROM wiki_pages p JOIN wiki_page_tags t ON t.page_id = p.id
        WHERE p.namensraum = 'kategorie' AND p.kategorie_key IS NOT NULL
          AND ${filter.sql} AND p.geloescht_at IS NULL`,
    )
    .all(...filter.args) as { kind: string; elternKey: string }[];
  for (const e of eltern) nachKey.get(e.kind)?.eltern.push(e.elternKey);

  return [...nachKey.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'de'));
}

/**
 * The ordinary pages in one category, matched on the folded key („NPCs" = „npcs").
 *
 * Trägt dieselbe „neu"-Marke wie die Übersicht: es ist dieselbe Kartenliste, und
 * ohne die Marke sähe dieselbe Seite hier gelesen und dort ungelesen aus.
 */
export function seitenInKategorie(user: WikiLeser, tag: string): WikiKategorieAnsicht['seiten'] {
  const filter = sichtbarkeitsFilter(user);
  const rows = db
    .prepare(
      `SELECT p.slug AS slug, p.titel AS titel, p.auszug AS auszug
         FROM wiki_page_tags t JOIN wiki_pages p ON p.id = t.page_id
        WHERE t.tag_key = ? AND p.namensraum = 'seite'
          AND ${filter.sql} AND p.geloescht_at IS NULL
        ORDER BY p.titel COLLATE NOCASE`,
    )
    .all(wikiTagKey(tag), ...filter.args) as { slug: string; titel: string; auszug: string }[];
  const neu = neueSeiten(user);
  return rows.map((r) => ({ ...r, neu: neu.has(r.slug) }));
}

/**
 * Everything the view of one category needs, in one round trip: its description
 * page (an ordinary page, so it goes through ladeSeite and gets the same GM
 * treatment as any other), its subcategories, its pages, and the categories it
 * belongs to itself.
 */
export function kategorieAnsicht(user: WikiLeser, tagRoh: string): WikiKategorieAnsicht {
  const key = wikiTagKey(tagRoh);
  const alle = kategorien(user);
  const eigen = alle.find((k) => k.key === key);
  const seite = kategorieSeite(user, key);

  return {
    key,
    // The description page's own title wins over whatever spelling the tags
    // happen to carry: somebody wrote it down there deliberately.
    tag: seite ? teileTitel(seite.titel).name : (eigen?.tag ?? tagRoh),
    seite: seite ? ladeSeite(user, seite) : null,
    unterkategorien: alle.filter((k) => k.eltern.includes(key)),
    seiten: seitenInKategorie(user, key),
    eltern: eigen?.eltern ?? [],
  };
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
