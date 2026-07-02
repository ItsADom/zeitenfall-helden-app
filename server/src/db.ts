import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATTR_ROW_CODES, BASE_VALUE_KEYS, LIST_SECTIONS, RESOURCE_KEYS } from 'shared';
import type { ColumnDef } from 'shared';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(process.env.HELDEN_DB ?? path.join(dir, 'helden.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function colSql(c: ColumnDef): string {
  switch (c.type) {
    case 'number':
      return `${c.key} REAL NOT NULL DEFAULT 0`;
    case 'bool':
      return `${c.key} INTEGER NOT NULL DEFAULT 0`;
    default:
      return `${c.key} TEXT NOT NULL DEFAULT ''`;
  }
}

const listTables = LIST_SECTIONS.map(
  (s) => `
  CREATE TABLE IF NOT EXISTS sec_${s.id} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    ${s.columns.map(colSql).join(',\n    ')}
  );`,
).join('\n');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    is_gm INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    group_id INTEGER NOT NULL REFERENCES groups(id)
  );
  CREATE TABLE IF NOT EXISTS character_visibility (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, section)
  );

  CREATE TABLE IF NOT EXISTS char_bio (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    alterGeburtstag TEXT NOT NULL DEFAULT '', geschlecht TEXT NOT NULL DEFAULT '',
    groesse TEXT NOT NULL DEFAULT '', gewicht TEXT NOT NULL DEFAULT '',
    augenfarbe TEXT NOT NULL DEFAULT '', haarfarbe TEXT NOT NULL DEFAULT '', hautfarbe TEXT NOT NULL DEFAULT '',
    familienstand TEXT NOT NULL DEFAULT '', anrede TEXT NOT NULL DEFAULT '',
    rasse TEXT NOT NULL DEFAULT '', rasseMod TEXT NOT NULL DEFAULT '',
    kultur TEXT NOT NULL DEFAULT '', kulturMod TEXT NOT NULL DEFAULT '',
    profession TEXT NOT NULL DEFAULT '', zweitprofession TEXT NOT NULL DEFAULT '',
    gottheit TEXT NOT NULL DEFAULT '', goettergeschenke TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS char_meta (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    stufe REAL NOT NULL DEFAULT 0, ap REAL NOT NULL DEFAULT 0, apNextLevel REAL NOT NULL DEFAULT 0,
    apGuthaben REAL NOT NULL DEFAULT 0, karma REAL NOT NULL DEFAULT 0, karmaGuthaben REAL NOT NULL DEFAULT 0,
    ruf REAL NOT NULL DEFAULT 0, psycheAkt REAL NOT NULL DEFAULT 0, psycheMax REAL NOT NULL DEFAULT 0,
    geldD REAL NOT NULL DEFAULT 0, geldS REAL NOT NULL DEFAULT 0, geldH REAL NOT NULL DEFAULT 0,
    geldK REAL NOT NULL DEFAULT 0, bank REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_attributes (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    attr TEXT NOT NULL,
    akt REAL NOT NULL DEFAULT 0,
    mod REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, attr)
  );
  CREATE TABLE IF NOT EXISTS char_base_values (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    mod REAL NOT NULL DEFAULT 0,
    base REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, key)
  );
  CREATE TABLE IF NOT EXISTS char_resources (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    permanent REAL NOT NULL DEFAULT 0, kauf REAL NOT NULL DEFAULT 0,
    kaufMax REAL NOT NULL DEFAULT 0, maxPlus REAL NOT NULL DEFAULT 0,
    aktuell REAL NOT NULL DEFAULT 0, besonderes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (character_id, key)
  );

  CREATE TABLE IF NOT EXISTS talents_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kategorie TEXT NOT NULL,
    gruppe TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    klasse TEXT NOT NULL DEFAULT '',
    probe TEXT NOT NULL DEFAULT '',
    ableiten TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_talents (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    talent_id INTEGER NOT NULL REFERENCES talents_catalog(id) ON DELETE CASCADE,
    taw REAL NOT NULL DEFAULT 0,
    at REAL NOT NULL DEFAULT 0, pa REAL NOT NULL DEFAULT 0, bl REAL NOT NULL DEFAULT 0,
    billiger TEXT NOT NULL DEFAULT '', spezialisierung TEXT NOT NULL DEFAULT '',
    waffenmeister TEXT NOT NULL DEFAULT '', berufsbonus TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (character_id, talent_id)
  );

  CREATE TABLE IF NOT EXISTS languages_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    familie TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    komplexitaet TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_languages (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    language_id INTEGER NOT NULL REFERENCES languages_catalog(id) ON DELETE CASCADE,
    taw REAL NOT NULL DEFAULT 0,
    muttersprache INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, language_id)
  );

  ${listTables}
`);

// Legt die festen Zeilen (Attribute, Basiswerte, Energien, Bio, Meta) für einen Charakter an
export function initCharacterRows(characterId: number): void {
  const attr = db.prepare('INSERT OR IGNORE INTO char_attributes (character_id, attr) VALUES (?, ?)');
  for (const code of ATTR_ROW_CODES) attr.run(characterId, code);
  const bv = db.prepare('INSERT OR IGNORE INTO char_base_values (character_id, key) VALUES (?, ?)');
  for (const key of BASE_VALUE_KEYS) bv.run(characterId, key);
  const res = db.prepare('INSERT OR IGNORE INTO char_resources (character_id, key) VALUES (?, ?)');
  for (const key of RESOURCE_KEYS) res.run(characterId, key);
  db.prepare('INSERT OR IGNORE INTO char_bio (character_id) VALUES (?)').run(characterId);
  db.prepare('INSERT OR IGNORE INTO char_meta (character_id) VALUES (?)').run(characterId);
}
