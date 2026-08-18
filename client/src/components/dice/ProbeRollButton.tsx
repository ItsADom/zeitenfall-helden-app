import type { ProbeSource } from '@shared/diceProtocol';
import { useChar } from '../../pages/Character';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

// Würfel-Knopf neben einer fertigen Probe-Zahl auf dem Bogen. Ein Klick
// würfelt sofort öffentlich — das ist der Normalfall und soll schnell bleiben;
// das kleine Dreieck daneben öffnet die selteneren Sichtbarkeiten.
//
// Was gewürfelt wird, entscheidet AUSSCHLIESSLICH die `source`: die Probe-Zahl
// rechnet der Server neu aus (siehe server/src/diceSource.ts). Die Zahl auf dem
// Bogen ist reine Anzeige und wird nie mitgeschickt.
//
// Rendert nichts ohne rollCtx (fremder Bogen oder Charakter ohne Gruppe).
export default function ProbeRollButton({ source, title }: { source: ProbeSource; title: string }) {
  const { rollCtx } = useChar();
  const { rollProbe } = useDicePanel();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLSpanElement>();
  if (!rollCtx) return null;

  const roll = (visibility: 'public' | 'hidden') => {
    rollProbe(rollCtx.groupId, rollCtx.charId, source, visibility);
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
        </span>
      )}
    </span>
  );
}
