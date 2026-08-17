// Character portraits, moved into helden-assets.db.
//
// The intent behind the second database was always „all images live here" —
// wiki pictures and character portraits alike. Portraits are the older half and
// therefore the migrating half, which makes this the one place in the feature
// where real, existing player data moves. So it does not move.
//
// It is COPIED. `char_portraits` stays exactly as it is:
//
//   * the copy is idempotent — it only ever fills gaps, so a second boot, an
//     interrupted first one and a restored backup all converge on the same
//     state without a version counter;
//   * reading falls back to the old table, so a half-migrated database, an
//     unopenable assets file and a rollback onto older code all still show
//     portraits;
//   * writing goes to the assets file, and to the old table only if the assets
//     file is unavailable — an upload must never fail because the picture
//     database is missing.
//
// The one operation that touches both is DELETE: removing a portrait has to
// remove it from the fallback as well, otherwise the old copy would simply
// reappear. That is deliberate, and it is the reason `char_portraits` may only
// be dropped once a release has gone by without anyone needing to roll back.
import { db } from '../db.js';
import { einzelAsset, loescheEinzelAsset, setzeEinzelAsset } from './store.js';
import { assetsDb } from './db.js';

const ROLLE = 'portrait';

export interface PortraitDaten {
  mime: string;
  data: Buffer;
}

function ausAltTabelle(charId: number): PortraitDaten | undefined {
  return db.prepare('SELECT mime, data FROM char_portraits WHERE character_id = ?').get(charId) as
    | PortraitDaten
    | undefined;
}

export function hatPortrait(charId: number): boolean {
  if (einzelAsset('character', charId, ROLLE)) return true;
  return !!db.prepare('SELECT 1 FROM char_portraits WHERE character_id = ?').get(charId);
}

export function ladePortrait(charId: number): PortraitDaten | undefined {
  const asset = einzelAsset('character', charId, ROLLE);
  if (asset) return { mime: asset.mime, data: asset.data };
  return ausAltTabelle(charId);
}

export function speicherePortrait(charId: number, mime: string, data: Buffer): void {
  const slug = setzeEinzelAsset(ROLLE, {
    ownerType: 'character',
    ownerId: charId,
    titel: `Porträt ${charId}`,
    mime,
    data,
  });
  if (slug) return;
  // Bilddatenbank nicht verfügbar: lieber in die alte Tabelle schreiben als den
  // Upload scheitern lassen. Der nächste Migrationslauf holt sie nach.
  db.prepare(
    `INSERT INTO char_portraits (character_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (character_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(charId, mime, data);
}

export function loeschePortrait(charId: number): void {
  loescheEinzelAsset('character', charId, ROLLE);
  // Auch aus der Rückfallebene — sonst taucht das alte Bild beim nächsten
  // Laden wieder auf, und „gelöscht" hätte nicht gestimmt.
  db.prepare('DELETE FROM char_portraits WHERE character_id = ?').run(charId);
}

/**
 * Copies portraits that are not in the assets database yet. Runs at boot, costs
 * one count query when there is nothing to do, and never deletes anything.
 */
export function migrierePortraits(): void {
  if (!assetsDb()) return;
  try {
    const alte = db.prepare('SELECT character_id AS id, mime, data FROM char_portraits').all() as {
      id: number;
      mime: string;
      data: Buffer;
    }[];
    const offen = alte.filter((p) => !einzelAsset('character', p.id, ROLLE));
    if (offen.length === 0) return;
    for (const p of offen) {
      setzeEinzelAsset(ROLLE, {
        ownerType: 'character',
        ownerId: p.id,
        titel: `Porträt ${p.id}`,
        mime: p.mime,
        data: p.data,
      });
    }
    console.log(
      `[assets] ${offen.length} Porträt(s) nach helden-assets.db kopiert — char_portraits bleibt als Rückfallebene bestehen`,
    );
  } catch (err) {
    // Ein fehlgeschlagener Umzug darf den Start nicht verhindern: gelesen wird
    // weiterhin aus der alten Tabelle.
    console.error('[assets] Porträt-Umzug fehlgeschlagen — es wird weiter aus char_portraits gelesen:', err);
  }
}
