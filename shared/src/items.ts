// Einheitliches Gegenstands-Modell (Cluster 5).
//
// Jeder Besitz ist EIN Item. Wo es liegt (`location`, dazu `zone`/`containerUid`)
// entscheidet, welcher Reiter es zeigt — es gibt KEIN „Ausrüstung"-Flag:
//   getragen   am Körper (welche Stelle sagt `zone`)            → Ausrüstung
//   bench      abgelegt, „gerade nicht getragen"                → Ausrüstung
//   behaelter  in einem Behälter (welcher sagt `containerUid`)  → Inventar (Stauraum)
//                                                                  bzw. inline bei Schnellzugriff-Behältern
//   inventar   mitgeführt an oberster Stelle (Behälter selbst;  → Inventar
//              plus ein loser Alt-Topf aus der Migration)
import type { Attributes } from './types.js';
import { maximaleLast } from './rules.js';

export type ItemLocation = 'inventar' | 'getragen' | 'behaelter' | 'bench';
export const ITEM_LOCATIONS: ItemLocation[] = ['inventar', 'getragen', 'behaelter', 'bench'];

// Art eines Behälters entscheidet, WO sein Inhalt erscheint:
//   quick    Schnellzugriff (Gürtel, Bandelier) — Inhalt inline in der Ausrüstung
//   storage  Stauraum (Rucksack, Tasche)        — Inhalt im Inventar
export type ContainerArt = 'quick' | 'storage';
export const CONTAINER_ARTEN: ContainerArt[] = ['quick', 'storage'];

// Womit ein Behälter sein Fassungsvermögen misst:
//   gewicht  Kapazität in kg — der übliche Fall (Rucksack, Gürteltasche).
//   stueck   Kapazität in Stück (Summe der `anzahl` der Inhalte) — für Behälter,
//            bei denen die Anzahl zählt statt das Gewicht (Köcher, Münzbeutel).
//            Inhalt zählt dabei automatisch NICHT zur Traglast (siehe
//            itemLastAnteil) — eine eigene Gewichtsreduktion ist dafür unnötig.
export type KapazitaetArt = 'gewicht' | 'stueck';
export const KAPAZITAET_ARTEN: KapazitaetArt[] = ['gewicht', 'stueck'];

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
  // Beidseitig getragen (nur bei seitengetrennten Zonen Arm/Hand/Bein sinnvoll):
  // EIN Gegenstand — ein Paar Schienen, Handschuhe, Beinlinge —, der zugleich auf
  // der Gegenseite erscheint. Gewicht und RS zählen einmal (der Datensatz bleibt
  // einer); nur die Anzeige wird gespiegelt (siehe zoneView / ZONE_SIBLING).
  beidseitig: boolean;
  // uid des Behälters, wenn location === 'behaelter'. Sonst ''.
  containerUid: string;
  // Kann dieser Gegenstand andere aufnehmen (z. B. Rucksack, Gürteltasche)?
  istBehaelter: boolean;
  // Behälter-Art (nur relevant, wenn istBehaelter): Schnellzugriff vs. Stauraum.
  containerArt: ContainerArt;
  // Fassungsvermögen des Behälters (0 = ohne Angabe/unbegrenzt) — Einheit
  // richtet sich nach kapazitaetArt: kg oder Stück.
  kapazitaet: number;
  // Womit das Fassungsvermögen gemessen wird (nur relevant, wenn istBehaelter).
  kapazitaetArt: KapazitaetArt;
  // Gewichtsreduktion des Inhalts in Prozent (0–100). 100 % = der Inhalt zählt
  // gar nicht zur getragenen Last (Beutel des Fassungsvermögens / „bag of holding").
  // Bei kapazitaetArt === 'stueck' wirkt IMMER wie 100 % — der Inhalt zählt nie
  // zur Traglast, unabhängig vom gespeicherten Wert (siehe itemLastAnteil).
  gewichtsreduktion: number;
  // Rüstungsschutz (nur bei Rüstungsteilen sinnvoll). Es wird NICHT summiert —
  // fürs Spiel zählt der höchste getragene Wert (siehe effektiverRs).
  rs: number;
  notiz: string;
}

// Neue, stabile Kennung. crypto.randomUUID gibt es im Browser wie in Node 18+.
export function makeUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Zeilengewicht: Stückzahl × Einzelgewicht (kg), OHNE Reduktion.
export function itemGewicht(item: Pick<Item, 'anzahl' | 'gewicht'>): number {
  return (Number(item.anzahl) || 0) * (Number(item.gewicht) || 0);
}

// Zählt der Gegenstand grundsätzlich zur getragenen Last? Abgelegtes (bench)
// zählt NICHT mit — es liegt irgendwo in Reichweite, nicht am Körper oder im
// Gepäck. Am Körper Getragenes (getragen) zählt mit halbem Gewicht (siehe
// itemLastAnteil); mitgeführte (inventar) und in Behältern liegende
// (behaelter) Gegenstände zählen voll.
export function zaehltZurLast(item: Pick<Item, 'location'>): boolean {
  return item.location === 'inventar' || item.location === 'behaelter' || item.location === 'getragen';
}

// Prozentsatz auf [0,100] begrenzen.
const clampPct = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));

// Halber Lastanteil für am Körper getragene Gegenstände (Spieler-Regel
// 2026-08-16) — sie sind zwar dabei, aber am Körper verteilt statt im Gepäck.
const GETRAGEN_ANTEIL = 0.5;

// Lastanteil EINES Gegenstands (kg): 0 für nicht zählende; getragene zählen
// halb; Behälter-Inhalt um die Reduktion seines Behälters gemindert. `byUid`
// liefert den Behälter.
export function itemLastAnteil(item: Item, byUid: Map<string, Item>): number {
  if (!zaehltZurLast(item)) return 0;
  const base = itemGewicht(item);
  if (item.location === 'getragen') return base * GETRAGEN_ANTEIL;
  if (item.location === 'behaelter') {
    const c = byUid.get(item.containerUid);
    const red = c ? (c.kapazitaetArt === 'stueck' ? 100 : clampPct(c.gewichtsreduktion)) : 0;
    return base * (1 - red / 100);
  }
  return base;
}

// Summe der getragenen Last (kg), inklusive Behälter-Reduktion.
export function getrageneLast(items: readonly Item[]): number {
  const byUid = new Map(items.map((it) => [it.uid, it]));
  return items.reduce((sum, it) => sum + itemLastAnteil(it, byUid), 0);
}

export interface LastInfo {
  getragen: number; // kg
  max: number; // maximaleLast(attrs) + bonus, als kg gelesen
  ueberladen: boolean;
}

// Traglast-Übersicht für die Ladungsanzeige: getragen / Maximum + Überladung.
// `bonus` (kg) ist der additive Zusatz auf die berechnete maximale Last; er darf
// negativ sein, das Maximum wird aber nie unter 0 gedrückt.
export function lastInfo(items: readonly Item[], attrs: Attributes, bonus = 0): LastInfo {
  const getragen = getrageneLast(items);
  const max = Math.max(0, maximaleLast(attrs) + (Number(bonus) || 0));
  return { getragen, max, ueberladen: getragen > max };
}

// Maßgeblicher Rüstungsschutz: der höchste RS unter den getragenen Teilen
// (es wird nicht summiert — Spieler-Regel 2026-08-10).
export function effektiverRs(items: readonly Item[]): number {
  return items.reduce((m, it) => (it.location === 'getragen' ? Math.max(m, Number(it.rs) || 0) : m), 0);
}

// --- Sichten auf denselben Bestand ---

// Am Körper getragene Gegenstände einer Zone.
export function itemsInZone(items: readonly Item[], zone: string): Item[] {
  return items.filter((it) => it.location === 'getragen' && it.zone === zone);
}

// Seitenpaare am Körper. Ein beidseitig getragener Gegenstand speichert EINE der
// beiden Seiten als seine Zone; auf der Gegenseite erscheint er nur gespiegelt.
export const ZONE_SIBLING: Record<string, BodyZone> = {
  'Arm links': 'Arm rechts',
  'Arm rechts': 'Arm links',
  'Hand links': 'Hand rechts',
  'Hand rechts': 'Hand links',
  'Bein links': 'Bein rechts',
  'Bein rechts': 'Bein links',
};
// Hat diese Zone eine Gegenseite (Arm/Hand/Bein)? Nur dort ist „beidseitig" sinnvoll.
export function isPairedZone(zone: string): boolean {
  return zone in ZONE_SIBLING;
}

// Anzeige-Sicht einer Körperzone: die dort abgelegten Gegenstände PLUS die
// beidseitig getragenen der Gegenseite (sie erscheinen hier gespiegelt). Fürs
// Gewicht/RS bleibt itemsInZone maßgeblich — jeder Gegenstand liegt genau einmal
// im Bestand, die Spiegelung dupliziert nur die Anzeige.
export function zoneView(items: readonly Item[], zone: string): Item[] {
  const own = itemsInZone(items, zone);
  const sibling = ZONE_SIBLING[zone];
  if (!sibling) return own;
  const mirrored = items.filter(
    (it) => it.location === 'getragen' && it.zone === sibling && it.beidseitig,
  );
  return [...own, ...mirrored];
}

// Inhalt eines Behälters (über dessen uid).
export function itemsInContainer(items: readonly Item[], containerUid: string): Item[] {
  return items.filter((it) => it.location === 'behaelter' && it.containerUid === containerUid);
}

// Belegtes Gewicht eines Behälters (kg) — Summe der Inhalte OHNE Reduktion
// (roher Inhalt).
export function containerFuellung(items: readonly Item[], containerUid: string): number {
  return itemsInContainer(items, containerUid).reduce((s, it) => s + itemGewicht(it), 0);
}

// Effektive Füllung eines Behälters (kg): Inhaltsgewicht NACH Abzug der
// Gewichtsreduktion des Behälters. Diese Zahl zählt gegen das Fassungsvermögen —
// ein Beutel mit 50 % Reduktion und 60 kg Kapazität fasst so 120 kg roher Ware.
export function containerEffektiveFuellung(items: readonly Item[], containerUid: string): number {
  const byUid = new Map(items.map((it) => [it.uid, it]));
  return itemsInContainer(items, containerUid).reduce((s, it) => s + itemLastAnteil(it, byUid), 0);
}

// Belegte Stückzahl eines Behälters — Summe der `anzahl` seiner Inhalte, für
// Behälter mit kapazitaetArt === 'stueck' (Köcher, Münzbeutel …).
export function containerFuellungStueck(items: readonly Item[], containerUid: string): number {
  return itemsInContainer(items, containerUid).reduce((s, it) => s + (Number(it.anzahl) || 0), 0);
}

// Füllstand eines Behälters in seiner eigenen Einheit (kg oder Stück) — zum
// Vergleich mit seinem `kapazitaet`, ohne dass die aufrufende Stelle zwischen
// beiden Varianten unterscheiden muss.
export function containerFuellungAnzeige(items: readonly Item[], container: Pick<Item, 'uid' | 'kapazitaetArt'>): number {
  return container.kapazitaetArt === 'stueck'
    ? containerFuellungStueck(items, container.uid)
    : containerEffektiveFuellung(items, container.uid);
}

// Alle Behälter (Gegenstände, die andere aufnehmen können).
export function containers(items: readonly Item[]): Item[] {
  return items.filter((it) => it.istBehaelter);
}
