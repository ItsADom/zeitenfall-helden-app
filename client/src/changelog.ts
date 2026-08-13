// Kuratiertes Änderungsprotokoll — bewusst knapp halten.
// Nicht jede Kleinigkeit eintragen; lieber wenige, aussagekräftige Einträge.
// Der erste Eintrag ist die Alpha-Grundausgabe (0.1.0) — der Stand, den die
// ersten Spieler zu sehen bekommen. Alles Spätere wird als echte Änderung
// relativ dazu eingetragen. Bei der ersten stabilen Ausgabe `version: '1.0.0'`.

export interface ChangelogEntry {
  date: string; // ISO, z. B. '2026-08-08'
  version?: string; // optional, erst bei echten Releases
  title: string;
  changes: string[];
}

// Vorschau auf Geplantes — wird auf der Changelog-Seite immer ganz oben als
// eigener Abschnitt gezeigt (ohne Version/Datum). Leeren, wenn nichts ansteht.
export const COMING_SOON: string[] = [
  'Sonder-Energien zum Auswählen aus einer vom Spielleiter gepflegten Liste — mit hinterlegten Regeln.',
  'Eine Gruppenübersicht für den Spielleiter: die wichtigsten Werte aller Charaktere einer Gruppe auf einen Blick.',
];

// Neueste Einträge zuerst.
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-13',
    title: 'Eigene Energien',
    changes: [
      'Unter den Energien im Heldenbrief kannst du jetzt eigene Spezialenergien anlegen (z. B. Karma, Odem, Blutkraft) — je Eintrag Name, Maximum und aktueller Wert.',
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
