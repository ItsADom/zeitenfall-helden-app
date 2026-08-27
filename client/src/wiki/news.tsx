import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiGet, apiPost } from '../api';

// „N Seiten mit neuen Änderungen" — the count next to Wiki in the top bar.
// Built exactly like RequestsProvider/PendingBadge, one source for the number
// and for clearing it.
//
// Gezählt werden SEITEN, nicht Speicherungen (die Rechnung dazu steht in
// server/src/wiki/neuigkeiten.ts). Und die Zahl ist nur die halbe Anzeige: WELCHE
// Seiten sich geändert haben, steht als Marke auf den Karten und überlebt das
// Wegräumen der Zahl.
//
// The focus/visibilitychange refetch is LOAD-BEARING here, not a nicety: the
// wiki opens in its own tab, so reading it in tab B leaves the badge in tab A
// showing a count that has already been dealt with. Refetching on return is
// what makes the number correct itself instead of quietly lying until reload.

interface NewsCtxValue {
  anzahl: number;
  refresh: () => void;
  /** „Ich habe die Zahl gesehen" — sets the watermark and zeroes the badge. */
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

  // Im Wiki zu sein IST der Blick auf die Zahl — die ganze Regel steht hier und
  // nicht in einer einzelnen Wiki-Seite, deshalb gilt sie für jede /wiki-Route.
  //
  // Die Abhängigkeit von `anzahl` ist Absicht und deckt drei Fälle mit einer
  // Regel ab: den ersten Ladevorgang (die Zahl kommt per refresh() an und wird
  // sofort quittiert), jedes Betreten des Wikis, und eine Zahl, die auftaucht,
  // während der Wiki-Tab offen steht. Gepostet wird nur, wenn es etwas zu
  // quittieren gibt; markiereGelesen setzt `anzahl` auf 0 und beendet damit die
  // Schleife. Schlägt der Post fehl, bringt der nächste refresh die Zahl zurück
  // und der Versuch wiederholt sich von selbst.
  const imWiki = useLocation().pathname.startsWith('/wiki');
  useEffect(() => {
    if (imWiki && anzahl > 0) markiereGelesen();
  }, [imWiki, anzahl, markiereGelesen]);

  return <NewsCtx.Provider value={{ anzahl, refresh, markiereGelesen }}>{children}</NewsCtx.Provider>;
}

export function useWikiNews(): NewsCtxValue {
  return useContext(NewsCtx) ?? { anzahl: 0, refresh: () => {}, markiereGelesen: () => {} };
}

export function WikiBadge() {
  const { anzahl } = useWikiNews();
  if (anzahl === 0) return null;
  return (
    <span className="nav-badge" title={`${anzahl} Seite(n) mit Änderungen seit deinem letzten Besuch`}>
      {anzahl}
    </span>
  );
}
