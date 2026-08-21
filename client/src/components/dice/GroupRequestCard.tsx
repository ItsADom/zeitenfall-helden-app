import type { GroupRollRequest } from '@shared/diceProtocol';
import { useDicePanel } from './DicePanelProvider';
import { REQUEST } from './labels';

// Gruppen-Sammelanfrage, nur bei der anfragenden Spielleitung: EINE Karte für
// die ganze Anfrage statt einer je Mitglied (die verschwänden sonst einzeln
// beim Antworten und die Spielleitung hätte N Zurückziehen-Knöpfe für dieselbe
// Sache). Ein Mitglied bleibt in der Liste stehen, sobald es geantwortet hat —
// nur sein Status ändert sich (siehe GroupRollMember.status) — statt aus der
// Karte zu verschwinden.
const STATUS_LABEL: Record<GroupRollRequest['members'][number]['status'], string> = {
  waiting: 'wartet …',
  rolled: 'gewürfelt',
  passed: 'gepasst',
};

export default function GroupRequestCard({ request }: { request: GroupRollRequest }) {
  const { revealGroupRequest, cancelGroupRequest } = useDicePanel();

  return (
    <div className="feed-request feed-request--group">
      <div className="feed-request-title">{REQUEST.groupTitle(request.label)}</div>
      <ul className="feed-group-members">
        {request.members.map((m) => (
          <li key={m.charId} className={`feed-group-member feed-group-member--${m.status}`}>
            <span>{m.charName}</span>
            <span className="muted">{STATUS_LABEL[m.status]}</span>
          </li>
        ))}
      </ul>
      <div className="feed-request-actions">
        <button className="small" title={REQUEST.groupRevealHint} onClick={() => revealGroupRequest(request.id)}>
          {REQUEST.groupReveal}
        </button>
        <button className="small" title={REQUEST.groupCancelHint} onClick={() => cancelGroupRequest(request.id)}>
          {REQUEST.groupCancel}
        </button>
      </div>
    </div>
  );
}
