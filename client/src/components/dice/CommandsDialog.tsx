import { Dialog } from '../Dialog';

// Statische Übersicht — neue Befehle in DicePanel.tsx's `send()` UND hier
// eintragen, sonst driftet die Übersicht vom tatsächlichen Verhalten weg.
const COMMANDS: { syntax: string; description: string }[] = [
  {
    syntax: '/r <Ausdruck>  oder  /roll <Ausdruck>',
    description:
      'Würfelt frei, z. B. „2w6+5". Mehrere Würfelarten dürfen gemischt werden („1w6+1w20"), ein Titel lässt sich mit „#" anhängen („5w10+6#Glück"). Tippst du stattdessen einen Namen, schlägt der Chat passende Proben deines Charakters vor.',
  },
  {
    syntax: '/dicecode w  oder  /dicecode d',
    description:
      'Legt fest, ob Würfelausdrücke im Chat als „w" oder „d" angezeigt werden (z. B. „2w6" vs. „2d6") — beide Buchstaben bleiben als Eingabe immer gültig.',
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
            </dt>
            <dd>{c.description}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
