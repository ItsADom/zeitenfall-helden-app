// Lücken-Sortierung fürs Katalog-Einfügen (siehe TODO "Catalog insert
// helper"): berechnet den `sort`-Wert für einen neuen Eintrag zwischen zwei
// Nachbarn, ohne die übrigen Zeilen anzufassen. Bleibt bewusst bei ganzen
// Zahlen (Math.floor des Mittelwerts) — die GM bekommt den Wert im
// Sortierungs-Feld zu sehen, und ein „1.0000000000000002" dort wäre nur
// verwirrend. `null` heißt: die Lücke ist erschöpft (beide Nachbarn liegen
// nur noch eine ganze Zahl auseinander) — dann muss der Aufrufer erst über
// das renumber-Endpoint neu durchnummerieren (großzügige Zehnerschritte) und
// danach neu rechnen; bei den kleinen Katalogen hier ist das billig genug,
// um es lieber öfter zu tun als Fließkommawerte anzuzeigen.
export function computeGapSort(sorted: { sort: number }[], anchorIndex: number, position: 'before' | 'after'): number | null {
  const GAP = 100;
  const anchor = sorted[anchorIndex].sort;
  const lower = position === 'before' ? (anchorIndex > 0 ? sorted[anchorIndex - 1].sort : anchor - GAP) : anchor;
  const upper = position === 'after' ? (anchorIndex < sorted.length - 1 ? sorted[anchorIndex + 1].sort : anchor + GAP) : anchor;
  const mid = Math.floor((lower + upper) / 2);
  if (mid <= lower || mid >= upper) return null;
  return mid;
}
