import type { ProbeSource } from '@shared/diceProtocol';
import { useChar } from '../../pages/Character';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

// Würfel-Knopf neben einer fertigen Probe-Zahl auf dem Bogen. Ein Klick
// würfelt sofort öffentlich — das ist der Normalfall und soll schnell bleiben;
// das kleine Dreieck daneben öffnet die selteneren Sichtbarkeiten.
//
// Auf einem FREMDEN Bogen (nur Spielleitung) wird stattdessen angefragt: sie
// würfelt nie für den Spieler, sie bittet ihn darum. Deshalb dort ein einziger
// Knopf ohne Sichtbarkeits-Auswahl — „SL + Spieler" ist der einzige Modus, den
// eine Anfrage kennt.
//
// Was gewürfelt wird, entscheidet AUSSCHLIESSLICH die `source`: die Probe-Zahl
// rechnet der Server neu aus (siehe server/src/diceSource.ts). Die Zahl auf dem
// Bogen ist reine Anzeige und wird nie mitgeschickt.
export default function ProbeRollButton({ source, title }: { source: ProbeSource; title: string }) {
  const { rollCtx, requestCtx } = useChar();
  const { rollProbe, requestProbe, modifier } = useDicePanel();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLSpanElement>();

  if (!rollCtx) {
    if (!requestCtx) return null;
    return (
      <span className="probe-roll screen-only">
        <button
          className="probe-roll-btn"
          title={`${title} beim Spieler anfragen (nur ihr beide seht das Ergebnis)`}
          onClick={() => requestProbe(requestCtx.groupId, requestCtx.targetUserId, requestCtx.charId, source)}
        >
          🎲?
        </button>
      </span>
    );
  }

  const roll = (visibility: 'public' | 'hidden') => {
    rollProbe(rollCtx.groupId, rollCtx.charId, source, visibility);
    closeNow();
  };

  // Ein gesetzter Modifikator (Dock, ModifierPicker) gilt auch für diesen
  // Ein-Klick-Weg und wird nach dem Wurf automatisch zurückgesetzt — die Zahl
  // daneben ist die letzte Chance, ihn VOR dem Klick zu bemerken.
  const modLabel = modifier === 0 ? null : modifier > 0 ? `+${modifier}` : String(modifier);

  return (
    <span className={`probe-roll screen-only${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button
        className="probe-roll-btn"
        title={modLabel ? `${title} würfeln (Modifikator ${modLabel})` : `${title} würfeln`}
        onClick={() => roll('public')}
      >
        🎲
        {modLabel && <span className="probe-roll-mod">{modLabel}</span>}
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
