// Zwei Systemseiten, die es immer geben soll, auch in einer frischen
// Produktionsdatenbank: „Würfeln" erklärt das Würfel-Feature samt Regelwerk,
// „Wiki-Hilfe" erklärt das Wiki selbst. Anders als seedWikiDemo.ts läuft das
// hier bei JEDEM Serverstart, ungated, auch mit NODE_ENV=production.
//
// Idempotent wie der Demo-Seed: erkannt wird am Titel, ein zweiter Lauf legt
// nichts doppelt an und überschreibt vor allem NICHTS, was eine Spielleitung
// inzwischen geändert hat. Geschrieben wird über dieselben Funktionen wie im
// laufenden Betrieb (legeSeiteAn/speichereSeite), nie per Hand ins SQL.
//
// Beide Seiten werden geschützt (nur Spielleitung darf bearbeiten) und
// unlöschbar markiert (siehe wiki_pages.unloeschbar) — sie sollen sich
// jederzeit anpassen, aber nie ganz verschwinden lassen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { legeBildAn } from './bilder.js';
import { legeSeiteAn, speichereSeite } from './seiten.js';
import { setzeFlag } from './verwaltung.js';
import type { WikiSeiteRow } from './zugriff.js';

interface Autor {
  id: number;
  isGm: boolean;
  name: string;
}

// Das App-Favicon als Beispielbild für den Bilder-Abschnitt auf „Wiki-Hilfe" —
// schon im Repository vorhanden (client/public, nicht client/dist: das gibt
// es auch in einem unbebauten dev-Checkout), kein eigenes Demo-Bild nötig.
const FAVICON_PFAD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'client',
  'public',
  'favicon-dark.png',
);

/**
 * Lädt das Favicon hoch und liefert seinen Bild-Slug für ein Live-Beispiel.
 * Fehlt die Datei aus irgendeinem Grund, bleibt der Bilder-Abschnitt ohne
 * Live-Beispiel, statt den Serverstart zu gefährden.
 */
function demoBild(seite: WikiSeiteRow, autor: Autor): string | null {
  let data: Buffer;
  try {
    data = fs.readFileSync(FAVICON_PFAD);
  } catch (err) {
    console.warn(
      '[wiki] Beispielbild für „Wiki-Hilfe" nicht gefunden, Bilder-Abschnitt bleibt ohne Live-Beispiel:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  return legeBildAn(seite, {
    titel: 'Zeitenkompass-Symbol',
    mime: 'image/png',
    data,
    gmOnly: false,
    hochgeladenVon: { id: autor.id, name: autor.name },
  });
}

/**
 * Die Spielleitung, falls es schon eine gibt. Anders als seedWikiDemo.ts'
 * gleichnamige Funktion wirft diese NICHT: ein frischer Serverstart ohne
 * ADMIN_USER/ADMIN_PASSWORD hat noch kein Spielleiter-Konto, und das darf den
 * Serverstart nicht abbrechen. Der nächste Neustart versucht es einfach
 * wieder.
 */
function spielleitung(): Autor | null {
  const row = db.prepare('SELECT id, display_name AS name FROM users WHERE is_gm = 1 ORDER BY id').get() as
    | { id: number; name: string }
    | undefined;
  return row ? { id: row.id, isGm: true, name: row.name } : null;
}

const seiteMitTitel = (titel: string): WikiSeiteRow | undefined =>
  db.prepare('SELECT * FROM wiki_pages WHERE titel = ?').get(titel) as WikiSeiteRow | undefined;

function ensureSystemSeite(autor: Autor, titel: string, text: string): void {
  if (seiteMitTitel(titel)) return;

  let seite = legeSeiteAn({ id: autor.id, name: autor.name }, titel);
  seite = speichereSeite(autor, seite, {
    titel,
    text,
    tags: '',
    kommentar: 'Systemseite angelegt',
    basisRev: null,
  });

  // Flags nach dem Schreiben setzen: „geschützt" würde sonst schon diesen
  // ersten Speichervorgang blockieren, wenn autor kein Spielleiter-Konto ist
  // (kann hier zwar nicht vorkommen, spielleitung() liefert immer einen
  // Spielleiter, aber die Reihenfolge kostet nichts und bleibt so am
  // Demo-Seed-Muster).
  seite = setzeFlag(autor, seite, 'geschuetzt', true) ?? seite;
  db.prepare('UPDATE wiki_pages SET unloeschbar = 1 WHERE id = ?').run(seite.id);
  console.log(`[wiki] Systemseite „${titel}" angelegt.`);
}

const WUERFELN_TEXT = [
  'Diese Seite erklärt das Würfeln im Chat und das Regelwerk dahinter. Sie ist **geschützt**',
  '(nur die Spielleitung darf sie bearbeiten) und kann nicht gelöscht werden.',
  '',
  '## Die Probe',
  '',
  'Eine Probe wirft ein oder mehrere W20 gegen einen vorher berechneten Probe-Wert. Waffen-',
  'und Eigenschaftsproben werfen einen einzelnen W20. Talente, Sprachen und die meisten',
  'Zauber/Fähigkeiten werfen mehrere W20 (meist drei), je einen gegen einen Teilwert.',
  '',
  'Die Summe der Würfel darf den Probe-Wert nicht übersteigen. Bei mehreren Würfeln gibt es',
  'einen Spielraum von bis zu 4 Punkten über dem Probe-Wert: ein **Knapper Erfolg**. Bei nur',
  'einem Würfel gibt es diesen Spielraum nicht, der Wurf gelingt sauber oder gar nicht.',
  '',
  'Der Zielwert (die Zahl hinter dem „/") bleibt nur dir selbst und der Spielleitung sichtbar.',
  'Andere Spieler sehen im Chat nur Würfel, Summe und Erfolg/Misserfolg.',
  '',
  '## Kritische Würfe: 20 und 1',
  '',
  'Jede natürliche 20 und jede natürliche 1 unter den W20 löst einen eigenen Bestätigungswurf',
  'aus. Den wirfst du selbst per Knopf, oder du lehnst ihn mit „Ohne" ab, wenn der Wurf gar',
  'kein Patzer-Konzept kennt (etwa ein freier Wurf).',
  '',
  '**Natürliche 20:** Bestätigung ≥ 10 macht sie zu einem **kritischen Fehlschlag** (Patzer),',
  'der jedes Erfolg/Misserfolg-Ergebnis überstimmt. Mehrere bestätigte 20er in einem Wurf',
  'verschärfen den Patzer. Bestätigung < 10 heißt: keine Bestätigung, aber ihr Wert wird trotzdem',
  'zur Summe addiert, was den Wurf verschlechtert und ihn bestenfalls noch knapp bestehen lässt.',
  '',
  '**Natürliche 1:** Ihre Bestätigung wird immer geworfen, und ihr Wert wird immer von der',
  'Summe abgezogen, unabhängig vom Ergebnis. Bleibt sie unaufgehoben stehen und der Wurf',
  'besteht sauber, ist das ein **kritischer Erfolg**.',
  '',
  'Treffen eine 20 und eine 1 im selben Wurf aufeinander, heben sie sich gegenseitig auf (in',
  'Wurfreihenfolge): Ihre Bestätigung wird trotzdem geworfen und zählt normal zur Summe, nur',
  'ihre Sonderbedeutung als Patzer oder kritischer Erfolg entfällt.',
  '',
  'Ein Wurf gilt erst als entschieden, wenn keine Bestätigung mehr offen ist.',
  '',
  '## Sichtbarkeit',
  '',
  '| Modus | Wer sieht den Wurf |',
  '| --- | --- |',
  '| Öffentlich | Die ganze Gruppe |',
  '| Verborgen | Nur du selbst, auch die Spielleitung nicht |',
  '| SL-Wurf | Nur du und die Spielleitung, ohne vorherige Anfrage |',
  '',
  'Bei „SL-Wurf" zählt für einen Spieler automatisch die gerade verbundene Spielleitung als',
  'Gegenüber. Die Spielleitung wählt bei einem eigenen Wurf stattdessen gezielt, mit welchem',
  'Gruppenmitglied sie ihn teilt.',
  '',
  '## Erleichterung/Erschwernis und Schicksalspunkte',
  '',
  'Ein situativer Modifikator wirkt auf die geworfene Summe, nicht auf den Probe-Wert: positiv',
  'erschwert, negativ erleichtert. Er gilt für genau den nächsten Wurf und setzt sich danach von',
  'selbst zurück.',
  '',
  'Schicksalspunkte erlauben eine komplette Probe zu wiederholen, mit Zustimmung der',
  'Spielleitung. Sie stehen begrenzt zur Verfügung und werden von der Spielleitung',
  'gutgeschrieben.',
  '',
  '## Freie Würfe und weitere Befehle',
  '',
  'Freie Würfe laufen über Chat-Befehle wie „/r" für einen beliebigen Würfelausdruck, „/master"',
  'für einen Meisterwurf oder „/wild" für wilde Magie. Die genaue Syntax und alle weiteren',
  'Befehle zeigt „/commands" direkt im Chat-Panel.',
].join('\n');

/**
 * `bildSlug`: null, solange kein Beispielbild hochgeladen werden konnte (siehe
 * demoBild) — der Bilder-Abschnitt beschreibt die Schreibweise dann nur noch
 * in Worten, ohne Live-Beispiel.
 */
function wikiHilfeText(bildSlug: string | null): string {
  return [
  'Diese Seite erklärt, wie das Wiki funktioniert: Formatierung, Verweise, Bilder, Kategorien',
  'und mehr. Sie ist **geschützt** (nur die Spielleitung darf sie bearbeiten) und kann nicht',
  'gelöscht werden.',
  '',
  '## Seiten anlegen und bearbeiten',
  '',
  'Jeder darf Seiten anlegen und bearbeiten, nichts muss vorher freigegeben werden. Über',
  '„+ Neue Seite" oder per Klick auf einen roten Verweis (siehe unten) entsteht eine neue Seite.',
  'Der Editor zeigt eine Vorschau, und ein kurzer Kommentar hält fest, was sich geändert hat,',
  'für das Änderungsprotokoll.',
  '',
  '## Formatierung',
  '',
  'Grundformatierung mit einfachen Zeichen. Zuerst die Übersicht, danach jeder Abschnitt',
  'einzeln: was du eintippst, und direkt darunter, was daraus wird. Der Editor hat außerdem',
  'einen eigenen Spickzettel mit denselben Beispielen.',
  '',
  '| Eingabe | Ergebnis |',
  '| --- | --- |',
  '| `# Titel`, `## Titel`, `### Titel` | Überschrift (bis zu drei Ebenen) |',
  '| `- Punkt` oder `1. Punkt` | Liste |',
  '| `**fett**`, `*kursiv*`, `` `code` `` | **fett**, *kursiv*, `code` |',
  '| `> Zitat` | Zitatblock |',
  '| `---` | Trennlinie |',
  '| Senkrechte Striche zwischen Spalten | Tabelle (siehe unten) |',
  '',
  '### Überschriften',
  '',
  '`# Titel`, `## Titel` oder `### Titel`, für bis zu drei Ebenen. Diese Seite benutzt sie',
  'selbst: jede Zeile im Inhaltsverzeichnis links ist so eine Überschrift.',
  '',
  '### Listen',
  '',
  'Eintippen:',
  '',
  '```',
  '- Erster Punkt',
  '- Zweiter Punkt',
  '',
  '1. Erster Schritt',
  '2. Zweiter Schritt',
  '```',
  '',
  'Ergebnis:',
  '',
  '- Erster Punkt',
  '- Zweiter Punkt',
  '',
  '1. Erster Schritt',
  '2. Zweiter Schritt',
  '',
  '### Fett, kursiv und Code',
  '',
  'Eintippen:',
  '',
  '```',
  '**fett**, *kursiv*, `code`',
  '```',
  '',
  'Ergebnis: **fett**, *kursiv*, `code`',
  '',
  '### Zitat',
  '',
  'Eintippen:',
  '',
  '```',
  '> Ein Zitat',
  '```',
  '',
  'Ergebnis:',
  '',
  '> Ein Zitat',
  '',
  '### Trennlinie',
  '',
  'Eintippen:',
  '',
  '```',
  '---',
  '```',
  '',
  'Ergebnis:',
  '',
  '---',
  '',
  '### Tabelle',
  '',
  'Eintippen:',
  '',
  '```',
  '| Spalte A | Spalte B |',
  '| --- | --- |',
  '| Wert 1 | Wert 2 |',
  '```',
  '',
  'Ergebnis:',
  '',
  '| Spalte A | Spalte B |',
  '| --- | --- |',
  '| Wert 1 | Wert 2 |',
  '',
  '## Verweise',
  '',
  'Zwei eckige Klammern verweisen auf eine andere Seite: `[[Titel]]` oder `[[Titel|Anzeigetext]]`',
  'für einen abweichenden Linktext. Zeigt der Verweis auf eine Seite, die es noch nicht gibt, ist',
  'er rot und legt die Seite per Klick an. Externe Verweise nutzen die übliche',
  '`[Text](https://…)`-Schreibweise und öffnen in einem neuen Tab.',
  '',
  '## Bilder',
  '',
  'Bilder lädst du direkt im Editor hoch, dabei bekommt jedes einen eigenen, zufälligen Slug.',
  'Ein Klick auf das hochgeladene Bild setzt die passende Zeile automatisch in den Text ein.',
  'Die Schreibweise dahinter musst du also nicht auswendig können, nur wiedererkennen und bei',
  'Bedarf anpassen: `[[bild:Slug|Größe|Position|Unterschrift]]`.',
  '',
  ...(bildSlug
    ? [
        '### Rechts',
        '',
        'Eintippen:',
        '',
        '```',
        `[[bild:${bildSlug}|klein|rechts|Das Zeitenkompass-Symbol]]`,
        'Ein Beispieltext, damit sich zeigt, wie das Bild sich verhält. Bei „rechts" steht das Bild',
        'rechter Hand, und dieser Absatz fließt links daneben weiter, bis er über das Bild',
        'hinausreicht.',
        '```',
        '',
        'Ergebnis:',
        '',
        `[[bild:${bildSlug}|klein|rechts|Das Zeitenkompass-Symbol]]`,
        'Ein Beispieltext, damit sich zeigt, wie das Bild sich verhält. Bei „rechts" steht das Bild',
        'rechter Hand, und dieser Absatz fließt links daneben weiter, bis er über das Bild',
        'hinausreicht.',
        '',
        '### Links',
        '',
        'Eintippen:',
        '',
        '```',
        `[[bild:${bildSlug}|klein|links|Das Zeitenkompass-Symbol]]`,
        'Derselbe Beispieltext, diesmal mit „links". Das Bild steht jetzt linker Hand, und dieser',
        'Absatz fließt stattdessen rechts daneben weiter, bis er über das Bild hinausreicht.',
        '```',
        '',
        'Ergebnis:',
        '',
        `[[bild:${bildSlug}|klein|links|Das Zeitenkompass-Symbol]]`,
        'Derselbe Beispieltext, diesmal mit „links". Das Bild steht jetzt linker Hand, und dieser',
        'Absatz fließt stattdessen rechts daneben weiter, bis er über das Bild hinausreicht.',
        '',
        '### Mitte',
        '',
        'Eintippen:',
        '',
        '```',
        `[[bild:${bildSlug}|klein|mitte|Das Zeitenkompass-Symbol]]`,
        'Wieder derselbe Beispieltext, diesmal mit „mitte".',
        '```',
        '',
        'Ergebnis:',
        '',
        `[[bild:${bildSlug}|klein|mitte|Das Zeitenkompass-Symbol]]`,
        '',
        'Wieder derselbe Beispieltext, diesmal mit „mitte". Bei „mitte" steht das Bild für sich',
        'allein in einer eigenen Zeile, kein Text fließt daneben, auch nicht bei einem kurzen Absatz',
        'wie diesem.',
      ]
    : []),
  '',
  '| Größe | Wirkung |',
  '| --- | --- |',
  '| klein | Schmal, Text kann daneben fließen |',
  '| mittel | Mittelgroß, Text kann daneben fließen |',
  '| groß | Groß, füllt aber noch nicht die ganze Breite |',
  '| voll | Volle Breite, eigene Zeile |',
  '',
  '| Position | Wirkung |',
  '| --- | --- |',
  '| links | Bild links, Text fließt rechts daneben |',
  '| rechts | Bild rechts, Text fließt links daneben |',
  '| mitte | Bild zentriert, eigene Zeile, kein Text daneben |',
  '',
  'Die Unterschrift (der letzte Teil hinter dem Bild-Slug) ist frei wählbar und optional. Jedes',
  'Bild lässt sich per Klick in voller Größe ansehen, unabhängig von der hier eingestellten',
  'Größe.',
  '',
  '## Kategorien',
  '',
  'Ein Eintrag im Tag-Feld (zum Beispiel „Orte") erzeugt die Kategorie sofort. Eine Seite',
  '„Kategorie:Orte" beschreibt sie in eigenen Worten. Trägt diese Kategorieseite selbst wieder',
  'eine Kategorie, ordnen sich Kategorien ineinander, „Städte" kann so in „Orte" liegen.',
  '',
  '## Weiterleitungen',
  '',
  'Steht ganz oben auf einer Seite `#WEITERLEITUNG [[Ziel]]`, landet man beim Aufrufen direkt',
  'beim Ziel, praktisch für Zweitnamen und andere Schreibweisen.',
  '',
  '## Suche',
  '',
  'Die Volltextsuche versteht Umlaute und ß gleichermaßen: „strasse" findet auch „Straße".',
  '',
  '## Verlauf',
  '',
  'Jede Bearbeitung bleibt dauerhaft erhalten, mit Autor, Zeitpunkt und Kommentar. Zwei',
  'Fassungen lassen sich vergleichen, und jede ältere Fassung lässt sich zurückholen.',
  '',
  '## Spielleiter-Werkzeuge',
  '',
  'Die Spielleitung kann eine Seite auf „nur Spielleitung" stellen (für Spieler existiert sie dann',
  'nirgends) oder „geschützt" (sichtbar für alle, änderbar nur durch die Spielleitung, wie diese',
  'Seite hier). Gelöschte Seiten landen im Papierkorb und lassen sich zurückholen, endgültig',
  'gelöscht wird erst auf ausdrücklichen Befehl.',
  ].join('\n');
}

/**
 * Zwei Speichervorgänge, wie beim Demo-Seed's Gareth-Seite: Das Bild braucht
 * die Seiten-ID, die Seite also zuerst mit Platzhaltertext anlegen und danach
 * mit dem endgültigen Inhalt (samt echtem Bild-Slug) überschreiben.
 */
function ensureWikiHilfe(autor: Autor): void {
  if (seiteMitTitel('Wiki-Hilfe')) return;

  let seite = legeSeiteAn({ id: autor.id, name: autor.name }, 'Wiki-Hilfe');
  seite = speichereSeite(autor, seite, {
    titel: 'Wiki-Hilfe',
    text: 'Platzhalter, wird gleich durch den echten Inhalt ersetzt.',
    tags: '',
    kommentar: 'Systemseite angelegt',
    basisRev: null,
  });

  const bildSlug = demoBild(seite, autor);
  const rev = db
    .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
    .get(seite.id) as { id: number };
  seite = speichereSeite(autor, seite, {
    titel: 'Wiki-Hilfe',
    text: wikiHilfeText(bildSlug),
    tags: '',
    kommentar: 'Inhalt ergänzt',
    basisRev: rev.id,
  });

  seite = setzeFlag(autor, seite, 'geschuetzt', true) ?? seite;
  db.prepare('UPDATE wiki_pages SET unloeschbar = 1 WHERE id = ?').run(seite.id);
  console.log('[wiki] Systemseite „Wiki-Hilfe" angelegt.');
}

export function seedSystemSeiten(): void {
  const sl = spielleitung();
  if (!sl) return;
  ensureSystemSeite(sl, 'Würfeln', WUERFELN_TEXT);
  ensureWikiHilfe(sl);
}
