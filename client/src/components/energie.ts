import type { ResourceKey } from '@shared/types';

// Zehrung nur für die vitalen Pools (LE/AU): AsP-Ruhezustand 0 wäre bei
// Nicht-Zauberern nur Dauer-Rot, die MR ist kein Vorrat.
// Eine Stelle für Heldenbrief und Übersicht, damit die Schwellen nicht driften.
export function depletionClass(key: ResourceKey, aktuell: number, ergebnis: number): '' | 'res-low' | 'res-crit' {
  if (!(key === 'le' || key === 'aus') || ergebnis <= 0) return '';
  const ratio = aktuell / ergebnis;
  return ratio <= 0.25 ? 'res-crit' : ratio <= 0.5 ? 'res-low' : '';
}
