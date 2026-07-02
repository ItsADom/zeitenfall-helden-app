// Seed: legt Spielleiter-Konto an und füllt die Kataloge aus server/data/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { hashPassword } from './auth.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function seed(): void {
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0) {
    const password = process.env.GM_PASSWORD ?? 'spielleiter';
    db.prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?, ?, ?, 1)').run(
      'spielleiter',
      hashPassword(password),
      'Spielleiter',
    );
    console.log(`Spielleiter-Konto angelegt: Benutzer "spielleiter", Passwort "${password}" (bitte ändern)`);
  }

  const talentCount = (db.prepare('SELECT COUNT(*) AS n FROM talents_catalog').get() as { n: number }).n;
  if (talentCount === 0) {
    const file = path.join(dataDir, 'talents.json');
    if (fs.existsSync(file)) {
      const talents = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        kategorie: string;
        gruppe: string;
        name: string;
        klasse: string;
        probe: string;
        ableiten: string;
        sort: number;
      }[];
      const stmt = db.prepare(
        'INSERT INTO talents_catalog (kategorie, gruppe, name, klasse, probe, ableiten, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      const tx = db.transaction(() => {
        for (const t of talents) stmt.run(t.kategorie, t.gruppe, t.name, t.klasse, t.probe, t.ableiten, t.sort);
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
