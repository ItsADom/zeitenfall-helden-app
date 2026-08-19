import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api';

// „N Änderungen seit deinem letzten Besuch" — the count next to Wiki in the top
// bar. Built exactly like RequestsProvider/PendingBadge, one source for the
// number and for clearing it.
//
// The focus/visibilitychange refetch is LOAD-BEARING here, not a nicety: the
// wiki opens in its own tab, so reading it in tab B leaves the badge in tab A
// showing a count that has already been dealt with. Refetching on return is
// what makes the number correct itself instead of quietly lying until reload.

interface NewsCtxValue {
  anzahl: number;
  refresh: () => void;
  /** „Ich habe es gesehen" — sets the watermark and zeroes the badge. */
  markiereGelesen: () => void;
}
const NewsCtx = createContext<NewsCtxValue | null>(null);

export function WikiNewsProvider({ children }: { children: React.ReactNode }) {
  const [anzahl, setAnzahl] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    apiGet<{ anzahl: number }>('/api/wiki/neuigkeiten')
      .then((d) => setAnzahl(d.anzahl))
      .catch(() => {
        // Still: die vorhandene Zahl bleibt stehen. Ein Abzeichen ist kein
        // Grund, dem Nutzer einen Fehler hinzuwerfen.
      })
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  const markiereGelesen = useCallback(() => {
    setAnzahl(0);
    apiPost('/api/wiki/gelesen').catch(() => {
      // Fehlgeschlagen: beim nächsten Abruf steht die Zahl wieder da.
    });
  }, []);

  useEffect(() => {
    refresh();
    const vielleicht = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', vielleicht);
    document.addEventListener('visibilitychange', vielleicht);
    return () => {
      window.removeEventListener('focus', vielleicht);
      document.removeEventListener('visibilitychange', vielleicht);
    };
  }, [refresh]);

  return <NewsCtx.Provider value={{ anzahl, refresh, markiereGelesen }}>{children}</NewsCtx.Provider>;
}

export function useWikiNews(): NewsCtxValue {
  return useContext(NewsCtx) ?? { anzahl: 0, refresh: () => {}, markiereGelesen: () => {} };
}

export function WikiBadge() {
  const { anzahl } = useWikiNews();
  if (anzahl === 0) return null;
  return (
    <span className="nav-badge" title={`${anzahl} Änderung(en) seit deinem letzten Besuch`}>
      {anzahl}
    </span>
  );
}
