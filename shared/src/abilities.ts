// Einheitliches Zauber-/Fähigkeiten-Modell (Cluster 6).
//
// Zauber und (mundane) Fähigkeiten liegen in EINEM Bestand pro Charakter — die
// „einzige Quelle der Wahrheit", aus der die Reiter nur noch anzeigen. Was ein
// Eintrag ist, entscheiden zwei Flags:
//   magisch  true  → Reiter „Zauber"        (hat Stufe × Komplexität → Magiepunkte)
//            false → Reiter „Fähigkeiten"    (mundan; Aktive haben Stufe/Fortschritt)
//   passiv   Dauerwirkung statt aktiver Probe — ein Filter INNERHALB beider Reiter,
//            damit eine passive Fähigkeit nicht doppelt (mundan wie magisch) lebt.
import type { Attributes } from './types.js';
import { makeUid } from './items.js';

export interface Ability {
  id: number;
  // Stabile, client-vergebene Kennung (überlebt das Speichern per DELETE+INSERT,
  // wie bei Item). Bezüge zwischen Einträgen laufen über sie, nicht über `id`.
  uid: string;
  magisch: boolean; // true → Zauber, false → Fähigkeit
  passiv: boolean; // Dauerwirkung (kein aktiver Wirk-Wurf)
  // Signatur-Zauber: höchstens EINER je Charakter (Boni später, vorerst nur die
  // Markierung). Der Server erzwingt die Einzigartigkeit beim Speichern.
  signatur: boolean;
  name: string;
  element: string; // Name aus der Element-Liste des Charakters ('' = ohne)
  // Freie Gruppierung des Spielers (z. B. „Heilmagie", „Utility") — MEHRERE
  // zugleich möglich (ein Zauber kann in mehr als einer Kategorie stehen).
  // Eine der zwei Achsen, nach denen die Reiter gruppieren können (die andere
  // ist element, die einwertig bleibt). Leeres Array = ohne Kategorie.
  kategorien: string[]; // Namen aus der Kategorie-Liste des Charakters
  stufe: number; // Zauberstufe bzw. Fähigkeitsstufe (Ganzzahl)
  komplexitaet: number; // nur magisch sinnvoll — speist die Magiepunkte
  kosten: string; // AP-Kosten, Freitext („2 bis X", „min 20")
  probe: string; // Probenausdruck „FF+FF+KL" (frei, auch mehr als drei Attribute)
  effekt: string;
  fortschritt: number; // Lernfortschritt / investierte Punkte (im Reiter editierbar)
  notiz: string;
  // Favorit fürs Würfel-Dock (📌 in AbilityManager/AbilityTable) — taucht dann
  // zusätzlich in der Würfel-Favoriten-Flyout auf (ShortcutsFlyout.tsx).
  favorit: boolean;
}

// Neue Kennung — dieselbe Quelle wie bei Item (crypto.randomUUID / Fallback).
export const makeAbilityUid = makeUid;

// Sichten auf denselben Bestand: die beiden Reiter.
export function zauberOf(list: readonly Ability[]): Ability[] {
  return list.filter((a) => a.magisch);
}
export function faehigkeitenOf(list: readonly Ability[]): Ability[] {
  return list.filter((a) => !a.magisch);
}

// Nach einem Feld gruppieren (für die Kopfzeilen im Reiter). Leerwerte landen
// unter '' — der Client zeigt sie als „Ohne …". Reihenfolge = erstes Auftreten.
// 'kategorie' ist mehrwertig: ein Eintrag mit mehreren Kategorien taucht in
// jeder seiner Gruppen auf (bewusste Mehrfachzählung, kein Duplikat-Bug).
export function groupAbilities(list: readonly Ability[], by: 'element' | 'kategorie'): Map<string, Ability[]> {
  const out = new Map<string, Ability[]>();
  const push = (key: string, a: Ability) => {
    const bucket = out.get(key);
    if (bucket) bucket.push(a);
    else out.set(key, [a]);
  };
  for (const a of list) {
    if (by === 'element') {
      push(a.element ?? '', a);
    } else {
      const cats = a.kategorien.length > 0 ? a.kategorien : [''];
      for (const key of cats) push(key, a);
    }
  }
  return out;
}

// --- 6a: Magierstufe & Magiepunkte ---
//
// Ein rein abgeleitetes Feature: die App rechnet und zeigt, aufsteigen tut der
// Mensch manuell. `magierstufe` ist der einzige Wert, den ein Mensch pflegt
// (0 = kein Magier, 1–5 = Rang) und liegt in char_meta.

export const MAGIER_MAX_STUFE = 5;

// Obergrenzen für Einträge: die Zauber-/Fähigkeitsstufe geht bis 10; die
// Komplexität hat einen weichen Richtwert von 5 (höher ist selten, aber möglich).
export const ABILITY_STUFE_MAX = 10;
export const ABILITY_KOMPLEX_SOFT_MAX = 5;

// Magiepunkte EINES Zaubers: Stufe × Komplexität.
export function spellPunkte(a: Pick<Ability, 'stufe' | 'komplexitaet'>): number {
  return (Number(a.stufe) || 0) * (Number(a.komplexitaet) || 0);
}

// „Triviale" Zauber (Stufe 1 UND Komplexität 1) unterliegen einer Anti-Füll-
// Grenze — nur sie, alles andere zählt voll.
export function istTrivial(a: Pick<Ability, 'stufe' | 'komplexitaet'>): boolean {
  return (Number(a.stufe) || 0) === 1 && (Number(a.komplexitaet) || 0) === 1;
}

export interface MagiepunkteInfo {
  summe: number; // gewertete Magiepunkte insgesamt
  trivialGesamt: number; // wie viele triviale Zauber der Charakter hat
  trivialGezaehlt: number; // wie viele davon (nach Deckel) gewertet werden
  trivialCap: number; // Deckel = 10 × (magierstufe − 1)
}

// Summe der gewerteten Magiepunkte. Triviale Zauber zählen höchstens
// 10 × (magierstufe − 1) Stück (je 1 Punkt); alles andere voll. Der Deckel gilt
// für jeden — bei Rang 1 ist er 10×0 = 0, bei Rang 0 ebenfalls 0.
export function magiepunkte(list: readonly Ability[], magierstufe: number): MagiepunkteInfo {
  const trivialCap = Math.max(0, 10 * (Math.max(0, Math.floor(magierstufe)) - 1));
  let nonTrivial = 0;
  let trivialGesamt = 0;
  for (const a of list) {
    if (!a.magisch) continue;
    if (istTrivial(a)) trivialGesamt++;
    else nonTrivial += spellPunkte(a);
  }
  const trivialGezaehlt = Math.min(trivialGesamt, trivialCap);
  return { summe: nonTrivial + trivialGezaehlt, trivialGesamt, trivialGezaehlt, trivialCap };
}

// Voraussetzungen für den NÄCHSTEN Rang (magierstufe + 1). Die vier Talent-TaWs
// werden über den Katalog nach Namen gelesen (siehe MAGIER_TALENT_NAMES).
export interface MagierAnforderung {
  koerper: number; // Körperbeherrschung TaW
  selbst: number; // Selbstbeherrschung TaW
  magiekunde: number; // Magiekunde TaW
  krypto: number; // Kryptografie TaW
  psyche: number; // Psyche in %
  magiepunkte: number;
}

export const MAGIER_ANFORDERUNGEN: Record<number, MagierAnforderung> = {
  2: { koerper: 20, selbst: 20, magiekunde: 20, krypto: 10, psyche: 80, magiepunkte: 16 },
  3: { koerper: 40, selbst: 40, magiekunde: 40, krypto: 20, psyche: 90, magiepunkte: 34 },
  4: { koerper: 60, selbst: 60, magiekunde: 60, krypto: 40, psyche: 100, magiepunkte: 60 },
  5: { koerper: 80, selbst: 80, magiekunde: 80, krypto: 80, psyche: 100, magiepunkte: 120 },
};

export const MAGIER_TALENT_NAMES = {
  koerper: 'Körperbeherrschung',
  selbst: 'Selbstbeherrschung',
  magiekunde: 'Magiekunde',
  krypto: 'Kryptographie',
} as const;

// Betriebswerte je Rang (statische Referenz, im Reiter als Panel gezeigt).
export interface MagierStufenReferenz {
  aspProRunde: number; // pro Runde einsetzbare AsP
  erschoepfungAb: number; // Erschöpfung oberhalb dieser AsP
  ueberladenToedlichAb: number; // Überladung tödlich ab +X über dem Maximum
  zauberStufenGrenze: number; // höchste wirkbare Zauberstufe
}

export const MAGIER_STUFEN_REFERENZ: Record<number, MagierStufenReferenz> = {
  1: { aspProRunde: 5, erschoepfungAb: 20, ueberladenToedlichAb: 20, zauberStufenGrenze: 5 },
  2: { aspProRunde: 10, erschoepfungAb: 25, ueberladenToedlichAb: 30, zauberStufenGrenze: 7 },
  3: { aspProRunde: 15, erschoepfungAb: 30, ueberladenToedlichAb: 40, zauberStufenGrenze: 10 },
  4: { aspProRunde: 20, erschoepfungAb: 40, ueberladenToedlichAb: 60, zauberStufenGrenze: 10 },
  5: { aspProRunde: 30, erschoepfungAb: 80, ueberladenToedlichAb: 150, zauberStufenGrenze: 10 },
};

// Reichweite je Magierstufe in Metern, ohne jeden Bonus — reine Anzeige-
// Referenz (siehe MagierPanel), keine Rolle in irgendeiner Formel. Kein
// gleichmäßiger Sprung pro Stufe (Rang 5 springt überproportional), deshalb
// eine Tabelle statt einer Formel. Stand der Hausregel; kann sich noch ändern.
export const SPELL_REICHWEITE_REFERENZ: Record<number, number> = {
  1: 25,
  2: 50,
  3: 75,
  4: 100,
  5: 200,
};

// Ist-Werte für den Voraussetzungs-Check (der Client liest sie zusammen).
export interface MagierIstWerte {
  koerper: number;
  selbst: number;
  magiekunde: number;
  krypto: number;
  psyche: number; // in %
  magiepunkte: number;
}

export interface EligibilityBedingung {
  key: keyof MagierAnforderung;
  label: string;
  ist: number;
  soll: number;
  erfuellt: boolean;
  einheit?: string;
}

export interface EligibilityResult {
  naechsteStufe: number | null; // null, wenn bereits Rang 5 (oder kein nächster)
  bedingungen: EligibilityBedingung[];
  erfuellt: boolean; // alle Bedingungen erfüllt
}

// Fortschrittsanzeige zum nächsten Rang — nie ein Knopf, nur Anzeige. Prüft immer
// nur genau den nächsten Rang (magierstufe + 1), passend zum einstufigen manuellen
// Aufstieg (und umgeht die Ringabhängigkeit des Trivial-Deckels).
export function magierEligibility(magierstufe: number, ist: MagierIstWerte): EligibilityResult {
  const next = Math.floor(magierstufe) + 1;
  const soll = MAGIER_ANFORDERUNGEN[next];
  if (!soll || next > MAGIER_MAX_STUFE) return { naechsteStufe: null, bedingungen: [], erfuellt: false };
  const mk = (key: keyof MagierAnforderung, label: string, istV: number, sollV: number, einheit?: string): EligibilityBedingung => ({
    key,
    label,
    ist: istV,
    soll: sollV,
    erfuellt: istV >= sollV,
    einheit,
  });
  const bedingungen = [
    mk('koerper', MAGIER_TALENT_NAMES.koerper, ist.koerper, soll.koerper),
    mk('selbst', MAGIER_TALENT_NAMES.selbst, ist.selbst, soll.selbst),
    mk('magiekunde', MAGIER_TALENT_NAMES.magiekunde, ist.magiekunde, soll.magiekunde),
    mk('krypto', MAGIER_TALENT_NAMES.krypto, ist.krypto, soll.krypto),
    mk('psyche', 'Psyche', Math.round(ist.psyche), soll.psyche, '%'),
    mk('magiepunkte', 'Magiepunkte', ist.magiepunkte, soll.magiepunkte),
  ];
  return { naechsteStufe: next, bedingungen, erfuellt: bedingungen.every((b) => b.erfuellt) };
}

// Attribute werden hier (noch) nicht gebraucht — die Probenzahl eines Zaubers
// rechnet der Client über probeExprZahl(attrs, ability.probe) aus rules.ts.
export type { Attributes };
