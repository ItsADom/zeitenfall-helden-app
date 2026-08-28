// Charakterbogen-Datenschicht: laden, Katalog, entprelltes Speichern,
// Würfel-Kontexte. Extrahiert aus pages/Character.tsx, damit ein zweiter
// Ort (die geplante virtuelle Tischplatte) dieselbe Seitenleiste mit
// derselben Lade-/Speicherlogik einbinden kann, ohne die Pool-Rechnung,
// den AktuellFeld-Speicherpfad und die Attribut-Würfe ein zweites Mal zu
// bauen. Seiten-Belange (Reiterleiste, Reihenfolge, Druckmodus, „Ansehen
// als"-Auswahl, Namensbearbeitung, Tabellenbreiten, Scroll-Erinnerung)
// bleiben bewusst in pages/Character.tsx — das hier ist nur der Datenteil.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Attributes, BaseValueInputs, CharLanguage, CharTalent, ExternalAttrPoint, Resources, SpecialResource } from '@shared/types';
import type { DynTab } from '@shared/dynamicSections';
import type { Item, StatBoni } from '@shared/items';
import { wornBoni } from '@shared/items';
import type { Ability } from '@shared/abilities';
import type { CoinPouch, CurrencySystem } from '@shared/currency';
import { apiGet, apiPut } from '../api';
import { useAuth, useThemeControls } from '../App';
import type { Row } from './inputs';

export interface FullData {
  // Fast alle Bio-Felder sind Freitext; rasseId ist die einzige Zahl (Verweis
  // in races_catalog, null = keine Rasse gewählt).
  bio: Record<string, string> & { rasseId: number | null };
  meta: Record<string, number>;
  attributes: Attributes;
  baseValues: BaseValueInputs;
  resources: Resources;
  // Spezialenergien (light): frei benannte Vorräte, vom Spieler selbst gepflegt.
  // Eigene Liste, damit die festen Energie-Spalten sie nicht verformen.
  special: SpecialResource[];
  // Externe Attributspunkte: nur in Einstellungen editiert (eigene Route),
  // hier rein lesend für die Ungenutzt-Berechnung im Heldenbrief.
  attrExtern: ExternalAttrPoint[];
  talents: CharTalent[];
  languages: CharLanguage[];
  lists: Record<string, Row[]>;
  tabs: DynTab[];
  visibility: Record<string, boolean>;
  // Spaltenbreiten der fest eingebauten Tabellen, je Tabellen-Schlüssel in
  // Prozent. Die selbst angelegten Tabellen führen ihre Breiten dagegen in der
  // Spaltendefinition mit (DynColumn.width).
  tableWidths: Record<string, number[]>;
  // Selbst gewählte Reihenfolge der Reiter als Liste von Schlüsseln. Leer =
  // Voreinstellung; unbekannte Schlüssel werden beim Anzeigen aussortiert.
  tabOrder: string[];
  portrait: boolean;
  // Einheitliches Gegenstands-Modell (Cluster 5): eine Liste plus die selbst
  // verwalteten Kategorien. Speichert über eigene Routen, nicht /section/:s.
  items: Item[];
  itemCategories: string[];
  // Zauber & Fähigkeiten (Cluster 6): ein Bestand, aus dem die Reiter „Zauber"
  // und „Fähigkeiten" nur anzeigen. Gepflegt wird in der Werkstatt; im Reiter
  // ändert sich einzig der Fortschritt. Speichert über eine eigene Route.
  abilities: Ability[];
  abilityLists: { element: string[]; kategorie: string[] };
  // Geldbeutel (Geld-Umbau): eine Liste, jeder Beutel an ein Katalog-
  // Währungssystem gebunden. Speichert über eine eigene Route, nicht /section/:s.
  pouches: CoinPouch[];
}

export interface TalentCatalogRow {
  id: number;
  kategorie: string;
  gruppe: string;
  name: string;
  probe: string;
  ableiten: string;
  skill100: string;
  sort: number;
}
export interface LanguageCatalogRow {
  id: number;
  kind: string;
  familie: string;
  name: string;
  komplexitaet: string;
  sort: number;
}
export interface RaceCatalogRow {
  id: number;
  gruppe: string;
  name: string;
  beschreibung: string;
  spezialisierung: string;
  talente: string;
  le: number | null;
  au: number | null;
  ae: number | null;
  mr: number | null;
  ak: number | null;
  gs: number | null;
  psyche: number | null;
  resilienz: number | null;
  notiz: string;
  sort: number;
}
export interface SpecialEnergyCatalogRow {
  id: number;
  name: string;
  formula: string;
  beschreibung: string;
  sort: number;
}
export interface Catalogs {
  talents: TalentCatalogRow[];
  languages: LanguageCatalogRow[];
  races: RaceCatalogRow[];
  specialEnergies: SpecialEnergyCatalogRow[];
  currencies: CurrencySystem[];
}

export interface CharacterInfo {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  // NULL, solange der Charakter keiner Gruppe angehört (Selbst-Anlage vor der
  // Freigabe) — der Server liefert das schon immer so, der Typ hier log früher.
  groupId: number | null;
  groupName: string;
  // Event-Gruppen: rein additiv zur festen Gruppe oben, nur-lesen hier (GM-only
  // verwaltet unter /verwaltung).
  tempGroups: { id: number; name: string }[];
  // Farbwelt des Charakters ('' = keine → Betrachter behält seine Vorgabe).
  theme?: string;
}

// Der Kontext, den die Seitenleiste und die eingebauten Reiter tatsächlich
// brauchen — bewusst klein, damit ein zweiter Einbindungsort (virtuelle
// Tischplatte) ihn ohne die Lade-/„Ansehen als"-Feinheiten mitbringen kann.
interface CharCtxValue {
  charId: number;
  data: FullData;
  /**
   * Boni aller getragenen Items, EINMAL aus data.items berechnet (wornBoni,
   * siehe shared/src/items.ts) — Reiter überlagern damit ihre eigenen
   * Attribute/Basiswerte/Ressourcen/Talente über die *MitBoni-Helfer, statt
   * jeder für sich data.items neu zu durchlaufen. `data` selbst bleibt roh
   * (siehe FullData) — Eingabefelder binden weiter dorthin, nie hierher.
   */
  stats: StatBoni;
  catalogs: Catalogs;
  update: (section: string, value: unknown) => void;
  /**
   * Gesetzt, wenn von diesem Bogen aus gewürfelt werden darf: eigener
   * Charakter (nie ein fremder — dafür gibt es den SL-Anfrage-Fluss) UND in
   * einer Gruppe (ohne Gruppe kein Feed, in den der Wurf posten könnte).
   * null = die Reiter blenden ihre Würfel-Knöpfe aus.
   */
  rollCtx: { groupId: number; charId: number } | null;
  /**
   * Gegenstück für die Spielleitung auf einem FREMDEN Bogen: sie würfelt
   * nicht selbst, sondern fragt die Probe beim Spieler an („SL + Spieler").
   * null auf dem eigenen Bogen und ohne Gruppe.
   */
  requestCtx: { groupId: number; charId: number; targetUserId: number } | null;
}
const CharCtx = createContext<CharCtxValue | null>(null);
export const useChar = () => useContext(CharCtx)!;

type Access = 'edit' | 'summary' | 'inspect' | null;

// Der volle Ladezustand, inklusive dem, was nur die Seite selbst braucht
// (info/access/summary für die Nicht-„edit"-Ansichten, loading/error für den
// ersten Aufbau, saveState/reloadTick/dynDirty für die Kopf- bzw. Inhalts-
// Anzeige). `useChar()` sieht davon absichtlich nur den schmalen Ausschnitt
// oben — dieser Typ ist für den Aufrufer von useCharSheet gedacht, heute nur
// pages/Character.tsx.
export interface CharSheetState {
  charId: number;
  info: CharacterInfo | null;
  setInfo: React.Dispatch<React.SetStateAction<CharacterInfo | null>>;
  access: Access;
  summary: unknown;
  data: FullData | null;
  setData: React.Dispatch<React.SetStateAction<FullData | null>>;
  stats: StatBoni;
  catalogs: Catalogs | null;
  loading: boolean;
  error: string;
  update: (section: string, value: unknown) => void;
  flush: () => Promise<void>;
  saveState: string;
  setSaveState: React.Dispatch<React.SetStateAction<string>>;
  rollCtx: CharCtxValue['rollCtx'];
  requestCtx: CharCtxValue['requestCtx'];
  /** Bei stiller Aktualisierung hochgezählt — für den React-Key von ContentTabView. */
  reloadTick: number;
  /** Hat der aktive Inhalts-Tab ungespeicherte Zeilen? Von ContentTabView per onDirtyChange gesetzt. */
  dynDirty: React.MutableRefObject<boolean>;
}

/**
 * Der Datenteil des Charakterbogens: laden (inkl. „Ansehen als" über `asUser`),
 * Katalog, entprelltes Sammel-Speichern der festen Sektionen, die Würfel-
 * Kontexte, die Farbwelt-Übernahme. Reine Datenlogik, kein Layout — siehe
 * Kommentar am Dateianfang.
 */
export function useCharSheet(charId: number, asUser?: number): CharSheetState {
  const { user } = useAuth();
  const [info, setInfo] = useState<CharacterInfo | null>(null);
  const [access, setAccess] = useState<Access>(null);
  const [data, setData] = useState<FullData | null>(null);
  const [summary, setSummary] = useState<unknown>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('');

  // Wird bei einer stillen Aktualisierung hochgezählt und geht in den React-Key
  // des aktiven Inhalts-Tabs ein — so übernimmt ContentTabView (hält Zeilen in
  // eigenem State) die frischen Serverdaten.
  const [reloadTick, setReloadTick] = useState(0);

  // Lädt den Charakter. quiet=true: stille Hintergrund-Aktualisierung ohne
  // Lade-Spinner — die bisherige Anzeige bleibt stehen, bis neue Daten da sind.
  const loadCharacter = useCallback(
    (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setData(null);
        setSummary(null);
      }
      setError('');
      const q = asUser ? `?asUser=${asUser}` : '';
      return apiGet<{ character: CharacterInfo; access: Access; data?: FullData; summary?: unknown }>(`/api/characters/${charId}${q}`)
        .then((res) => {
          setInfo(res.character);
          setAccess(res.access);
          setData(res.data ?? null);
          setSummary(res.summary ?? null);
          if (quiet) setReloadTick((t) => t + 1);
        })
        .catch((e) => {
          // Fehler einer stillen Aktualisierung nicht anzeigen — der alte Stand
          // bleibt stehen, es wird beim nächsten Fokus erneut versucht.
          if (!quiet) setError(e instanceof Error ? e.message : 'Fehler');
        })
        .finally(() => {
          if (!quiet) setLoading(false);
        });
    },
    [charId, asUser],
  );

  useEffect(() => {
    void loadCharacter();
    apiGet<Catalogs>('/api/catalogs').then(setCatalogs);
  }, [loadCharacter]);

  // Der Charakter bringt seine eigene Farbwelt mit — sie gilt für JEDEN, der ihn
  // öffnet (Spieler, Spielleiter, Gruppenmitglied), für Farbe UND Kopf-Animation.
  // App wendet die überschreibende Farbwelt an; beim Verlassen wird sie
  // abgeräumt und die persönliche Vorgabe des Betrachters greift wieder.
  const { setOverrideTheme } = useThemeControls();
  useEffect(() => {
    setOverrideTheme(info?.theme ?? null);
    return () => setOverrideTheme(null);
  }, [info?.theme, setOverrideTheme]);

  // Automatisches Speichern geänderter Sektionen (entprellt)
  const dirty = useRef(new Set<string>());
  const saving = useRef(false); // läuft gerade ein Speichern der festen Sektionen?
  const dynDirty = useRef(false); // hat der aktive Inhalts-Tab ungespeicherte Zeilen?
  const timer = useRef<number | undefined>(undefined);
  const dataRef = useRef<FullData | null>(null);
  dataRef.current = data;

  const flush = useCallback(async () => {
    const sections = [...dirty.current];
    dirty.current.clear();
    const d = dataRef.current;
    if (!d || sections.length === 0) return;
    saving.current = true;
    setSaveState('Speichere…');
    try {
      for (const s of sections) {
        if (s === 'visibility') await apiPut(`/api/characters/${charId}/visibility`, d.visibility);
        else if (s === 'items') await apiPut(`/api/characters/${charId}/items`, d.items);
        else if (s === 'itemCategories') await apiPut(`/api/characters/${charId}/item-categories`, d.itemCategories);
        else if (s === 'abilities') await apiPut(`/api/characters/${charId}/abilities`, d.abilities);
        else if (s === 'pouches') await apiPut(`/api/characters/${charId}/pouches`, d.pouches);
        else {
          const value =
            s === 'bio' ? d.bio
            : s === 'meta' ? d.meta
            : s === 'attributes' ? d.attributes
            : s === 'baseValues' ? d.baseValues
            : s === 'resources' ? d.resources
            : s === 'special' ? d.special
            : s === 'talents' ? d.talents
            : s === 'languages' ? d.languages
            : d.lists[s];
          await apiPut(`/api/characters/${charId}/section/${s}`, value);
        }
      }
      setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      dirty.current = new Set([...dirty.current, ...sections]);
      setSaveState(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving.current = false;
    }
  }, [charId]);

  const update = useCallback(
    (section: string, value: unknown) => {
      setData((prev) => {
        if (!prev) return prev;
        if (section === 'bio') return { ...prev, bio: value as FullData['bio'] };
        if (section === 'meta') return { ...prev, meta: value as FullData['meta'] };
        if (section === 'attributes') return { ...prev, attributes: value as Attributes };
        if (section === 'baseValues') return { ...prev, baseValues: value as BaseValueInputs };
        if (section === 'resources') return { ...prev, resources: value as Resources };
        if (section === 'special') return { ...prev, special: value as SpecialResource[] };
        if (section === 'talents') return { ...prev, talents: value as CharTalent[] };
        if (section === 'languages') return { ...prev, languages: value as CharLanguage[] };
        if (section === 'visibility') return { ...prev, visibility: value as FullData['visibility'] };
        if (section === 'items') return { ...prev, items: value as Item[] };
        if (section === 'itemCategories') return { ...prev, itemCategories: value as string[] };
        if (section === 'abilities') return { ...prev, abilities: value as Ability[] };
        if (section === 'pouches') return { ...prev, pouches: value as CoinPouch[] };
        return { ...prev, lists: { ...prev.lists, [section]: value as Row[] } };
      });
      dirty.current.add(section);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 1500);
    },
    [flush],
  );

  // Kehrt der Tab/das Fenster in den Vordergrund zurück, still nachladen — so
  // sieht man Änderungen anderer (Spielleiter ⇄ Spieler), ohne neu zu laden.
  // Bewusst NICHT während eigener ungespeicherter Änderungen (feste Sektionen:
  // dirty/saving; aktiver Inhalts-Tab: dynDirty) — sonst würde der eigene Stand
  // vom Serverstand überschrieben.
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState !== 'visible') return;
      if (dirty.current.size > 0 || saving.current || dynDirty.current) return;
      void loadCharacter(true);
    };
    window.addEventListener('focus', maybeReload);
    document.addEventListener('visibilitychange', maybeReload);
    return () => {
      window.removeEventListener('focus', maybeReload);
      document.removeEventListener('visibilitychange', maybeReload);
    };
  }, [loadCharacter]);

  // Würfeln nur vom eigenen Bogen und nur mit Gruppe — ein Spielleiter, der
  // einen fremden Bogen offen hat, würfelt hier NICHT für den Spieler (dafür
  // ist der SL-Anfrage-Fluss da), und ohne Gruppe gibt es keinen Feed.
  const rollCtx = info && info.groupId != null && info.ownerUserId === user.id ? { groupId: info.groupId, charId } : null;
  // Spielleitung auf einem fremden Bogen: anfragen statt würfeln.
  const requestCtx =
    info && info.groupId != null && user.isGm && info.ownerUserId !== user.id
      ? { groupId: info.groupId, charId, targetUserId: info.ownerUserId }
      : null;

  // Einmal pro data.items-Wechsel berechnet, nicht in jedem Reiter neu — siehe
  // CharCtxValue.stats.
  const stats = useMemo(() => wornBoni(data?.items ?? []), [data?.items]);

  return {
    charId, info, setInfo, access, summary, data, setData, stats, catalogs, loading, error,
    update, flush, saveState, setSaveState, rollCtx, requestCtx, reloadTick, dynDirty,
  };
}

// Der rohe Kontext, exportiert für pages/Character.tsx: die Seite braucht die
// feineren Ladezustände (Zusammenfassung, kein Zugriff, „Ansehen als") selbst
// und ruft dafür useCharSheet direkt auf, muss den Kontext also selbst
// aufspannen — CharSheetProvider unten übernimmt das nur für den einfachen Fall.
export { CharCtx };

/**
 * Einfache Einbindung für einen zweiten Ort, der den Charakterbogen (bzw.
 * seine Seitenleiste) zeigen will, ohne sich um Lade-/Zusammenfassungs-/
 * Kein-Zugriff-Zustände zu kümmern — immer der eigene Charakter des
 * Betrachters (kein `asUser`), also praktisch immer `access === 'edit'`,
 * sobald geladen. Rendert `children` erst, wenn Daten UND Katalog stehen UND
 * Bearbeitungszugriff besteht; solange nicht, ein schlichtes „Lade…".
 *
 * pages/Character.tsx nutzt dies NICHT — die Seite braucht die feineren
 * Zustände (Zusammenfassung, kein Zugriff, „Ansehen als") selbst und ruft
 * dafür `useCharSheet` direkt auf.
 */
export function CharSheetProvider({ charId, children }: { charId: number; children: React.ReactNode }) {
  const sheet = useCharSheet(charId);
  if (!sheet.data || !sheet.catalogs || sheet.access !== 'edit') {
    return <p className="muted">Lade…</p>;
  }
  const ctx: CharCtxValue = {
    charId, data: sheet.data, stats: sheet.stats, catalogs: sheet.catalogs, update: sheet.update,
    rollCtx: sheet.rollCtx, requestCtx: sheet.requestCtx,
  };
  return <CharCtx.Provider value={ctx}>{children}</CharCtx.Provider>;
}
