// Was dieser Leser im Wiki noch nicht gesehen hat — als Zahl neben „Wiki" und
// als Marke auf der einzelnen Seite.
//
// Die Wasserstände sind REVISIONS-IDs, keine Zeitstempel. created_at kommt aus
// datetime('now') und ist auf die Sekunde genau; fünf Speicherungen innerhalb
// einer Sekunde sind während einer Sitzung ganz normal, und eine Zeitgrenze
// verschluckte davon entweder vier oder käme nie mehr hinterher. Eine id ist
// eindeutig und monoton, damit stimmt die Rechnung in beide Richtungen.
//
// Eigene Bearbeitungen sind keine Neuigkeit. Man weiß, was man gerade selbst
// geschrieben hat, und ein Abzeichen, das wegen des eigenen Tippfehlers
// aufleuchtet, erzieht dazu, es zu ignorieren.
//
// DREI EBENEN, die sich unabhängig voneinander leeren:
//
//   gesehen_rev        — „die Zahl habe ich zur Kenntnis genommen".
//                        Wird gesetzt, sobald der Leser im Wiki ist.
//   alles_gelesen_rev  — Boden für die Seitenmarken: alles bis hierher gilt auf
//                        JEDER Seite als gelesen. Setzt „Alle gelesen".
//   wiki_seite_gelesen — je Seite, bis wohin sie gelesen ist. Setzt das Öffnen
//                        genau dieser Seite.
//
// Eine Seite ist ungelesen, wenn sie eine fremde Revision oberhalb von
// MAX(alles_gelesen_rev, ihrer eigenen Zeile) hat. Die ZAHL ist die Menge
// dieser Seiten, die zusätzlich über gesehen_rev liegen — also der Schnitt aus
// „noch ungelesen" und „seit dem letzten Blick dazugekommen". Der Schnitt ist
// der Grund, warum die Zahl mitsinkt, wenn man eine Seite direkt aus der
// Übersicht öffnet, statt bis zum nächsten Wiki-Besuch falsch stehen zu bleiben.
import { db } from '../db.js';
import type { WikiLeser } from './zugriff.js';
import { sichtbarkeitsFilter } from './zugriff.js';

/** Highest revision id that exists at all — the value „everything read" means. */
function hoechsteRev(): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM wiki_revisions').get() as { n: number };
  return row.n;
}

interface Wasserstand {
  gesehen_rev: number;
  alles_gelesen_rev: number;
}

function wasserstand(userId: number): Wasserstand | undefined {
  return db.prepare('SELECT gesehen_rev, alles_gelesen_rev FROM wiki_gelesen WHERE user_id = ?').get(userId) as
    | Wasserstand
    | undefined;
}

/**
 * Der gemeinsame Rumpf beider Abfragen — eine Seite mit einer fremden Revision
 * oberhalb der übergebenen Schranke UND oberhalb ihrer eigenen Zeile.
 *
 * Zahl und Marke lesen denselben Text, damit sie sich nicht widersprechen
 * können: die Zahl reicht nur eine höhere Schranke herein.
 */
function ungelesenSql(filterSql: string): string {
  return `FROM wiki_revisions r
            JOIN wiki_pages p ON p.id = r.page_id
            LEFT JOIN wiki_seite_gelesen g ON g.user_id = ? AND g.page_id = p.id
           WHERE r.id > MAX(?, COALESCE(g.gesehen_rev, 0))
             AND (r.author_user_id IS NULL OR r.author_user_id <> ?)
             AND p.geloescht_at IS NULL
             AND ${filterSql}`;
}

/**
 * Wie viele SEITEN dieser Leser noch nicht angeschaut hat.
 *
 * Seiten, nicht Bearbeitungen: fünfmal an derselben Seite gespeichert ist eine
 * Meldung. Deshalb COUNT(DISTINCT p.id) und nicht COUNT(*).
 *
 * Wer den Änderungsstand noch nie gesehen hat, stünde auf 0 — und bekäme damit
 * die gesamte Historie als neu vorgesetzt. Das ist zwar wahr, aber unbrauchbar,
 * deshalb setzt der erste Aufruf beide Wasserstände auf die Spitze: gezählt wird
 * ab dem Moment, in dem jemand das Abzeichen zum ersten Mal sieht.
 */
export function anzahlNeu(user: WikiLeser): number {
  const bekannt = wasserstand(user.id);
  if (!bekannt) {
    merkeAllesGelesen(user.id);
    return 0;
  }

  const filter = sichtbarkeitsFilter(user);
  const schranke = Math.max(bekannt.gesehen_rev, bekannt.alles_gelesen_rev);
  const row = db
    .prepare(`SELECT COUNT(DISTINCT p.id) AS n ${ungelesenSql(filter.sql)}`)
    .get(user.id, schranke, user.id, ...filter.args) as { n: number };
  return row.n;
}

/**
 * Which of these pages changed since the reader last looked at them, by
 * somebody else. Drives the „neu" marker in the page lists.
 *
 * Anders als die Zahl kennt das nur den Boden und die Zeile der Seite — die
 * Marke überlebt das Betreten des Wikis und verschwindet erst, wenn die Seite
 * selbst geöffnet wird oder „Alle gelesen" den Boden anhebt.
 */
export function neueSeiten(user: WikiLeser): Set<string> {
  const boden = wasserstand(user.id)?.alles_gelesen_rev ?? 0;
  const filter = sichtbarkeitsFilter(user);
  const rows = db
    .prepare(`SELECT DISTINCT p.slug AS slug ${ungelesenSql(filter.sql)}`)
    .all(user.id, boden, user.id, ...filter.args) as { slug: string }[];
  return new Set(rows.map((r) => r.slug));
}

/**
 * „Die Zahl habe ich gesehen" — betrifft NUR das Abzeichen, keine Marke.
 *
 * Beim Anlegen der Zeile geht der Boden trotzdem mit auf die Spitze: eine erste
 * Berührung über diesen Weg (statt über anzahlNeu) darf nicht bedeuten, dass
 * plötzlich das gesamte Wiki markiert ist.
 */
export function merkeGesehen(userId: number): number {
  const rev = hoechsteRev();
  db.prepare(
    `INSERT INTO wiki_gelesen (user_id, gesehen_rev, alles_gelesen_rev) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET gesehen_rev = excluded.gesehen_rev`,
  ).run(userId, rev, rev);
  return rev;
}

/**
 * „Alle gelesen" — hebt den Boden auf die Spitze und räumt damit jede Marke weg.
 *
 * Die Einzelzeilen werden gelöscht statt stehen gelassen: der neue Boden deckt
 * sie ohnehin alle ab, und ohne das Löschen wüchse die Tabelle mit der Zeit auf
 * Nutzer × Seiten an.
 */
export function merkeAllesGelesen(userId: number): number {
  const rev = hoechsteRev();
  db.prepare(
    `INSERT INTO wiki_gelesen (user_id, gesehen_rev, alles_gelesen_rev) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET gesehen_rev = excluded.gesehen_rev,
                                        alles_gelesen_rev = excluded.alles_gelesen_rev`,
  ).run(userId, rev, rev);
  db.prepare('DELETE FROM wiki_seite_gelesen WHERE user_id = ?').run(userId);
  return rev;
}

/**
 * Diese eine Seite ist gelesen — aufgerufen, wenn sie jemand aufschlägt.
 *
 * Bewusst das Maximum DIESER Seite und nicht wiki_pages.aktuelle_rev:
 * Metadaten-Ereignisse (umbenannt, Sichtbarkeit geändert) sind Revisionszeilen
 * ohne Text und ziehen aktuelle_rev nicht mit — über aktuelle_rev bliebe eine
 * Umbenennung für immer ungelesen.
 */
export function merkeSeiteGelesen(userId: number, pageId: number): void {
  db.prepare(
    `INSERT INTO wiki_seite_gelesen (user_id, page_id, gesehen_rev)
     VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM wiki_revisions WHERE page_id = ?))
     ON CONFLICT(user_id, page_id) DO UPDATE SET gesehen_rev = excluded.gesehen_rev`,
  ).run(userId, pageId, pageId);
}
