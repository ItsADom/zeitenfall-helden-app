// Geld (Münz-Umbau): Währungen kommen aus einem GM-gepflegten Welt-Katalog
// (wie Talente/Sprachen/Rassen) statt aus fest verdrahteten Feldern
// (früher Meta.geldD/S/H/K/bank). Ein System hat mehrere Münzsorten auf einer
// NICHT zwingend dezimalen Leiter (z. B. Aventurisch: Kreuzer→Heller→
// Silbertaler→Dublone→Garethische Dublone bei ×10/×10/×10/×500) — deshalb
// Katalog-Zeilen statt fester Spalten. `faktor` ist der Wert einer Münzsorte
// relativ zur kleinsten Einheit des Systems (die kleinste hat faktor 1).
export interface CurrencyDenomination {
  id: number;
  code: string;
  name: string;
  faktor: number;
  sort: number;
}

export interface CurrencySystem {
  id: number;
  name: string;
  notiz: string;
  sort: number;
  denominations: CurrencyDenomination[];
}

// Geldbeutel: ein Charakter kann mehrere benannte Beutel haben (Gürtelbeutel,
// Bank, …), jeder an EIN Währungssystem gebunden. `kapazitaet` zählt in Münzen
// (jede Münzsorte zählt gleich, unabhängig vom Wert) — 0 = unbegrenzt, gleiche
// Konvention wie bei Behältern (items.ts kapazitaet). Bewusst kein Teil des
// allgemeinen Behälter-Systems: die Kapazität wird direkt im Geld-Bereich
// gepflegt, nicht über die Ausrüstung.
export interface CoinPouch {
  id: number;
  name: string;
  systemId: number | null;
  kapazitaet: number;
  coins: Record<number, number>; // denominationId -> Anzahl
}

// Summe aller Münzen eines Beutels (Stück, unabhängig von der Sorte).
export function pouchFuellung(pouch: Pick<CoinPouch, 'coins'>): number {
  return Object.values(pouch.coins).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

// Weicher Deckel: eine Kapazität von 0 heißt unbegrenzt, sonst wird nur
// angezeigt (nicht blockiert), wenn der Beutel übervoll ist.
export function pouchUeberfuellt(pouch: Pick<CoinPouch, 'coins' | 'kapazitaet'>): boolean {
  return pouch.kapazitaet > 0 && pouchFuellung(pouch) > pouch.kapazitaet;
}
