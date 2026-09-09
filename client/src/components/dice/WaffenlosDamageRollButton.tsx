import { useChar } from '../../pages/Character';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

// Würfel-Knopf für die Schaden-Formel von Waffenlosem Kampf (Raufen) — wie
// WeaponDamageRollButton, nur ohne Item (siehe roll.waffenlosDamage im
// Protokoll): Schaden würfelt man für sich, niemand bittet eine andere Person
// darum, deshalb nur vom EIGENEN Bogen sichtbar (rollCtx).
export default function WaffenlosDamageRollButton({
  technik,
  title,
}: {
  technik: 'Raufen' | 'Ringen';
  title: string;
}) {
  const { rollCtx } = useChar();
  const { rollWaffenlosDamage } = useDicePanel();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLSpanElement>();

  if (!rollCtx) return null;

  const roll = (visibility: 'public' | 'hidden' | 'gm_player') => {
    rollWaffenlosDamage(rollCtx.groupId, rollCtx.charId, technik, visibility);
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
