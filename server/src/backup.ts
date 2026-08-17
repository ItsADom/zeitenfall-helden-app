import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatenbankTyp } from 'better-sqlite3';
import { db } from './db.js';
import { assetsDb } from './assets/db.js';

// Sicherung der SQLite-Dateien über die Online-Backup-API von better-sqlite3:
// läuft im laufenden Betrieb und ist WAL-sicher — ein bloßes Kopieren der
// .db-Datei wäre es nicht.
//
// ZWEI Zeitpläne, nicht einer. helden.db ist klein, ändert sich ständig und
// wird täglich gesichert. helden-assets.db enthält Bilder: groß, selten
// geändert — täglich mitzukopieren würde jede Tagessicherung vervielfachen.
// Deshalb wöchentlich, mit eigenem Dateinamen-Präfix und eigenem
// Aufbewahrungsfenster.
//
// Die beiden Aufräum-Regeln dürfen sich nicht in die Quere kommen: jeder Plan
// bekommt einen eigenen Ausdruck, der NUR seine eigenen Dateien trifft
// (helden-2026-08-17.db vs. helden-assets-2026-08-17.db).

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(dataDir, 'backups');

const dayStamp = (d = new Date()) => d.toISOString().slice(0, 10); // YYYY-MM-DD

export interface SicherungsPlan {
  /** Dateiname-Präfix, zugleich der Name im Protokoll. */
  prefix: string;
  /** Wird erst beim Lauf geholt: die Bilddatenbank öffnet sich träge. */
  quelle: () => DatenbankTyp | null;
  keep: number;
  intervalHours: number;
}

// Genau der eigene Präfix, nicht mehr: 'helden' darf 'helden-assets-…' nicht
// mitzählen, sonst löschen sich die beiden Fenster gegenseitig auf.
const dateiMuster = (prefix: string) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.db$`);

function prune(prefix: string, keep: number): void {
  const muster = dateiMuster(prefix);
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => muster.test(f))
    .sort(); // Dateiname sortiert = chronologisch
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    // Sidecars mitnehmen, falls die Sicherung zwischenzeitlich geöffnet wurde
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(BACKUP_DIR, f + suffix), { force: true });
    }
  }
}

// Sicherung für den heutigen Tag anlegen. Eine bereits vorhandene wird bewusst
// NICHT überschrieben: sonst könnte ein Neustart mit beschädigtem Stand die
// gute Kopie des Tages ersetzen.
export async function backupNow(plan: SicherungsPlan): Promise<string | null> {
  const quelle = plan.quelle();
  if (!quelle) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `${plan.prefix}-${dayStamp()}.db`);
  if (fs.existsSync(target)) return null;

  // Erst in eine temporäre Datei sichern, dann umbenennen — so entsteht nie
  // eine halbfertige Datei unter dem endgültigen Namen.
  const tmp = `${target}.part`;
  fs.rmSync(tmp, { force: true }); // Rest eines abgebrochenen Laufs
  await quelle.backup(tmp);
  fs.renameSync(tmp, target);
  prune(plan.prefix, plan.keep);
  return target;
}

export function scheduleBackup(plan: SicherungsPlan): void {
  const run = () =>
    void backupNow(plan)
      .then((file) => {
        if (file) console.log(`Sicherung angelegt: ${file}`);
      })
      .catch((e) => console.error(`Sicherung (${plan.prefix}) fehlgeschlagen:`, e));
  run();
  setInterval(run, plan.intervalHours * 60 * 60 * 1000).unref();
  console.log(
    `Sicherungen ${plan.prefix}: ${BACKUP_DIR} (alle ${plan.intervalHours} h, ${plan.keep} Stück aufbewahrt)`,
  );
}

/** Beide Pläne: helden.db täglich, helden-assets.db wöchentlich. */
export function startBackupSchedule(): void {
  scheduleBackup({
    prefix: 'helden',
    quelle: () => db,
    keep: Number(process.env.BACKUP_KEEP) || 3,
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,
  });
  scheduleBackup({
    prefix: 'helden-assets',
    quelle: assetsDb,
    // 8 Wochensicherungen ≈ zwei Monate. Bilder ändern sich selten; eine
    // versehentlich gelöschte Karte fällt eher nach Wochen auf als nach Tagen.
    keep: Number(process.env.BACKUP_ASSETS_KEEP) || 8,
    intervalHours: Number(process.env.BACKUP_ASSETS_INTERVAL_HOURS) || 168,
  });
}
