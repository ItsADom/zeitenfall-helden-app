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

// Neueste Einträge zuerst.
export const CHANGELOG: ChangelogEntry[] = [
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
