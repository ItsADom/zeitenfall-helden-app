// „N Änderungen seit deinem letzten Besuch".
//
// The watermark is a REVISION ID, not a timestamp. created_at comes from
// datetime('now') and is accurate to the second; five saves inside one second
// are ordinary during a session, and a timestamp boundary would either swallow
// four of them or never clear. An id is unique and monotonic, so the count is
// exact either way.
//
// Own edits do not count as news. You know what you just wrote, and a badge
// that lights up because of your own typo fix trains people to ignore it.
import { db } from '../db.js';
import type { WikiLeser } from './zugriff.js';
import { sichtbarkeitsFilter } from './zugriff.js';

/** Highest revision id that exists at all — the value „everything read" means. */
function hoechsteRev(): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM wiki_revisions').get() as { n: number };
  return row.n;
}

export function gesehenRev(userId: number): number {
  const row = db.prepare('SELECT gesehen_rev FROM wiki_gelesen WHERE user_id = ?').get(userId) as
    | { gesehen_rev: number }
    | undefined;
  return row?.gesehen_rev ?? 0;
}

/**
 * How many visible changes this user has not looked at yet.
 *
 * A user who has never opened the change log starts at 0, which would count the
 * entire history as new. That is technically true and practically useless, so
 * the first call sets the watermark to the current tip instead: the badge
 * begins counting from the moment somebody first sees it.
 */
export function anzahlNeu(user: WikiLeser): number {
  const bekannt = db.prepare('SELECT gesehen_rev FROM wiki_gelesen WHERE user_id = ?').get(user.id) as
    | { gesehen_rev: number }
    | undefined;
  if (!bekannt) {
    merkeGesehen(user.id);
    return 0;
  }

  const filter = sichtbarkeitsFilter(user);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE r.id > ? AND ${filter.sql}
          AND (r.author_user_id IS NULL OR r.author_user_id <> ?)`,
    )
    .get(bekannt.gesehen_rev, ...filter.args, user.id) as { n: number };
  return row.n;
}

/** Marks everything up to now as seen. Returns the new watermark. */
export function merkeGesehen(userId: number): number {
  const rev = hoechsteRev();
  db.prepare(
    `INSERT INTO wiki_gelesen (user_id, gesehen_rev) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET gesehen_rev = excluded.gesehen_rev`,
  ).run(userId, rev);
  return rev;
}

/**
 * Which of these pages changed since the watermark, by somebody else. Drives
 * the „neu" marker in the page list — the same question the badge answers, one
 * level of detail further down.
 */
export function neueSeiten(user: WikiLeser): Set<string> {
  const bekannt = gesehenRev(user.id);
  const filter = sichtbarkeitsFilter(user);
  const rows = db
    .prepare(
      `SELECT DISTINCT p.slug AS slug
         FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
        WHERE r.id > ? AND ${filter.sql} AND p.geloescht_at IS NULL
          AND (r.author_user_id IS NULL OR r.author_user_id <> ?)`,
    )
    .all(bekannt, ...filter.args, user.id) as { slug: string }[];
  return new Set(rows.map((r) => r.slug));
}
