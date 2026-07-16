// Kuratiertes Änderungsprotokoll — bewusst knapp halten.
// Nicht jede Kleinigkeit eintragen; lieber wenige, aussagekräftige Einträge.
// Sobald echte Versionen anstehen, `version` setzen (z. B. '1.0.0').

export interface ChangelogEntry {
  date: string; // ISO, z. B. '2026-07-16'
  version?: string; // optional, erst bei echten Releases
  title: string;
  changes: string[];
}

// Neueste Einträge zuerst.
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-16',
    title: 'Gemeinsame Gruppeninhalte',
    changes: [
      'Jede Gruppe hat jetzt einen Bereich „Gemeinsames" mit Gruppen-Inventar, Questlog und bekannten NPCs.',
      'Die Tabs lassen sich wie beim Charakter frei umbenennen, ergänzen und mit eigenen Spalten versehen.',
      'Jedes Mitglied der Gruppe darf die gemeinsamen Inhalte bearbeiten.',
    ],
  },
  {
    date: '2026-07-16',
    title: 'Änderungsseite & Aufräumen',
    changes: [
      'Neue Seite „Änderungen" — hier stehen künftig die wichtigsten Neuerungen.',
      'Interner Aufräumschritt: der einmalige Excel-Importer wurde entfernt (Charaktere werden ohnehin direkt in der App gepflegt).',
    ],
  },
  {
    date: '2026-07-16',
    title: 'Heldenbrief-Feinschliff & einklappbare Talente',
    changes: [
      'Geld als Münzkarten mit eigener Farbwelt (Gold/Silber/Bronze/Eisen); Energien-Tabelle verschlankt.',
      'Talente lassen sich je Kategorie und je Kampf-Waffengruppe ein- und ausklappen — der Zustand bleibt erhalten.',
      'Niedrige Lebensenergie und Ausdauer werden in der Aktuell-Spalte farblich hervorgehoben.',
      'Die Tab-Leiste bleibt beim Scrollen oben griffbereit.',
      'Insgesamt dichteres, wärmeres Layout mit heraldischen Kopfzeilen.',
    ],
  },
];
