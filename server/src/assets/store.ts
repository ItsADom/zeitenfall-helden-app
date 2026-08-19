// Generic image storage over helden-assets.db.
//
// Knows nothing about the wiki: an asset belongs to an `owner_type` and an
// `owner_id`, and that is the whole relationship. The wiki, the bio page's
// gallery and (later) character portraits are three callers of the same four
// functions.
//
// Every function degrades to "no images" when the database could not be opened,
// rather than throwing. A missing picture is a blemish; a page that will not
// load is a failure.
import { randomBytes } from 'node:crypto';
import { wikiSlug } from 'shared';
import { assetsDb } from './db.js';
import { bildMasse } from './masse.js';

export type OwnerTyp = 'wiki' | 'character';

export interface AssetInfo {
  slug: string;
  titel: string;
  mime: string;
  bytes: number;
  breite: number;
  hoehe: number;
  pos: number;
  gmOnly: boolean;
  uploaderName: string;
  erstelltAm: string;
}

export interface AssetDaten {
  mime: string;
  data: Buffer;
  ownerType: OwnerTyp;
  ownerId: number;
  gmOnly: boolean;
}

const ALS_INFO = `slug, titel, mime, bytes, breite, hoehe, pos, gm_only AS gmOnly,
                  uploader_name AS uploaderName, created_at AS erstelltAm`;

/**
 * `wappen-von-gareth-k3f91a` — a readable name plus six random characters.
 *
 * The suffix is not decoration. An image URL is a capability: it is only ever
 * handed to somebody who was allowed to receive the page it sits on, so the
 * address itself must not be derivable from the title. Without the suffix,
 * anyone could try /api/wiki/bilder/wappen-von-gareth and see what comes back.
 */
function bildSlug(titel: string): string {
  return `${wikiSlug(titel || 'bild').slice(0, 40)}-${randomBytes(4).toString('hex').slice(0, 6)}`;
}

export function assetsFuer(ownerType: OwnerTyp, ownerId: number): AssetInfo[] {
  const db = assetsDb();
  if (!db) return [];
  const rows = db
    .prepare(`SELECT ${ALS_INFO} FROM assets WHERE owner_type = ? AND owner_id = ? ORDER BY pos, id`)
    .all(ownerType, ownerId) as (Omit<AssetInfo, 'gmOnly'> & { gmOnly: number })[];
  return rows.map((r) => ({ ...r, gmOnly: !!r.gmOnly }));
}

/** The bytes, plus who owns them — the caller checks access against that owner. */
export function ladeAsset(slug: string): AssetDaten | null {
  const db = assetsDb();
  if (!db) return null;
  const row = db
    .prepare(
      'SELECT mime, data, owner_type AS ownerType, owner_id AS ownerId, gm_only AS gmOnly FROM assets WHERE slug = ?',
    )
    .get(slug) as (Omit<AssetDaten, 'gmOnly'> & { gmOnly: number }) | undefined;
  return row ? { ...row, gmOnly: !!row.gmOnly } : null;
}

export interface NeuesAsset {
  ownerType: OwnerTyp;
  ownerId: number;
  titel: string;
  mime: string;
  data: Buffer;
  breite?: number;
  hoehe?: number;
  rolle?: string;
  gmOnly?: boolean;
  uploaderUserId?: number;
  uploaderName?: string;
}

/**
 * Stores one image and returns its slug — the name it is addressed by in markup
 * as `[[bild:slug]]`. The slug is global, not per page, so an image can be
 * embedded on a second page without being uploaded twice.
 */
export function legeAssetAn(neu: NeuesAsset): string | null {
  const db = assetsDb();
  if (!db) return null;
  let slug = bildSlug(neu.titel);
  while (db.prepare('SELECT 1 FROM assets WHERE slug = ?').get(slug)) slug = bildSlug(neu.titel);
  const pos = (
    db.prepare('SELECT COALESCE(MAX(pos), 0) AS n FROM assets WHERE owner_type = ? AND owner_id = ?').get(
      neu.ownerType,
      neu.ownerId,
    ) as { n: number }
  ).n;

  // Maße aus den Bytes, wenn der Aufrufer keine mitbringt: der Upload-Weg
  // kennt nur Titel und Bild, und ohne das stand in der Bilderliste bei jedem
  // Eintrag „0×0". Eine Stelle für alle Aufrufer statt in jedem Weg einzeln.
  const masse = neu.breite && neu.hoehe ? { breite: neu.breite, hoehe: neu.hoehe } : bildMasse(neu.data, neu.mime);

  db.prepare(
    `INSERT INTO assets (slug, owner_type, owner_id, rolle, titel, mime, bytes, breite, hoehe, pos, gm_only, data,
                         uploader_user_id, uploader_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    slug,
    neu.ownerType,
    neu.ownerId,
    neu.rolle ?? '',
    neu.titel,
    neu.mime,
    neu.data.length,
    masse.breite,
    masse.hoehe,
    pos + 1,
    neu.gmOnly ? 1 : 0,
    neu.data,
    neu.uploaderUserId ?? null,
    neu.uploaderName ?? '',
  );
  return slug;
}

/**
 * „There is exactly one image in this role for this owner" — a portrait, and
 * later anything else that is one-of rather than many-of. Replaces instead of
 * appending, so the role cannot accumulate leftovers.
 */
export function setzeEinzelAsset(rolle: string, neu: NeuesAsset): string | null {
  const db = assetsDb();
  if (!db) return null;
  const ersetzen = db.transaction(() => {
    db.prepare('DELETE FROM assets WHERE owner_type = ? AND owner_id = ? AND rolle = ?').run(
      neu.ownerType,
      neu.ownerId,
      rolle,
    );
    return legeAssetAn({ ...neu, rolle });
  });
  return ersetzen();
}

/** The one image in a role, or null. */
export function einzelAsset(ownerType: OwnerTyp, ownerId: number, rolle: string): AssetDaten | null {
  const db = assetsDb();
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT mime, data, owner_type AS ownerType, owner_id AS ownerId, gm_only AS gmOnly
         FROM assets WHERE owner_type = ? AND owner_id = ? AND rolle = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(ownerType, ownerId, rolle) as (Omit<AssetDaten, 'gmOnly'> & { gmOnly: number }) | undefined;
  return row ? { ...row, gmOnly: !!row.gmOnly } : null;
}

export function loescheEinzelAsset(ownerType: OwnerTyp, ownerId: number, rolle: string): number {
  const db = assetsDb();
  if (!db) return 0;
  return db.prepare('DELETE FROM assets WHERE owner_type = ? AND owner_id = ? AND rolle = ?').run(
    ownerType,
    ownerId,
    rolle,
  ).changes;
}

/** Only a GM ever calls this — see the wiki router. */
export function setzeAssetGmOnly(slug: string, gmOnly: boolean): boolean {
  const db = assetsDb();
  if (!db) return false;
  return db.prepare('UPDATE assets SET gm_only = ? WHERE slug = ?').run(gmOnly ? 1 : 0, slug).changes > 0;
}

export function loescheAsset(slug: string): boolean {
  const db = assetsDb();
  if (!db) return false;
  return db.prepare('DELETE FROM assets WHERE slug = ?').run(slug).changes > 0;
}

/**
 * The cleanup hook. Called when an owner is hard-deleted — emptying the wiki
 * trash, deleting a character. NOT called on a soft delete: a page that can
 * still be restored must come back with its pictures.
 */
export function loescheAssetsFuer(ownerType: OwnerTyp, ownerId: number): number {
  const db = assetsDb();
  if (!db) return 0;
  return db.prepare('DELETE FROM assets WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId).changes;
}

/**
 * The safety net under that hook, because hooks get missed — a delete path
 * added later, a crash between the two databases, a row written by hand.
 * Removes assets whose owner no longer exists in helden.db.
 *
 * The live id set is passed IN rather than queried here: this module must not
 * know about the other database, and the caller does.
 */
export function fegeVerwaisteAssets(ownerType: OwnerTyp, lebendeIds: ReadonlySet<number>): number {
  const db = assetsDb();
  if (!db) return 0;
  const besitzer = db
    .prepare('SELECT DISTINCT owner_id AS id FROM assets WHERE owner_type = ?')
    .all(ownerType) as { id: number }[];
  const verwaist = besitzer.map((b) => b.id).filter((id) => !lebendeIds.has(id));
  if (verwaist.length === 0) return 0;

  const loeschen = db.transaction(() => {
    let n = 0;
    const stmt = db.prepare('DELETE FROM assets WHERE owner_type = ? AND owner_id = ?');
    for (const id of verwaist) n += stmt.run(ownerType, id).changes;
    return n;
  });
  const anzahl = loeschen();
  // Loud on purpose: a sweeper that quietly deletes things is indistinguishable
  // from a bug that quietly deletes things.
  console.log(`[assets] ${anzahl} verwaiste Bild(er) entfernt (${ownerType}: ${verwaist.join(', ')})`);
  return anzahl;
}
