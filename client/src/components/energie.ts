import type { ResourceKey } from '@shared/types';

// Zehrung nur für die vitalen Pools (LE/AU): AsP-Ruhezustand 0 wäre bei
// Nicht-Zauberern nur Dauer-Rot, die MR ist kein Vorrat.
// Eine Stelle für Heldenbrief und Seitenleiste, damit die Schwellen nicht driften.
export function depletionClass(key: ResourceKey, aktuell: number, ergebnis: number): '' | 'res-low' | 'res-crit' {
  if (!(key === 'le' || key === 'aus') || ergebnis <= 0) return '';
  const ratio = aktuell / ergebnis;
  return ratio <= 0.25 ? 'res-crit' : ratio <= 0.5 ? 'res-low' : '';
}

// Überladung: der laufende Wert sitzt ÜBER dem Maximum und bleibt dort, bis er
// verbraucht ist (z. B. gefilterte Astralenergie). Gilt für JEDEN Pool — anders
// als Zehrung, die nur die vitalen Pools (LE/AU) betrifft. Ein überladener Wert
// soll bewusst besonders aussehen, nicht wie ein Tippfehler.
export function overfilled(aktuell: number, max: number): boolean {
  return max > 0 && aktuell > max;
}

// Die Klasse für einen Pool: Überladung hat Vorrang (ein überfüllter Wert kann
// nicht zugleich „niedrig“ sein), sonst greift die Zehrung.
export function poolClass(key: ResourceKey, aktuell: number, max: number): '' | 'res-low' | 'res-crit' | 'res-over' {
  return overfilled(aktuell, max) ? 'res-over' : depletionClass(key, aktuell, max);
}
