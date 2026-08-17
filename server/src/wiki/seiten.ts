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
  wikiSuchtext,
  zeilenBilanz,
} from 'shared';
import type { WikiArt, WikiLogEintrag, WikiSeiteInfo, WikiSeiteVoll, WikiTag } from 'shared';
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

export function ladeSeite(user: WikiLeser, row: WikiSeiteRow): WikiSeiteVoll {
  const rev = letzteFassung(row.id);
  const quelle = rev?.text ?? '';
  // GM-only regions are removed HERE, on the server. A client that merely
  // declined to render them would still have shipped the text, and anyone could
  // read it in the network tab.
  const text = user.isGm ? quelle : quelleOhneGm(quelle);
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

interface LogEinfuegen {
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

function schreibeLog(e: LogEinfuegen): number {
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
function schreibeAbgeleitetes(pageId: number, titel: string, quelle: string, tags: WikiTag[]): string {
  const docVoll = parseWiki(quelle);
  const docPublic = ohneGmBloecke(docVoll);
  const auszug = auszugVon(docPublic);

  db.prepare('DELETE FROM wiki_links WHERE from_page_id = ?').run(pageId);
  const linkStmt = db.prepare('INSERT OR IGNORE INTO wiki_links (from_page_id, to_slug) VALUES (?, ?)');
  for (const ziel of sammleLinks(docVoll)) linkStmt.run(pageId, ziel);

  db.prepare('DELETE FROM wiki_page_tags WHERE page_id = ?').run(pageId);
  const tagStmt = db.prepare('INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_key, tag) VALUES (?, ?, ?)');
  for (const t of tags) tagStmt.run(pageId, t.key, t.tag);

  if (HAT_FTS) {
    // Two indexes so a player's snippet can never quote a GM-only block.
    db.prepare('DELETE FROM wiki_fts WHERE rowid = ?').run(pageId);
    db.prepare('DELETE FROM wiki_fts_gm WHERE rowid = ?').run(pageId);
    db.prepare('INSERT INTO wiki_fts (rowid, titel, text) VALUES (?, ?, ?)').run(
      pageId,
      titel,
      wikiSuchtext(titel, alsKlartext(docPublic)),
    );
    db.prepare('INSERT INTO wiki_fts_gm (rowid, titel, text) VALUES (?, ?, ?)').run(
      pageId,
      titel,
      wikiSuchtext(titel, alsKlartext(docVoll)),
    );
  }

  return auszug;
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
    throw new WikiKonflikt(seite, altText, alt.author_name);
  }

  const titel = kappe(eingabe.titel, WIKI_LIMITS.TITEL_MAX).trim() || seite.titel;
  const text = kappe(eingabe.text, WIKI_LIMITS.TEXT_MAX);
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

// --- Change log ---

function alsLogEintrag(row: Record<string, unknown>): WikiLogEintrag {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    titel: String(row.titel),
    nr: Number(row.nr),
    art: String(row.art) as WikiArt,
    autorName: String(row.author_name ?? ''),
    erstelltAm: String(row.created_at),
    kommentar: String(row.kommentar ?? ''),
    zeilenPlus: Number(row.zeilen_plus ?? 0),
    zeilenMinus: Number(row.zeilen_minus ?? 0),
    ...(row.feld ? { feld: String(row.feld) } : {}),
    ...(row.alt_wert != null ? { altWert: String(row.alt_wert) } : {}),
    ...(row.neu_wert != null ? { neuWert: String(row.neu_wert) } : {}),
  };
}

/** One page's history, newest first. */
export function verlaufFuer(pageId: number): WikiLogEintrag[] {
  const rows = db
    .prepare(
      `SELECT r.*, p.slug AS slug
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE r.page_id = ?
        ORDER BY r.nr DESC`,
    )
    .all(pageId) as Record<string, unknown>[];
  return rows.map(alsLogEintrag);
}

/** The wiki-wide feed. Filtered in SQL so invisible pages never reach the page. */
export function letzteAenderungen(user: WikiLeser, limit = 100, vor?: string): WikiLogEintrag[] {
  const filter = sichtbarkeitsFilter(user);
  const rows = db
    .prepare(
      `SELECT r.*, p.slug AS slug
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE ${filter.sql} ${vor ? 'AND r.created_at < ?' : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`,
    )
    .all(...filter.args, ...(vor ? [vor] : []), Math.min(limit, 300)) as Record<string, unknown>[];
  return rows.map(alsLogEintrag);
}

export function fassungsText(pageId: number, revId: number): string | null {
  const row = db.prepare('SELECT text FROM wiki_revisions WHERE id = ? AND page_id = ?').get(revId, pageId) as
    | { text: string | null }
    | undefined;
  return row?.text ?? null;
}
