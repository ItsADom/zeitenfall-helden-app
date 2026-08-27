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
    -- unlöschbar: Systemseite, die es immer geben soll (siehe seedSystemSeiten.ts).
    -- Anders als geschuetzt geht es hier nicht ums Bearbeiten, sondern ausschließlich
    -- ums Löschen — die Spielleitung darf den Inhalt jederzeit ändern.
    unloeschbar INTEGER NOT NULL DEFAULT 0,
    -- Weiches Löschen: ein Abend Arbeit verschwindet nicht durch einen Fehlklick.
    geloescht_at TEXT,
    -- 'seite' | 'kategorie'. Ergibt sich aus dem Titel („Kategorie:Orte"), damit
    -- eine Kategorie eine ganz normale Seite ist — mit Verlauf, Rechten, Suche.
    namensraum TEXT NOT NULL DEFAULT 'seite',
    -- Nur bei namensraum='kategorie': der gefaltete Schlüssel, unter dem die
    -- Seiten dieser Kategorie in wiki_page_tags stehen. Bewusst gespeichert und
    -- nicht aus dem Slug abgeleitet — freierSlug() kann „kategorie-orte-2"
    -- vergeben, und eine Suche über den Slug fände die Seite dann nicht mehr.
    kategorie_key TEXT,
    -- Ziel-Slug, wenn die Seite ein Wegweiser ist (#WEITERLEITUNG [[…]]).
    weiterleitung TEXT,
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

`);

// Nachgereichte Spalten von wiki_pages. Die Tabelle steht in freier Wildbahn
// schon, deshalb reicht `CREATE TABLE IF NOT EXISTS` oben für sie nicht mehr —
// dort stehen sie trotzdem, damit eine frische Datenbank das Schema an einem
// Stück beschreibt und niemand die Definition aus zwei Stellen zusammensucht.
{
  const spalten = (db.prepare('PRAGMA table_info(wiki_pages)').all() as { name: string }[]).map((c) => c.name);
  if (!spalten.includes('namensraum')) {
    db.exec("ALTER TABLE wiki_pages ADD COLUMN namensraum TEXT NOT NULL DEFAULT 'seite'");
  }
  if (!spalten.includes('kategorie_key')) db.exec('ALTER TABLE wiki_pages ADD COLUMN kategorie_key TEXT');
  if (!spalten.includes('weiterleitung')) db.exec('ALTER TABLE wiki_pages ADD COLUMN weiterleitung TEXT');
  if (!spalten.includes('unloeschbar')) db.exec('ALTER TABLE wiki_pages ADD COLUMN unloeschbar INTEGER NOT NULL DEFAULT 0');
}

db.exec(`
  -- Eine Kategorie hat höchstens EINE Beschreibungsseite. Der Teilindex nimmt
  -- gelöschte Seiten aus: sonst blockierte eine im Papierkorb liegende
  -- „Kategorie:Orte" das Neuanlegen derselben Kategorie auf Dauer.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_kategorie_key
    ON wiki_pages (kategorie_key)
    WHERE kategorie_key IS NOT NULL AND geloescht_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_wiki_weiterleitung ON wiki_pages (weiterleitung);
`);

// Wasserstände je Nutzer für „was habe ich im Wiki noch nicht gesehen".
//
// Bewusst REVISIONS-IDs und keine Zeitstempel: created_at kommt aus
// datetime('now') und ist auf die Sekunde genau. Fünf Änderungen innerhalb
// derselben Sekunde sind im Spiel völlig normal (Speichern, Tippfehler,
// Speichern) — mit einem Zeitstempel als Grenze fielen davon vier unter den
// Tisch oder blieben ewig ungelesen. Eine id ist eindeutig und monoton.
//
// ZWEI Wasserstände, weil sich Zahl und Seitenmarke unabhängig leeren (siehe
// neuigkeiten.ts): gesehen_rev quittiert die Zahl neben „Wiki", alles_gelesen_rev
// ist der Boden, ab dem eine Seite ohne eigene Zeile in wiki_seite_gelesen als
// gelesen gilt.
//
// Die erste Fassung dieser Tabelle hatte gesehen_bis TEXT. Sie wurde nie
// beschrieben (der Zähler entsteht erst hier), deshalb wird sie ersetzt statt
// migriert — es geht nichts verloren, was je jemand erzeugt hätte.
{
  const spalten = (db.prepare('PRAGMA table_info(wiki_gelesen)').all() as { name: string }[]).map((c) => c.name);
  if (spalten.length > 0 && !spalten.includes('gesehen_rev')) db.exec('DROP TABLE wiki_gelesen');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_gelesen (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      gesehen_rev INTEGER NOT NULL DEFAULT 0,
      alles_gelesen_rev INTEGER NOT NULL DEFAULT 0
    );
  `);
  if (spalten.length > 0 && !spalten.includes('alles_gelesen_rev')) {
    db.exec('ALTER TABLE wiki_gelesen ADD COLUMN alles_gelesen_rev INTEGER NOT NULL DEFAULT 0');
  }
}

// Der DEFAULT 0 der Spalte oben ist für Bestandszeilen die FALSCHE Antwort: mit
// 0 bekäme jeder, der bisher auf dem Laufenden war, beim ersten Start
// schlagartig das ganze Wiki als „neu" markiert. Richtig ist der Stand, den er
// bereits quittiert hat.
//
// Steht bewusst außerhalb des ALTER-Zweigs und läuft bei jedem Start: es ist
// idempotent (nach „Alle gelesen" sind beide Werte gleich und ungleich 0) und
// deckt damit auch ab, was ein user_version-Schritt nicht sähe — ein Rollback
// auf alten Code und zurück, oder eine Sicherung aus der Zeit davor.
db.exec('UPDATE wiki_gelesen SET alles_gelesen_rev = gesehen_rev WHERE alles_gelesen_rev = 0 AND gesehen_rev > 0');

db.exec(`
  -- Bis wohin dieser Nutzer DIESE Seite gesehen hat. Eine fehlende Zeile heißt
  -- „nur der Boden aus wiki_gelesen.alles_gelesen_rev gilt" — deshalb darf
  -- „Alle gelesen" die Zeilen löschen, statt für jede Seite eine anzulegen.
  CREATE TABLE IF NOT EXISTS wiki_seite_gelesen (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    gesehen_rev INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, page_id)
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
