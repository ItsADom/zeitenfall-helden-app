import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiGet } from '../api';

// Offene Gruppen-Anfragen selbst angelegter Charaktere. EINE Quelle für das
// Navigations-Abzeichen (Anzahl) und die „Offene Anfragen"-Liste in der
// Verwaltung — so aktualisiert sich das Abzeichen mit, wenn dort freigegeben oder
// abgelehnt wird. Nur für Spielleitung/Verwaltung befüllt (sonst antwortet der
// Server mit 403); für alle anderen bleibt die Liste leer.
export interface GroupRequest {
  characterId: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  requestedGroupId: number;
  requestedGroupName: string;
  requestedAt: number | null;
}

interface RequestsCtxValue {
  requests: GroupRequest[];
  refresh: () => void;
}
const RequestsCtx = createContext<RequestsCtxValue | null>(null);

export function RequestsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [requests, setRequests] = useState<GroupRequest[]>([]);
  const inflight = useRef(false);

  const refresh = useCallback(() => {
    if (!enabled || inflight.current) return;
    inflight.current = true;
    apiGet<{ requests: GroupRequest[] }>('/api/admin/requests')
      .then((d) => setRequests(d.requests))
      .catch(() => {
        // Fehler still: die vorhandene Liste bleibt stehen.
      })
      .finally(() => {
        inflight.current = false;
      });
  }, [enabled]);

  // Erstladung plus stilles Nachladen bei Rückkehr auf den Tab/ins Fenster — wie
  // die Gruppenseiten, damit die Zahl frisch bleibt, ohne zu pollen.
  useEffect(() => {
    if (!enabled) {
      setRequests([]);
      return;
    }
    refresh();
    const maybe = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', maybe);
    document.addEventListener('visibilitychange', maybe);
    return () => {
      window.removeEventListener('focus', maybe);
      document.removeEventListener('visibilitychange', maybe);
    };
  }, [enabled, refresh]);

  return <RequestsCtx.Provider value={{ requests, refresh }}>{children}</RequestsCtx.Provider>;
}

export function usePendingRequests(): RequestsCtxValue {
  return useContext(RequestsCtx) ?? { requests: [], refresh: () => {} };
}

// Kleines Zahl-Abzeichen für den „Kataloge & Nutzer"-Eintrag in der Kopfleiste.
export function PendingBadge() {
  const { requests } = usePendingRequests();
  if (requests.length === 0) return null;
  return (
    <span className="nav-badge" title={`${requests.length} offene Charakter-Anfrage(n)`}>
      {requests.length}
    </span>
  );
}
