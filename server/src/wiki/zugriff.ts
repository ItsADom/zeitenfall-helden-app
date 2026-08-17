// The wiki's single access authority — the counterpart to characterAccess() in
// routes.ts, and for the same reason: one place to reason about, rather than a
// visibility check copied into fifteen queries.
//
// Two rules that must not drift:
//
//   * "Not allowed to see it" answers 404, never 403. A 403 would confirm that
//     a GM-only page with that name exists. The one deliberate exception is a
//     protected page: it is visible, so admitting it exists leaks nothing.
//   * A pure Admin gets NOTHING beyond a player here. isAdmin manages accounts
//     and deliberately has no insight into character sheets (anti-cheat); story
//     secrets follow exactly the same logic.
import type { SessionUser } from '../auth.js';
import { db } from '../db.js';

export interface WikiSeiteRow {
  id: number;
  slug: string;
  titel: string;
  aktuelle_rev: number | null;
  auszug: string;
  gm_only: number;
  geschuetzt: number;
  geloescht_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything a wiki decision needs from a user, and nothing more. */
export type WikiLeser = Pick<SessionUser, 'id' | 'isGm'>;

/**
 * SQL fragment + parameters restricting a page query to what this reader may
 * see. Returned as SQL rather than filtered in JS so lists, search and the
 * change log can never accidentally page over rows they then drop.
 */
export function sichtbarkeitsFilter(user: WikiLeser, alias = 'p'): { sql: string; args: unknown[] } {
  if (user.isGm) return { sql: '1=1', args: [] };
  return { sql: `${alias}.gm_only = 0 AND ${alias}.geloescht_at IS NULL`, args: [] };
}

function rowFuerSlug(slug: string): WikiSeiteRow | undefined {
  const direkt = db.prepare('SELECT * FROM wiki_pages WHERE slug = ?').get(slug) as WikiSeiteRow | undefined;
  if (direkt) return direkt;
  // Renamed pages keep their old address working via the alias table.
  return db
    .prepare('SELECT p.* FROM wiki_slug_alias a JOIN wiki_pages p ON p.id = a.page_id WHERE a.slug = ?')
    .get(slug) as WikiSeiteRow | undefined;
}

/**
 * The page this reader may see under `slug`, or null. A null result means the
 * route answers 404 — it never distinguishes "does not exist" from "not yours".
 */
export function seiteFuer(user: WikiLeser, slug: string): WikiSeiteRow | null {
  const row = rowFuerSlug(slug);
  if (!row) return null;
  if (user.isGm) return row;
  if (row.gm_only || row.geloescht_at) return null;
  return row;
}

/** Same lookup by id, for routes that already resolved the page. */
export function seiteFuerId(user: WikiLeser, id: number): WikiSeiteRow | null {
  const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(id) as WikiSeiteRow | undefined;
  if (!row) return null;
  if (user.isGm) return row;
  if (row.gm_only || row.geloescht_at) return null;
  return row;
}

/**
 * May this reader write to this page? False only for a protected page, which
 * is the one case that answers 403 rather than 404.
 */
export function darfBearbeiten(user: WikiLeser, seite: WikiSeiteRow): boolean {
  return user.isGm || !seite.geschuetzt;
}
