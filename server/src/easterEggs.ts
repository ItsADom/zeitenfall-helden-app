// Statischer Katalog aller Easter Eggs (TODO.md „Easter egg tracker"). Ein
// neues Ei ist damit ein reiner Code-Change plus dem passenden
// reportEasterEggFound(key)-Aufruf an seinem Auslöser — keine
// Schema-Änderung, denn WER welchen key WANN gefunden hat steht separat in
// easter_egg_finds (db.ts). Inhalt lebt im Code, gleiches Prinzip wie
// shared/src/changelog.ts, statt einer per Hand zu pflegenden DB-Tabelle.
export interface EasterEggCatalogEntry {
  key: string;
  name: string;
  medallion: string;
  description: string;
}

export const EASTER_EGG_CATALOG: EasterEggCatalogEntry[] = [
  {
    key: 'chaos-mode',
    name: 'Chaosmodus',
    medallion: '✺',
    description:
      'Fünfmal hintereinander auf das Banner in der Kopfleiste geklickt. Für ein paar Sekunden bricht die Farbwelt der Seite komplett zusammen.',
  },
  {
    key: 'upside-down',
    name: 'Kopfüber',
    medallion: '⇅',
    description:
      'Dreimal hintereinander auf die Kompassrose der Startseite geklickt. Die ganze Oberfläche dreht sich auf den Kopf, bis man es noch einmal klickt oder die Seite neu lädt.',
  },
  {
    key: 'wuerfelgott',
    name: 'Würfelgott',
    medallion: '⚅',
    description: '„Würfelgott" irgendwo in eine Chat-Nachricht geschrieben. Ein Bild erscheint, das erklärt, wer hier wirklich über die Würfel wacht.',
  },
  {
    key: 'konami',
    name: 'Konami-Code',
    medallion: '⌨',
    description: '↑↑↓↓←→←→BA auf der Tastatur getippt. Der ganze Bildschirm wird zur Party, bis man klickt, Esc drückt oder neu lädt.',
  },
  {
    key: 'easteregg',
    name: '/easteregg',
    medallion: '❋',
    description: 'Ein Chat-Befehl, der in keiner Liste steht. Wer ihn tippt, hinterlässt eine öffentliche, dauerhafte Nachricht im Chat mit seiner Nummer in der Reihe.',
  },
];
