import { useChar } from '../../pages/Character';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

// Würfel-Knopf für die Schaden-Formel einer Waffenzeile — dieselbe Sichtbar-
// keits-Auswahl wie ProbeRollButton, aber ohne dessen Anfrage-Zweig: Schaden
// würfelt man für sich, niemand bittet eine andere Person darum (siehe
// roll.weaponDamage im Protokoll). Deshalb nur vom EIGENEN Bogen sichtbar
// (rollCtx) — auf einem fremden Bogen (Spielleitung, requestCtx) erscheint
// gar kein Knopf, statt einer Anfrage, die es für Schaden nicht gibt.
export default function WeaponDamageRollButton({
  sectionRowId,
  ranged,
  title,
}: {
  sectionRowId: number;
  ranged: boolean;
  title: string;
}) {
  const { rollCtx } = useChar();
  const { rollWeaponDamage } = useDicePanel();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLSpanElement>();

  if (!rollCtx) return null;

  const roll = (visibility: 'public' | 'hidden' | 'gm_player') => {
    rollWeaponDamage(rollCtx.groupId, rollCtx.charId, sectionRowId, ranged, visibility);
    closeNow();
  };

  return (
    <span className={`probe-roll screen-only${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button className="probe-roll-btn" title={`${title} würfeln`} onClick={() => roll('public')}>
        🎲
      </button>
      <button className="probe-roll-more" title="Sichtbarkeit wählen" aria-haspopup="true" aria-expanded={open}>
        ▾
      </button>
      {open && (
        <span className="dice-flyout probe-roll-flyout" role="menu">
          <button className="dice-flyout-item" role="menuitem" onClick={() => roll('public')}>
            👁 Öffentlich
          </button>
          <button className="dice-flyout-item" role="menuitem" onClick={() => roll('hidden')}>
            🔒 Verborgen
          </button>
          <hr className="dice-flyout-sep" />
          <button
            className="dice-flyout-item"
            role="menuitem"
            title="Nur du und die Spielleitung sehen den Wurf"
            onClick={() => roll('gm_player')}
          >
            🛡 SL-Wurf
          </button>
        </span>
      )}
    </span>
  );
}
