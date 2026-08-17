// Wiki schema.
//
// Deliberately its own file rather than more lines in db.ts (913 already). It
// imports `db` from there, so ESM evaluation order guarantees the base schema
// and its ~40 idempotent migrations have finished before any of this runs.
//
// All tables are new, so `CREATE TABLE IF NOT EXISTS` is the whole migration
// story and PRAGMA user_version stays where cluster 5 left it (4). The one
// thing that would otherwise need a numbered step — the search index, which
// arrives a phase later than the pages — self-heals instead, see
// indexNachziehen() at the bottom. That also repairs a database restored from a
// pre-wiki backup, which a version counter would not.
import { db } from '../db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    titel TEXT NOT NULL,
    -- Zeigt auf die aktuell gültige Fassung. Die Umkehrung (wiki_revisions
    -- -> wiki_pages) macht daraus einen Zyklus; SQLite trägt den, solange die
    -- Seite zuerst ohne Verweis angelegt und danach nachgezogen wird.
    aktuelle_rev INTEGER REFERENCES wiki_revisions(id) ON DELETE SET NULL,
    auszug TEXT NOT NULL DEFAULT '',
    -- „nur Spielleiter": für Spieler existiert die Seite nicht (404 überall).
    gm_only INTEGER NOT NULL DEFAULT 0,
    -- geschützt: nur der Spielleiter darf bearbeiten.
    geschuetzt INTEGER NOT NULL DEFAULT 0,
    -- Weiches Löschen: ein Abend Arbeit verschwindet nicht durch einen Fehlklick.
    geloescht_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Alte Slugs nach dem Umbenennen: ein Lesezeichen auf den alten Namen findet
  -- die Seite weiter, statt ins Leere zu laufen.
  CREATE TABLE IF NOT EXISTS wiki_slug_alias (
    slug TEXT PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE
  );

  -- Änderungsprotokoll UND Versionsverlauf in einer chronologischen Tabelle.
  -- Eine Zeile MIT Text ist eine Inhaltsfassung; eine Zeile OHNE ist ein
  -- Metadaten-Ereignis (umbenannt, gelöscht, Sichtbarkeit) und trägt
  -- feld/alt_wert/neu_wert. Eine Tabelle heißt: das Protokoll ist EINE sortierte
  -- Abfrage und kann dem Inhalt, den es beschreibt, nie widersprechen.
  CREATE TABLE IF NOT EXISTS wiki_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    art TEXT NOT NULL DEFAULT 'bearbeitet',
    -- Der Titel, wie er DAMALS lautete — sonst lügt das Protokoll nach einer
    -- Umbenennung rückwirkend.
    titel TEXT NOT NULL,
    text TEXT,
    feld TEXT,
    alt_wert TEXT,
    neu_wert TEXT,
    -- Einmal beim Speichern gerechnet, damit die Protokollliste nie diffen muss.
    zeilen_plus INTEGER NOT NULL DEFAULT 0,
    zeilen_minus INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    -- Autor als SET NULL statt Löschsperre: ein Tippfehler von vor einem Jahr
    -- darf kein Konto am Leben halten. Der Name wird mitgeschrieben.
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL DEFAULT '',
    kommentar TEXT NOT NULL DEFAULT '',
    base_revision_id INTEGER REFERENCES wiki_revisions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_rev_seite ON wiki_revisions (page_id, nr);
  CREATE INDEX IF NOT EXISTS idx_wiki_rev_zeit ON wiki_revisions (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_rev_autor ON wiki_revisions (author_user_id, created_at DESC);

  -- Verweise der aktuellen Fassung. Ziel als Slug, nicht als id: ein Verweis
  -- darf auf eine Seite zeigen, die es noch gar nicht gibt (Rotlink).
  CREATE TABLE IF NOT EXISTS wiki_links (
    from_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_slug TEXT NOT NULL,
    PRIMARY KEY (from_page_id, to_slug)
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_links_ziel ON wiki_links (to_slug);

  CREATE TABLE IF NOT EXISTS wiki_page_tags (
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    tag_key TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (page_id, tag_key)
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_tags_key ON wiki_page_tags (tag_key);

  -- Wasserstand je Nutzer für „N Änderungen seit deinem letzten Besuch".
  CREATE TABLE IF NOT EXISTS wiki_gelesen (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    gesehen_bis TEXT NOT NULL
  );
`);

/**
 * Two search indexes, because a player's snippet must never quote GM-only
 * prose: wiki_fts holds the public text (```gm regions removed), wiki_fts_gm
 * the full text, and the query picks the table by role. rowid = wiki_pages.id
 * in both, so keeping them in step is a delete-then-insert.
 *
 * FTS5 is compiled into the better-sqlite3 build this project uses (verified),
 * but the flag lets search degrade to LIKE instead of the box failing to boot
 * if that ever stops being true.
 */
export let HAT_FTS = true;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts
      USING fts5(titel, text, tokenize = 'unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts_gm
      USING fts5(titel, text, tokenize = 'unicode61 remove_diacritics 2');
  `);
} catch (err) {
  HAT_FTS = false;
  console.warn('[wiki] FTS5 nicht verfügbar — Suche fällt auf LIKE zurück:', err);
}
