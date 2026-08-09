import { useEffect, useState } from 'react';
import { apiGet } from '../api';

// Der Überblick über Charaktere und Gruppen. Der Server liefert beide Listen in
// einem Aufruf (/api/overview) — bei Spielleitern alle, bei Spielern die
// eigenen. Beide Übersichtsseiten (Charaktere, Gruppen) teilen sich diesen
// Haken, damit die Filterung nur an einer Stelle liegt.
export interface Overview {
  characters: { id: number; name: string; group_id: number }[];
  groups: { id: number; name: string }[];
}

export function useOverview(): Overview | null {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    apiGet<Overview>('/api/overview').then(setData);
  }, []);
  return data;
}
