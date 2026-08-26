// Token status catalogues for the virtual table. Frozen lists, not logic —
// see "Statuses vs covers" in docs/concepts/virtual-table.md.

export interface BoardStatus {
  key: string;
  label: string;
  emoji: string;
}

/**
 * Corner badges — several at once, small. Stored as an array of keys, never
 * the emoji itself, so the rendering can change (e.g. to artwork) without
 * rewriting stored data.
 */
export const BOARD_STATUSES: BoardStatus[] = [
  { key: 'vergiftet', label: 'Vergiftet', emoji: '🤢' },
  { key: 'betaeubt', label: 'Betäubt', emoji: '💫' },
  { key: 'liegend', label: 'Liegend', emoji: '⬇️' },
  { key: 'brennend', label: 'Brennend', emoji: '🔥' },
  { key: 'blind', label: 'Blind', emoji: '🙈' },
  { key: 'stumm', label: 'Stumm', emoji: '🤐' },
  { key: 'gelaehmt', label: 'Gelähmt', emoji: '🥶' },
  { key: 'gesegnet', label: 'Gesegnet', emoji: '✨' },
  { key: 'unsichtbar', label: 'Unsichtbar', emoji: '👻' },
];

export interface BoardCover {
  key: string;
  label: string;
}

/**
 * At most one at a time, drawn over the whole token (dead, unconscious) —
 * a different kind of thing than a status badge, not a bigger version of one.
 */
export const BOARD_COVERS: BoardCover[] = [
  { key: 'tot', label: 'Tot' },
  { key: 'bewusstlos', label: 'Bewusstlos' },
];

export const BOARD_STATUS_BY_KEY: Record<string, BoardStatus> = Object.fromEntries(
  BOARD_STATUSES.map((s) => [s.key, s]),
);
export const BOARD_COVER_BY_KEY: Record<string, BoardCover> = Object.fromEntries(
  BOARD_COVERS.map((c) => [c.key, c]),
);
