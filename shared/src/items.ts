// Einheitliches Gegenstands-Modell (Cluster 5).
//
// Jeder Besitz ist EIN Item mit Gewicht, Kategorie und Ort. Inventar-Anzeige,
// Kategorie-Summen, getragene Last und die getragene Ausrüstung (Körperzonen,
// Behälter) leiten sich alle aus dieser einen Liste ab — statt aus verstreuten
// Einzeltabellen.
import type { Attributes } from './types.js';
import { maximaleLast } from './rules.js';

// Wo ein Gegenstand gerade ist:
//   inventar  — im Rucksack/lose (der Standard)
//   getragen  — am Körper (zusätzlich sagt `zone`, an welcher Stelle)
//   behaelter — in einem Behälter (zusätzlich sagt `containerUid`, in welchem)
//   tier      — auf dem Tier/Reittier verstaut (nicht am Körper)
export type ItemLocation = 'inventar' | 'getragen' | 'behaelter' | 'tier';
export const ITEM_LOCATIONS: ItemLocation[] = ['inventar', 'getragen', 'behaelter', 'tier'];

// Körperzonen für getragene Ausrüstung. Arme/Hände/Beine sind seitengetrennt
// (Spieler-Entscheidung 2026-08-10) — eine Zone ist KEIN Einzelfach, sondern
// eine Liste: an „Arm links" dürfen Armschiene UND Armreif zugleich liegen.
export const BODY_ZONES = [
  'Kopf',
  'Hals',
  'Brust',
  'Rücken',
  'Arm links',
  'Arm rechts',
  'Hand links',
  'Hand rechts',
  'Gürtel',
  'Bein links',
  'Bein rechts',
  'Füße',
] as const;
export type BodyZone = (typeof BODY_ZONES)[number];

export interface Item {
  id: number;
  // Stabile, client-vergebene Kennung. Anders als die DB-`id` (wird beim Speichern
  // per DELETE+INSERT neu vergeben) überlebt die uid das Speichern — deshalb
  // verweist die Behälter-Zugehörigkeit (`containerUid`) auf sie, nicht auf `id`.
  uid: string;
  name: string;
  anzahl: number; // Stückzahl
  gewicht: number; // kg je Stück (Dezimalzahlen erlaubt)
  kategorie: string; // Name aus der Kategorienliste des Charakters ('' = ohne)
  location: ItemLocation;
  // Körperstelle, wenn location === 'getragen' (Name aus BODY_ZONES). Sonst ''.
  zone: string;
  // uid des Behälters, wenn location === 'behaelter'. Sonst ''.
  containerUid: string;
  // Kann dieser Gegenstand andere aufnehmen (z. B. Rucksack, Gürteltasche)?
  istBehaelter: boolean;
  // Fassungsvermögen des Behälters in kg (0 = ohne Angabe/unbegrenzt).
  kapazitaet: number;
  notiz: string;
}

// Neue, stabile Kennung. crypto.randomUUID gibt es im Browser wie in Node 18+.
export function makeUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Zeilengewicht: Stückzahl × Einzelgewicht (kg).
export function itemGewicht(item: Pick<Item, 'anzahl' | 'gewicht'>): number {
  return (Number(item.anzahl) || 0) * (Number(item.gewicht) || 0);
}

// Zählt der Gegenstand zur getragenen Last? Am Körper Getragenes und auf dem
// Tier/Reittier Verstautes liegt nicht im Rucksack/in der Hand und zählt NICHT
// mit (Spieler-Entscheidung 2026-08-09: „alle außer am Körper Getragenem").
// Behälter-Inhalte zählen mit — der Behälter wird ja getragen.
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

// --- Ausrüstung (5b): Sichten auf denselben Bestand ---

// Am Körper getragene Gegenstände einer Zone.
export function itemsInZone(items: readonly Item[], zone: string): Item[] {
  return items.filter((it) => it.location === 'getragen' && it.zone === zone);
}

// Inhalt eines Behälters (über dessen uid).
export function itemsInContainer(items: readonly Item[], containerUid: string): Item[] {
  return items.filter((it) => it.location === 'behaelter' && it.containerUid === containerUid);
}

// Belegtes Gewicht eines Behälters (kg) — Summe seiner Inhalte.
export function containerFuellung(items: readonly Item[], containerUid: string): number {
  return itemsInContainer(items, containerUid).reduce((s, it) => s + itemGewicht(it), 0);
}

// Alle Behälter (Gegenstände, die andere aufnehmen können).
export function containers(items: readonly Item[]): Item[] {
  return items.filter((it) => it.istBehaelter);
}
