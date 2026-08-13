// Seed: legt Spielleiter-Konto an und füllt die Kataloge aus server/data/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { backfillGroupSessionLog } from './dynSections.js';
import { lockVorteileTab, migrateAusruestungToItems, migrateInventarToItems } from './characterData.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// Zweites Konto mit Spielleiter-Rechten (z. B. für den Entwickler, der nicht
// der Spielleiter ist). Bewusst NICHT an eine leere Datenbank gekoppelt, damit
// es sich auch nachträglich anlegen lässt.
function seedAdminAccount(): void {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!username && !password) return;
  if (!username || !password) {
    console.warn('ADMIN_USER und ADMIN_PASSWORD müssen zusammen gesetzt sein — Konto übersprungen');
    return;
  }

  // Das Bootstrap-Konto trägt BEIDE Rollen (Spielleitung + Verwaltung), damit von
  // Anfang an jemand Konten anlegen UND das Spiel leiten kann.
  const existing = db.prepare('SELECT id, is_gm AS isGm, is_admin AS isAdmin FROM users WHERE username = ?').get(username) as
    | { id: number; isGm: number; isAdmin: number }
    | undefined;
  if (existing) {
    // Idempotent: kein Passwort-Reset bei jedem Start (das Passwort im Prozess-
    // Environment darf ein später geändertes nicht stillschweigend überschreiben)
    if (!existing.isGm || !existing.isAdmin) {
      db.prepare('UPDATE users SET is_gm = 1, is_admin = 1 WHERE id = ?').run(existing.id);
      console.log(`Konto "${username}" auf Spielleiter- und Verwaltungsrechte gehoben`);
    }
    return;
  }

  db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, 1, 1)').run(
    username,
    hashPassword(password),
    process.env.ADMIN_NAME ?? username,
  );
  console.log(`Konto mit Spielleiter- und Verwaltungsrechten angelegt: "${username}"`);
}

export function seed(): void {
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0) {
    const password = process.env.GM_PASSWORD ?? 'spielleiter';
    // Erstkonto trägt beide Rollen, damit der erste Nutzer nicht bei der Konten-
    // verwaltung ausgesperrt ist.
    db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, 1, 1)').run(
      'spielleiter',
      hashPassword(password),
      'Spielleiter',
    );
    console.log(`Spielleiter-Konto angelegt: Benutzer "spielleiter", Passwort "${password}" (bitte ändern)`);
  }

  seedAdminAccount();

  const talentCount = (db.prepare('SELECT COUNT(*) AS n FROM talents_catalog').get() as { n: number }).n;
  if (talentCount === 0) {
    const file = path.join(dataDir, 'talents.json');
    if (fs.existsSync(file)) {
      const talents = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        kategorie: string;
        gruppe: string;
        name: string;
        probe: string;
        ableiten: string;
        skill100: string;
        sort: number;
      }[];
      const stmt = db.prepare(
        'INSERT INTO talents_catalog (kategorie, gruppe, name, probe, ableiten, skill100, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      const tx = db.transaction(() => {
        for (const t of talents) stmt.run(t.kategorie, t.gruppe, t.name, t.probe, t.ableiten, t.skill100 ?? '', t.sort);
      });
      tx();
      console.log(`Talent-Katalog geladen: ${talents.length} Einträge`);
    } else {
      console.warn('server/data/talents.json fehlt — Talent-Katalog leer');
    }
  }

  const langCount = (db.prepare('SELECT COUNT(*) AS n FROM languages_catalog').get() as { n: number }).n;
  if (langCount === 0) {
    const file = path.join(dataDir, 'languages.json');
    if (fs.existsSync(file)) {
      const languages = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        kind: string;
        familie: string;
        name: string;
        komplexitaet: string;
        sort: number;
      }[];
      const stmt = db.prepare('INSERT INTO languages_catalog (kind, familie, name, komplexitaet, sort) VALUES (?, ?, ?, ?, ?)');
      const tx = db.transaction(() => {
        for (const l of languages) stmt.run(l.kind, l.familie, l.name, l.komplexitaet, l.sort);
      });
      tx();
      console.log(`Sprachen-Katalog geladen: ${languages.length} Einträge`);
    } else {
      console.warn('server/data/languages.json fehlt — Sprachen-Katalog leer');
    }
  }
}

seed();
// Reihenfolge zählt: beide führen denselben Migrationszähler (PRAGMA
// user_version) weiter, der kleinere Schritt zuerst.
backfillGroupSessionLog();
lockVorteileTab();
migrateInventarToItems();
migrateAusruestungToItems();
