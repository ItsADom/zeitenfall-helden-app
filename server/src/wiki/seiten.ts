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
  kategorieKeyFuerTitel,
  normalizeWikiTags,
  ohneGmBloecke,
  parseWiki,
  quelleOhneGm,
  sammleLinks,
  stelleGmBloeckeHer,
  teileTitel,
  verbergeGmBloecke,
  weiterleitungsZiel,
  wikiSlug,
  wikiSuchtext,
  zeilenBilanz,
} from 'shared';
import type { WikiArt, WikiDoc, WikiNamensraum, WikiSeiteInfo, WikiSeiteVoll, WikiTag } from 'shared';
import { db } from '../db.js';
import { HAT_FTS } from './schema.js';
import type { WikiLeser, WikiSeiteRow } from './zugriff.js';
import { seiteFuer, sichtbarkeitsFilter } from './zugriff.js';

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

/** System page (see seedSystemSeiten.ts) — deletion is refused outright, for anyone, GM included. */
export class WikiUnloeschbar extends Error {
  constructor() {
    super('Diese Systemseite kann nicht gelöscht werden');
    this.name = 'WikiUnloeschbar';
  }
}

/**
 * A category may have only one description page, so renaming a page onto an
 * occupied „Kategorie:…" title is refused rather than silently made a duplicate
 * — two pages describing one category is how they start contradicting.
 */
export class WikiTitelVergeben extends Error {
  constructor(readonly titel: string) {
    super(`Es gibt bereits eine Seite „${titel}"`);
    this.name = 'WikiTitelVergeben';
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
    unloeschbar: !!row.unloeschbar,
    geaendertAm: row.updated_at,
    autorName,
    tags: tagsVon(row.id),
    namensraum: row.namensraum as WikiNamensraum,
    weiterleitung: row.weiterleitung,
  };
}

/**
 * The page list.
 *
 * `alle` is for the change-log filter, which offers every page somebody could
 * have edited. The default is the reader's list — articles only: a category
 * page belongs in the category directory, and a redirect is a signpost whose
 * card would say nothing but the name of somewhere else.
 */
export function listeSeiten(user: WikiLeser, { alle = false }: { alle?: boolean } = {}): WikiSeiteInfo[] {
  const filter = sichtbarkeitsFilter(user);
  const nurArtikel = alle ? '' : " AND p.namensraum = 'seite' AND p.weiterleitung IS NULL";
  const rows = db
    .prepare(
      `SELECT p.*, COALESCE(r.author_name, '') AS autorName
       FROM wiki_pages p
       LEFT JOIN wiki_revisions r ON r.id = p.aktuelle_rev
       WHERE ${filter.sql} AND p.geloescht_at IS NULL${nurArtikel}
       ORDER BY p.titel COLLATE NOCASE`,
    )
    .all(...filter.args) as (WikiSeiteRow & { autorName: string })[];
  return rows.map((r) => alsInfo(r, r.autorName));
}

/**
 * The live description page of a category, by folded key. Null while nobody has
 * written one — a category exists as soon as a page carries the tag, and the
 * red link inviting a description is the point.
 */
export function kategorieSeite(user: WikiLeser, key: string): WikiSeiteRow | null {
  const row = db
    .prepare("SELECT * FROM wiki_pages WHERE kategorie_key = ? AND namensraum = 'kategorie' AND geloescht_at IS NULL")
    .get(key) as WikiSeiteRow | undefined;
  if (!row) return null;
  return user.isGm || !row.gm_only ? row : null;
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

/**
 * The page a redirect points at — exactly ONE hop.
 *
 * Chasing a chain would need loop detection and would hide the fact that the
 * chain exists; landing on a second signpost makes the problem visible to the
 * person best placed to fix it. Same call MediaWiki makes.
 */
export function folgeWeiterleitung(user: WikiLeser, seite: WikiSeiteRow): WikiSeiteRow | null {
  if (!seite.weiterleitung) return null;
  const ziel = seiteFuer(user, seite.weiterleitung);
  // Invisible or missing target: stay on the signpost, which at least says
  // where it meant to go and can be edited.
  if (!ziel || ziel.id === seite.id) return null;
  return ziel;
}

export function ladeSeite(
  user: WikiLeser,
  row: WikiSeiteRow,
  modus: LadeModus = 'lesen',
  weitergeleitetVon?: WikiSeiteRow | null,
): WikiSeiteVoll {
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
    linkZiele: linkZiele(user, [...sammleLinks(doc), ...(row.weiterleitung ? [row.weiterleitung] : [])]),
    weitergeleitetVon: weitergeleitetVon ? { slug: weitergeleitetVon.slug, titel: weitergeleitetVon.titel } : null,
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
export function schreibeAbgeleitetes(
  pageId: number,
  titel: string,
  quelle: string,
  tags: WikiTag[],
  eigenerSlug: string,
): { auszug: string; weiterleitung: string | null } {
  const docVoll = parseWiki(quelle);
  const docPublic = ohneGmBloecke(docVoll);
  const auszug = auszugVon(docPublic);

  // A page pointing at itself is a loop with one step in it. Treating it as an
  // ordinary page is the only reading that leaves the text reachable.
  const ziel = weiterleitungsZiel(quelle);
  const weiterleitung = ziel && ziel !== eigenerSlug ? ziel : null;

  db.prepare('DELETE FROM wiki_links WHERE from_page_id = ?').run(pageId);
  const linkStmt = db.prepare('INSERT OR IGNORE INTO wiki_links (from_page_id, to_slug) VALUES (?, ?)');
  for (const zielSlug of sammleLinks(docVoll)) linkStmt.run(pageId, zielSlug);
  // The redirect marker is a link too — otherwise the target's „Was hierher
  // verweist" would not list the signpost pointing at it, which is exactly
  // where a wrong redirect gets noticed.
  if (weiterleitung) linkStmt.run(pageId, weiterleitung);

  db.prepare('DELETE FROM wiki_page_tags WHERE page_id = ?').run(pageId);
  const tagStmt = db.prepare('INSERT OR IGNORE INTO wiki_page_tags (page_id, tag_key, tag) VALUES (?, ?, ?)');
  for (const t of tags) tagStmt.run(pageId, t.key, t.tag);

  schreibeIndex(pageId, titel, docVoll);

  return { auszug, weiterleitung };
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

/**
 * Address for a title. A category gets the predictable `kategorie-orte` rather
 * than whatever the generic slugger produces, so the address can be typed and
 * guessed — and falls back to the ordinary allocator if something already sits
 * there, which is why the tag→page link runs over kategorie_key and not this.
 */
function slugFuerTitel(titel: string, istVergeben: (slug: string) => boolean = slugVergeben): string {
  const { namensraum, name } = teileTitel(titel);
  if (namensraum !== 'kategorie') return freierSlug(titel, istVergeben);
  const wunsch = `kategorie-${wikiSlug(name)}`;
  return istVergeben(wunsch) ? freierSlug(titel, istVergeben) : wunsch;
}

/**
 * `tagsRoh` pre-sets categories at creation time — e.g. the character sheet's
 * red link hands over "Spielercharakter" so a new character page starts
 * already filed, instead of the author having to remember to tag it.
 */
export function legeSeiteAn(autor: { id: number; name: string }, titelRoh: string, tagsRoh?: unknown): WikiSeiteRow {
  const titel = kappe(titelRoh, WIKI_LIMITS.TITEL_MAX).trim();
  if (!titel) throw new Error('Titel fehlt');
  const { namensraum } = teileTitel(titel);
  const kategorieKey = kategorieKeyFuerTitel(titel);
  const tags = namensraum === 'kategorie' ? [] : normalizeWikiTags(tagsRoh);

  const anlegen = db.transaction((): WikiSeiteRow => {
    // Two pages describing one category would eventually contradict each other.
    // Node runs this transaction to completion before the next request, so the
    // check and the insert cannot be interleaved.
    if (kategorieKey) {
      const schon = db
        .prepare("SELECT * FROM wiki_pages WHERE kategorie_key = ? AND namensraum = 'kategorie' AND geloescht_at IS NULL")
        .get(kategorieKey) as WikiSeiteRow | undefined;
      if (schon) throw new WikiTitelVergeben(titel);
    }
    const slug = slugFuerTitel(titel);
    const info = db
      .prepare('INSERT INTO wiki_pages (slug, titel, namensraum, kategorie_key) VALUES (?, ?, ?, ?)')
      .run(slug, titel, namensraum, kategorieKey);
    const pageId = Number(info.lastInsertRowid);
    const revId = schreibeLog({ pageId, art: 'angelegt', titel, text: '', autor });
    db.prepare('UPDATE wiki_pages SET aktuelle_rev = ? WHERE id = ?').run(revId, pageId);
    schreibeAbgeleitetes(pageId, titel, '', tags, slug);
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

  // The namespace follows the title, so a rename can move a page into the
  // category namespace or back out of it. Refused only when the target category
  // already has a description page.
  const { namensraum } = teileTitel(titel);
  const kategorieKey = kategorieKeyFuerTitel(titel);
  if (titelGeaendert && kategorieKey && kategorieKey !== seite.kategorie_key) {
    const schon = db
      .prepare(
        "SELECT 1 FROM wiki_pages WHERE kategorie_key = ? AND namensraum = 'kategorie' AND geloescht_at IS NULL AND id <> ?",
      )
      .get(kategorieKey, seite.id);
    if (schon) throw new WikiTitelVergeben(titel);
  }

  const speichern = db.transaction((): WikiSeiteRow => {
    let slug = seite.slug;
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
      const neuerSlug = slugFuerTitel(titel, (s) => s !== seite.slug && slugVergeben(s));
      if (neuerSlug !== seite.slug) {
        db.prepare('INSERT OR IGNORE INTO wiki_slug_alias (slug, page_id) VALUES (?, ?)').run(seite.slug, seite.id);
        db.prepare('DELETE FROM wiki_slug_alias WHERE slug = ?').run(neuerSlug);
        db.prepare('UPDATE wiki_pages SET slug = ? WHERE id = ?').run(neuerSlug, seite.id);
        slug = neuerSlug;
      }
      db.prepare('UPDATE wiki_pages SET namensraum = ?, kategorie_key = ? WHERE id = ?').run(
        namensraum,
        kategorieKey,
        seite.id,
      );
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

    const { auszug, weiterleitung } = schreibeAbgeleitetes(seite.id, titel, text, tags, slug);
    db.prepare(
      `UPDATE wiki_pages
          SET titel = ?, aktuelle_rev = ?, auszug = ?, weiterleitung = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(titel, revId, auszug, weiterleitung, seite.id);
    return db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(seite.id) as WikiSeiteRow;
  });
  return speichern();
}

/**
 * Repairs pages whose namespace or redirect disagrees with what their title and
 * text say, at boot.
 *
 * Same idea as indexNachziehen(): a column added to an existing database is
 * backfilled with its DEFAULT, not with the right answer. A page somebody had
 * already titled „Kategorie:Orte" before namespaces existed would keep
 * namensraum='seite' and never show up as the category it plainly is.
 *
 * The redirect column drifts the other way round, and that case is realistic:
 * a release rollback puts code back on a migrated database, and an edit made
 * under the older code updates the text without touching the column. The page
 * would then keep redirecting after rolling forward although its text no longer
 * says so. Both columns are derived, so both are recomputed — a derived value
 * nobody re-derives is a value that eventually lies.
 *
 * Runs unconditionally rather than behind a version counter: a counter would
 * miss the rollback case and a database restored from an older backup alike.
 */
export function namensraeumeNachziehen(): void {
  const kandidaten = db
    .prepare(
      `SELECT p.id AS id, p.slug AS slug, p.titel AS titel, p.namensraum AS namensraum,
              p.kategorie_key AS kategorieKey, p.weiterleitung AS weiterleitung,
              COALESCE(r.text, '') AS text
         FROM wiki_pages p LEFT JOIN wiki_revisions r ON r.id = p.aktuelle_rev`,
    )
    .all() as {
    id: number;
    slug: string;
    titel: string;
    namensraum: string;
    kategorieKey: string | null;
    weiterleitung: string | null;
    text: string;
  }[];

  const belegt = new Set(
    kandidaten.filter((k) => k.kategorieKey && k.namensraum === 'kategorie').map((k) => k.kategorieKey as string),
  );

  let geaendert = 0;
  const lauf = db.transaction(() => {
    for (const k of kandidaten) {
      const { namensraum } = teileTitel(k.titel);
      const key = kategorieKeyFuerTitel(k.titel);
      const ziel = weiterleitungsZiel(k.text);
      const weiterleitung = ziel && ziel !== k.slug ? ziel : null;
      if (namensraum === k.namensraum && key === k.kategorieKey && weiterleitung === k.weiterleitung) continue;
      // Two pre-existing pages could both be titled „Kategorie:Orte"; only the
      // first may claim the category, or the unique index rejects the second.
      if (key && belegt.has(key)) continue;
      if (key) belegt.add(key);
      db.prepare('UPDATE wiki_pages SET namensraum = ?, kategorie_key = ?, weiterleitung = ? WHERE id = ?').run(
        namensraum,
        key,
        weiterleitung,
        k.id,
      );
      geaendert++;
    }
  });
  lauf();
  if (geaendert > 0) console.log(`[wiki] Namensräume nachgezogen: ${geaendert} Seite(n)`);
}

// Reading the change log lives in verlauf.ts — this module owns writing it.
