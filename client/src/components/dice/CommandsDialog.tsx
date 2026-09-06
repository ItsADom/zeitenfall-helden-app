import { Dialog } from '../Dialog';

// Statische Übersicht — neue Befehle in DicePanel.tsx's `send()` UND hier
// eintragen, sonst driftet die Übersicht vom tatsächlichen Verhalten weg.
//
// GM-only commands are LISTED rather than hidden, marked with `nurSl`. Someone
// who just watched dice tumble across their whole screen will go looking for
// how that happened, and an invisible command turns that into a question for
// the Spielleitung. Hiding would buy nothing either way: the server is what
// actually gates them, and the parser ships in everyone's bundle regardless.
const COMMANDS: { syntax: string; description: string; nurSl?: true }[] = [
  {
    syntax: '/i <Ausdruck>  oder  /important <Ausdruck>',
    nurSl: true,
    description:
      'Sagt einen großen Wurf an: bei allen am Tisch verdunkelt sich kurz der Bildschirm, eine Fanfare erklingt und die Würfel fallen sichtbar, bevor das Ergebnis im Chat landet. Ansonsten wie „/r", auch mit „#Titel". Immer öffentlich. Esc oder ein Klick überspringt die Anzeige — nur bei dir.',
  },
  {
    syntax: '/r <Ausdruck>  oder  /roll <Ausdruck>',
    description:
      'Würfelt frei, z. B. „2w6+5", auch mit echter Rechnung („2*(1w6+3)"). Mehrere Würfelarten dürfen gemischt werden („1w6+1w20"), ein Titel lässt sich mit „#" anhängen („5w10+6#Glück"), ein vorangestelltes „Nx" wiederholt den ganzen Wurf N-mal als eine gemeinsame Karte („3x2w6+8"). Tippst du stattdessen einen Namen, schlägt der Chat passende Proben deines Charakters vor — auch die lassen sich mit „Nx" wiederholt würfeln („2xAthletik"); ist einer ausgewählt, lösen sich auch Attributs-Kürzel wie „MU" im Ausdruck gegen dessen Werte auf.',
  },
  {
    syntax: '/dicecode w  oder  /dicecode d',
    description:
      'Legt fest, ob Würfelausdrücke im Chat als „w" oder „d" angezeigt werden (z. B. „2w6" vs. „2d6") — beide Buchstaben bleiben als Eingabe immer gültig.',
  },
  {
    syntax: '/mute',
    description:
      'Schaltet den Benachrichtigungsklang aus und wieder an — der Klang selbst und seine Lautstärke stehen in den Einstellungen. Der Chat-Reiter blinkt auch stummgeschaltet weiter, es geht also nichts verloren.',
  },
  {
    syntax: '/master',
    description: 'Würfelt den Master-Würfel.',
  },
  {
    syntax: '/wild',
    description: 'Würfelt für wilde Magie.',
  },
  {
    syntax: '/koop <Name>  oder  /coop <Name>',
    description:
      'Schlägt eine Kooperationsprobe vor (nur Eigenschaften, Talente, Sprachen) — ein offener Pool erscheint für die ganze Gruppe, jeder tritt selbst bei. Gewürfelt wird erst, wenn die vorschlagende Person oder die Spielleitung ihn startet. Das Ergebnis wird gepoolt: die ganze Gruppe besteht oder scheitert gemeinsam.',
  },
  {
    syntax: '/wettstreit <Name>  oder  /contest <Name>',
    description:
      'Schlägt einen Wettstreit vor — derselbe Pool wie „/koop" (nur Eigenschaften, Talente, Sprachen), aber niemand wird gepoolt: beim Start würfelt jeder für sich, und genau eine Person (oder mehrere bei echtem Gleichstand) gewinnt.',
  },
  {
    syntax: '/line  oder  ---',
    description: 'Zieht eine Trennlinie in den Chat, z. B. als Markierung für Szenenwechsel oder Sessionende.',
  },
  {
    syntax: '/me <Text>',
    description: 'Schreibt eine Aktion in der dritten Person, z. B. „/me betritt den Raum" → „<Name> betritt den Raum".',
  },
  {
    syntax: '/commands',
    description: 'Zeigt diese Übersicht.',
  },
];

export default function CommandsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Chat-Befehle"
      footer={
        <button type="button" className="small" onClick={onClose}>
          Schließen
        </button>
      }
    >
      <dl className="cmd-list">
        {COMMANDS.map((c) => (
          <div className="cmd-list-item" key={c.syntax}>
            <dt>
              <code>{c.syntax}</code>
              {c.nurSl && <span className="cmd-nur-sl">nur Spielleitung</span>}
            </dt>
            <dd>{c.description}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
