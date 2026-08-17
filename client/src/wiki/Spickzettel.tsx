import { CollapsiblePanel } from '../components/collapse';

// Formatting cheat sheet for the editor.
//
// Collapsed by default and right under the text field: the markup is a small
// subset, so what people need is a reminder within reach, not a manual on
// another page. Every line here is a construct the parser actually implements —
// if one is added or dropped, this list moves with it.
//
// Deliberately NOT a table: a two-column grid does the same job without pulling
// in the sheet table styling and its sticky header machinery.

interface Zeile {
  code: string;
  was: string;
}

const BLOCK: Zeile[] = [
  { code: '# Überschrift', was: 'Überschrift (## und ### für Unterebenen)' },
  {
    code: '#WEITERLEITUNG [[Gareth]]',
    was: 'Ganz oben als erste Zeile: die Seite wird zum Wegweiser auf eine andere',
  },
  { code: '- Punkt', was: 'Aufzählung' },
  { code: '1. Punkt', was: 'Nummerierte Liste' },
  { code: '> Zitat', was: 'Eingerückter Kasten' },
  { code: '---', was: 'Trennlinie' },
  { code: '| Kopf | Kopf |\n| --- | --- |\n| Zelle | Zelle |', was: 'Tabelle (Trennzeile nicht vergessen)' },
];

const INLINE: Zeile[] = [
  { code: '**fett**', was: 'fett' },
  { code: '*kursiv*', was: 'kursiv' },
  { code: '`Code`', was: 'Feste Breite' },
  { code: '[[Gareth]]', was: 'Verweis auf eine Wiki-Seite' },
  { code: '[[Gareth|die Stadt]]', was: 'Verweis mit eigenem Text' },
  { code: '[Text](https://…)', was: 'Externer Link (nur http/https)' },
];

function Liste({ zeilen }: { zeilen: Zeile[] }) {
  return (
    <dl className="wiki-spick">
      {zeilen.map((z) => (
        <div key={z.code} className="wiki-spick-zeile">
          <dt>
            <code>{z.code}</code>
          </dt>
          <dd className="muted">{z.was}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function WikiSpickzettel({ istGm }: { istGm: boolean }) {
  return (
    <CollapsiblePanel collapseKey="wiki-spick" title="Formatierung">
      <p className="muted">
        Eine Leerzeile beginnt einen neuen Absatz, ein einfacher Zeilenumbruch bleibt ein Zeilenumbruch.
      </p>
      <Liste zeilen={BLOCK} />
      <Liste zeilen={INLINE} />
      {istGm && (
        <>
          <p className="muted">
            Nur für die Spielleitung: alles zwischen diesen beiden Zeilen sehen die Spieler nicht — weder auf der
            Seite noch in der Suche noch im Quelltext.
          </p>
          <dl className="wiki-spick">
            <div className="wiki-spick-zeile">
              <dt>
                <code>{'```gm\nGeheimnis\n```'}</code>
              </dt>
              <dd className="muted">Abschnitt nur für die Spielleitung</dd>
            </div>
          </dl>
        </>
      )}
    </CollapsiblePanel>
  );
}
