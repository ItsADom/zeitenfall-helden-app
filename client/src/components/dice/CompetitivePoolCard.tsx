import type { CoopPoolRequest } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import { WETTSTREIT } from './labels';

// Wettstreit-Pool: strukturell identisch zu CoopPoolCard (siehe dort) — auch
// Beitreten/Verlassen/Starten/Verwerfen laufen über dieselben
// roll.coop.*-Nachrichten (nur `mode` unterscheidet, siehe
// server/src/coopPools.ts). Eigene Komponente statt eines Modus-Zweigs in
// CoopPoolCard, weil Titel/Beschriftungen komplett eigene Wortlaute sind
// (WETTSTREIT statt COOP in labels.ts).
export default function CompetitivePoolCard({ request }: { request: CoopPoolRequest }) {
  const { user } = useAuth();
  const { charId, joinCoopPool, leaveCoopPool, startCoopPool, cancelCoopPool } = useDicePanel();
  const joined = charId !== null && request.members.some((m) => m.charId === charId);
  const canManage = user.isGm || user.id === request.initiatorUserId;

  return (
    <div className="feed-request feed-request--group feed-request--competitive">
      <div className="feed-request-title">{WETTSTREIT.title(request.initiatorName, request.label)}</div>
      {request.members.length === 0 ? (
        <p className="muted feed-group-empty">{WETTSTREIT.empty}</p>
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
            {joined ? WETTSTREIT.leave : WETTSTREIT.join}
          </button>
        )}
        {canManage && (
          <>
            <button className="small" title={WETTSTREIT.startHint} onClick={() => startCoopPool(request.id)}>
              {WETTSTREIT.start}
            </button>
            <button className="small" title={WETTSTREIT.cancelHint} onClick={() => cancelCoopPool(request.id)}>
              {WETTSTREIT.cancel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
