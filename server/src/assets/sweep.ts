// The safety net under the cleanup hooks.
//
// SQLite has no cross-database foreign key, so deleting a wiki page or a
// character cannot cascade into helden-assets.db. Explicit hooks do that job —
// and hooks get missed: a delete path added later, a crash between the two
// writes, a row inserted by hand. This sweep is what makes „missed" mean „gone
// next week" instead of „never".
//
// It lives here rather than in assets/store.ts because it is the one piece that
// must know BOTH databases: the store deliberately knows nothing about
// helden.db, and gets handed the live id set instead.
//
// Soft-deleted wiki pages still have their row in wiki_pages, so a page in the
// trash keeps its pictures — restoring it has to bring them back.
import { db } from '../db.js';
import { fegeVerwaisteAssets } from './store.js';

const ids = (sql: string): Set<number> =>
  new Set((db.prepare(sql).all() as { id: number }[]).map((r) => r.id));

export function fegeVerwaisteBilder(): void {
  try {
    fegeVerwaisteAssets('wiki', ids('SELECT id FROM wiki_pages'));
    fegeVerwaisteAssets('character', ids('SELECT id FROM characters'));
    fegeVerwaisteAssets('group', ids('SELECT id FROM groups'));
    // Nutzer besitzen kein Bild, aber ihren eigenen Benachrichtigungston.
    fegeVerwaisteAssets('user', ids('SELECT id FROM users'));
  } catch (err) {
    console.error('[assets] Aufräumen verwaister Bilder fehlgeschlagen:', err);
  }
}

/** Weekly, alongside the images' own backup — they change on the same rhythm. */
export function startAssetSweep(): void {
  const stunden = Number(process.env.BACKUP_ASSETS_INTERVAL_HOURS) || 168;
  fegeVerwaisteBilder();
  setInterval(fegeVerwaisteBilder, stunden * 60 * 60 * 1000).unref();
}
