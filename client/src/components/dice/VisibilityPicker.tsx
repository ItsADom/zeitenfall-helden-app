import type { RollVisibility } from '@shared/diceProtocol';
import { useHoverFlyout } from '../useHoverFlyout';

// Sichtbarkeit des NÄCHSTEN Wurfs. „SL + Spieler" fehlt hier bewusst: das ist
// kein Modus, den man einfach einstellt, sondern ein eigener Anfrage-Fluss
// (Spielleitung fordert eine bestimmte Probe an) — kommt in einer späteren
// Ausbaustufe an seiner eigenen Stelle.
const MODES: { value: Exclude<RollVisibility, 'gm_player'>; icon: string; label: string; hint: string }[] = [
  { value: 'public', icon: '👁', label: 'Öffentlich', hint: 'Alle in der Gruppe sehen den Wurf' },
  { value: 'hidden', icon: '🔒', label: 'Verborgen', hint: 'Nur du siehst den Wurf — auch die Spielleitung nicht' },
];

export default function VisibilityPicker({
  value,
  onChange,
}: {
  value: RollVisibility;
  onChange: (v: RollVisibility) => void;
}) {
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>();
  const current = MODES.find((m) => m.value === value) ?? MODES[0];

  return (
    <div className={`dice-flyout-wrap${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button className="dice-icon-btn" title={`Sichtbarkeit: ${current.label}`} aria-haspopup="true" aria-expanded={open}>
        {current.icon}
      </button>
      {open && (
        <div className="dice-flyout" role="menu">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={`dice-flyout-item${m.value === value ? ' active' : ''}`}
              role="menuitem"
              title={m.hint}
              onClick={() => {
                onChange(m.value);
                closeNow();
              }}
            >
              <span aria-hidden>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
