// Shared wiki types and limits.
//
// The limits live here rather than at the call sites because both ends need
// them: the client disables its save button on them, the server rejects on
// them. One source, no drift.

/**
 * What a log row records. A row with `text` is a content version; a row without
 * one is a metadata event (renamed, deleted, visibility changed) and carries
 * feld/altWert/neuWert instead.
 */
export type WikiArt =
  | 'angelegt'
  | 'bearbeitet'
  | 'umbenannt'
  | 'geloescht'
  | 'wiederhergestellt'
  | 'sichtbarkeit'
  | 'geschuetzt';

export const WIKI_ARTEN: WikiArt[] = [
  'angelegt',
  'bearbeitet',
  'umbenannt',
  'geloescht',
  'wiederhergestellt',
  'sichtbarkeit',
  'geschuetzt',
];

export const WIKI_LIMITS = {
  TITEL_MAX: 120,
  /** Hard cap on a page body. Also the parser's guard against pathological input. */
  TEXT_MAX: 100_000,
  ZEILEN_MAX: 5_000,
  KOMMENTAR_MAX: 200,
  TAGS_MAX: 12,
  TAG_MAX: 30,
  /** Search terms beyond this are dropped rather than widening the query. */
  SUCHE_TERME_MAX: 8,
  /** Plain-text characters kept as a page teaser in the list view. */
  AUSZUG_MAX: 180,
} as const;

/** One row of the page list. Deliberately without the body. */
export interface WikiSeiteInfo {
  slug: string;
  titel: string;
  auszug: string;
  gmOnly: boolean;
  geschuetzt: boolean;
  geaendertAm: string;
  autorName: string;
  tags: string[];
}

/** A page as the read view needs it. */
export interface WikiSeiteVoll extends WikiSeiteInfo {
  /**
   * Markup source. For a reader without GM rights the ```gm regions have
   * already been removed server-side — they are never sent and then hidden.
   */
  text: string;
  revisionId: number;
  nr: number;
  darfBearbeiten: boolean;
  /**
   * Every [[target]] this page links to, mapped to the target's title or null
   * when it does not exist (or is invisible to this reader) — that is what
   * turns a link red. One round trip instead of one lookup per link.
   */
  linkZiele: Record<string, string | null>;
}

/** One entry of the per-page history and of the wiki-wide change log. */
export interface WikiLogEintrag {
  id: number;
  slug: string;
  /** The title AS IT WAS, so the log does not start lying after a rename. */
  titel: string;
  nr: number;
  art: WikiArt;
  autorName: string;
  erstelltAm: string;
  kommentar: string;
  zeilenPlus: number;
  zeilenMinus: number;
  /**
   * Whether this row carries a content version. Only such a row can be compared
   * or restored — a rename has nothing to diff against.
   */
  hatText: boolean;
  /** Metadata events only. */
  feld?: string;
  altWert?: string;
  neuWert?: string;
}
