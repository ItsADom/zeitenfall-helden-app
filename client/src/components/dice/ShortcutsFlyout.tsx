import { Link } from 'react-router-dom';
import { parseDiceShortcuts } from '@shared/dice';
import { useHoverFlyout } from '../useHoverFlyout';

// Würfel-Favoriten des Charakters als Knöpfe: ein Klick würfelt sofort und
// postet ins Feed. Gepflegt werden sie als Klartext in den Einstellungen
// („Label: Ausdruck" je Zeile) — hier nur gelesen und gerendert.
export default function ShortcutsFlyout({
  raw,
  charId,
  onPick,
  onOpen,
}: {
  raw: string;
  charId: number | null;
  onPick: (label: string, expression: string) => void;
  onOpen?: () => void;
}) {
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>(onOpen);
  const lines = parseDiceShortcuts(raw);
  const usable = lines.filter((l) => l.kind === 'shortcut' && l.valid);

  return (
    <div className={`dice-flyout-wrap${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button className="dice-icon-btn" title="Würfel-Favoriten" aria-haspopup="true" aria-expanded={open}>
        🎲
      </button>
      {open && (
        <div className="dice-flyout dice-flyout--shortcuts" role="menu">
          {usable.length === 0 ? (
            <p className="muted dice-flyout-empty">
              Noch keine Favoriten.
              {charId != null && (
                <>
                  {' '}
                  <Link to={`/einstellungen?char=${charId}#wuerfel`} onClick={closeNow}>
                    Anlegen
                  </Link>
                </>
              )}
            </p>
          ) : (
            lines.map((line, i) =>
              line.kind === 'separator' ? (
                <hr key={i} className="dice-flyout-sep" />
              ) : line.valid ? (
                <button
                  key={i}
                  className="dice-flyout-item"
                  role="menuitem"
                  title={line.expression}
                  onClick={() => {
                    onPick(line.label, line.expression);
                    closeNow();
                  }}
                >
                  <span className="dice-shortcut-label">{line.label}</span>
                  <span className="muted dice-shortcut-expr">{line.expression}</span>
                </button>
              ) : null,
            )
          )}
        </div>
      )}
    </div>
  );
}
