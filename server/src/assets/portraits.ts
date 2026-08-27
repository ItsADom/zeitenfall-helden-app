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
import { einzelAsset, loescheEinzelAsset, setzeEinzelAsset, type OwnerTyp } from './store.js';
import { assetsDb } from './db.js';

// Zwei Rollen je Porträt: `portrait` ist das kleine Anzeigebild (bisher die
// einzige Größe — 512px, wie auf dem Bogen/in der Zusammenfassung gezeigt),
// `portrait-full` ein größeres Master-Bild (bis 1600px lange Kante), das nur
// die Vergrößerungs-Ansicht lädt. Beide entstehen client-seitig aus derselben
// Ausschnitt-/Zoom-Wahl (siehe client/src/components/CropEditor.tsx) — es gibt
// weiterhin keine Server-Bildbibliothek, nur zwei statt einer hochgeladenen
// Größe. Die Namenskonvention (owner_type + rolle) trägt später genauso für
// Wiki-Bilder/die geplante erweiterte Bio, ohne dass sich am Schema etwas
// ändern müsste.
const ROLLE = 'portrait';
const ROLLE_FULL = 'portrait-full';
// Der unbeschnittene Original-Upload, wie er ausgewählt wurde — bevor der
// CropEditor einen Ausschnitt wählt. Nur die Vergrößerungs-Ansicht will das:
// `ladePortrait(..., full: true)` greift zuerst hierauf zu und fällt auf
// ROLLE_FULL zurück, wenn (noch) kein Original vorliegt (ältere Porträts).
const ROLLE_ORIGINAL = 'portrait-original';

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

/** `full`: das große Master-Bild statt der 512px-Anzeigegröße — kennt keine Rückfallebene. */
export function ladePortrait(charId: number, full = false): PortraitDaten | undefined {
  if (full) {
    const original = einzelAsset('character', charId, ROLLE_ORIGINAL);
    if (original) return { mime: original.mime, data: original.data };
    const asset = einzelAsset('character', charId, ROLLE_FULL);
    return asset ? { mime: asset.mime, data: asset.data } : undefined;
  }
  const asset = einzelAsset('character', charId, ROLLE);
  if (asset) return { mime: asset.mime, data: asset.data };
  return ausAltTabelle(charId);
}

export function speicherePortrait(charId: number, mime: string, data: Buffer, full = false): void {
  const slug = setzeEinzelAsset(full ? ROLLE_FULL : ROLLE, {
    ownerType: 'character',
    ownerId: charId,
    titel: `Porträt ${charId}`,
    mime,
    data,
  });
  if (slug || full) return;
  // Bilddatenbank nicht verfügbar: lieber in die alte Tabelle schreiben als den
  // Upload scheitern lassen. Der nächste Migrationslauf holt sie nach. Gilt nur
  // fürs Anzeigebild — das Master-Bild kannte die alte Tabelle nie, ein
  // fehlendes ist hier ein Verzicht auf die Vergrößerung, kein Datenverlust.
  db.prepare(
    `INSERT INTO char_portraits (character_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (character_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(charId, mime, data);
}

/** Der unbeschnittene Original-Upload — wie `speicherePortrait(..., full: true)`, aber ohne Rückfalltabelle. */
export function speicherePortraitOriginal(charId: number, mime: string, data: Buffer): void {
  setzeEinzelAsset(ROLLE_ORIGINAL, {
    ownerType: 'character',
    ownerId: charId,
    titel: `Porträt-Original ${charId}`,
    mime,
    data,
  });
}

export function loeschePortrait(charId: number): void {
  loescheEinzelAsset('character', charId, ROLLE);
  loescheEinzelAsset('character', charId, ROLLE_FULL);
  loescheEinzelAsset('character', charId, ROLLE_ORIGINAL);
  // Auch aus der Rückfallebene — sonst taucht das alte Bild beim nächsten
  // Laden wieder auf, und „gelöscht" hätte nicht gestimmt.
  db.prepare('DELETE FROM char_portraits WHERE character_id = ?').run(charId);
}

// --- Gruppen-Porträt: dieselben zwei Rollen, aber ohne Rückfalltabelle — für
// Gruppen gab es nie eine char_portraits-Altlast, hier zieht direkt
// helden-assets.db ein.
const GRUPPE: OwnerTyp = 'group';

export function hatGruppenPortrait(groupId: number): boolean {
  return !!einzelAsset(GRUPPE, groupId, ROLLE);
}

export function ladeGruppenPortrait(groupId: number, full = false): PortraitDaten | undefined {
  if (full) {
    const original = einzelAsset(GRUPPE, groupId, ROLLE_ORIGINAL);
    if (original) return { mime: original.mime, data: original.data };
  }
  const asset = einzelAsset(GRUPPE, groupId, full ? ROLLE_FULL : ROLLE);
  return asset ? { mime: asset.mime, data: asset.data } : undefined;
}

export function speichereGruppenPortrait(groupId: number, mime: string, data: Buffer, full = false): void {
  setzeEinzelAsset(full ? ROLLE_FULL : ROLLE, {
    ownerType: GRUPPE,
    ownerId: groupId,
    titel: `Gruppenporträt ${groupId}`,
    mime,
    data,
  });
}

export function speichereGruppenPortraitOriginal(groupId: number, mime: string, data: Buffer): void {
  setzeEinzelAsset(ROLLE_ORIGINAL, {
    ownerType: GRUPPE,
    ownerId: groupId,
    titel: `Gruppenporträt-Original ${groupId}`,
    mime,
    data,
  });
}

export function loescheGruppenPortrait(groupId: number): void {
  loescheEinzelAsset(GRUPPE, groupId, ROLLE);
  loescheEinzelAsset(GRUPPE, groupId, ROLLE_FULL);
  loescheEinzelAsset(GRUPPE, groupId, ROLLE_ORIGINAL);
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
