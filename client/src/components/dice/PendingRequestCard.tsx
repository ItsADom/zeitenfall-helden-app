import type { PendingRollRequest } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import { REQUEST } from './labels';

// Angefragte „SL + Spieler"-Probe. Bewusst eine Karte im Feed statt eines
// modalen Dialogs: sie soll auffallen, aber niemanden aus dem Spiel reißen.
// Beim angefragten Spieler mit Knöpfen, bei der Spielleitung nur als Hinweis,
// dass die Anfrage noch offen ist.
export default function PendingRequestCard({ request }: { request: PendingRollRequest }) {
  const { user } = useAuth();
  const { acceptRequest, declineRequest } = useDicePanel();
  const mine = request.targetUserId === user.id;

  if (!mine) {
    return (
      <div className="feed-request feed-request--waiting">
        <span className="feed-request-title muted">{REQUEST.waiting(request.targetCharName, request.label)}</span>
      </div>
    );
  }

  return (
    <div className="feed-request">
      <div className="feed-request-title">{REQUEST.title(request.gmName)}</div>
      <div className="feed-request-probe">{request.label}</div>
      <div className="feed-request-actions">
        <button className="small primary" onClick={() => acceptRequest(request.id)}>
          {REQUEST.accept}
        </button>
        <button className="small" title={REQUEST.declineHint} onClick={() => declineRequest(request.id)}>
          {REQUEST.decline}
        </button>
      </div>
      <div className="muted feed-request-note">{REQUEST.note}</div>
    </div>
  );
}
