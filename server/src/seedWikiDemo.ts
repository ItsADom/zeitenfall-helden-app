// Demo-Seed fürs Wiki: legt eine kleine, zusammenhängende Beispielwelt an, in
// der JEDE gebaute Funktion einmal vorkommt — Kategorien mit Unterkategorien,
// Bilder in allen Größen und Lagen, Wikilinks samt Rotlink, Weiterleitungen,
// Nur-SL-Seiten und -Abschnitte, eine geschützte Seite, ein Papierkorb-Eintrag,
// Verlauf mit mehreren Fassungen und Suchtreffer über Umlaut und ß.
//
// Gedacht zum Anschauen und Kaputtklicken, nicht als Inhalt: `npm run
// seed:wiki` in einer Entwicklungsdatenbank.
//
// Zwei Aufrufwege: als Skript über das npm-Skript, oder beim Serverstart, wenn
// SEED_WIKI_DEMO=1 gesetzt ist (siehe index.ts). Der zweite Weg füllt eine
// frisch geleerte dev-Datenbank von selbst wieder. „Idempotent" heißt dabei
// nicht „stellt den Demo-Zustand wieder her": Erkannt wird am Titel, und
// `seiteMitTitel` sieht auch gelöschte Seiten — was du wegklickst, bleibt weg.
//
// Sicherheitsnetze wie beim Dummy-Seed:
//   • Bricht bei NODE_ENV=production ab.
//   • Idempotent: erkannt wird am Titel. Ein zweiter Lauf legt nichts doppelt
//     an und überschreibt vor allem NICHTS, was jemand inzwischen geändert hat.
//
// Geschrieben wird über dieselben Funktionen wie im laufenden Betrieb
// (legeSeiteAn/speichereSeite), nie per Hand ins SQL: nur so entstehen Auszug,
// Verweise, Kategorien, Namensraum, Weiterleitung und beide Suchindizes so, wie
// sie der Server auch sonst erzeugt.
import { pathToFileURL } from 'node:url';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import './wiki/schema.js';
import { legeSeiteAn, speichereSeite } from './wiki/seiten.js';
import type { WikiSeiteRow } from './wiki/zugriff.js';
import { bilderFuerSeite, legeBildAn } from './wiki/bilder.js';
import { loescheSeite, setzeFlag } from './wiki/verwaltung.js';
import {
  bannerGrauenstein,
  geheimskizze,
  karteGareth,
  portraitAlrik,
  wappenGareth,
} from './seedWikiBilder.js';

interface Autor {
  id: number;
  isGm: boolean;
  name: string;
}

// Throws rather than exits: since this also runs from the server start (see
// SEED_WIKI_DEMO in index.ts), a refusal must stay catchable. A process.exit
// there would kill the service, and Restart=always would make it a loop.
function abortIfProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NODE_ENV=production — diese Seiten gehören nicht in die echte Datenbank.');
  }
}

/** Die Spielleitung — die gibt es nach dem normalen Seed immer. */
function spielleitung(): Autor {
  const row = db.prepare('SELECT id, display_name AS name FROM users WHERE is_gm = 1 ORDER BY id').get() as
    | { id: number; name: string }
    | undefined;
  if (!row) {
    throw new Error('Kein Spielleiter-Konto gefunden. Erst `npm run seed` laufen lassen.');
  }
  return { ...row, isGm: true };
}

/**
 * Ein Spieler als zweiter Autor, damit Verlauf und „Letzte Änderungen" zwei
 * Namen zeigen statt einen. Vorhandene werden benutzt; nur wenn es gar keinen
 * gibt, entsteht einer.
 */
function spieler(): Autor {
  const vorhanden = db
    .prepare('SELECT id, display_name AS name FROM users WHERE is_gm = 0 AND is_admin = 0 ORDER BY id')
    .get() as { id: number; name: string } | undefined;
  if (vorhanden) return { ...vorhanden, isGm: false };

  const passwort = process.env.DUMMY_PASSWORD ?? 'test1234';
  const info = db
    .prepare("INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, 0, 0)")
    .run('alrik', hashPassword(passwort), 'Alrik');
  console.log(`  Spieler-Konto „alrik" angelegt (Passwort: ${passwort}).`);
  return { id: Number(info.lastInsertRowid), isGm: false, name: 'Alrik' };
}

const seiteMitTitel = (titel: string): WikiSeiteRow | undefined =>
  db.prepare('SELECT * FROM wiki_pages WHERE titel = ?').get(titel) as WikiSeiteRow | undefined;

interface SeiteWunsch {
  titel: string;
  text: string;
  tags?: string;
  autor: Autor;
  kommentar?: string;
  /** Weitere Fassungen — dafür sind Verlauf, Unterschiede und das Protokoll da. */
  nachtrag?: { autor: Autor; text: string; kommentar: string }[];
  gmOnly?: boolean;
  geschuetzt?: boolean;
  inPapierkorb?: boolean;
}

const angelegt: string[] = [];
const uebersprungen: string[] = [];

function ensureSeite(w: SeiteWunsch): WikiSeiteRow {
  const schon = seiteMitTitel(w.titel);
  if (schon) {
    uebersprungen.push(w.titel);
    return schon;
  }

  let seite = legeSeiteAn({ id: w.autor.id, name: w.autor.name }, w.titel);
  seite = speichereSeite({ ...w.autor }, seite, {
    titel: w.titel,
    text: w.text,
    tags: w.tags ?? '',
    kommentar: w.kommentar ?? 'Erste Fassung',
    basisRev: null,
  });

  for (const n of w.nachtrag ?? []) {
    const aktuell = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(seite.id) as WikiSeiteRow;
    const rev = db
      .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
      .get(seite.id) as { id: number } | undefined;
    seite = speichereSeite({ ...n.autor }, aktuell, {
      titel: w.titel,
      text: n.text,
      tags: w.tags ?? '',
      kommentar: n.kommentar,
      basisRev: rev?.id ?? null,
    });
  }

  // Flags nach dem Schreiben: „geschützt" würde sonst die eigene zweite Fassung
  // abweisen, weil der Spieler danach nicht mehr schreiben darf.
  const sl = spielleitungCache;
  if (w.gmOnly) seite = setzeFlag(sl, seite, 'gm_only', true) ?? seite;
  if (w.geschuetzt) seite = setzeFlag(sl, seite, 'geschuetzt', true) ?? seite;
  if (w.inPapierkorb) loescheSeite(sl, seite);

  angelegt.push(w.titel);
  return seite;
}

let spielleitungCache: Autor;

function bild(seite: WikiSeiteRow, quelle: { titel: string; data: Buffer }, autor: Autor, gmOnly = false): string {
  // Am Titel erkannt, wie die Seiten auch: sonst hinge nach dem zweiten Lauf
  // jedes Bild doppelt an der Seite, während der Text nur das erste erwähnt.
  const schon = bilderFuerSeite(seite).find((b) => b.titel === quelle.titel);
  if (schon) return schon.slug;

  const slug = legeBildAn(seite, {
    titel: quelle.titel,
    mime: 'image/png',
    data: quelle.data,
    gmOnly,
    hochgeladenVon: { id: autor.id, name: autor.name },
  });
  if (!slug) {
    throw new Error('Bild konnte nicht gespeichert werden — ist helden-assets.db erreichbar (HELDEN_ASSETS_DB)?');
  }
  return slug;
}

export function seedWikiDemo(): void {
  abortIfProduction();
  const sl = spielleitung();
  spielleitungCache = sl;
  const sp = spieler();

  if (seiteMitTitel('Gareth')) {
    console.log('  (Demo-Seiten sind schon da — es wird nichts überschrieben.)');
  }

  // --- Kategorien als echte Seiten, drei Ebenen tief -----------------------

  ensureSeite({
    autor: sl,
    titel: 'Kategorie:Welt',
    text:
      'Alles, was es in der Welt des **Zeitenfalls** gibt: Orte, Personen, Mächte.\n' +
      'Die Unterkategorien führen weiter.',
  });

  ensureSeite({
    autor: sl,
    titel: 'Kategorie:Orte',
    tags: 'Welt',
    text:
      'Schauplätze der Kampagne — Städte, Burgen, Wälder, Straßen.\n\n' +
      'Diese Seite steht selbst in der Kategorie [[Kategorie:Welt|Welt]]; genau das macht sie zu einer\n' +
      'Unterkategorie. Ein Baum entsteht dadurch von allein, ohne dass ihn jemand anlegen müsste.',
  });

  ensureSeite({
    autor: sl,
    titel: 'Kategorie:Städte',
    tags: 'Orte',
    text: 'Orte mit Mauern, Markt und Obrigkeit. Untergeordnet den *Orten*.',
  });

  ensureSeite({
    autor: sl,
    titel: 'Kategorie:Personen',
    tags: 'Welt',
    text: 'Wer den Helden begegnet: Verbündete, Händler, Widersacher.',
  });

  ensureSeite({
    autor: sl,
    titel: 'Kategorie:Regeln',
    text: 'Hausregeln und Nachschlagewerk für den Tisch.',
  });

  // --- Der Leitartikel ----------------------------------------------------

  const gareth = ensureSeite({
    autor: sp,
    titel: 'Gareth',
    tags: 'Orte, Städte',
    kommentar: 'Stadt angelegt',
    text: 'Platzhalter, wird gleich gefüllt.',
    nachtrag: [
      {
        autor: sl,
        kommentar: 'Abschnitte, Karte und Wappen ergänzt',
        text: 'Zweite Fassung, wird gleich ersetzt.',
      },
    ],
  });

  // Bilder erst jetzt: sie brauchen die Seiten-ID, und ihre Slugs kommen
  // zufällig zustande und müssen deshalb in den Text eingesetzt werden.
  const karte = bild(gareth, karteGareth(), sl);
  const wappen = bild(gareth, wappenGareth(), sp);

  if (angelegt.includes('Gareth')) {
    const jetzt = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(gareth.id) as WikiSeiteRow;
    const rev = db
      .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
      .get(gareth.id) as { id: number };
    speichereSeite(sl, jetzt, {
      titel: 'Gareth',
      tags: 'Orte, Städte',
      kommentar: 'Karte und Wappen eingebunden',
      basisRev: rev.id,
      text: [
        `[[bild:${wappen}|klein|rechts|Das Wappen der Stadt]]`,
        '',
        '**Gareth** ist die größte Stadt des Reiches und der Ort, an dem die Kampagne beginnt.',
        'Wer über [[Die Straße nach Gareth|die große Straße]] kommt, sieht zuerst die Türme.',
        '',
        '## Lage',
        '',
        `[[bild:${karte}|gross|mitte|Die Umgebung: Fluss, Wald und die beiden Straßen]]`,
        '',
        'Die Stadt liegt am Knick des Flusses, dort wo die Handelswege aus dem Süden auf die',
        'Straße nach [[Grauenstein]] treffen. Nach Osten führt eine Straße bis [[Perricum]] —',
        'diese Seite gibt es noch nicht, deshalb ist der Verweis *rot* und legt sie auf Klick an.',
        '',
        '## Viertel',
        '',
        '| Viertel | Ruf | Bewacht von |',
        '| --- | --- | --- |',
        '| Tempelbezirk | vornehm | Stadtgarde |',
        '| Hafenviertel | rau | niemandem |',
        '| Neustadt | geschäftig | Söldnern |',
        '',
        '### Der Tempelbezirk',
        '',
        'Hier residiert die Obrigkeit, hier steht das Haus von [[Alrik von Gareth]].',
        '',
        '> Wer in Gareth etwas gilt, wohnt oben am Hügel.',
        '> Wer in Gareth etwas *weiß*, wohnt unten am Hafen.',
        '',
        '### Das Hafenviertel',
        '',
        'Enge Gassen, billiges Bier, und angeblich mehr als ein Keller, der nicht auf der Karte steht.',
        '',
        '```gm',
        'Nur für die Spielleitung: Der Wirt im „Blauen Ochsen" arbeitet für die Schwarze Hand.',
        'Wenn die Gruppe zu laut nach dem Keller fragt, verschwindet sie aus dem Hafenviertel —',
        'siehe [[Die Schwarze Hand]].',
        '```',
        '',
        '## Regeln vor Ort',
        '',
        '1. Waffen bleiben im Tempelbezirk gebunden.',
        '2. Zauber in der Öffentlichkeit kosten eine Strafe — siehe [[Regeln: Zauberproben]].',
        '3. Fremde zahlen Torzoll.',
        '',
        '---',
        '',
        'Mehr zum Umland steht auf [[Grauenstein]]. Der Reisebericht liegt unter',
        '[Aventurische Bibliothek](https://www.wiki-aventurica.de/) — ein externer Verweis,',
        'der in einem neuen Tab aufgeht.',
      ].join('\n'),
    });
  }

  // --- Zweiter Ort, damit „Verweise hierher" etwas zu zeigen hat ----------

  const grauenstein = ensureSeite({
    autor: sp,
    titel: 'Grauenstein',
    tags: 'Orte',
    kommentar: 'Angelegt',
    text: 'Platzhalter.',
  });
  const banner = bild(grauenstein, bannerGrauenstein(), sp);
  if (angelegt.includes('Grauenstein')) {
    const jetzt = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(grauenstein.id) as WikiSeiteRow;
    const rev = db
      .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
      .get(grauenstein.id) as { id: number };
    speichereSeite(sp, jetzt, {
      titel: 'Grauenstein',
      tags: 'Orte',
      kommentar: 'Banner und Text',
      basisRev: rev.id,
      text: [
        `[[bild:${banner}|voll|Die Kämme über Grauenstein, von der Straße aus]]`,
        '',
        'Zwei Tagesritte nordwestlich von [[Gareth]] steigen die Kämme auf. **Grauenstein**',
        'ist die letzte Feste davor — und der Name, den die Kampagne „Schatten über Grauenstein"',
        'trägt.',
        '',
        '## Anreise',
        '',
        'Über [[Die Straße nach Gareth]], dann nordwärts. Zu Fuß fünf Tage, beritten zwei.',
        '',
        '## Was man hört',
        '',
        '- In den Stollen soll etwas begraben liegen.',
        '- Die Feste steht seit dem *Zeitenfall* leer.',
        '- Der letzte Vogt ist nie zurückgekommen.',
      ].join('\n'),
    });
  }

  ensureSeite({
    autor: sp,
    titel: 'Die Straße nach Gareth',
    tags: 'Orte',
    kommentar: 'Angelegt',
    text: [
      'Die große **Straße** verbindet den Süden mit [[Gareth]] und weiter mit [[Grauenstein]].',
      '',
      'Sie ist zugleich das Beispiel dafür, dass die Suche das ß versteht: Wer *strasse* eintippt,',
      'findet diese Seite ebenso wie mit *Straße*. Dasselbe gilt für Umlaute — *Kamme* findet',
      'die Kämme.',
      '',
      '## Stationen',
      '',
      '1. Die Zollbrücke',
      '2. Der Rastplatz am Wäldchen',
      '3. Das Südtor von Gareth',
    ].join('\n'),
  });

  // --- Personen -----------------------------------------------------------

  const alrik = ensureSeite({
    autor: sp,
    titel: 'Alrik von Gareth',
    tags: 'Personen',
    kommentar: 'Angelegt',
    text: 'Platzhalter.',
    nachtrag: [{ autor: sl, kommentar: 'Werte nachgetragen', text: 'Zwischenfassung.' }],
  });
  const portrait = bild(alrik, portraitAlrik(), sp);
  if (angelegt.includes('Alrik von Gareth')) {
    const jetzt = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(alrik.id) as WikiSeiteRow;
    const rev = db
      .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
      .get(alrik.id) as { id: number };
    speichereSeite(sl, jetzt, {
      titel: 'Alrik von Gareth',
      tags: 'Personen',
      kommentar: 'Porträt eingefügt',
      basisRev: rev.id,
      text: [
        `[[bild:${portrait}|mittel|links|Alrik, gezeichnet am Hof]]`,
        '',
        '**Alrik von Gareth** hält Haus im Tempelbezirk von [[Gareth]]. Er gilt als zugänglich,',
        'solange man ihn nicht nach seinem Bruder fragt.',
        '',
        'Dieser Absatz steht absichtlich *neben* dem Bild: Die Bildzeile steht davor, also fließt',
        'der Text daneben weiter, bis er über das Bild hinausreicht. Genau so setzt man Text auf',
        'dieselbe Höhe wie ein Bild.',
        '',
        '## Werte',
        '',
        '| Eigenschaft | Wert |',
        '| --- | --- |',
        '| Mut | 14 |',
        '| Klugheit | 13 |',
        '| Gewandtheit | 11 |',
        '',
        '```gm',
        'Alriks Bruder ist seit dem Zeitenfall verschollen. Alrik weiß, dass er lebt, und zahlt',
        'seit Jahren für Nachrichten über ihn — an die falschen Leute.',
        '```',
      ].join('\n'),
    });
  }

  // --- Regelseite ---------------------------------------------------------

  ensureSeite({
    autor: sl,
    titel: 'Regeln: Zauberproben',
    tags: 'Regeln',
    kommentar: 'Hausregel festgehalten',
    text: [
      'Eine **Zauberprobe** läuft wie eine Talentprobe, mit drei Unterschieden.',
      '',
      '## Ablauf',
      '',
      '1. Drei Würfe gegen die drei Eigenschaften des Zaubers.',
      '2. Übrige Punkte vom Zauberwert abziehen.',
      '3. Bleibt etwas übrig, gelingt der Zauber.',
      '',
      '## Erschwernisse',
      '',
      '| Umstand | Aufschlag |',
      '| --- | --- |',
      '| In Bewegung | +2 |',
      '| Verletzt | +4 |',
      '| Ohne Geste | +7 |',
      '',
      '## Notation am Tisch',
      '',
      'Wir schreiben Proben verkürzt auf. Der Block darunter zeigt sie so, wie sie im Heft steht —',
      'unverändert, ohne Formatierung:',
      '',
      '```',
      'ZP (MU/KL/CH) 14  -  Erschwernis +4  =>  10 verbleibend',
      '```',
      '',
      '> Im Zweifel entscheidet der Tisch, nicht das Heft.',
    ].join('\n'),
  });

  // --- Weiterleitungen ----------------------------------------------------

  ensureSeite({
    autor: sp,
    titel: 'Gareth (Stadt)',
    kommentar: 'Wegweiser',
    text: '#WEITERLEITUNG [[Gareth]]',
  });

  ensureSeite({
    autor: sp,
    titel: 'Die Hauptstadt',
    kommentar: 'Wegweiser',
    text: '#WEITERLEITUNG [[Gareth]]',
  });

  // --- Nur Spielleitung ---------------------------------------------------

  const hand = ensureSeite({
    autor: sl,
    titel: 'Die Schwarze Hand',
    tags: 'Personen',
    kommentar: 'Angelegt',
    gmOnly: true,
    text: [
      'Diese **ganze Seite** ist auf „nur Spielleiter" gestellt. Für Spieler existiert sie nirgends:',
      'nicht in der Liste, nicht in der Suche, nicht in den Kategorien und nicht im Protokoll.',
      'Ein Spieler, der die Adresse errät, bekommt 404 — nicht 403, sonst wüsste er ja Bescheid.',
      '',
      '## Wer dahintersteckt',
      '',
      'Der Wirt im „Blauen Ochsen" zu [[Gareth]] ist der Kopf, nicht der Handlanger.',
      '',
      '## Die Gewölbe',
      '',
      'Der Zugang liegt unter dem Hafenviertel.',
    ].join('\n'),
  });
  const skizze = bild(hand, geheimskizze(), sl, true);
  if (angelegt.includes('Die Schwarze Hand')) {
    const jetzt = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(hand.id) as WikiSeiteRow;
    const rev = db
      .prepare('SELECT id FROM wiki_revisions WHERE page_id = ? AND text IS NOT NULL ORDER BY nr DESC LIMIT 1')
      .get(hand.id) as { id: number };
    const alt = db.prepare('SELECT text FROM wiki_revisions WHERE id = ?').get(rev.id) as { text: string };
    speichereSeite(sl, jetzt, {
      titel: 'Die Schwarze Hand',
      tags: 'Personen',
      kommentar: 'Skizze ergänzt',
      basisRev: rev.id,
      text: `${alt.text}\n\n[[bild:${skizze}|mittel|rechts|Die Kellergewölbe]]\n`,
    });
  }

  // --- Geschützt, Papierkorb, Wegweiser ins Leere -------------------------

  ensureSeite({
    autor: sl,
    titel: 'Willkommen im Zeitenkompass-Wiki',
    tags: 'Regeln',
    kommentar: 'Startseite',
    geschuetzt: true,
    text: [
      'Diese Seite ist **geschützt**: sichtbar für alle, änderbar nur durch die Spielleitung.',
      'Ein Spieler, der es trotzdem versucht, bekommt hier ausnahmsweise 403 statt 404 — die Seite',
      'ist ja ohnehin zu sehen, es gibt also nichts zu verbergen.',
      '',
      '## Was hier steht',
      '',
      '- Orte: [[Gareth]], [[Grauenstein]], [[Die Straße nach Gareth]]',
      '- Personen: [[Alrik von Gareth]]',
      '- Regeln: [[Regeln: Zauberproben]]',
      '',
      '## Wie man mitschreibt',
      '',
      '1. Oben rechts auf **+ Neue Seite**.',
      '2. Text tippen; der Spickzettel unter dem Feld erklärt die Formatierung.',
      '3. Kurz notieren, *was* geändert wurde — das steht später im Protokoll.',
      '',
      'Niemand muss etwas freigeben. Wer sich vertut, holt unter **Verlauf** die vorige Fassung zurück.',
      '',
      '## Zum Ausprobieren',
      '',
      '- Ein Rotlink: [[Perricum]] — die Seite gibt es nicht, ein Klick legt sie an.',
      '- Ein Wegweiser: [[Gareth (Stadt)]] führt weiter auf Gareth.',
      '- Die Kategorien stehen links; [[Kategorie:Orte|Orte]] enthält eine Unterkategorie.',
    ].join('\n'),
  });

  ensureSeite({
    autor: sp,
    titel: 'Verworfene Notizen',
    kommentar: 'Angelegt',
    inPapierkorb: true,
    text:
      'Diese Seite liegt im **Papierkorb**. Verlauf und Bilder sind noch da, die Spielleitung kann\n' +
      'sie zurückholen — endgültig gelöscht wird sie erst auf ausdrücklichen Befehl.',
  });

  const zahl = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  console.log(
    `\n✓ Wiki-Demo fertig. ${angelegt.length} Seite(n) neu, ${uebersprungen.length} schon vorhanden.\n` +
      `  Stand jetzt: ${zahl('SELECT COUNT(*) AS n FROM wiki_pages WHERE geloescht_at IS NULL')} Seiten, ` +
      `${zahl("SELECT COUNT(*) AS n FROM wiki_pages WHERE namensraum = 'kategorie'")} Kategorien, ` +
      `${zahl('SELECT COUNT(*) AS n FROM wiki_revisions')} Protokolleinträge.\n` +
      `  Autoren: ${sl.name} (Spielleitung) und ${sp.name} (Spieler).\n` +
      '  Anfangen bei „Willkommen im Zeitenkompass-Wiki".',
  );
}

// Unlike its sibling seeds this file must stay importable WITHOUT seeding:
// index.ts calls seedWikiDemo() behind SEED_WIKI_DEMO=1, and a bare call here
// would fire on the mere import — in every instance, production included.
// So the script path is gated on being the process entry point.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    seedWikiDemo();
  } catch (err) {
    console.error(`✗ Wiki-Demo-Seed abgebrochen: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
