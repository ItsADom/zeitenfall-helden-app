// Definitionen der Listen-Sektionen: treiben DB-Schema (Server) und
// generische Tabellen-Editoren (Client).

export type ColType = 'text' | 'number' | 'bool';

export interface ColumnDef {
  key: string;
  label: string;
  type: ColType;
  width?: number; // relative Breite für die Tabellen-Darstellung
}

export interface ListSectionDef {
  id: string;
  label: string;
  columns: ColumnDef[];
}

const t = (key: string, label: string, width?: number): ColumnDef => ({ key, label, type: 'text', width });
const n = (key: string, label: string, width?: number): ColumnDef => ({ key, label, type: 'number', width });
const b = (key: string, label: string, width?: number): ColumnDef => ({ key, label, type: 'bool', width });

// Jede Zeile jeder Listen-Sektion bekommt eine freie Notiz (eigener Editor im Client)
export const NOTIZ_KEY = 'notiz';

const RAW_SECTIONS: ListSectionDef[] = [
  // Heldenbrief
  {
    id: 'professionBoni',
    label: 'Professionsboni',
    columns: [t('bezeichnung', 'Profession', 2), t('effekt', 'Effekt', 5)],
  },
  {
    id: 'vorteile',
    label: 'Vorteile',
    columns: [t('name', 'Vorteil', 2), t('wert', 'Wert', 1), t('gp', 'GP', 1), t('beschreibung', 'Beschreibung', 6)],
  },
  {
    id: 'nachteile',
    label: 'Nachteile',
    columns: [t('name', 'Nachteil', 2), t('wert', 'Wert', 1), t('gp', 'GP', 1), t('beschreibung', 'Beschreibung', 6)],
  },
  {
    id: 'titel',
    label: 'Titel / Orden',
    columns: [t('name', 'Titel / Orden', 3), t('effekt', 'Effekt', 6)],
  },
  {
    id: 'perks',
    label: '20+ Perks',
    columns: [t('voraussetzung', 'Voraussetzung', 1), t('name', 'Name', 2), t('effekt', 'Effekt', 5)],
  },
  // Waffen
  {
    id: 'waffenNah',
    label: 'Nahkampfwaffen',
    columns: [
      t('name', 'Waffe', 3), t('typMaterial', 'Typ/Material', 2), t('rd', 'RD', 1), t('tp', 'TP', 1),
      t('anforderung', 'Anforderung', 1), n('at', 'AT', 1), n('pa', 'PA', 1), n('bl', 'BL', 1),
      t('schaden', 'Schaden', 1), n('iniBonus', 'Ini-Bonus', 1), t('reichweite', 'Reichweite', 1),
      t('besonderes', 'Besonderes', 3), t('expLevel', 'EXP/LVL', 1), n('talentId', 'Kampftalent', 2),
    ],
  },
  {
    id: 'waffenFern',
    label: 'Fernkampfwaffen',
    columns: [
      t('name', 'Waffe', 3), t('typEbe', 'Typ/eBE', 2), t('entfernung', 'Entfernung', 2),
      t('tpEntfernung', 'TP/Entfernung', 2), n('atMod', 'AT-Mod', 1), t('tp', 'TP', 1),
      t('besonderes', 'Besonderes', 3), n('talentId', 'Kampftalent', 2),
    ],
  },
  // Waffen (neu): kompaktes Layout mit gepaarten Spalten (zweizeiliger Kopf im
  // Client), löst waffenNah/waffenFern in der Darstellung ab. Die Felder sind
  // 1:1-Umbenennungen der alten Spalten (siehe Migration in db.ts) — keins
  // verändert seine Bedeutung, „tp" heißt nur klarer „haltbarkeit".
  {
    id: 'waffenNahNeu',
    label: 'Nahkampfwaffen',
    columns: [
      t('typ', 'Waffe/Typ', 3), t('expLevel', 'EXP/LVL', 1), t('schaden', 'Schaden', 1),
      t('material', 'Material', 2), n('iniBonus', 'Ini-Bonus', 1), t('rd', 'Rüstungsdurchdringung', 1),
      t('reichweite', 'Reichweite', 1), t('haltbarkeit', 'Haltbarkeit', 1), t('besonderes', 'Besonderes', 3),
      t('anforderung', 'Anforderung', 1), n('talentId', 'Kampftalent', 2),
      n('at', 'AT', 1), n('pa', 'PA', 1), n('bl', 'BL', 1),
    ],
  },
  {
    id: 'waffenFernNeu',
    label: 'Fernkampfwaffen',
    columns: [
      t('typ', 'Waffe/Typ', 3), t('eBE', 'eBE', 1), t('haltbarkeit', 'Haltbarkeit', 1),
      t('entfernung', 'Entfernung', 2), t('besonderes', 'Besonderes', 3),
      t('schaden', 'Schaden', 2), n('talentId', 'Kampftalent', 2), n('atMod', 'AT-Mod', 1),
    ],
  },
  {
    id: 'waffenlos',
    label: 'Waffenloser Kampf',
    columns: [t('technik', 'Technik', 2), t('tpKk', 'TP/KK', 1), n('ini', 'INI', 1), n('at', 'AT', 1), n('pa', 'PA', 1), t('tpa', 'TP(A)', 1), n('talentId', 'Kampftalent', 2)],
  },
  {
    id: 'kampfstile',
    label: 'Kampfstile',
    columns: [t('name', 'Kampfstil', 3), t('besonderes', 'Besonderes', 6)],
  },
  {
    id: 'munition',
    label: 'Pfeile/Bolzen',
    columns: [t('art', 'Art', 3), t('anzahl', 'Anzahl', 1), t('fuerWaffe', 'für Waffe', 3)],
  },
  // Zauber: frei benennbare Sektionen je Charakter, Einträge referenzieren die Sektion per Name
  {
    id: 'zauberSektionen',
    label: 'Zauber-Sektionen',
    columns: [t('name', 'Sektion', 4)],
  },
  {
    id: 'zauberEintraege',
    label: 'Zauber & Techniken',
    columns: [
      t('sektion', 'Sektion', 2), t('name', 'Name', 4), t('stufe', 'Stufe', 1), t('kosten', 'Kosten', 1),
      t('probe', 'Probe', 2), t('effekt', 'Effekt', 5), n('fortschritt', 'Fortschritt', 1),
      n('probeZahlManuell', 'Probe (Zahl, manuell)', 1),
    ],
  },
  // Ausrüstung
  {
    id: 'ausruestungSlots',
    label: 'Getragene Ausrüstung',
    columns: [t('slot', 'Körperstelle', 2), t('beschreibung', 'Ausrüstung', 6)],
  },
  {
    id: 'behaelter',
    label: 'Behälter',
    columns: [t('name', 'Behälter', 4), t('kapazitaet', 'Kapazität', 2)],
  },
  {
    id: 'proviant',
    label: 'Proviant/Tränke/Magisches',
    columns: [t('name', 'Gegenstand', 4), n('portionen', 'Portionen/Ladungen', 1), n('gewicht', 'Gewicht', 1)],
  },
  {
    id: 'kleidungen',
    label: 'Kleidungen',
    columns: [t('anlass', 'Anlass', 2), t('kleidung', 'Kleidung', 5), n('gewicht', 'Gewicht', 1)],
  },
  {
    id: 'tierAusruestung',
    label: 'Tier-Ausrüstung',
    columns: [t('tier', 'Tier/Begleiter', 2), t('name', 'Ausrüstungsstück', 5), n('gewicht', 'Gewicht', 1)],
  },
  // Inventar
  {
    id: 'inventar',
    label: 'Inventar',
    columns: [t('kategorie', 'Kategorie', 2), t('name', 'Name', 5), n('anzahl', 'Anzahl', 1), n('eGewicht', 'E-Gewicht', 1)],
  },
  // Artefakte
  {
    id: 'kraftspeicher',
    label: 'Kraftspeicher',
    columns: [
      t('name', 'Speicherkörper', 3), t('pasp', 'pAsP', 1), t('maxAstral', 'max. Astral', 1),
      t('momentaneAsp', 'momentane AsP', 1), t('einschraenkungen', 'Einschränkungen', 3), t('besonderes', 'Besonderes', 3),
    ],
  },
  {
    id: 'artefakte',
    label: 'Artefakte',
    columns: [
      t('name', 'Artefaktname', 3), t('wert', 'Wert', 1), t('pasp', 'pAsP', 1), t('sprueche', 'gespeicherte Sprüche', 3),
      t('ladungen', 'Ladungen', 1), t('intervallStab', 'Intervall/Stab.', 1), t('beseeltheit', 'Beseeltheit/Nebeneffekte', 2),
      t('ausloeser', 'Auslöser', 2), t('haltbarkeit', 'Haltbarkeit/Besonderes/Material', 3),
    ],
  },
  // Besitz
  {
    id: 'waehrungen',
    label: 'Cambio',
    columns: [t('waehrung', 'Währung', 3), t('menge', 'Menge', 2)],
  },
  {
    id: 'schulden',
    label: 'Schulden',
    columns: [t('glaeubiger', 'Gläubiger', 2), t('schulden', 'Schulden', 1), t('ort', 'Ort', 2), t('frist', 'Frist', 1), t('zinsen', 'Zinsen', 1)],
  },
  {
    id: 'wertgegenstaende',
    label: 'Wertgegenstände',
    columns: [t('name', 'Gegenstand', 3), t('aussehen', 'Aussehen', 3), t('besonderes', 'Besonderes', 3), t('wert', 'Wert', 1)],
  },
  {
    id: 'einnahmequellen',
    label: 'Einnahmequellen',
    columns: [t('quelle', 'Quelle', 2), t('ort', 'Ort', 2), t('beschreibung', 'Beschreibung', 4), t('gewinnProMonat', 'Gewinn pro Monat', 1)],
  },
  {
    id: 'immobilien',
    label: 'Land & Immobilien',
    columns: [t('typ', 'Typ', 2), t('ort', 'Ort', 2), t('beschreibung', 'Beschreibung', 4), t('kostenProMonat', 'Kosten pro Monat', 1)],
  },
  {
    id: 'besitzSonstiges',
    label: 'Sonstiges',
    columns: [t('art', 'Art', 2), t('beschreibung', 'Beschreibung', 5), t('kostenGewinn', 'Kosten / Gewinn', 1)],
  },
  // Bibliothek
  {
    id: 'bibliothek',
    label: 'Bücher',
    columns: [
      t('buch', 'Buch', 3), t('typ', 'Typ', 1), t('wert', 'Wert', 1), t('voraussetzungen', 'Voraussetzungen', 2),
      t('talente', 'Talente', 2), t('besonderes', 'Besonderes', 3), b('abgeschlossen', 'Abgeschlossen', 1), b('inTasche', 'In Tasche', 1),
    ],
  },
  // Boni
  {
    id: 'boni',
    label: 'Boni',
    columns: [t('bonus', 'Bonus', 3), t('herkunft', 'Herkunft', 3)],
  },
  // Vorlieben
  {
    id: 'vorlieben',
    label: 'Vorlieben',
    columns: [t('kind', 'Art', 1), t('text', 'Text', 6)],
  },
];

export const LIST_SECTIONS: ListSectionDef[] = RAW_SECTIONS.map((s) => ({
  ...s,
  columns: [...s.columns, t(NOTIZ_KEY, 'Notiz', 3)],
}));

export const LIST_SECTION_IDS = LIST_SECTIONS.map((s) => s.id);
export const listSectionById = (id: string): ListSectionDef | undefined => LIST_SECTIONS.find((s) => s.id === id);

// Inventar-Kategorien wie im Blatt
export const INVENTAR_KATEGORIEN = ['Allgemein', 'Tränke/Proviant', 'Handwerk'] as const;
// Vorlieben-Spalten
export const VORLIEBEN_KINDS = ['mag', 'magNicht'] as const;
