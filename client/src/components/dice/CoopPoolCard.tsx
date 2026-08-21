import type { CoopPoolRequest } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import { COOP } from './labels';

// Kooperationsprobe-Pool: anders als GroupRequestCard (nur bei der
// anfragenden Spielleitung) hier für JEDEN in der Gruppe sichtbar — das
// Beitreten/Verlassen ist ja gerade selbstbedient (siehe
// server/src/coopPools.ts). „Starten"/„Verwerfen" bleiben nur der
// vorschlagenden Person bzw. der Spielleitung vorbehalten.
export default function CoopPoolCard({ request }: { request: CoopPoolRequest }) {
  const { user } = useAuth();
  const { charId, joinCoopPool, leaveCoopPool, startCoopPool, cancelCoopPool } = useDicePanel();
  const joined = charId !== null && request.members.some((m) => m.charId === charId);
  const canManage = user.isGm || user.id === request.initiatorUserId;

  return (
    <div className="feed-request feed-request--group feed-request--coop">
      <div className="feed-request-title">{COOP.title(request.initiatorName, request.label)}</div>
      {request.members.length === 0 ? (
        <p className="muted feed-group-empty">{COOP.empty}</p>
      ) : (
        <ul className="feed-group-members">
          {request.members.map((m) => (
            <li key={m.charId} className="feed-group-member">
              <span>{m.charName}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="feed-request-actions">
        {charId !== null && (
          <button className="small" onClick={() => (joined ? leaveCoopPool(request.id) : joinCoopPool(request.id))}>
            {joined ? COOP.leave : COOP.join}
          </button>
        )}
        {canManage && (
          <>
            <button className="small" title={COOP.startHint} onClick={() => startCoopPool(request.id)}>
              {COOP.start}
            </button>
            <button className="small" title={COOP.cancelHint} onClick={() => cancelCoopPool(request.id)}>
              {COOP.cancel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
