// The change log — which is also the version history, because it is one table.
//
// Two surfaces over the same rows: one page's `Verlauf`, and the wiki-wide
// „Letzte Änderungen". Nothing is ever pruned; history here is prose somebody
// wrote, not telemetry. The offsite growth that would otherwise cause is fixed
// in the backup script, not with a retention window.
//
// This module reads the log and writes exactly one kind of row: a restore. It
// is a normal save with an old text — history GROWS on an undo, it never
// shrinks, so the undo is itself auditable.
import { zeilenBilanz } from 'shared';
import type { WikiArt, WikiLogEintrag } from 'shared';
import { db } from '../db.js';
import { WikiGeschuetzt, schreibeAbgeleitetes, schreibeLog, sichtbareQuelle } from './seiten.js';
import type { WikiLeser, WikiSeiteRow } from './zugriff.js';
import { sichtbarkeitsFilter } from './zugriff.js';

/**
 * Metadata rows a player must not see. A „nur Spielleiter"-toggle would
 * otherwise tell them the page used to be secret, which is exactly the fact the
 * flag exists to hide.
 */
const NUR_GM_ARTEN: readonly WikiArt[] = ['sichtbarkeit', 'geschuetzt', 'geloescht'];

const artFilter = (user: WikiLeser): string =>
  user.isGm ? '' : ` AND r.art NOT IN (${NUR_GM_ARTEN.map((a) => `'${a}'`).join(',')})`;

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
    /** Only a row that HAS a text can be compared or restored. */
    hatText: row.text != null,
    ...(row.feld ? { feld: String(row.feld) } : {}),
    ...(row.alt_wert != null ? { altWert: String(row.alt_wert) } : {}),
    ...(row.neu_wert != null ? { neuWert: String(row.neu_wert) } : {}),
  };
}

/** One page's history, newest first. */
export function verlaufFuer(user: WikiLeser, pageId: number): WikiLogEintrag[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.nr, r.art, r.titel, r.feld, r.alt_wert, r.neu_wert,
              r.zeilen_plus, r.zeilen_minus, r.author_name, r.kommentar, r.created_at,
              r.text IS NOT NULL AS text, p.slug AS slug
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE r.page_id = ?${artFilter(user)}
        ORDER BY r.nr DESC`,
    )
    .all(pageId) as Record<string, unknown>[];
  // `text IS NOT NULL` comes back as 0/1; alsLogEintrag only asks whether it is
  // null, and 0 is not null — normalise before handing it over.
  return rows.map((r) => alsLogEintrag({ ...r, text: r.text ? '' : null }));
}

export interface AenderungsFilter {
  /** Exact author name as it was written into the row. */
  autor?: string;
  /** One page only. */
  slug?: string;
  /** ISO dates, inclusive; `bis` covers the whole day. */
  von?: string;
  bis?: string;
  limit?: number;
  /** Keyset pagination: the created_at of the last row of the previous page. */
  vor?: string;
}

/**
 * The wiki-wide feed. Every restriction is applied in SQL — a filter that ran
 * in the client would mean the invisible rows had already been sent.
 */
export function letzteAenderungen(user: WikiLeser, filter: AenderungsFilter = {}): WikiLogEintrag[] {
  const sicht = sichtbarkeitsFilter(user);
  const wo: string[] = [sicht.sql];
  const args: unknown[] = [...sicht.args];

  if (filter.autor) {
    wo.push('r.author_name = ?');
    args.push(filter.autor);
  }
  if (filter.slug) {
    wo.push('p.slug = ?');
    args.push(filter.slug);
  }
  if (filter.von) {
    wo.push('r.created_at >= ?');
    args.push(filter.von);
  }
  if (filter.bis) {
    // A date, not a timestamp: „bis 3. Mai" means the whole of 3 May.
    wo.push('r.created_at < ?');
    args.push(`${filter.bis}T23:59:59.999`);
  }
  if (filter.vor) {
    wo.push('r.created_at < ?');
    args.push(filter.vor);
  }

  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 300);
  const rows = db
    .prepare(
      `SELECT r.id, r.nr, r.art, r.titel, r.feld, r.alt_wert, r.neu_wert,
              r.zeilen_plus, r.zeilen_minus, r.author_name, r.kommentar, r.created_at,
              r.text IS NOT NULL AS text, p.slug AS slug
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE ${wo.join(' AND ')}${artFilter(user)}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`,
    )
    .all(...args, limit) as Record<string, unknown>[];
  return rows.map((r) => alsLogEintrag({ ...r, text: r.text ? '' : null }));
}

/** Distinct author names, for the filter's dropdown. Visible pages only. */
export function autoren(user: WikiLeser): string[] {
  const sicht = sichtbarkeitsFilter(user);
  return (
    db
      .prepare(
        `SELECT DISTINCT r.author_name AS name
           FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
          WHERE ${sicht.sql} AND r.author_name <> ''
          ORDER BY r.author_name COLLATE NOCASE`,
      )
      .all(...sicht.args) as { name: string }[]
  ).map((r) => r.name);
}

/**
 * One revision's text, masked for this reader exactly like the read view. The
 * diff view fetches through here, so an old revision can never hand out a
 * GM-only section that the current one refuses.
 */
export function fassungsText(user: WikiLeser, pageId: number, revId: number): string | null {
  const row = db.prepare('SELECT text FROM wiki_revisions WHERE id = ? AND page_id = ?').get(revId, pageId) as
    | { text: string | null }
    | undefined;
  if (!row || row.text == null) return null;
  return sichtbareQuelle(user, row.text, 'lesen');
}

/**
 * „Diese Fassung übernehmen" — writes a NEW revision whose text is the old one.
 *
 * The text comes out of the database, never off the wire, so restoring brings
 * back GM-only sections intact even when a player triggers it: they restore
 * content they cannot read, which is the correct outcome and not a leak.
 */
export function stelleFassungHer(
  user: WikiLeser & { name: string },
  seite: WikiSeiteRow,
  revId: number,
): { nr: number } | null {
  if (!user.isGm && seite.geschuetzt) throw new WikiGeschuetzt();

  const ziel = db.prepare('SELECT id, nr, text FROM wiki_revisions WHERE id = ? AND page_id = ?').get(revId, seite.id) as
    | { id: number; nr: number; text: string | null }
    | undefined;
  if (!ziel || ziel.text == null) return null;

  const jetzt = db
    .prepare('SELECT id, text FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
    .get(seite.id) as { id: number; text: string } | undefined;
  const aktuell = jetzt?.text ?? '';
  if (aktuell === ziel.text) return null; // Nothing to undo.

  const tags = (
    db.prepare('SELECT tag, tag_key FROM wiki_page_tags WHERE page_id = ?').all(seite.id) as {
      tag: string;
      tag_key: string;
    }[]
  ).map((r) => ({ tag: r.tag, key: r.tag_key }));

  const text = ziel.text;
  const bilanz = zeilenBilanz(aktuell, text);

  const herstellen = db.transaction((): { nr: number } => {
    const revIdNeu = schreibeLog({
      pageId: seite.id,
      art: 'wiederhergestellt',
      // The page keeps its CURRENT name — a restore undoes text, not the title.
      titel: seite.titel,
      text,
      zeilenPlus: bilanz.plus,
      zeilenMinus: bilanz.minus,
      kommentar: `Fassung ${ziel.nr} wiederhergestellt`,
      tags,
      autor: { id: user.id, name: user.name },
      basisRev: jetzt?.id ?? null,
    });
    // Restoring a revision restores what it did to the derived data too — a
    // page that used to be a redirect becomes one again, and one that stopped
    // being a redirect stops.
    const { auszug, weiterleitung } = schreibeAbgeleitetes(seite.id, seite.titel, text, tags, seite.slug);
    db.prepare(
      `UPDATE wiki_pages
          SET aktuelle_rev = ?, auszug = ?, weiterleitung = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(revIdNeu, auszug, weiterleitung, seite.id);
    const neu = db.prepare('SELECT nr FROM wiki_revisions WHERE id = ?').get(revIdNeu) as { nr: number };
    return { nr: neu.nr };
  });
  return herstellen();
}
