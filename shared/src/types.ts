// Attribute
export type AttrCode = 'MU' | 'KL' | 'IN' | 'CH' | 'FF' | 'GE' | 'KO' | 'KK';
export const ATTR_CODES: AttrCode[] = ['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK'];
// Sozialstatus steht mit in der Attributtabelle, wird aber nie in Proben verwendet
export type AttrRowCode = AttrCode | 'SO';
export const ATTR_ROW_CODES: AttrRowCode[] = [...ATTR_CODES, 'SO'];

export const ATTR_LABELS: Record<AttrRowCode, string> = {
  MU: 'Mut',
  KL: 'Klugheit',
  IN: 'Intuition',
  CH: 'Charisma',
  FF: 'Fingerfertigkeit',
  GE: 'Gewandtheit',
  KO: 'Konstitution',
  KK: 'Körperkraft',
  SO: 'Sozialstatus',
};

export interface AttributeValue {
  akt: number;
  mod: number;
}
export type Attributes = Record<AttrRowCode, AttributeValue>;

// Basiswerte (Heldenbrief rechte Spalte)
export type BaseValueKey =
  | 'at'
  | 'pa'
  | 'bl'
  | 'fk'
  | 'ini'
  | 'artefaktkontrolle'
  | 'todesschwelle'
  | 'wundschwelle'
  | 'ausweichen'
  | 'resilienz'
  | 'mr'
  | 'gs';

// MR steht neben der Resilienz: beides sind Widerstände (Resilienz gegen
// Psyche-Schaden). MR ist zugleich Eingang für Artefaktkontrolle und Resilienz.
export const BASE_VALUE_KEYS: BaseValueKey[] = [
  'at', 'pa', 'bl', 'fk', 'ini', 'artefaktkontrolle',
  'todesschwelle', 'wundschwelle', 'ausweichen', 'resilienz', 'mr', 'gs',
];

export const BASE_VALUE_LABELS: Record<BaseValueKey, { label: string; formel: string }> = {
  at: { label: 'Attacke-Basis', formel: '(MU+GE+KK):5' },
  pa: { label: 'Parade-Basis', formel: '(IN+GE+FF):5' },
  bl: { label: 'Blocken-Basis', formel: '(KO+KK+IN):5' },
  fk: { label: 'Fernkampf-Basis', formel: '(IN+FF+KK):5' },
  ini: { label: 'Initiative-Basis', formel: '(MU+MU+IN+GE):5' },
  artefaktkontrolle: { label: 'Artefaktkontrolle', formel: '(IN+MR+MU)' },
  todesschwelle: { label: 'Todesschwelle', formel: '(Wundschwelle+MU):4' },
  wundschwelle: { label: 'Wundschwelle', formel: '(KO):2' },
  ausweichen: { label: 'Ausweichen', formel: '(GE+GE+IN):3' },
  resilienz: { label: 'Resilienz', formel: '(MU+MU+MR):5' },
  mr: { label: 'Magieresistenz', formel: '(MU+KL+KO):5' },
  gs: { label: 'Geschwindigkeit', formel: '' },
};

// Basiswert-Eingaben: Modifikator je Wert, GS hat zusätzlich einen Basiswert als Eingabe
export interface BaseValueInputs {
  mods: Record<BaseValueKey, number>;
  gsBase: number;
}

// Energien/Ressourcen (LE, AUS, AsE) — echte Vorräte mit Aktuell/Max.
// Die MR ist keiner davon und liegt bei den Basiswerten.
export type ResourceKey = 'le' | 'aus' | 'ase';
export const RESOURCE_KEYS: ResourceKey[] = ['le', 'aus', 'ase'];
export const RESOURCE_LABELS: Record<ResourceKey, { label: string; formel: string }> = {
  le: { label: 'Lebensenergie', formel: '(KO+KO+KK):2' },
  aus: { label: 'Ausdauer', formel: '(MU+GE+KO):2' },
  ase: { label: 'Astralenergie', formel: '(MU+IN+CH):2' },
};

// Spaltennamen der Energien-Tabellen — eine Stelle für Heldenbrief und Summary,
// damit die Namen nicht auseinanderlaufen.
//
// Die vier Eingaben bilden ein Kreuz aus Herkunft und Ziel:
//
//                  → Maximum      → Ausbaugrenze
//   Bonus          permanent      maxPlus
//   gekauft (AP)   kauf           kaufMax
//
// Deshalb steht das Ziel in der Gruppenzeile und die Herkunft in der Spalte.
// Die Paare je Ziel dürfen NICHT zusammengefasst werden, auch wenn die Formel
// sie nur addiert: die Trennung ist der Nachweis, was mit Abenteuerpunkten
// gekauft wurde. (Bei der MR gab es diesen Grund nicht — sie wurde deshalb zu
// einem einzelnen Basiswert-Modifikator zusammengelegt.)
export const RESOURCE_COLUMN_LABELS = {
  formelwert: 'Formelwert',
  bonus: 'Bonus',
  gekauft: 'Gekauft',
  summe: 'Summe',
  maximum: 'Maximum',
  ausbaugrenze: 'Ausbaugrenze',
  aktuell: 'Aktuell',
} as const;

export interface ResourceInput {
  permanent: number;
  kauf: number;
  kaufMax: number;
  maxPlus: number;
  aktuell: number;
  besonderes: string;
}
export type Resources = Record<ResourceKey, ResourceInput>;

// Bio (Heldenbrief Kopf)
export interface Bio {
  alterGeburtstag: string;
  geschlecht: string;
  groesse: string;
  gewicht: string;
  augenfarbe: string;
  haarfarbe: string;
  hautfarbe: string;
  familienstand: string;
  anrede: string;
  rasse: string;
  rasseMod: string;
  kultur: string;
  kulturMod: string;
  profession: string;
  zweitprofession: string;
  gottheit: string;
  goettergeschenke: string;
}

// Meta (Stufe, AP, Karma, Geld, Psyche, Ruf)
export interface Meta {
  stufe: number;
  ap: number;
  apNextLevel: number;
  apGuthaben: number;
  karma: number;
  karmaGuthaben: number;
  ruf: number;
  psycheAkt: number;
  // Rassengrundwert der Psyche: manuell vom Spieler gepflegt (bis es einen
  // Rassen-Katalog gibt, der ihn liefert — siehe TODO). Zusammen mit einem
  // optionalen Bonus und der MU-Komponente bildet er das Psyche-Maximum.
  psycheBase: number;
  psycheBonus: number;
  // psycheMax ist NICHT mehr die Quelle der Wahrheit — das Maximum wird über
  // psycheMax() aus Rassengrundwert + Bonus + MU-Anteil berechnet. Die Spalte
  // bleibt (Altbestand), wird aber nicht mehr gelesen.
  psycheMax: number;
  geldD: number;
  geldS: number;
  geldH: number;
  geldK: number;
  bank: number;
  // Zusatz auf die berechnete maximale Traglast (kg). Additiv, kann negativ sein
  // (z. B. Vor-/Nachteile). Die Formel bleibt sichtbar; dies erhöht nur das Maximum.
  traglastBonus: number;
}

// Talente
export type TalentKategorie = 'kampf' | 'koerper' | 'gesellschaft' | 'natur' | 'wissen' | 'handwerk' | 'gaben';
export const TALENT_KATEGORIE_LABELS: Record<TalentKategorie, string> = {
  kampf: 'Kampftalente',
  koerper: 'Körperliche Talente',
  gesellschaft: 'Gesellschaftliche Talente',
  natur: 'Natur-Talente',
  wissen: 'Wissenstalente',
  handwerk: 'Handwerkstalente',
  gaben: 'Gaben',
};

export interface TalentCatalogEntry {
  id: number;
  kategorie: TalentKategorie;
  gruppe: string; // z.B. "Hiebwaffen" bei Kampftalenten, sonst ''
  name: string;
  probe: [AttrCode, AttrCode, AttrCode] | null; // null bei Kampftalenten
  ableiten: string; // "Verwandte Fertigkeiten (+5)" bzw. "Ableiten (+10)"
  skill100: string; // freigeschaltete Meisterschaft ab 100 TaW
  sort: number;
}

export interface CharTalent {
  talentId: number;
  taw: number;
  // Nur Kampftalente: Aufteilung des TaW auf AT/PA/BL
  at: number;
  pa: number;
  bl: number;
  spezialisierung: string;
  waffenmeister: string;
  berufsbonus: string;
}

// Sprachen & Schriften
export type SpracheKind = 'sprache' | 'schrift';
export interface LanguageCatalogEntry {
  id: number;
  kind: SpracheKind;
  familie: string;
  name: string;
  komplexitaet: string;
  sort: number;
}
export interface CharLanguage {
  languageId: number;
  taw: number;
  muttersprache: boolean;
}

// Charakter / Verwaltung
export interface UserInfo {
  id: number;
  username: string;
  displayName: string;
  isGm: boolean;
  // Nur im Entwicklungs-/Opt-in-Modus gesetzt: erlaubt dem Spielleiter die
  // „Ansehen als"-Vorschau von Charakteren aus Sicht anderer Nutzer.
  devViewAs?: boolean;
}

export interface GroupInfo {
  id: number;
  name: string;
  memberIds: number[];
}

export interface CharacterInfo {
  id: number;
  name: string;
  ownerUserId: number;
  groupId: number;
}

// Sichtbarkeits-Sektionen des berechneten Kerns (Bio ist immer sichtbar).
// Generische Sektionen tragen ihre Sichtbarkeit selbst (DynSection.visible).
export const VISIBILITY_SECTIONS = ['attribute', 'basiswerte', 'ressourcen', 'talente', 'waffen', 'sprachen'] as const;
export type VisibilitySection = (typeof VISIBILITY_SECTIONS)[number];

export const VISIBILITY_LABELS: Record<VisibilitySection, string> = {
  attribute: 'Attribute',
  basiswerte: 'Basiswerte',
  ressourcen: 'Energien',
  talente: 'Talente',
  waffen: 'Waffen',
  sprachen: 'Sprachen',
};
