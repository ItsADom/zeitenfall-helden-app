import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiGet } from '../api';

// Der Überblick über Charaktere und Gruppen. Der Server liefert beide Listen in
// einem Aufruf (/api/overview) — bei Spielleitern alle, bei Spielern die eigenen.
//
// Früher holte jede Übersichtsseite die Daten selbst. Jetzt liegt EINE Quelle
// app-weit im Kontext: die Schnellzugriff-Menüs in der Kopfleiste und beide
// Listenseiten teilen sie sich. `refresh` lädt im Hintergrund neu (z. B. beim
// Öffnen eines Menüs), damit Umbenennungen/neue Charaktere sichtbar werden,
// ohne dass die zwischengespeicherte Liste kurz verschwindet.
export interface Overview {
  // group_id ist NULL, solange der Charakter keiner Gruppe angehört (Selbst-
  // Anlage vor der Freigabe). requested_group_id trägt dann die erbetene Gruppe.
  characters: { id: number; name: string; group_id: number | null; requested_group_id: number | null }[];
  // isTemp: Event-Gruppe statt feste Gruppe — entscheidet zwischen /event/
  // und /gruppe/ beim Verlinken (siehe NavMenu, GruppenPage).
  groups: { id: number; name: string; isTemp: boolean }[];
}

interface OverviewCtxValue {
  overview: Overview | null;
  refresh: () => void;
}
const OverviewCtx = createContext<OverviewCtxValue | null>(null);

export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(() => {
    if (inflight.current) return; // parallele Aufrufe (Hover) zusammenfassen
    inflight.current = true;
    apiGet<Overview>('/api/overview')
      .then(setOverview)
      .catch(() => {
        // Fehler still: die vorhandene (evtl. veraltete) Liste bleibt stehen.
      })
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  useEffect(refresh, [refresh]);

  return <OverviewCtx.Provider value={{ overview, refresh }}>{children}</OverviewCtx.Provider>;
}

export function useOverview(): Overview | null {
  return useContext(OverviewCtx)?.overview ?? null;
}

export function useOverviewRefresh(): () => void {
  return useContext(OverviewCtx)?.refresh ?? (() => {});
}
