// Spaltenbreiten von Tabellen — bewusst in Prozent statt in Pixeln.
//
// Prozente haben zwei Vorteile: die Tabelle füllt jede Fensterbreite aus, und
// das Verhältnis der Spalten zueinander bleibt beim Verkleinern erhalten. Ein
// in Pixeln gespeicherter Wert wäre auf einem schmalen Bildschirm entweder zu
// breit (Querbalken) oder auf einem breiten verschenkter Platz.
//
// Vereinbarung: Ein Breiten-Satz ist ein Array, dessen Werte sich auf 100
// summieren. `settle` stellt das her — jede Funktion hier gibt bereits
// bereinigte Werte zurück, sodass die Oberfläche nie nachrechnen muss.

// Unter diesen Prozentsatz darf keine Spalte fallen, sonst ist sie nicht mehr
// bedienbar. Bei sehr vielen Spalten greift stattdessen die Gleichverteilung.
export const MIN_COL_PERCENT = 3;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Bringt beliebige positive Werte auf Prozente, die sich exakt zu 100 summieren
// und das Minimum einhalten. Der Maßstab der Eingabe ist gleichgültig: [2,1,1]
// und [240,120,120] ergeben dasselbe Ergebnis. Genau deshalb funktionieren die
// früher als Pixel abgelegten Breiten ohne Umrechnung weiter.
function settle(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const min = Math.min(MIN_COL_PERCENT, 100 / n);
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  const out = total > 0 ? clean.map((v) => (v / total) * 100) : clean.map(() => 100 / n);

  // Zu schmale Spalten auf das Minimum heben und den verbleibenden Platz
  // proportional unter den übrigen aufteilen. Jeder Durchlauf nagelt genau eine
  // Spalte fest, mehr als n Durchläufe kann es deshalb nicht geben.
  const pinned = new Array<boolean>(n).fill(false);
  for (let pass = 0; pass < n; pass++) {
    const under = out.findIndex((v, i) => !pinned[i] && v < min);
    if (under === -1) break;
    pinned[under] = true;
    out[under] = min;

    const rest = 100 - out.reduce((s, v, i) => (pinned[i] ? s + v : s), 0);
    const freeSum = out.reduce((s, v, i) => (pinned[i] ? s : s + v), 0);
    const freeCount = pinned.filter((p) => !p).length;
    if (freeCount === 0) break;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      out[i] = freeSum > 0 ? (out[i] / freeSum) * rest : rest / freeCount;
    }
  }

  // Auf zwei Nachkommastellen runden; den Rundungsrest trägt die breiteste
  // Spalte, dort fällt ein Hundertstel Prozent nicht auf.
  const rounded = out.map(round2);
  const diff = round2(100 - rounded.reduce((s, v) => s + v, 0));
  if (diff !== 0) {
    let widest = 0;
    for (let i = 1; i < n; i++) if (rounded[i] > rounded[widest]) widest = i;
    rounded[widest] = round2(rounded[widest] + diff);
  }
  return rounded;
}

// Liest gespeicherte Breiten ein. Fehlende Einträge (etwa eine neu angelegte
// Spalte) bekommen den Durchschnitt der bekannten — nicht das Minimum, sonst
// erschiene jede neue Spalte als unbrauchbar schmaler Streifen.
export function normalizeWidths(raw: readonly (number | undefined | null)[]): number[] {
  const values = raw.map((v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null));
  const known = values.filter((v): v is number => v !== null);
  const fallback = known.length > 0 ? known.reduce((s, v) => s + v, 0) / known.length : 1;
  return settle(values.map((v) => v ?? fallback));
}

// Verschiebt den Trennstrich zwischen Spalte `index` und `index + 1`, indem
// Spalte `index` auf `percent` gesetzt wird.
//
// Bewusst wird nur mit dem rechten Nachbarn getauscht und nicht mit allen
// Spalten verrechnet: ein Trennstrich trennt genau zwei Spalten, und wer ihn
// anfasst, erwartet, dass der Rest der Tabelle stehen bleibt. Weil die Summe
// des Paares gleich bleibt, bleibt auch die Gesamtsumme bei 100 — ohne dass
// irgendwo Platz aus dem Nichts entsteht oder verschwindet.
export function resizeAgainstNeighbour(widths: readonly number[], index: number, percent: number): number[] {
  const n = widths.length;
  if (n < 2 || index < 0 || index >= n - 1) return settle(widths);

  const clean = settle(widths);
  const min = Math.min(MIN_COL_PERCENT, 100 / n);
  const pair = clean[index] + clean[index + 1];
  // Beide Seiten behalten mindestens die Mindestbreite.
  const target = Math.min(pair - min, Math.max(min, percent));

  const out = clean.slice();
  out[index] = round2(target);
  out[index + 1] = round2(pair - target);
  return out;
}

// Alle Spalten gleich breit — der „Zurücksetzen"-Knopf über der Tabelle.
export function evenWidths(count: number): number[] {
  return settle(new Array<number>(Math.max(0, count)).fill(1));
}

// Kleinste Breite, die eine Spalte einnehmen darf.
export function minPercent(count: number): number {
  if (count <= 1) return 100;
  return Math.min(MIN_COL_PERCENT, 100 / count);
}
