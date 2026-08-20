import type { RollVisibility } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

const MODES: { value: 'public' | 'hidden'; icon: string; label: string; hint: string }[] = [
  { value: 'public', icon: '👁', label: 'Öffentlich', hint: 'Alle in der Gruppe sehen den Wurf' },
  { value: 'hidden', icon: '🔒', label: 'Verborgen', hint: 'Nur du siehst den Wurf — auch die Spielleitung nicht' },
];

// „SL-Wurf": nur du und ein Gegenüber seht den Wurf, ohne erst eine Anfrage zu
// stellen und eine Antwort abzuwarten (der bestehende „SL + Spieler"-Anfrage-
// Fluss bleibt daneben bestehen, für den Fall „Spielleitung bittet gezielt um
// eine bestimmte Probe"). Ein Spieler wählt das Gegenüber nicht selbst — das
// wäre sonst ein Weg, sich einen beliebigen Mitspieler als heimlichen Zeugen
// auszusuchen — sondern bekommt EINEN Eintrag; die Spielleitung wählt
// stattdessen gezielt EIN Gruppenmitglied und bekommt darum je Mitglied einen
// eigenen Eintrag.
const GM_PLAYER_ICON = '🛡';
const GM_PLAYER_LABEL = 'SL-Wurf';

export default function VisibilityPicker({
  value,
  targetUserId,
  onChange,
}: {
  value: RollVisibility;
  /** Nur bei value 'gm_player' UND Spielleitung relevant — das gewählte Gruppenmitglied. */
  targetUserId: number | null;
  onChange: (v: RollVisibility, targetUserId?: number) => void;
}) {
  const { user } = useAuth();
  const { groupId, myGroups } = useDicePanel();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>();
  const members = myGroups.find((g) => g.id === groupId)?.members ?? [];
  const targetName = user.isGm ? members.find((m) => m.userId === targetUserId)?.name : undefined;

  const currentLabel =
    value === 'hidden' ? MODES[1].label : value === 'gm_player' ? (targetName ? `${GM_PLAYER_LABEL}: ${targetName}` : GM_PLAYER_LABEL) : MODES[0].label;
  const currentIcon = value === 'hidden' ? MODES[1].icon : value === 'gm_player' ? GM_PLAYER_ICON : MODES[0].icon;

  return (
    <div className={`dice-flyout-wrap${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button className="dice-icon-btn" title={`Sichtbarkeit: ${currentLabel}`} aria-haspopup="true" aria-expanded={open}>
        {currentIcon}
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
          <hr className="dice-flyout-sep" />
          {user.isGm ? (
            <>
              <p className="dice-flyout-label muted">
                {GM_PLAYER_ICON} {GM_PLAYER_LABEL}
              </p>
              {members.length === 0 && <p className="dice-flyout-empty muted">Keine Mitglieder in dieser Gruppe.</p>}
              {members.map((m) => (
                <button
                  key={m.userId}
                  className={`dice-flyout-item${value === 'gm_player' && targetUserId === m.userId ? ' active' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    onChange('gm_player', m.userId);
                    closeNow();
                  }}
                >
                  → {m.name}
                </button>
              ))}
            </>
          ) : (
            <button
              className={`dice-flyout-item${value === 'gm_player' ? ' active' : ''}`}
              role="menuitem"
              title="Nur du und die Spielleitung sehen den Wurf"
              onClick={() => {
                onChange('gm_player');
                closeNow();
              }}
            >
              <span aria-hidden>{GM_PLAYER_ICON}</span> {GM_PLAYER_LABEL}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
