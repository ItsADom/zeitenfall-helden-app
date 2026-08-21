import type { ProbeSource } from '@shared/diceProtocol';
import { useChar } from '../../pages/Character';
import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

type AbilityWeapon = Extract<ProbeSource, { kind: 'ability' }>['weapon'];

// Würfel-Knopf für eine Fähigkeit, deren Probe einen AT/PA/BL-Term führt
// (siehe probeExprHasWeaponTerm in shared/rules.ts) — anders als
// ProbeRollButton steht die Zahl hier erst fest, wenn feststeht, MIT WAS
// gekämpft wird. Ein Klick öffnet deshalb immer erst die Waffenwahl statt
// sofort zu würfeln: die Nahkampfwaffen des Charakters, plus Raufen/Ringen
// für Unbewaffnet (fixer Stand, bis der Waffenlose-Kampf-Reiter selbst
// strukturierte Zeilen bekommt — siehe TODO.md).
export default function AbilityWeaponRollButton({ abilityId, title }: { abilityId: number; title: string }) {
  const { data, catalogs, rollCtx, requestCtx } = useChar();
  const { rollProbe, requestProbe } = useDicePanel();
  const { open, wrapRef, openNow, closeNow, hoverProps } = useHoverFlyout<HTMLSpanElement>();

  if (!rollCtx && !requestCtx) return null;

  const weapons = data.lists.waffenNahNeu.filter((r) => Number(r.id) > 0);
  const raufen = catalogs.talents.find((t) => t.name === 'Raufen');
  const ringen = catalogs.talents.find((t) => t.name === 'Ringen');

  const choose = (weapon: AbilityWeapon) => {
    const source: ProbeSource = { kind: 'ability', abilityId, weapon };
    if (rollCtx) rollProbe(rollCtx.groupId, rollCtx.charId, source, 'public');
    else if (requestCtx) requestProbe(requestCtx.groupId, requestCtx.targetUserId, requestCtx.charId, source);
    closeNow();
  };

  return (
    <span className={`probe-roll screen-only${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button
        className="probe-roll-btn"
        title={`${title} würfeln — Waffe wählen`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={openNow}
      >
        🎲
      </button>
      {open && (
        <span className="dice-flyout probe-roll-flyout" role="menu">
          {weapons.map((w) => (
            <button
              key={String(w.id)}
              className="dice-flyout-item"
              role="menuitem"
              onClick={() => choose({ kind: 'row', sectionRowId: Number(w.id) })}
            >
              {String(w.typ || '(ohne Name)')}
            </button>
          ))}
          {raufen && (
            <button className="dice-flyout-item" role="menuitem" onClick={() => choose({ kind: 'talent', talentId: raufen.id })}>
              Unbewaffnet (Raufen)
            </button>
          )}
          {ringen && (
            <button className="dice-flyout-item" role="menuitem" onClick={() => choose({ kind: 'talent', talentId: ringen.id })}>
              Unbewaffnet (Ringen)
            </button>
          )}
        </span>
      )}
    </span>
  );
}
