// Reihenfolge der Reiter auf der Charakterseite.
//
// Die Reiter kommen aus zwei Quellen: vier fest eingebaute (Heldenbrief,
// Talente, Waffen, Sprachen) plus „Sichtbarkeit", und beliebig viele selbst
// angelegte. Damit sich beide gemeinsam sortieren lassen, führt
// diese Datei eine gemeinsame Sprache ein: jeder Reiter hat einen Schlüssel.
// Eingebaute heißen wie ihr Beschriftungstext, selbst angelegte „c<id>".
//
// Gespeichert wird nur die Liste dieser Schlüssel. Sie ist absichtlich
// unvollständig belastbar: fehlt ein Schlüssel, rutscht der Reiter ans Ende;
// steht ein unbekannter drin (gelöschter Reiter), fällt er weg. So braucht es
// weder Migration noch Aufräumarbeiten, wenn Reiter dazukommen oder gehen.

// Der Heldenbrief bleibt immer vorn und lässt sich nicht verschieben — er ist
// der Einstieg in den Charakter, und ein Charakterbogen, dessen erste Seite
// wandert, verwirrt mehr als er nützt.
export const FIXED_TAB_KEYS = ['Heldenbrief'] as const;

// Eingebaute Reiter, die sich verschieben lassen. „Sichtbarkeit" steht in der
// Voreinstellung hinter den selbst angelegten, weil es eine Einstellung ist und
// kein Inhalt. „Inventar" ist seit Cluster 5 ein eingebauter Reiter (eigenes
// Gegenstands-Modell) statt einer selbst angelegten Tabelle.
export const MOVABLE_BUILTIN_TAB_KEYS = ['Talente', 'Waffen', 'Inventar', 'Sprachen'] as const;
export const SICHTBARKEIT_TAB_KEY = 'Sichtbarkeit';

// Grenzen für die gespeicherte Liste. Kein Reiter-Schlüssel ist lang, und mehr
// als ein paar Dutzend Reiter hat kein Charakter — die Werte sind großzügig
// gewählt und dienen nur dazu, dass über die Schnittstelle nichts Beliebiges in
// der Datenbank landet.
export const MAX_TAB_KEY_LENGTH = 60;
export const MAX_TAB_KEYS = 200;

export function dynTabKey(id: number): string {
  return `c${id}`;
}

// Umkehrung von dynTabKey; null für die eingebauten Reiter.
export function dynTabId(key: string): number | null {
  if (!/^c[0-9]+$/.test(key)) return null;
  const id = Number(key.slice(1));
  return Number.isSafeInteger(id) ? id : null;
}

export function isFixedTab(key: string): boolean {
  return (FIXED_TAB_KEYS as readonly string[]).includes(key);
}

// Reihenfolge, in der die Reiter ohne eigene Sortierung erscheinen — also der
// Zustand, den es vor dieser Funktion gab.
export function defaultTabKeys(dynamicTabIds: readonly number[]): string[] {
  return [
    ...FIXED_TAB_KEYS,
    ...MOVABLE_BUILTIN_TAB_KEYS,
    ...dynamicTabIds.map(dynTabKey),
    SICHTBARKEIT_TAB_KEY,
  ];
}

// Säubert eine von außen kommende Liste: nur Zeichenketten, keine Doppelten,
// keine übermäßig langen Schlüssel.
export function normalizeTabOrder(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const key = v.trim();
    if (!key || key.length > MAX_TAB_KEY_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_TAB_KEYS) break;
  }
  return out;
}

// Bringt die gespeicherte Reihenfolge mit den tatsächlich vorhandenen Reitern
// zusammen. `available` ist die Voreinstellung (siehe defaultTabKeys) und
// bestimmt zugleich, welche Schlüssel es überhaupt gibt.
export function orderTabKeys(available: readonly string[], stored: readonly string[]): string[] {
  const present = new Set(available);
  const out = FIXED_TAB_KEYS.filter((k) => present.has(k)) as string[];
  const seen = new Set(out);
  for (const key of stored) {
    if (present.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  // Was die gespeicherte Liste nicht kennt (neu angelegter Reiter, später
  // hinzugekommener eingebauter), hängt sich hinten an.
  for (const key of available) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

// Kleinster Platz, an den ein Reiter darf: direkt hinter den festen.
function firstMovableIndex(order: readonly string[]): number {
  const i = order.findIndex((k) => !isFixedTab(k));
  return i < 0 ? order.length : i;
}

// Setzt `key` vor oder hinter `target`. Ein Ziel innerhalb des festen Blocks
// wird nach hinten gezogen, statt den Zug abzulehnen — wer einen Reiter auf
// „Heldenbrief" fallen lässt, meint „ganz nach links".
export function moveTabKey(
  order: readonly string[],
  key: string,
  target: string,
  place: 'before' | 'after',
): string[] {
  if (isFixedTab(key) || key === target) return order.slice();
  if (!order.includes(key)) return order.slice();
  const rest = order.filter((k) => k !== key);
  let at = rest.indexOf(target);
  if (at < 0) return order.slice();
  if (place === 'after') at += 1;
  at = Math.max(at, firstMovableIndex(rest));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

// Ob ein Schritt nach links (-1) oder rechts (1) möglich ist — für die Pfeil-
// Knöpfe, die neben dem Ziehen weiterhin funktionieren sollen.
export function canStepTab(order: readonly string[], key: string, dir: -1 | 1): boolean {
  if (isFixedTab(key)) return false;
  const i = order.indexOf(key);
  if (i < 0) return false;
  const j = i + dir;
  return j >= 0 && j < order.length && !isFixedTab(order[j]);
}

export function stepTabKey(order: readonly string[], key: string, dir: -1 | 1): string[] {
  if (!canStepTab(order, key, dir)) return order.slice();
  const i = order.indexOf(key);
  const out = order.slice();
  [out[i], out[i + dir]] = [out[i + dir], out[i]];
  return out;
}
