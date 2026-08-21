// Kuratiertes Änderungsprotokoll — bewusst knapp halten.
// Nicht jede Kleinigkeit eintragen; lieber wenige, aussagekräftige Einträge.
// Der erste Eintrag ist die Alpha-Grundausgabe (0.1.0) — der Stand, den die
// ersten Spieler zu sehen bekommen. Alles Spätere wird als echte Änderung
// relativ dazu eingetragen. Bei der ersten stabilen Ausgabe `version: '1.0.0'`.
//
// Liegt bewusst in `shared`, nicht mehr im Client: die Changelog-Seite rendert
// es UND der Server spiegelt neue Einträge nach Discord (siehe server/discord.ts).
// Client-Import bleibt über die Re-Export-Hülle client/src/changelog.ts erhalten.

// Kategorisierte Änderungen, ohne Datum/Titel/Version — die Bausteine, die
// sowohl ein ganzer Eintrag als auch (bei mehreren gebündelten Funktionen,
// siehe `features` unten) ein einzelner Funktionsblock trägt.
export interface ChangelogBullets {
  // Leere oder fehlende Gruppen werden nicht angezeigt.
  added?: string[]; // „Neue Funktionen"
  changed?: string[]; // „Änderungen"
  fixed?: string[]; // „Bugfixes"
  // Spielleiter/Verwaltung-exklusiv — steht IMMER als letzte Gruppe, nach
  // added/changed/fixed, unabhängig davon, ob der Punkt inhaltlich eine neue
  // Funktion, eine Änderung oder ein Bugfix ist: die Zielgruppe zählt hier
  // mehr als die Art der Änderung. Einträge behalten trotzdem ihr „(Spielleiter)"-
  // oder „(Verwaltung)"-Präfix, weil das die zwei Rollen innerhalb der Gruppe
  // unterscheidet (siehe CLAUDE.md).
  admin?: string[]; // „Spielleiter & Verwaltung"
  // Ungegliederte Liste — für die Bestandseinträge (Alpha & frühe Versionen),
  // die bewusst NICHT nachträglich in die Kategorien einsortiert werden. Neue
  // Einträge nutzen stattdessen added/changed/fixed.
  changes?: string[];
}

// Ein einzelner Funktionsblock innerhalb eines Eintrags, der mehrere große,
// unabhängig voneinander gebaute Funktionen im selben Release bündelt (siehe
// `ChangelogEntry.features`) — trägt eigene kategorisierte Abschnitte, damit
// z. B. Wiki- und Würfel-Punkte nicht in derselben „Neue Funktionen"-Liste
// verschwimmen.
export interface ChangelogFeature extends ChangelogBullets {
  title: string;
}

export interface ChangelogEntry extends ChangelogBullets {
  date: string; // ISO, z. B. '2026-08-08'
  version?: string; // optional, erst bei echten Releases
  title: string;
  /**
   * Nur gesetzt, wenn dieser Eintrag mehrere große, unabhängig entstandene
   * Funktionen bündelt, die zufällig im selben Release landen (z. B. zwei
   * fertige Features, die zusammen ausgeliefert werden). Eine gemeinsame
   * Gruppen-Überschrift wie „Neue Funktionen" reicht dann nicht, um die
   * Leser nicht durcheinanderzubringen — jeder Block bekommt eine eigene,
   * deutlich abgesetzte Überschrift samt eigener added/changed/fixed/admin.
   * Schließt die Felder aus `ChangelogBullets` auf Eintrags-Ebene NICHT aus,
   * aber die Anzeige nutzt bei vorhandenem `features` nur die Blöcke darin —
   * für den Normalfall (eine Funktion pro Eintrag) bleibt es bei den flachen
   * Feldern oben.
   */
  features?: ChangelogFeature[];
}

// Ein anzuzeigender Abschnitt eines Eintrags. `label` ist leer für die
// ungegliederten Bestandseinträge (dann ohne Überschrift gerendert).
export interface ChangelogGroup {
  label: string;
  items: string[];
}

// Reihenfolge und Überschriften der kategorisierten Abschnitte. Eine Stelle für
// Client-Anzeige UND Discord-Spiegel.
const CHANGELOG_GROUP_ORDER: { key: 'added' | 'changed' | 'fixed' | 'admin'; label: string }[] = [
  { key: 'added', label: 'Neue Funktionen' },
  { key: 'changed', label: 'Änderungen' },
  { key: 'fixed', label: 'Bugfixes' },
  // Zuletzt, nicht nach Art sortiert: siehe Kommentar an `admin` in ChangelogEntry.
  { key: 'admin', label: 'Spielleiter & Verwaltung' },
];

// Liefert die anzuzeigenden Abschnitte EINES Bausteins (ganzer Eintrag ohne
// `features`, oder ein einzelner Funktionsblock daraus): entweder die
// kategorisierten (nicht-leeren) Gruppen in fester Reihenfolge oder — für
// Bestandseinträge — eine einzige unbeschriftete Gruppe aus `changes`.
export function changelogGroups(e: ChangelogBullets): ChangelogGroup[] {
  const grouped = CHANGELOG_GROUP_ORDER.map(({ key, label }) => ({ label, items: e[key] ?? [] })).filter(
    (g) => g.items.length > 0,
  );
  if (grouped.length > 0) return grouped;
  return e.changes && e.changes.length > 0 ? [{ label: '', items: e.changes }] : [];
}

// Bekannter Fehler — wird auf der Changelog-Seite als eigener Abschnitt
// gezeigt (unter „Demnächst", über der Historie). Rein informativ für Spieler;
// wird NICHT nach Discord gespiegelt (der Server liest nur CHANGELOG).
export interface KnownBug {
  title: string; // knappe Überschrift, z. B. „Porträt lädt nicht"
  description?: string; // optional: ein, zwei Sätze zum Problem
  workaround?: string; // optional: „So kommst du vorerst weiter"
  status?: string; // optional: kurzer Stand, z. B. „in Arbeit", „bekannt"
}

// Bekannte, noch offene Fehler. Leeren, wenn nichts ansteht — dann wird der
// Abschnitt gar nicht erst gezeigt. Behobenes hier entfernen (die Behebung
// gehört, falls spürbar, in einen CHANGELOG-Eintrag).
//
// ┌── VORLAGE für einen bekannten Fehler (kopieren, einfügen, ausfüllen) ──────┐
// │
//   {
//     title: 'Kurze Überschrift, z. B. „Porträt lädt nicht"',
//     description: 'Ein, zwei Sätze zum Problem.',   // optional
//     workaround: 'So kommst du vorerst weiter.',     // optional
//     status: 'in Arbeit',                            // optional, z. B. „in Arbeit", „bekannt"
//   },
// │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Hinweise:
//   • Nur `title` ist Pflicht; die übrigen Felder weglassen, wenn nichts dazu zu
//     sagen ist (fehlende werden einfach nicht gezeigt).
//   • Spieler-Sicht, sachlich und knapp — kein Fehler-Tracker.
//   • Wird NICHT nach Discord gespiegelt (der Server liest nur CHANGELOG).
export const KNOWN_BUGS: KnownBug[] = [
  {
    title: 'Seltsames Scrollverhalten',
    description: 'Seiten scrollen zurück nach oben, wenn man sie wieder in den Fokus nimmt.',
    status: 'in Arbeit',
  },
  {
    title: 'Keine Umrechnung zwischen Münzsorten',
    description: 'Höhere Werte lassen sich noch nicht automatisch in andere Münzsorten desselben Systems umrechnen (z. B. Silbertaler in Dublonen) — das braucht noch weitere Entwicklung.',
    status: 'in Arbeit',
  },
  {
    title: 'Bank-Beutel zeigt alle Münzsorten statt der höchsten',
    description: 'Eine echte Bank würde Geld normalerweise in der höchsten Münzsorte lagern (z. B. Dublonen in Aventurien), statt jede Sorte einzeln vorzuhalten wie ein normaler Geldbeutel. Das braucht noch Feinschliff.',
    status: 'in Arbeit',
  },
];

// Vorschau auf Geplantes — wird auf der Changelog-Seite immer ganz oben als
// eigener Abschnitt gezeigt (ohne Version/Datum). Leeren, wenn nichts ansteht.
export const COMING_SOON: string[] = [
  'Sonder-Energien zum Auswählen aus einer vom Spielleiter gepflegten Liste, samt hinterlegter Regeln.',
  'Eine ausführliche Charakter-Biografie als eigene Seite: Hintergrundgeschichte, Aussehen und mehrere Bilder.',
  'Die Rassen-Boni (Lebensenergie, Ausdauer, Astralenergie, Magieresistenz, Artefaktkontrolle) fließen direkt in die berechneten Werte ein, statt nur als Info zu stehen.',
  'Gestaltwandler-Charaktere: eigene Werte je Form, gebündelt unter einem Charakter.',
  'Ganz frühe Überlegung, noch ohne Konzept: eigene kleine Bögen für Tiere und Begleiter.',
  'Ein virtueller Spieltisch für Kampf und Erkundung: Karte, Marker und Initiative-Leiste.',
  'Mehr Farbthemen und ein ruhigeres Standard-Design.',
  'Visuelles Feintuning'
];

// Neueste Einträge zuerst — neuen Eintrag also OBEN in die Liste einfügen.
//
// ┌── VORLAGE für einen neuen Eintrag (kopieren, einfügen, ausfüllen) ─────────┐
// │
//   {
//     date: '2026-08-20',          // ISO-Datum JJJJ-MM-TT
//     version: '0.4',              // weglassen, solange es kein echtes Release ist
//     title: 'Kurzer, sprechender Titel',
//     // ERINNERUNG: der Titel wird oft früh vergeben, während der Eintrag noch
//     // wächst — und bleibt dann leicht an der ERSTEN Sache hängen, die reinkam,
//     // statt an dem, was beim Release tatsächlich das Schwergewicht ist (siehe
//     // 0.5 „Event-Gruppen", benannt nach einem Nebenpunkt neben dem eigentlichen
//     // Kern Geld-Umbau). Beim Versionieren (Version setzen) den Titel deshalb
//     // NOCHMAL gegenlesen und ggf. auf den größten Punkt umbenennen.
//     // Nur die passenden Abschnitte ausfüllen — leere/fehlende werden NICHT
//     // gezeigt. Reihenfolge in der Anzeige ist immer: Neue Funktionen,
//     // Änderungen, Bugfixes, Spielleiter & Verwaltung (egal, wie sie hier stehen).
//     added: [                     // → „Neue Funktionen"
//       'Ein neuer, spürbarer Funktionsumfang in einem Satz.',
//     ],
//     changed: [                   // → „Änderungen" (Umbenennungen, Umzüge, Verhalten)
//       'Was sich gegenüber vorher anders anfühlt.',
//     ],
//     fixed: [                     // → „Bugfixes"
//       'Welches Problem jetzt behoben ist.',
//     ],
//     admin: [                     // → „Spielleiter & Verwaltung" — NUR Spielleiter-/
//       // Verwaltungs-exklusives landet hier, unabhängig davon, ob es inhaltlich
//       // neu/geändert/behoben ist. Präfix „(Spielleiter)"/„(Verwaltung)" bleibt
//       // trotzdem am Punkt, um die zwei Rollen zu unterscheiden.
//       '(Spielleiter) Was sich nur in der Spielleiter-Ansicht ändert.',
//     ],
//   },
// │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Hinweise:
//   • Keine Punkte in jeglichen Kategorien außer `added` nötig zu Features, die User sowieso noch nie gesehen haben (wichtig bei generell neuen Features).
//   • Spieler-Sicht, knapp halten: wenige, aussagekräftige Punkte statt Commit-Log.
//   • `changes: [...]` (flache Liste ohne Überschriften) gibt es weiterhin, ist
//     aber nur für die Bestandseinträge gedacht — neue Einträge nutzen die vier
//     Abschnitte oben.
//   • Bündelt ein Release ausnahmsweise zwei GROSSE, unabhängig entstandene
//     Funktionen (z. B. zwei fertige Features, die zufällig zusammen
//     ausgeliefert werden) statt `added`/`changed`/`fixed`/`admin` oben
//     stattdessen `features: [{ title: 'Erste Funktion', added: [...], ... },
//     { title: 'Zweite Funktion', ... }]` — jeder Block bekommt eine eigene,
//     deutlich abgesetzte Überschrift. Der Normalfall (eine Funktion pro
//     Eintrag) bleibt bei den vier flachen Abschnitten.
//   • Der Discord-Spiegel postet automatisch jeden Eintrag, der NEUER ist als der
//     zuletzt gepostete (per Version/Datum+Titel erkannt) — also einfach oben
//     einfügen und beim nächsten Serverstart geht er raus.
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-21',
    title: 'Würfel-Feinschliff & Porträts',
    added: [
      'Der Rassen-Katalog gibt jetzt auch LE/AU/AsE/MR/Artefaktkontrolle vor (nicht nur Geschwindigkeit, Psyche und Resilienz wie bisher) — die Rassen-Auswahl im Heldenbrief rechnet diese fünf Werte automatisch mit ein. Bitte kontrolliert eure Werte, ob sie noch stimmen! Vorher vergebene Rassenboni sind jetzt eventuell doppelt vorhanden.',
      'Chat zeigt bei einer nicht-aufgehobenen 1/20 zusätzlich, welches Attribut sie hat.',
      'Einen Schicksalspunkt auszugeben erfordert nun eine Bestätigung und meldet die Ausgabe als Chat-Zeile.',
      'Gruppen bekommen ein eigenes Porträt, genau wie Charaktere.',
      'Porträt hochladen: der Bildausschnitt lässt sich jetzt selbst wählen (ziehen + zoomen) statt automatisch auf die Mitte zugeschnitten zu werden. Ein Klick aufs Porträt zeigt es vergrößert.',
      'Im Ausrüstungs-Reiter lässt sich ein Gegenstand jetzt direkt anlegen („+ Gegenstand" unter „Nicht getragen") statt ihn erst im Inventar anzulegen und dann herüberzuziehen.',
      'Ausweichen und Initiative lassen sich jetzt genau wie die Attribute direkt anklicken und würfeln.',
      'Die Probe einer Fähigkeit kann jetzt AT/PA/BL statt nur Eigenschaften enthalten (z. B. „KK+AT") — beim Würfeln wird dann erst die Waffe (oder „Unbewaffnet") abgefragt, mit der die Fähigkeit eingesetzt wird.',
    ],
    admin: [
      '(Spielleiter) Dieselbe Probe von der ganzen (gerade verbundenen) Gruppe auf einmal anfordern — Ergebnisse erscheinen erst gemeinsam im Chat, sobald alle gewürfelt oder gepasst haben. Wer zu lange braucht, lässt sich vorzeitig auflösen.',
      '(Spielleiter) Die Attribut-Kacheln in der Gruppenübersicht sehen jetzt genauso aus wie in der Charakterbogen-Seitenleiste (Hintergrund, Schriftgröße, Tooltip mit vollem Attributnamen).',
    ],
    changed: [
      'Eine 1 zählt jetzt nur noch als kritischer Erfolg, wenn ihre Bestätigung ≥10 zeigt — spiegelt die Regel für die 20 (Krit. Fehlschlag).',
      'Der Chat-Eingabeverlauf (Pfeil hoch/runter) merkt sich jetzt die letzten fünf gesendeten Zeilen statt nur der letzten, samt Pfeil-runter zurück zum leeren Chat-Input.',
    ],
    fixed: [
      'Auf „Charaktere" und der Gruppenseite ließ sich ein Charakter nur über den Namen selbst anklicken — jetzt reicht ein Klick irgendwo auf die Karte.',
      'Beim Hovern der Würfel-Chat-Kopfzeile mit der Maus durchbrach die Hervorhebung die abgerundeten Ecken des Chat-Fensters.',
      'Die Attributspunkte-Grenze im Heldenbrief ließ sich bei sehr schnellem Tippen überschreiten.',
      'Erleichterung/Erschwerung wurde erst beim Verlassen des Feldes gespeichert, nicht schon beim Tippen.',
      'Die Vorschlagsliste für Proben (/r) ließ sich über die ersten 8 Treffer hinaus nicht scrollen.',
      'War der Chat-Verlauf ganz nach unten gescrollt, scrollte weiteres Scrollen die Seite dahinter statt einfach am Ende zu bleiben.',
      '„Einstellungen", „Zauber & Fähigkeiten verwalten" und der Wiki-Editor fragen jetzt nach, bevor eine Seite mit ungespeicherten Änderungen verlassen wird — auch bei einem Klick auf einen anderen Menüpunkt oder „Zurück" im Browser, nicht nur beim Schließen des Tabs.',
      'Ein gewürfeltes Attacke/Parade/Blocken/Fernkampf würfelte gegen eine zu niedrige Zahl, wenn der jeweilige Basiswert einen eigenen Modifikator hatte — der floss auf dem Bogen zwar in die angezeigte Zahl ein, beim eigentlichen Wurf aber nicht.',
    ],
  },
  {
    date: '2026-08-20',
    version: '0.6.0',
    title: 'Wiki & Würfeln',
    features: [
      {
        title: 'Wiki',
        added: [
          'Ein Wiki für Weltwissen, Spielregeln und alles Weitere, über „Wiki" in der Kopfleiste. Öffnet bewusst in einem neuen Tab, damit Nachschlagen mitten im Spiel nicht den Charakterbogen verlässt. Jeder darf Seiten anlegen und bearbeiten, mit einfacher Formatierung (Überschriften, Listen, Tabellen, Verweise, Bilder) und Vorschau direkt im Editor.',
          'Volltextsuche über das ganze Wiki, mit Umlaut- und ß-Behandlung.',
          'Kategorien fassen Seiten zu einem Thema zusammen und lassen sich ineinander verschachteln.',
          'Weiterleitungen für Zweitnamen und andere Schreibweisen einer Seite.',
          'Ein vollständiges Änderungsprotokoll: jede Bearbeitung bleibt nachvollziehbar, samt Vergleich und Wiederherstellung älterer Fassungen.',
          'Bearbeiten zwei Leute gleichzeitig dieselbe Seite, geht nichts verloren. Ein Konflikt wird angezeigt, statt still etwas zu überschreiben.',
        ],
        fixed: [
          'Auf der Gruppenseite rutschten die Tabellenköpfe beim Scrollen unter die Reiterleiste, sobald diese auf zwei Zeilen umbrach.',
        ],
        admin: [
          '(Spielleiter) Seiten (oder einzelne Abschnitte und Bilder darin) lassen sich auf „nur Spielleiter" stellen: für Spieler unsichtbar, überall.',
          '(Spielleiter) Außerdem: „geschützt" (bearbeitbar nur von dir) und ein Papierkorb für gelöschte Seiten.',
        ],
      },
      {
        title: 'Würfeln & Chat',
        added: [
          'Ein angedockter Würfel-Chat (🎲 unten rechts) mit gemeinsamem Verlauf aus Chat-Nachrichten und Würfelwürfen, jederzeit erreichbar und auch für vergangene Sessions einsehbar.',
          'Proben direkt vom Charakterbogen würfeln, per Würfel-Knopf neben jeder berechneten Probe, öffentlich oder verborgen.',
          'Kritische Erfolge und Fehlschläge bestätigst du selbst, über einen eigenen Bestätigungswurf.',
          'Freie Würfe per Chat-Befehl, mit Vorschlägen für passende Proben deines Charakters, dazu eigene, benannte Würfel-Favoriten fürs schnelle Würfeln per Klick.',
          'Erleichterung/Erschwerung und Schicksalspunkte lassen sich direkt im Chat-Panel einstellen bzw. verwalten.',
          'Der Zielwert einer Probe ist nur für dich selbst und die Spielleitung sichtbar. Andere Spieler sehen nur Würfel und Ergebnis.',
          'Meisterwurf (/master) und wilde Magie (/wild) lassen sich jederzeit per Befehl würfeln, nicht nur von der Spielleitung.',
          'Neue Sichtbarkeit „SL-Wurf": nur du und die Spielleitung sehen einen Wurf, ganz ohne vorherige Anfrage.',
          '„/commands" zeigt eine Übersicht aller Chat-Befehle.',
        ],
        admin: [
          '(Spielleiter) Proben heimlich mit einem einzelnen Spieler würfeln, per Anfrage statt offenem Wurf.',
          '(Spielleiter) Auf der Gruppen-Übersicht setzt „Neuer Spieltag" die Schicksalspunkte aller Charaktere der Gruppe auf ihr Maximum zurück.',
        ],
      },
      {
        title: 'Generelles',
        added: [
          'Ausrüstungsgegenstände können jetzt eine Haltbarkeit wie LP bekommen. Der Ausrüstungs-Chip zeigt den aktuellen Zustand als Prozentsatz, kritisch niedrige Werte fallen rot auf.',
        ],
      },
    ],
  },
  {
    date: '2026-08-16',
    version: '0.5.1',
    title: 'Ausrüstung: Traglast und neue Anlage-Dialoge',
    added: [
      'Neuer Dialog zum Anlegen von Gegenständen und Behältern im Inventar: Name, Kategorie, Gewicht usw. werden vorher abgefragt, statt einen leeren Eintrag einzufügen und ihn danach zu bearbeiten. Für Ausrüstung lassen sich dabei auch RS und „Quickslots" (Anzahl direkt hineinsteckbarer Gegenstände, wie bei einem Gürtel) mit angeben.',
      'Kaffeekasse'
    ],
    changed: [
      'Am Körper getragene Ausrüstung (Rüstung, Waffen in der Hand usw.) zählt jetzt zur Hälfte ihres Gewichts zur Traglast — bisher zählte sie gar nicht mit. Dadurch kann sich die angezeigte Traglast bestehender Charaktere spürbar erhöhen. Abgelegte, nicht getragene Gegenstände zählen weiterhin nicht mit.',
      'Neue Ausrüstung wird jetzt im Inventar angelegt und von dort in die Ausrüstungs-Zonen gezogen — die „+"-Knöpfe im Ausrüstungs-Reiter sind entfallen.',
    ],
    fixed: [
      'Fernkampfwaffen im Waffen-Reiter hatten kein Feld für die Rüstungsdurchdringung (RD).',
      'Schaden (und falls vorhanden RD) einer Waffe standen im Waffen-Reiter erst nach dem Aufklappen der Karte — jetzt stehen sie schon im Kartenkopf neben der Probe.',
      'Valoric weiß nun, was Bananen sind.'
    ],
    admin: [
      '(Spielleiter) Die Einstellungen-Seite steht jetzt auch dem Spielleiter offen (u. a. für die Farbwelt, die zuvor nur in der Kopfleiste wählbar war) — dort erscheinen ausschließlich die eigenen Charaktere des Spielleiter-Kontos, nie die anderer Spieler.',
    ],
  },
  {
    date: '2026-08-16',
    version: '0.5',
    title: 'Event-Gruppen',
    added: [
      'Ein Rassen-Katalog mit den Rassen aus dem Rassenbrief: im Heldenbrief wählst du unter „Herkunft" deine Rasse jetzt aus einer Liste statt sie frei einzutippen. Kurzbeschreibung und die hinterlegten Boni werden direkt angezeigt. Geschwindigkeit, Psyche (Rassengrundwert) und Resilienz (Rassengrundwert) übernehmen dabei automatisch den Wert der Rasse und sind danach gesperrt — persönliche Anpassungen laufen über die jeweils vorhandene Mod.-/Bonus-Spalte. Die übrigen Boni (Lebensenergie, Ausdauer, Astralenergie, Magieresistenz, Artefaktkontrolle) werden vorerst nur angezeigt und fließen noch nicht automatisch in die berechneten Werte ein — das kommt in einem späteren Schritt.',
      'Die Regeltabelle fürs Erschaffen neuer Zauber im Spiel — aufklappbar unter „Zauber & Fähigkeiten verwalten".',
      'Zauber und Fähigkeiten können jetzt in mehreren Kategorien gleichzeitig stehen (unter „Zauber & Fähigkeiten verwalten" mit Komma trennen) — praktisch, wenn ein Eintrag z. B. sowohl Heil- als auch Kampfmagie ist.',
    ],
    changed: [
      'Der Waffen-Reiter zeigt jede Waffe jetzt als aufklappbare Karte statt als Tabellenzeile: Name und die fertig berechnete Angriffs-/Paraden-/Blocken- bzw. Fernkampfprobe stehen sofort da, alle Details (Schaden, Material, Reichweite, Kampftalent, Besonderes, Notiz …) öffnen sich mit einem Klick. Der bisherige, tabellenbasierte Waffen-Reiter („Waffen (alt)") entfällt damit — nichts ist verloren gegangen, alle bestehenden Einträge sind in die neue Ansicht übernommen.',
      'Die Attribut-Tabelle im Heldenbrief heißt jetzt „Basis"/„Bonus" statt „Akt."/„Mod." — passt zur Sprache, die die anderen Tabellen (Basiswerte, Energien) schon verwenden.',
      'Geld ist umgebaut: statt fester Dublonen/Silbertaler/Heller/Kreuzer + Bank legst du dir jetzt beliebig viele benannte Geldbeutel an (z. B. „Gürtelbeutel", „Bank"), jeder mit eigener Kapazität in Münzen und einer Währung aus dem Katalog. Deine bisherigen Münzen und dein Bankguthaben sind automatisch in einen „Gürtelbeutel" bzw. „Bank"-Beutel übernommen worden. Ein Gesamtvermögen über alle Beutel/Währungen hinweg wird nicht mehr angezeigt.',
    ],
    admin: [
      '(Spielleiter) Neben der festen Gruppe gibt es jetzt Event-Gruppen für einzelne Sessions abseits der regulären Zusammensetzung — unter „Kataloge & Nutzer" anlegen und Charaktere zuordnen, ohne deren feste Gruppe zu verändern. Ein Charakter kann in beliebig vielen Event-Gruppen zugleich stecken und sieht seine Event-Zugehörigkeit als Hinweis auf dem eigenen Bogen. Jede Event-Gruppe hat eine eigene Spielleiter-Übersicht wie die festen Gruppen.',
      '(Spielleiter) Die Spielleiter-Übersicht zeigt jetzt auch Merkmale (z. B. „Hat Gefahreninstinkt") als Chips je Charakter — verwaltet unter „Kataloge & Nutzer" → „Merkmale-Katalog" und dort auf jeder Karte zuweisbar — sowie ein freies Notizfeld pro Charakter, das nur der Spielleiter sieht (unabhängig von der persönlichen Notiz in der Seitenleiste).',
      '(Verwaltung) Der Rassen-Katalog lässt sich unter „Kataloge & Nutzer" pflegen, genau wie Talente, Sprachen und Merkmale.',
      '(Verwaltung) Ein Währungs-Katalog lässt sich ebenfalls unter „Kataloge & Nutzer" pflegen: Währungssysteme (z. B. Aventurisch, Myranor, Titania) mit ihren jeweiligen Münzsorten und Umrechnungsfaktoren anlegen, umbenennen und löschen.',
    ],
    fixed: [
      'Fernkampfwaffen im Waffen-Reiter berechneten ihre FK-Probe ohne den Bonus des zugeordneten Kampftalents — sie fließt jetzt korrekt mit ein.',
    ],
  },
  {
    date: '2026-08-14',
    version: '0.4',
    title: 'Eigene Charaktere & Zeitenkompass',
    added: [
      'Du kannst dir jetzt selbst einen Charakter anlegen — unter „Charaktere" über „Neuen Charakter anlegen". Dabei kannst du eine Gruppe erbitten; die Aufnahme wird erst nach Freigabe durch Spielleitung oder Verwaltung wirksam. Bis dahin gehört der Charakter dir und ist voll bearbeitbar, nur eben noch keiner Gruppe zugeordnet.',
      '(Verwaltung) Offene Gruppen-Anfragen selbst angelegter Charaktere erscheinen unter „Kataloge & Nutzer" (mit Zähler-Abzeichen in der Kopfleiste) und lassen sich dort annehmen oder ablehnen. Beim Annehmen wird der Spieler zugleich Mitglied der Gruppe.',
      'Neu: eine Startseite. Ein Klick auf den Namen „Zeitenkompass" oben links bringt dich dorthin — mit deinen Charakteren zum direkten Weiterspringen und den neusten Änderungen auf einen Blick.',
      'Ausrüstung an Armen, Händen oder Beinen kannst du jetzt als „beidseitig" markieren (Häkchen beim Bearbeiten des Stücks): ein Paar Schienen, Handschuhe oder Beinlinge wird als ein Gegenstand geführt, aber auf beiden Seiten angezeigt (Zeichen ⇄). Das Gewicht zählt dabei nur einmal.',
      'Unter den Attributen im Heldenbrief steht jetzt „Ungenutzte Attributspunkte" — eine Erinnerung, wenn nach einem Stufenaufstieg noch Punkte übrig sind. Eine Erhöhung über das Verfügbare hinaus wird abgelehnt; zusätzliche Punkte aus anderen Quellen lassen sich in den Einstellungen unter „Externe Attributspunkte" pro Charakter eintragen.',
      'Behälter im Inventar und in der Ausrüstung lassen sich jetzt wahlweise auf Stück statt kg umstellen — praktisch für Köcher, Münzbeutel & Co. Der Inhalt zählt dabei nicht zur Traglast.',
    ],
    changed: [
      'Die App hat einen Namen: „Zeitenkompass". Er steht jetzt oben links in der Kopfleiste (bisher „Heldenverwaltung") und führt auf die neue Startseite.',
      'Im Inventar lassen sich die Kategorie-Gruppen innerhalb eines Behälters jetzt einzeln ein- und ausklappen (Klick auf die Kategorie-Kopfzeile) — praktisch bei vollen Behältern.',
      'Die Einstellungen-Seite hat oben eine Sprung-Navigation bekommen, damit du bei den Bereichen nicht endlos scrollen musst.',
    ],
    fixed: [
      'Breite Tabellen ragten nach dem Ein- und Ausklappen der Überblick-Seitenleiste in diese hinein; sie passen sich jetzt wieder sauber an die verbleibende Breite an.',
      'Die Talentsuche legte ihren Hintergrund über die Seitenleiste — sie bleibt jetzt in ihrer Spalte.',
      '(Verwaltung) Im Talent-Katalog stand die Kopfzeile beim Scrollen mitten in der Tabelle statt oben angeheftet.',
      'Im Inventar bleibt die „Zu Ausrüstung"-Ablage jetzt oben angeheftet, während du durch die Behälter scrollst — so kannst du einen Gegenstand auch vom Ende einer langen Tasche direkt dorthin ziehen, ohne herauszuzoomen.',
      'Beim Anmelden musste der Benutzername bisher exakt in Groß-/Kleinschreibung stimmen — das ist jetzt egal.',
    ],
  },
  {
    date: '2026-08-13',
    version: '0.3.2',
    title: 'Eigene Energien',
    changes: [
      'Unter den Energien im Heldenbrief kannst du jetzt eigene Spezialenergien anlegen (z. B. Drachenkraft, Seelen, Blut) — je Eintrag Name, Maximum und aktueller Wert.',
      'Sie erscheinen auch in der Seitenleiste als Schnell-Pool (mit −/+ für Schaden und Heilung) und in der Spielleiter-Übersicht als Chip.',
    ],
  },
  {
    date: '2026-08-12',
    version: '0.3.1',
    title: 'Wege durch die App',
    changes: [
      'Die „Einstellungen" sind aus der Kopfleiste in ein Klappmenü hinter deinem Namen gewandert — dort liegen jetzt „Profil" und „Einstellungen".',
      'Von den charakterbezogenen Seiten („Einstellungen", „Zauber & Fähigkeiten verwalten") führt ein Zurück-Link direkt auf den Bogen — und zwar auf den Reiter, von dem du gekommen bist.',
      'Auf dem Charakterbogen bringt dich ein „Einstellungen"-Link mit einem Klick zu den Einstellungen dieses Charakters (und wieder zurück).',
      'Aus dem Inventar springt „Kategorien bearbeiten →" direkt zur Kategorienliste in den Einstellungen.',
      'Hell/Dunkel schaltest du jetzt direkt in der Kopfleiste (Sonne/Mond) statt im Farbmenü.',
      'Einträge in Tabellen und Listen werden nun in zwei Schritten gelöscht: erst wird der Löschknopf rot, ein zweiter Klick entfernt — so verschwindet nichts mehr aus Versehen.',
      'Der aktuelle Tab ist nun beim Neuladen der Seite gespeichert; kein zurückspringen auf den Heldenbrief mehr.'
    ],
  },
  {
    date: '2026-08-11',
    version: '0.3',
    title: 'Zauber & Fähigkeiten neu gedacht',
    changes: [
      'Aus dem einen frei benennbaren Bereich „Zauber/Fähigkeiten“ sind zwei aufgeräumte Reiter geworden: „Zauber“ für alles Magische und „Fähigkeiten“ für Mundanes (Techniken, besondere Talente und Ähnliches).',
      'Beide Reiter sind zum Nachschlagen da: die Einträge stehen übersichtlich als Text und lassen sich nicht aus Versehen verstellen. Nur der Fortschritt ist direkt in der Zeile änderbar — den fasst man im Spiel am häufigsten an.',
      'Gepflegt wird alles an einem Ort: über „Liste bearbeiten →“ (oben an beiden Reitern) öffnet sich die Seite „Zauber & Fähigkeiten verwalten“. Dort legst du Einträge an, änderst Namen, Werte, Proben und Effekte und bringst sie per Ziehen in deine Wunsch-Reihenfolge. Verbindlich wird es mit „Speichern“.',
      'Jeder Eintrag hat einen aufklappbaren Detailbereich für Kosten, Probe, Effekt und eine freie Notiz — so bleibt die Liste schlank, ohne dass Angaben verloren gehen.',
      'Aktiv oder passiv: dauerhaft wirkende Zauber und Fähigkeiten kannst du als „passiv“ markieren und getrennt von den aktiven einblenden.',
      'Signatur-Zauber: markiere deinen wichtigsten Zauber mit einem Stern — er steht im Reiter dann immer ganz oben und ist so sofort zur Hand.',
      'Ordnung in langen Listen: Suche, Filter (nach Element, Kategorie, aktiv/passiv), Sortierung und eine Gruppierung nach Element oder Kategorie. Ein erneuter Klick auf die aktive Gruppierung hebt sie wieder auf.',
      'Deine eigenen Element- und Kategorie-Listen legst du auf der Verwaltungsseite an; beim Tippen schlägt die App sie dir danach als Vorschläge vor.',
      'Neu: ein Magier-Bereich über der Zauberliste. Mit einer eingetragenen Magierstufe zeigt er die daraus abgeleiteten Magiepunkte und Stufe für Stufe die Voraussetzungen für den nächsten Rang (Talentwerte, Psyche, Magiepunkte) — du siehst auf einen Blick, was noch fehlt.',
      'Die Magierstufe steigt nur, wenn die Voraussetzungen erfüllt sind. Für Ausnahmen, die die Stufe kurzzeitig anheben, gibt es „Überschreiben“; schaltest du es wieder aus, fällt die Stufe auf das regulär Erreichbare zurück.',
    ],
  },
  {
    date: '2026-08-10',
    version: '0.2.1',
    title: 'Eine eigene Einstellungsseite',
    changes: [
      'Neu: die Seite „Einstellungen“ oben in der Kopfleiste. Dort wählst du einen deiner Charaktere und richtest ihn ein — verbindlich wird es mit „Speichern“.',
      'Reiter verwalten: umbenennen, sortieren, neu anlegen oder löschen. Der „Heldenbrief“ bleibt dabei immer vorn.',
      'Auch die Sichtbarkeit für Gruppenmitglieder und deine Inventar-Kategorien pflegst du jetzt hier.',
      'Deine persönliche Farbwelt (hell/dunkel, Animation) ist von der Kopfleiste auf diese Seite gewandert.',
      'Auf dem Charakterbogen selbst dient die Reiterleiste damit nur noch zum Umschalten — das Umbenennen und Sortieren der Reiter passiert in den Einstellungen.',
      'Neu: Du kannst jedem Charakter eine eigene Farbwelt geben (in den Einstellungen). Sie gilt für alle, die den Charakter öffnen — Farbe UND die Bewegung in der Kopfleiste passen sich an.',
      'Überall sonst — in den Listen und Einstellungen — bleibt deine persönliche Farbwelt. Ein Charakter ohne eigene Wahl übernimmt einfach deine Vorgabe.',
    ],
  },
  {
    date: '2026-08-10',
    version: '0.2',
    title: 'Ausrüstung & Inventar neu gedacht',
    changes: [
      '„Ausrüstung“ zeigt jetzt, was dein Charakter TRÄGT: Körperzonen zum Ablegen der Ausrüstung und eine Ablage „nicht getragen“ zum Umrüsten. Ziehen ordnet ein — das geht auch ohne „Bearbeiten“.',
      'Behälter: ein Schnellzugriff-Behälter (z. B. ein Gürtel) zeigt seinen Inhalt direkt an der Körperzone; ein Stauraum-Behälter (z. B. ein Rucksack) sammelt seinen Inhalt im Inventar.',
      'Behälter haben ein Fassungsvermögen und können das Gewicht ihres Inhalts verringern — bis hin zum „Beutel des Fassungsvermögens“, dessen Inhalt gar nicht zur Traglast zählt.',
      'Eine Traglast-Anzeige warnt bei Überladung. Rüstungsteile zeigen ihren Rüstungsschutz (fürs Spiel zählt der höchste getragene Wert).',
      'Das Inventar sammelt, was in deinen Behältern steckt — nach Kategorien geordnet (kleine Überschriften), ein- und ausklappbar, mit einer Zeile zum Anlegen neuer Gegenstände samt Kategorie.',
      'Gegenstände bewegst du per Ziehen zwischen Ausrüstung und Inventar; die Anzahl lässt sich auch ohne „Bearbeiten“ schnell ändern.',
    ],
  },
  {
    date: '2026-08-09',
    version: '0.1.4',
    title: 'Neue Navigation und eine stets sichtbare Seitenleiste',
    changes: [
      'Neu: eine stets sichtbare Seitenleiste am Charakterbogen. Sie zeigt Lebenspunkte, Ausdauer, Astralpunkte und Psyche zum direkten Ändern (auch ohne „Bearbeiten“) sowie Attribute und Vermögen auf einen Blick — ohne den Reiter zu wechseln. Sie lässt sich ein- und ausklappen und in der Breite ziehen.',
      'Der frühere Reiter „Übersicht“ entfällt dafür: die laufenden Werte stehen jetzt in der Seitenleiste, alles Übrige weiterhin ausführlich im Heldenbrief.',
      'Der Kopfbereich des Bogens (Name, Spieler, Gruppe und der „Bearbeiten“-Schalter) bleibt beim Scrollen oben stehen.',
      '„Charaktere“ und „Gruppen“ haben jetzt eigene Seiten in der Kopfleiste. Die Spielleiter-Verwaltung heißt nun „Kataloge & Nutzer“.',
      'Anzeigename und Passwort lassen sich auf einer eigenen Profilseite ändern — oben rechts über den eigenen Namen erreichbar.',
    ],
  },
  {
    date: '2026-08-09',
    version: '0.1.3',
    title: 'Helle und dunkle Ansicht für jede Farbwelt',
    changes: [
      'Jede Farbwelt (Khôm, Bornland, Thorwal, Drachensteine, Gareth) gibt es jetzt hell und dunkel. Im Farbmenü oben rechts schaltet ein Schieber mit Sonne/Mond zwischen beiden um.',
      'Die Schattenlande bleiben ihre eigene, immer dunkle Welt — der Hell/Dunkel-Schieber ist dort ohne Wirkung.',
      'Ohne eigene Wahl richtet sich die App nach der Systemeinstellung: dunkel, wenn das Gerät dunkel eingestellt ist.',
      'Ein zweiter Schieber schaltet die Bewegung in der Kopfleiste an oder aus.',
    ],
  },
  {
    date: '2026-08-09',
    version: '0.1.2',
    title: 'Tabellen bleiben beim Scrollen lesbar',
    changes: [
      'Die Kopfzeile einer Tabelle bleibt beim Scrollen oben stehen. Auch weit unten in einer langen Liste ist damit noch zu sehen, welche Spalte welche ist.',
      'Die Talentsuche bleibt ebenfalls sichtbar — für eine neue Suche muss man nicht mehr nach oben zurückscrollen.',
      'Ein- und Ausklappen geschieht jetzt an der Überschrift selbst: ein Klick auf die Raute davor (oder auf den Titel) klappt den Bereich zu. Der Knopf „Einklappen“ über der Tabelle entfällt dafür.',
    ],
  },
  {
    date: '2026-08-09',
    version: '0.1.1',
    title: 'Blätter öffnen sich jetzt geschützt',
    changes: [
      'Ein Charakterblatt öffnet sich zum Ansehen: die Werte stehen als Text da und lassen sich nicht aus Versehen verstellen. Zum Ändern oben rechts auf „Bearbeiten“, mit „Fertig“ ist das Blatt wieder geschützt. Jedes Öffnen beginnt erneut geschützt.',
      'Die Übersicht ist davon ausgenommen: aktuelle Energien, Psyche und Geld lassen sich dort weiterhin jederzeit ändern, ohne vorher etwas einschalten zu müssen.',
    ],
  },
  {
    date: '2026-08-08',
    version: '0.1.0',
    title: 'Alpha-Test — die Heldenverwaltung im Überblick',
    changes: [
      'Übersicht: Stufe, Abenteuerpunkte, Attribute, Basiswerte, Energien, Psyche und Geld auf einen Blick. Was sich ständig bewegt (aktuelle Energien, Psyche, Geld) lässt sich direkt hier ändern.',
      'Heldenbrief: der vollständige Bogen mit Attributen, Basiswerten, Energien und Persönlichem. Geld als Münzkarten, niedrige Lebensenergie und Ausdauer farblich hervorgehoben.',
      'Talente: nach Kategorien ein- und ausklappbar, mit TaW und automatisch berechneten Probenwerten.',
      'Waffen: Nah-, Fern- und waffenloser Kampf mit berechneten AT-/PA-/BL-Werten aus deinen Talenten.',
      'Sprachen mit Muttersprache und Steigerung.',
      'Ausrüstung & Inventar: getragene Ausrüstung, Behälter, Proviant und Kleidung. Behälter können feste Fächer haben (z. B. ein Gürtel mit mehreren Steckplätzen).',
      'Zauber/Fähigkeiten: frei benennbare Bereiche für Zauber, Liturgien, Techniken und Ähnliches — mit berechneter Probe.',
      'Weitere Bereiche: Vorteile & Nachteile, Bibliothek, Artefakte, Besitz, Boni und Vorlieben.',
      'Eigene Tabs & Tabellen: lege dir zusätzliche Tabs, Tabellen und Spalten an (Text, Zahl, Ja/Nein, berechnete Probe, Ausrüstung), sortiere nach jeder Spalte und hinterlege Notizen je Zeile.',
      'Porträt: ein Bild deiner Heldin oder deines Helden in der Person-Sektion hochladen.',
      'Gruppen: ein gemeinsamer Bereich mit Gruppen-Inventar, Questlog, bekannten NPCs und Sitzungslog. Alle Mitglieder dürfen ihn bearbeiten; Änderungen der anderen erscheinen automatisch, sobald du wieder ins Fenster wechselst.',
      'Sichtbarkeit: du bestimmst selbst, welche Teile deines Charakters die übrigen Gruppenmitglieder sehen dürfen.',
      'Farbthemen: über das Menü oben rechts das Aussehen umstellen — Khôm (Rot), Bornland (Grün), Thorwal (Blau), Drachensteine (Amethyst), Gareth (Bronze) und Schattenlande (Nachtmodus). Die Wahl bleibt pro Gerät gespeichert.',
      'Speichern & Sicherheit: alles wird automatisch gespeichert, es gibt tägliche Sicherungen, und jede Spielerin und jeder Spieler meldet sich mit eigenem Zugang an.',
      'Drucken & Export: alle Tabs als PDF ausgeben (je Tab eine Seite) oder den ganzen Charakter als Datei exportieren.',
    ],
  },
];
