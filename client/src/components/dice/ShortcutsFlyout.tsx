import { Link } from 'react-router-dom';
import { parseDiceShortcuts } from '@shared/dice';
import type { ProbeSource } from '@shared/diceProtocol';
import { useHoverFlyout } from '../useHoverFlyout';
import type { RollableProbe } from './rollableProbes';

// Würfel-Favoriten als Knöpfe: ein Klick würfelt sofort und postet ins Feed.
// Gepflegt werden sie als Klartext in den Einstellungen („Label: Ausdruck" je
// Zeile) — hier nur gelesen und gerendert. Bei einem Charakter sind es dessen
// eigene (charId gesetzt), bei der Spielleitung (charId === null) ihre
// kontoweiten Favoriten (siehe /me/dice-shortcuts) — daher der eigene
// `editHref` statt einer festen, an charId hängenden Verlinkung.
//
// ZWEITE, getrennte Gruppe darunter (nur bei charId gesetzt): 📌-favorisierte
// Talente/Zauber-Fähigkeiten (Talente.tsx/AbilityManager.tsx) — echte Proben
// statt eines rohen Würfelausdrucks, deshalb ein eigener onPickFavorite statt
// über onPick zu laufen. Immer öffentlich, wie die Freitext-Favoriten oben.
export default function ShortcutsFlyout({
  raw,
  charId,
  editHref,
  onPick,
  onOpen,
  favorites,
  onPickFavorite,
}: {
  raw: string;
  charId: number | null;
  editHref?: string;
  onPick: (label: string, expression: string) => void;
  onOpen?: () => void;
  favorites?: RollableProbe[];
  onPickFavorite?: (source: ProbeSource) => void;
}) {
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>(onOpen);
  const lines = parseDiceShortcuts(raw);
  const usable = lines.filter((l) => l.kind === 'shortcut' && l.valid);
  const favList = charId != null ? (favorites ?? []) : [];

  return (
    <div className={`dice-flyout-wrap${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button className="dice-icon-btn" title="Würfel-Favoriten" aria-haspopup="true" aria-expanded={open}>
        🎲
      </button>
      {open && (
        <div className="dice-flyout dice-flyout--shortcuts" role="menu">
          {usable.length === 0 && favList.length === 0 ? (
            <p className="muted dice-flyout-empty">
              Noch keine Favoriten.
              {editHref && (
                <>
                  {' '}
                  <Link to={editHref} onClick={closeNow}>
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
          {favList.length > 0 && onPickFavorite && (
            <>
              <hr className="dice-flyout-sep" />
              <p className="dice-flyout-label">📌 Talente & Fähigkeiten</p>
              {favList.map((p, i) => (
                <button
                  key={i}
                  className="dice-flyout-item"
                  role="menuitem"
                  title={`Probe ${p.probeZahl}`}
                  onClick={() => {
                    onPickFavorite(p.source);
                    closeNow();
                  }}
                >
                  <span className="dice-shortcut-label">{p.label}</span>
                  <span className="muted dice-shortcut-expr">{p.probeZahl}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
