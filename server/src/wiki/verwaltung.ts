// The GM's tools: visibility, protection, and the trash.
//
// Every one of these is `requireGm`, never `requireGmOrAdmin`. A pure Admin
// manages accounts and deliberately has no insight into character sheets —
// that is an anti-cheat decision, and story secrets follow exactly the same
// logic. Somebody who can create users must not thereby be able to read what
// the party has not discovered yet.
//
// Each change writes a metadata row into the change log, so the log answers
// „since when is this page protected, and who did that?" the same way it
// answers everything else. Those rows are GM-only to read — see verlauf.ts.
import { parseWiki } from 'shared';
import { db } from '../db.js';
import { assetsFuer, loescheAssetsFuer } from '../assets/store.js';
import { WikiTitelVergeben, WikiUnloeschbar, loescheIndex, schreibeIndex, schreibeLog } from './seiten.js';
import type { WikiLeser, WikiSeiteRow } from './zugriff.js';

export interface PapierkorbEintrag {
  slug: string;
  titel: string;
  geloeschtAm: string;
  bilder: number;
}

type Autor = WikiLeser & { name: string };

const alsAutor = (user: Autor) => ({ id: user.id, name: user.name });

/**
 * Flips „nur Spielleiter" or „geschützt". Returns the page as it now stands, or
 * null if the flag already had that value — a log entry saying nothing changed
 * is noise in the one place that has to stay readable.
 */
export function setzeFlag(
  user: Autor,
  seite: WikiSeiteRow,
  feld: 'gm_only' | 'geschuetzt',
  wert: boolean,
): WikiSeiteRow | null {
  const alt = !!seite[feld];
  if (alt === wert) return null;

  const wörter =
    feld === 'gm_only'
      ? { an: 'nur Spielleiter', aus: 'alle' }
      : { an: 'nur Spielleitung darf bearbeiten', aus: 'alle dürfen bearbeiten' };

  const umstellen = db.transaction((): WikiSeiteRow => {
    db.prepare(`UPDATE wiki_pages SET ${feld} = ? WHERE id = ?`).run(wert ? 1 : 0, seite.id);
    schreibeLog({
      pageId: seite.id,
      art: feld === 'gm_only' ? 'sichtbarkeit' : 'geschuetzt',
      titel: seite.titel,
      feld: feld === 'gm_only' ? 'sichtbarkeit' : 'schutz',
      altWert: alt ? wörter.an : wörter.aus,
      neuWert: wert ? wörter.an : wörter.aus,
      autor: alsAutor(user),
    });
    return db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(seite.id) as WikiSeiteRow;
  });
  return umstellen();
}

/**
 * Soft delete. An evening's writing must not disappear on a misclick, so the
 * page moves to the trash rather than out of existence — history, images and
 * incoming links all stay.
 *
 * The search index rows DO go: leaving them would make indexNachziehen() see a
 * permanent mismatch between live pages and indexed rows and rebuild on every
 * single boot.
 *
 * Throws for an `unloeschbar` system page — refused for a GM too, not just
 * everyone else, since the whole point is that these two pages always exist.
 */
export function loescheSeite(user: Autor, seite: WikiSeiteRow): boolean {
  if (seite.unloeschbar) throw new WikiUnloeschbar();
  if (seite.geloescht_at) return false;
  const loeschen = db.transaction(() => {
    db.prepare("UPDATE wiki_pages SET geloescht_at = datetime('now') WHERE id = ?").run(seite.id);
    loescheIndex(seite.id);
    schreibeLog({
      pageId: seite.id,
      art: 'geloescht',
      titel: seite.titel,
      feld: 'zustand',
      altWert: 'sichtbar',
      neuWert: 'Papierkorb',
      autor: alsAutor(user),
    });
  });
  loeschen();
  return true;
}

/**
 * Back out of the trash, index included.
 *
 * A category page can only come back if its category is still free: somebody
 * may have written a new „Kategorie:Orte" while the old one sat in the trash,
 * and two description pages for one category is exactly the state the unique
 * index exists to prevent. Refusing here turns that into a clear message
 * instead of a constraint violation.
 */
export function stelleSeiteHer(user: Autor, seite: WikiSeiteRow): boolean {
  if (!seite.geloescht_at) return false;
  if (seite.kategorie_key) {
    const belegt = db
      .prepare(
        "SELECT 1 FROM wiki_pages WHERE kategorie_key = ? AND namensraum = 'kategorie' AND geloescht_at IS NULL AND id <> ?",
      )
      .get(seite.kategorie_key, seite.id);
    // Thrown, not returned false: the caller maps false onto „gibt es nicht",
    // and that is the one thing this is not.
    if (belegt) throw new WikiTitelVergeben(seite.titel);
  }
  const text =
    (db.prepare('SELECT text FROM wiki_revisions WHERE id = ?').get(seite.aktuelle_rev) as
      | { text: string | null }
      | undefined)?.text ?? '';

  const herstellen = db.transaction(() => {
    db.prepare('UPDATE wiki_pages SET geloescht_at = NULL WHERE id = ?').run(seite.id);
    schreibeIndex(seite.id, seite.titel, parseWiki(text));
    schreibeLog({
      pageId: seite.id,
      art: 'wiederhergestellt',
      titel: seite.titel,
      feld: 'zustand',
      altWert: 'Papierkorb',
      neuWert: 'sichtbar',
      autor: alsAutor(user),
    });
  });
  herstellen();
  return true;
}

export function papierkorb(): PapierkorbEintrag[] {
  const rows = db
    .prepare(
      `SELECT id, slug, titel, geloescht_at AS geloeschtAm
         FROM wiki_pages WHERE geloescht_at IS NOT NULL
        ORDER BY geloescht_at DESC`,
    )
    .all() as { id: number; slug: string; titel: string; geloeschtAm: string }[];
  // The image count makes the hard-delete warning concrete — „samt 3 Bildern"
  // is a different decision from „samt 0 Bildern". Counted rather than joined:
  // the pictures live in the other database file.
  return rows.map(({ id, ...rest }) => ({ ...rest, bilder: assetsFuer('wiki', id).length }));
}

/**
 * Irreversible. Rows in helden.db go by CASCADE; the images do NOT, because
 * they are in a second file and SQLite cannot cascade across one — so the hook
 * is called by hand, here, at the only place a wiki page ever really dies.
 *
 * The `unloeschbar` check here is belt-and-suspenders: loescheSeite() already
 * refuses to put such a page in the trash in the first place, so this path
 * should be unreachable for one — but a second guard at the one place a page
 * truly disappears costs nothing.
 */
export function endgueltigLoeschen(seite: WikiSeiteRow): boolean {
  if (seite.unloeschbar) throw new WikiUnloeschbar();
  if (!seite.geloescht_at) return false; // Only ever from the trash.
  const bilder = loescheAssetsFuer('wiki', seite.id);
  const loeschen = db.transaction(() => {
    loescheIndex(seite.id);
    // aktuelle_rev points at wiki_revisions and back — clear it first so the
    // circular reference does not block the delete.
    db.prepare('UPDATE wiki_pages SET aktuelle_rev = NULL WHERE id = ?').run(seite.id);
    db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(seite.id);
  });
  loeschen();
  console.log(`[wiki] Seite „${seite.titel}" endgültig gelöscht (${bilder} Bild(er) mit entfernt)`);
  return true;
}
