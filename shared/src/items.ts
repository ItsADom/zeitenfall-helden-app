// Einheitliches Gegenstands-Modell (Cluster 5).
//
// Jeder Besitz ist EIN Item mit Gewicht, Kategorie und Ort. Inventar-Anzeige,
// Kategorie-Summen, getragene Last und (in 5b) die getragene Ausrüstung leiten
// sich alle aus dieser einen Liste ab — statt aus verstreuten Einzeltabellen.
import type { Attributes } from './types.js';
import { maximaleLast } from './rules.js';

// Wo ein Gegenstand gerade ist. In 5a liegt alles im 'inventar'; 5b ergänzt
// getragene Ausrüstung (am Körper), Behälter-Inhalte und Tier-/Reittier-Gepäck.
export type ItemLocation = 'inventar' | 'getragen' | 'behaelter' | 'tier';
export const ITEM_LOCATIONS: ItemLocation[] = ['inventar', 'getragen', 'behaelter', 'tier'];

export interface Item {
  id: number;
  name: string;
  anzahl: number; // Stückzahl
  gewicht: number; // kg je Stück (Dezimalzahlen erlaubt)
  kategorie: string; // Name aus der Kategorienliste des Charakters ('' = ohne)
  location: ItemLocation;
  notiz: string;
}

// Zeilengewicht: Stückzahl × Einzelgewicht (kg).
export function itemGewicht(item: Pick<Item, 'anzahl' | 'gewicht'>): number {
  return (Number(item.anzahl) || 0) * (Number(item.gewicht) || 0);
}

// Zählt der Gegenstand zur getragenen Last? Am Körper Getragenes und auf dem
// Tier/Reittier Verstautes liegt nicht im Rucksack/in der Hand und zählt NICHT
// mit (Spieler-Entscheidung 2026-08-09: „alle außer am Körper Getragenem").
export function zaehltZurLast(item: Pick<Item, 'location'>): boolean {
  return item.location !== 'getragen' && item.location !== 'tier';
}

// Summe der getragenen Last (kg).
export function getrageneLast(items: readonly Item[]): number {
  return items.reduce((sum, it) => (zaehltZurLast(it) ? sum + itemGewicht(it) : sum), 0);
}

export interface LastInfo {
  getragen: number; // kg
  max: number; // maximaleLast(attrs), als kg gelesen
  ueberladen: boolean;
}

// Traglast-Übersicht für die Ladungsanzeige: getragen / Maximum + Überladung.
export function lastInfo(items: readonly Item[], attrs: Attributes): LastInfo {
  const getragen = getrageneLast(items);
  const max = maximaleLast(attrs);
  return { getragen, max, ueberladen: getragen > max };
}
