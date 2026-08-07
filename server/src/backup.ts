import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

// Tägliche Sicherung der SQLite-Datei über die Online-Backup-API von
// better-sqlite3: läuft im laufenden Betrieb und ist WAL-sicher — ein
// bloßes Kopieren der .db-Datei wäre es nicht.

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(dataDir, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 3;
const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS) || 24;

const FILE_RE = /^helden-\d{4}-\d{2}-\d{2}\.db$/;
const dayStamp = (d = new Date()) => d.toISOString().slice(0, 10); // YYYY-MM-DD

// Sicherungen jenseits von KEEP entfernen (Dateiname sortiert = chronologisch)
function prune(): void {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    // Sidecars mitnehmen, falls die Sicherung zwischenzeitlich geöffnet wurde
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(BACKUP_DIR, f + suffix), { force: true });
    }
  }
}

// Sicherung für den heutigen Tag anlegen. Eine bereits vorhandene wird bewusst
// NICHT überschrieben: sonst könnte ein Neustart mit beschädigtem Stand die
// gute Kopie des Tages ersetzen.
export async function backupNow(): Promise<string | null> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `helden-${dayStamp()}.db`);
  if (fs.existsSync(target)) return null;

  // Erst in eine temporäre Datei sichern, dann umbenennen — so entsteht nie
  // eine halbfertige Datei unter dem endgültigen Namen.
  const tmp = `${target}.part`;
  fs.rmSync(tmp, { force: true }); // Rest eines abgebrochenen Laufs
  await db.backup(tmp);
  fs.renameSync(tmp, target);
  prune();
  return target;
}

const run = () =>
  void backupNow()
    .then((file) => {
      if (file) console.log(`Sicherung angelegt: ${file}`);
    })
    .catch((e) => console.error('Sicherung fehlgeschlagen:', e));

export function startBackupSchedule(): void {
  run();
  setInterval(run, INTERVAL_HOURS * 60 * 60 * 1000).unref();
  console.log(`Sicherungen: ${BACKUP_DIR} (alle ${INTERVAL_HOURS} h, ${KEEP} Stück aufbewahrt)`);
}
