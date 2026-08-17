// Page storage: reading, creating, and the one transaction that saves a change.
//
// Everything that mutates a page goes through speichereSeite(). That is what
// keeps the derived data — excerpt, outgoing links, categories, both search
// indexes — from drifting away from the text they describe, and it is why there
// are no triggers: there is exactly one write site, and a trigger would hide it.
import {
  WIKI_LIMITS,
  alsKlartext,
  auszug as auszugVon,
  freierSlug,
  normalizeWikiTags,
  ohneGmBloecke,
  parseWiki,
  quelleOhneGm,
  sammleLinks,
  stelleGmBloeckeHer,
  verbergeGmBloecke,
  wikiSuchtext,
  zeilenBilanz,
} from 'shared';
import type { WikiArt, WikiDoc, WikiSeiteInfo, WikiSeiteVoll, WikiTag } from 'shared';
import { db } from '../db.js';
import { HAT_FTS } from './schema.js';
import type { WikiLeser, WikiSeiteRow } from './zugriff.js';
import { sichtbarkeitsFilter } from './zugriff.js';

/** Somebody else saved while this editor was open. Surfaces as 409. */
export class WikiKonflikt extends Error {
  constructor(
    readonly seite: WikiSeiteRow,
    readonly aktuellerText: string,
    readonly aktuellerAutor: string,
  ) {
    super('Die Seite wurde zwischenzeitlich geändert');
    this.name = 'WikiKonflikt';
  }
}

/** Protected page, non-GM writer. The one case that is 403 and not 404. */
export class WikiGeschuetzt extends Error {
  constructor() {
    super('Diese Seite ist geschützt');
    this.name = 'WikiGeschuetzt';
  }
}

interface RevRow {
  id: number;
  nr: number;
  text: string | null;
  titel: string;
  author_name: string;
  created_at: string;
}

const kappe = (s: unknown, max: number): string => String(s ?? '').slice(0, max);

// --- Reading ---

function tagsVon(pageId: number): string[] {
  return (db.prepare('SELECT tag FROM wiki_page_tags WHERE page_id = ? ORDER BY tag').all(pageId) as {
    tag: string;
  }[]).map((r) => r.tag);
}

function letzteFassung(pageId: number): RevRow | undefined {
  return db
    .prepare('SELECT * FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
    .get(pageId) as RevRow | undefined;
}

function alsInfo(row: WikiSeiteRow, autorName: string): WikiSeiteInfo {
  return {
    slug: row.slug,
    titel: row.titel,
    auszug: row.auszug,
    gmOnly: !!row.gm_only,
    geschuetzt: !!row.geschuetzt,
    geaendertAm: row.updated_at,
    autorName,
    tags: tagsVon(row.id),
  };
}

export function listeSeiten(user: WikiLeser): WikiSeiteInfo[] {
  const filter = sichtbarkeitsFilter(user);
  const rows = db
    .prepare(
      `SELECT p.*, COALESCE(r.author_name, '') AS autorName
       FROM wiki_pages p
       LEFT JOIN wiki_revisions r ON r.id = p.aktuelle_rev
       WHERE ${filter.sql} AND p.geloescht_at IS NULL
       ORDER BY p.titel COLLATE NOCASE`,
    )
    .all(...filter.args) as (WikiSeiteRow & { autorName: string })[];
  return rows.map((r) => alsInfo(r, r.autorName));
}

/**
 * Which of these link targets exist and are visible to this reader. A target
 * that is missing — or GM-only for a player — comes back null, and the client
 * paints it as a red link. One round trip instead of one lookup per link.
 */
export function linkZiele(user: WikiLeser, slugs: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const slug of slugs) out[slug] = null;
  if (slugs.length === 0) return out;

  const filter = sichtbarkeitsFilter(user);
  const platzhalter = slugs.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.slug AS slug, p.titel AS titel, p.slug AS treffer
         FROM wiki_pages p
        WHERE p.slug IN (${platzhalter}) AND ${filter.sql} AND p.geloescht_at IS NULL
       UNION ALL
       SELECT a.slug AS slug, p.titel AS titel, p.slug AS treffer
         FROM wiki_slug_alias a JOIN wiki_pages p ON p.id = a.page_id
        WHERE a.slug IN (${platzhalter}) AND ${filter.sql} AND p.geloescht_at IS NULL`,
    )
    .all(...slugs, ...filter.args, ...slugs, ...filter.args) as { slug: string; titel: string }[];

  for (const row of rows) out[row.slug] = row.titel;
  return out;
}

/**
 * Which visible pages link HERE. Reads wiki_links backwards — the table is
 * written from the current text of every page, so this is always the live
 * answer rather than a cached one.
 *
 * Old addresses count: after a rename, pages still pointing at the previous
 * slug are genuinely linking to this page and would otherwise vanish from the
 * list exactly when someone needs to find them.
 */
export function verweiseAuf(user: WikiLeser, seite: WikiSeiteRow): { slug: string; titel: string }[] {
  const aliase = (
    db.prepare('SELECT slug FROM wiki_slug_alias WHERE page_id = ?').all(seite.id) as { slug: string }[]
  ).map((r) => r.slug);
  const slugs = [seite.slug, ...aliase];
  const platzhalter = slugs.map(() => '?').join(',');
  const filter = sichtbarkeitsFilter(user);
  return db
    .prepare(
      `SELECT DISTINCT p.slug AS slug, p.titel AS titel
         FROM wiki_links l JOIN wiki_pages p ON p.id = l.from_page_id
        WHERE l.to_slug IN (${platzhalter}) AND p.id <> ?
          AND ${filter.sql} AND p.geloescht_at IS NULL
        ORDER BY p.titel COLLATE NOCASE`,
    )
    .all(...slugs, seite.id, ...filter.args) as { slug: string; titel: string }[];
}

/**
 * How much of the source a reader gets. Reading drops GM regions entirely;
 * editing replaces each with a `[[gm:n]]` marker so a player can move around it
 * without deleting it. GM regions themselves are never sent to a non-GM either
 * way — this is not a rendering flag.
 */
export type LadeModus = 'lesen' | 'bearbeiten';

/** The text of `quelle` this reader may receive, in this mode. */
export function sichtbareQuelle(user: WikiLeser, quelle: string, modus: LadeModus): string {
  if (user.isGm) return quelle;
  return modus === 'bearbeiten' ? verbergeGmBloecke(quelle).text : quelleOhneGm(quelle);
}

export function ladeSeite(user: WikiLeser, row: WikiSeiteRow, modus: LadeModus = 'lesen'): WikiSeiteVoll {
  const rev = letzteFassung(row.id);
  const quelle = rev?.text ?? '';
  // GM-only regions are removed HERE, on the server. A client that merely
  // declined to render them would still have shipped the text, and anyone could
  // read it in the network tab.
  const text = sichtbareQuelle(user, quelle, modus);
  const doc = parseWiki(text);

  return {
    ...alsInfo(row, rev?.author_name ?? ''),
    text,
    revisionId: rev?.id ?? 0,
    nr: rev?.nr ?? 0,
    darfBearbeiten: user.isGm || !row.geschuetzt,
    linkZiele: linkZiele(user, sammleLinks(doc)),
  };
}

// --- Writing ---

function naechsteNr(pageId: number): number {
  const row = db.prepare('SELECT COALESCE(MAX(nr), 0) AS n FROM wiki_revisions WHERE page_id = ?').get(pageId) as {
    n: number;
  };
  return row.n + 1;
}

export interface LogEinfuegen {
  pageId: number;
  art: WikiArt;
  titel: string;
  text?: string | null;
  feld?: string | null;
  altWert?: string | null;
  neuWert?: string | null;
  zeilenPlus?: number;
  zeilenMinus?: number;
  tags?: WikiTag[];
  autor: { id: number; name: string };
  kommentar?: string;
  basisRev?: number | null;
}

export function schreibeLog(e: LogEinfuegen): number {
  const info = db
    .prepare(
      `INSERT INTO wiki_revisions
         (page_id, nr, art, titel, text, feld, alt_wert, neu_wert,
          zeilen_plus, zeilen_minus, tags, author_user_id, author_name, kommentar, base_revision_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.pageId,
      naechsteNr(e.pageId),
      e.art,
      e.titel,
      e.text ?? null,
      e.feld ?? null,
      e.altWert ?? null,
      e.neuWert ?? null,
      e.zeilenPlus ?? 0,
      e.zeilenMinus ?? 0,
      JSON.stringify((e.tags ?? []).map((t) => t.tag)),
      e.autor.id,
      e.autor.name,
      kappe(e.kommentar, WIKI_LIMITS.KOMMENTAR_MAX),
      e.basisRev ?? null,
    );
  return Number(info.lastInsertRowid);
}

/**
 * Rewrites everything derived from a page's current text. Called inside the
 * save transaction, never on its own — derived data that can be written
 * separately is derived data that will eventually disagree.
 */
export function schreibeAbgeleitetes(pageId: number, titel: string, quelle: string, tags: WikiTag[]): string {
  const docVoll = parseWiki(quelle);
  const docPublic = ohneGmBloecke(docVoll);
  const auszug = auszugVon(docPublic);

  db.prepare('DELETE FROM wiki_links WHERE from_page_id = ?').run(pageId);
  const linkStmt = db.prepare('INSERT OR IGNORE INTO wiki_links (from_page_id, to_slug) VALUES (?, ?)');
  for (const ziel of sammleLinks(docVoll)) linkStmt.run(pageId, ziel);

  db.prepare('DELETE FROM wiki_page_tags WHERE page_id = ?').run(pageId);
  const tagStmt = db.prepare('INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_key, tag) VALUES (?, ?, ?)');
  for (const t of tags) tagStmt.run(pageId, t.key, t.tag);

  schreibeIndex(pageId, titel, docVoll);

  return auszug;
}

/**
 * Both search indexes for one page. Separate from the rest of the derived data
 * because a rebuild needs exactly this and nothing else — and because there
 * must be only ONE place that decides which text lands in which index.
 */
export function schreibeIndex(pageId: number, titel: string, docVoll: WikiDoc): void {
  if (!HAT_FTS) return;
  loescheIndex(pageId);
  // Two indexes so a player's snippet can never quote a GM-only block.
  db.prepare('INSERT INTO wiki_fts (rowid, titel, text) VALUES (?, ?, ?)').run(
    pageId,
    titel,
    wikiSuchtext(titel, alsKlartext(ohneGmBloecke(docVoll))),
  );
  db.prepare('INSERT INTO wiki_fts_gm (rowid, titel, text) VALUES (?, ?, ?)').run(
    pageId,
    titel,
    wikiSuchtext(titel, alsKlartext(docVoll)),
  );
}

/** Takes a page out of both indexes — soft delete, and before every rewrite. */
export function loescheIndex(pageId: number): void {
  if (!HAT_FTS) return;
  db.prepare('DELETE FROM wiki_fts WHERE rowid = ?').run(pageId);
  db.prepare('DELETE FROM wiki_fts_gm WHERE rowid = ?').run(pageId);
}

function slugVergeben(slug: string): boolean {
  return (
    !!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug) ||
    !!db.prepare('SELECT 1 FROM wiki_slug_alias WHERE slug = ?').get(slug)
  );
}

export function legeSeiteAn(autor: { id: number; name: string }, titelRoh: string): WikiSeiteRow {
  const titel = kappe(titelRoh, WIKI_LIMITS.TITEL_MAX).trim();
  if (!titel) throw new Error('Titel fehlt');

  const anlegen = db.transaction((): WikiSeiteRow => {
    const slug = freierSlug(titel, slugVergeben);
    const info = db.prepare('INSERT INTO wiki_pages (slug, titel) VALUES (?, ?)').run(slug, titel);
    const pageId = Number(info.lastInsertRowid);
    const revId = schreibeLog({ pageId, art: 'angelegt', titel, text: '', autor });
    db.prepare('UPDATE wiki_pages SET aktuelle_rev = ? WHERE id = ?').run(revId, pageId);
    schreibeAbgeleitetes(pageId, titel, '', []);
    return db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(pageId) as WikiSeiteRow;
  });
  return anlegen();
}

export interface SpeichernEingabe {
  titel: string;
  text: string;
  kommentar: string;
  tags: unknown;
  /** The revision the editor started from; drives conflict detection. */
  basisRev: number | null;
}

/**
 * Saves a change. Returns the page as it now stands, or throws WikiKonflikt if
 * somebody else got there first — never an automatic merge, because that is
 * where prose quietly dies.
 */
export function speichereSeite(
  user: WikiLeser & { name: string },
  seite: WikiSeiteRow,
  eingabe: SpeichernEingabe,
): WikiSeiteRow {
  if (!user.isGm && seite.geschuetzt) throw new WikiGeschuetzt();

  const alt = letzteFassung(seite.id);
  const altText = alt?.text ?? '';
  if (eingabe.basisRev != null && alt && eingabe.basisRev !== alt.id) {
    // The competing text goes back to the author to compare against — through
    // the same mask, or the 409 body would hand a player what the read path
    // just refused them.
    throw new WikiKonflikt(seite, sichtbareQuelle(user, altText, 'bearbeiten'), alt.author_name);
  }

  const titel = kappe(eingabe.titel, WIKI_LIMITS.TITEL_MAX).trim() || seite.titel;
  // A non-GM edited a text whose GM-only regions were markers. Put them back
  // where the markers now stand, before anything derived is computed — the
  // stored text is always the complete one.
  const eingereicht = kappe(eingabe.text, WIKI_LIMITS.TEXT_MAX);
  const text = user.isGm
    ? eingereicht
    : stelleGmBloeckeHer(eingereicht, verbergeGmBloecke(altText).bloecke);
  const tags = normalizeWikiTags(eingabe.tags);
  const autor = { id: user.id, name: user.name };

  const textGeaendert = text !== altText;
  const titelGeaendert = titel !== seite.titel;
  // A save that changed nothing writes no log row at all: the change log should
  // record changes, not visits to the editor.
  if (!textGeaendert && !titelGeaendert) return seite;

  const speichern = db.transaction((): WikiSeiteRow => {
    if (titelGeaendert) {
      schreibeLog({
        pageId: seite.id,
        art: 'umbenannt',
        titel,
        feld: 'titel',
        altWert: seite.titel,
        neuWert: titel,
        autor,
      });
      // The old address keeps working; inbound [[…]] are deliberately NOT
      // rewritten, which would mass-edit other pages under this author's name.
      const neuerSlug = freierSlug(titel, (s) => s !== seite.slug && slugVergeben(s));
      if (neuerSlug !== seite.slug) {
        db.prepare('INSERT OR IGNORE INTO wiki_slug_alias (slug, page_id) VALUES (?, ?)').run(seite.slug, seite.id);
        db.prepare('DELETE FROM wiki_slug_alias WHERE slug = ?').run(neuerSlug);
        db.prepare('UPDATE wiki_pages SET slug = ? WHERE id = ?').run(neuerSlug, seite.id);
      }
    }

    let revId = seite.aktuelle_rev;
    if (textGeaendert) {
      const bilanz = zeilenBilanz(altText, text);
      revId = schreibeLog({
        pageId: seite.id,
        art: alt ? 'bearbeitet' : 'angelegt',
        titel,
        text,
        zeilenPlus: bilanz.plus,
        zeilenMinus: bilanz.minus,
        tags,
        autor,
        kommentar: eingabe.kommentar,
        basisRev: eingabe.basisRev,
      });
    }

    const auszug = schreibeAbgeleitetes(seite.id, titel, text, tags);
    db.prepare(
      "UPDATE wiki_pages SET titel = ?, aktuelle_rev = ?, auszug = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(titel, revId, auszug, seite.id);
    return db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(seite.id) as WikiSeiteRow;
  });
  return speichern();
}

// Reading the change log lives in verlauf.ts — this module owns writing it.
