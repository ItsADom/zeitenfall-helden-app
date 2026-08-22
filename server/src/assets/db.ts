// The image database — a SECOND SQLite file, deliberately separate from
// helden.db.
//
// The reason is the backup cycle, not tidiness: helden.db is small, changes
// constantly and is copied offsite every 24 hours. Images are large, change
// rarely, and would multiply the size of every one of those daily copies. In
// their own file they get their own, weekly schedule — see backup.ts.
//
// The cost of the split is that SQLite has no cross-database foreign key, so
// `ON DELETE CASCADE` cannot reach in here. That is paid twice over in
// store.ts: an explicit cleanup hook on hard delete, AND a sweeper, because
// hooks get forgotten.
//
// Opened lazily and defensively: if this file is missing or corrupt the wiki
// renders without images rather than failing to boot. Text is the point;
// pictures are the decoration.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatenbankTyp } from 'better-sqlite3';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export const ASSETS_PFAD = process.env.HELDEN_ASSETS_DB ?? path.join(dir, 'helden-assets.db');

let geoeffnet: DatenbankTyp | null = null;

/**
 * Generic from the start: `owner_type`/`owner_id` mean the expanded bio page's
 * gallery and (later) character portraits plug in without a schema change.
 * Its own user_version namespace starts at 0 — separate file, separate history.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    owner_type TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    rolle TEXT NOT NULL DEFAULT '',
    titel TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT 'image/jpeg',
    bytes INTEGER NOT NULL DEFAULT 0,
    breite INTEGER NOT NULL DEFAULT 0,
    hoehe INTEGER NOT NULL DEFAULT 0,
    pos INTEGER NOT NULL DEFAULT 0,
    -- „nur Spielleiter": ein Bild, das in einen Nur-SL-Abschnitt gehört. Der
    -- Server liefert es dann niemandem sonst aus, unabhängig von der Seite.
    gm_only INTEGER NOT NULL DEFAULT 0,
    data BLOB NOT NULL,
    -- Kein FK: der Nutzer steht in einer anderen Datei. Der Name wird deshalb
    -- mitgeschrieben, wie im Änderungsprotokoll auch.
    uploader_user_id INTEGER,
    uploader_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets (owner_type, owner_id, pos);
`;

/**
 * The image database, or null if it could not be opened. Never throws.
 *
 * Retries the open on every call while it hasn't succeeded yet — a failed
 * attempt is NOT cached. A transient cause (data dir not yet writable at
 * boot, a momentary disk issue) would otherwise wedge image uploads for the
 * rest of the process's life, since nothing else ever calls this again on
 * its own; only a restart used to clear it.
 */
export function assetsDb(): DatenbankTyp | null {
  if (geoeffnet) return geoeffnet;
  try {
    fs.mkdirSync(path.dirname(ASSETS_PFAD), { recursive: true });
    const datenbank = new Database(ASSETS_PFAD);
    datenbank.pragma('journal_mode = WAL');
    datenbank.exec(SCHEMA);
    geoeffnet = datenbank;
    return geoeffnet;
  } catch (err) {
    console.error(`[assets] ${ASSETS_PFAD} konnte nicht geöffnet werden — das Wiki läuft ohne Bilder:`, err);
    return null;
  }
}

/** For the backup schedule, which needs the handle but must not create it. */
export const assetsVerfuegbar = (): boolean => assetsDb() !== null;
