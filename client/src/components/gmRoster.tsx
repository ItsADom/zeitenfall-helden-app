import { useEffect, useRef, useState } from 'react';
import type { ResourceKey } from '@shared/types';
import { apiPut } from '../api';
import { depletionClass, overfilled } from './energie';

// Geteilte Bausteine zwischen GroupOverview.tsx (die volle SL-Übersichtsseite)
// und VttRoster.tsx (dieselben Karten, schmal in die Tisch-Seitenleiste
// gefaltet — siehe docs/concepts/virtual-table.md) — extrahiert, damit beide
// dieselbe Vital-Färbung und dieselbe GM-Notiz-Speicherlogik benutzen statt
// sie zweimal zu pflegen.

// Kürzel wie in der Charakterbogen-Seitenleiste (RES_ABBR): LP/AUS/ASP, plus Psyche.
export const VITAL_LABELS: Record<string, string> = { le: 'LP', aus: 'AUS', ase: 'ASP', psyche: 'Psyche', schicksalspunkte: '🍀 SP' };

// Färbung eines Vital-Chips: Überladung hat Vorrang, sonst Zehrung — aber
// Zehrung nur für die vitalen Pools (LE/AUS), wie im Heldenbrief. Psyche/AsE
// bekommen kein Dauer-Rot, nur die Überladungs-Färbung.
export function vitalClass(key: string, aktuell: number, max: number): string {
  if (overfilled(aktuell, max)) return 'res-over';
  if (key === 'le' || key === 'aus') return depletionClass(key as ResourceKey, aktuell, max);
  return '';
}

/**
 * Freitext-GM-Notiz je Charakter: eigene, kleine Save-Debounce-Logik statt der
 * TextInput/NumInput-Displaymode-Kopplung, weil das hier GM-only und außerhalb
 * des normalen section-save-Wegs ist. `initial` wird nur beim ersten Rendern
 * übernommen, damit ein stiller Poll währenddessen nicht mittippt.
 */
export function GmNoteField({ charId, initial }: { charId: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  const onChange = (v: string) => {
    setValue(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void apiPut(`/api/characters/${charId}/gm-notiz`, { notiz: v });
    }, 1200);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <textarea
      className="gm-note"
      placeholder="Notiz (nur für den Spielleiter)…"
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
