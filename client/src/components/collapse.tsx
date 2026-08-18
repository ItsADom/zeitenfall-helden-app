// Ein- und Ausklappen von Panels.
//
// Ausgelöst wird es an der ÜBERSCHRIFT — genauer am heraldischen Sigel davor.
// Vorher saß dafür ein Knopf „Einklappen" über der Tabelle: ein zweites
// Bedienelement für etwas, das die Überschrift ohnehin anbietet, und es stand
// auch noch woanders als die Überschrift, zu der es gehörte.
//
// Der Zustand liegt pro Gerät im localStorage, nicht am Charakter: er
// beschreibt, was jemand gerade sehen will, nicht wie die Heldin aussieht.
// Deshalb wandert er auch nicht in die Datenbank und ist im Nur-Lesen-Modus
// weiterhin bedienbar — Zuklappen verändert nichts am Charakter.
import { useDisplayMode } from './displayMode';
import { usePersistedState } from './persist';

// Derselbe Schlüsselraum wie zuvor in useTableLayout, damit bereits
// zugeklappte Tabellen zugeklappt bleiben.
const storageKey = (key: string) => `tbl-zu:${key}`;

/**
 * Eingeklappt-Zustand für `key`. Im Druck immer aufgeklappt: dort hängen
 * dieselben Tabellen mit denselben Schlüsseln im DOM, und wer eine Tabelle am
 * Bildschirm zugeklappt hat, will sie trotzdem auf dem Ausdruck haben.
 *
 * `standard` gilt nur, solange niemand selbst geklappt hat — danach zählt die
 * gemerkte Entscheidung. Gedacht für Panels, die Nachschlagewerk sind und nicht
 * Inhalt: der Formatierungs-Spickzettel etwa hilft beim ersten Mal und steht
 * danach jedes Mal im Weg zwischen Text und Speichern-Knopf.
 */
export function useCollapsed(key: string, standard = false): [boolean, () => void] {
  const [collapsed, setCollapsed] = usePersistedState<boolean>(storageKey(key), standard);
  const forPrint = useDisplayMode() === 'print';
  return [forPrint ? false : collapsed, () => setCollapsed((v) => !v)];
}

/** Chevron rechts in der Überschrift — zeigt die Richtung an, in die es geht. */
export function CollapseChevron({ open }: { open: boolean }) {
  return (
    <span className="chev" aria-hidden>
      {open ? '▾' : '▸'}
    </span>
  );
}

/**
 * Panel mit anklickbarer Überschrift. `info` steht klein neben dem Titel
 * (die Sprachen zeigen dort ihre Probenwerte), `actions` rechts daneben und
 * ist vom Klick ausgenommen — sonst klappte jeder Knopf dort das Panel zu.
 */
export function CollapsiblePanel({
  collapseKey,
  standardZu = false,
  title,
  info,
  actions,
  rows,
  forceOpen = false,
  children,
}: {
  collapseKey: string;
  /** Zugeklappt starten, solange niemand selbst geklappt hat. */
  standardZu?: boolean;
  title: React.ReactNode;
  info?: React.ReactNode;
  actions?: React.ReactNode;
  /** Zeilenzahl für den Hinweis im zugeklappten Zustand. */
  rows?: number;
  /**
   * Vorübergehend offen halten, ohne den gemerkten Zustand anzufassen — die
   * Talentsuche zeigt so auch Treffer aus zugeklappten Kategorien, und nach
   * dem Leeren der Suche ist alles wieder wie vorher.
   */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [stored, toggle] = useCollapsed(collapseKey, standardZu);
  const collapsed = stored && !forceOpen;
  return (
    <div className="panel">
      <h3
        className="collapsible"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title={collapsed ? 'Ausklappen' : 'Einklappen'}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="panel-title">{title}</span>
        {info && (
          // Der Zusatztext ist Beiwerk und soll den Klick nicht abfangen,
          // damit die ganze Zeile als Schalter taugt.
          <span className="muted panel-info">{info}</span>
        )}
        <span className="head-rule" aria-hidden />
        {actions && (
          <span className="panel-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
        <CollapseChevron open={!collapsed} />
      </h3>
      {collapsed ? <CollapsedNote rows={rows} onOpen={toggle} /> : children}
    </div>
  );
}

/** Platzhalter anstelle eines eingeklappten Inhalts. */
export function CollapsedNote({ rows, onOpen }: { rows?: number; onOpen: () => void }) {
  return (
    <p className="muted collapsed-note" onClick={onOpen} title="Ausklappen">
      {rows === undefined ? 'Eingeklappt' : `Eingeklappt — ${rows} ${rows === 1 ? 'Zeile' : 'Zeilen'}`}
    </p>
  );
}
