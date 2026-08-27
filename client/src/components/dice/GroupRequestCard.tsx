import type { GroupRollRequest } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import { REQUEST } from './labels';

// Gruppen-Sammelanfrage: EINE Karte für die ganze Anfrage statt einer je
// Mitglied (die verschwänden sonst einzeln beim Antworten). Ein Mitglied
// bleibt in der Liste stehen, sobald es geantwortet hat — nur sein Status
// ändert sich (siehe GroupRollMember.status) — statt aus der Karte zu
// verschwinden.
//
// Geht inzwischen an ALLE Beteiligten, nicht nur die anfragende Spielleitung
// (siehe roll.group.created in ws.ts) — Spieler sehen dieselbe Kartei, aber
// ohne die beiden Spielleitungs-Knöpfe: sie können mitverfolgen, wer noch
// dran ist, aber die Probe weder erzwingen noch verwerfen (das bleibt bei
// PendingRequestCard's eigenem Annehmen/Ablehnen für den eigenen Zweig).
const STATUS_LABEL: Record<GroupRollRequest['members'][number]['status'], string> = {
  waiting: 'wartet …',
  rolled: 'gewürfelt',
  passed: 'gepasst',
};

export default function GroupRequestCard({ request }: { request: GroupRollRequest }) {
  const { user } = useAuth();
  const { revealGroupRequest, cancelGroupRequest } = useDicePanel();
  const isGm = request.gmUserId === user.id;

  return (
    <div className="feed-request feed-request--group">
      <div className="feed-request-title">{isGm ? REQUEST.groupTitle(request.label) : REQUEST.groupTitleFor(request.gmName, request.label)}</div>
      <ul className="feed-group-members">
        {request.members.map((m) => (
          <li key={m.charId} className={`feed-group-member feed-group-member--${m.status}`}>
            <span>{m.charName}</span>
            <span className="muted">{STATUS_LABEL[m.status]}</span>
          </li>
        ))}
      </ul>
      {isGm && (
        <div className="feed-request-actions">
          <button className="small" title={REQUEST.groupRevealHint} onClick={() => revealGroupRequest(request.id)}>
            {REQUEST.groupReveal}
          </button>
          <button className="small" title={REQUEST.groupCancelHint} onClick={() => cancelGroupRequest(request.id)}>
            {REQUEST.groupCancel}
          </button>
        </div>
      )}
    </div>
  );
}
