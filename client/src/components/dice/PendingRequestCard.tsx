import type { PendingRollRequest } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import { REQUEST } from './labels';

// Angefragte „SL + Spieler"-Probe. Bewusst eine Karte im Feed statt eines
// modalen Dialogs: sie soll auffallen, aber niemanden aus dem Spiel reißen.
// Beim angefragten Spieler mit Knöpfen, bei der Spielleitung nur als Hinweis,
// dass die Anfrage noch offen ist.
// Zweige einer Gruppen-Sammelanfrage (request.groupRequestId gesetzt) landen
// hier NIE als „nicht mine" — die Spielleitung sieht die ganze Sammelanfrage
// stattdessen als EINE GroupRequestCard (siehe dort), der Server schickt ihr
// für diese Zweige kein roll.pending.created. Nur der angefragte Spieler
// bekommt seine eigene (normale) Karte, exakt wie bei einer Einzelanfrage.
export default function PendingRequestCard({ request }: { request: PendingRollRequest }) {
  const { user } = useAuth();
  const { acceptRequest, declineRequest, cancelRequest } = useDicePanel();
  const mine = request.targetUserId === user.id;
  // Die Spielleitung, die die Anfrage selbst gestellt hat — darf sie
  // zurückziehen, bevor der Spieler reagiert (z. B. falsche Probe erwischt).
  const mayCancel = !mine && request.gmUserId === user.id;

  if (!mine) {
    return (
      <div className="feed-request feed-request--waiting">
        <span className="feed-request-title muted">{REQUEST.waiting(request.targetCharName, request.label)}</span>
        {mayCancel && (
          <button className="small" title={REQUEST.cancelHint} onClick={() => cancelRequest(request.id)}>
            {REQUEST.cancel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="feed-request">
      <div className="feed-request-title">{REQUEST.title(request.gmName)}</div>
      <div className="feed-request-probe">{request.label}</div>
      {request.modifier != null && (
        <div className="feed-request-mod" title="Ersetzt deinen eigenen Modifikator für diesen Wurf">
          {REQUEST.modifier(request.modifier)}
        </div>
      )}
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
