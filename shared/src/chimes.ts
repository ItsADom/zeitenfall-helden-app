// Notification sounds for the chat dock — the part both sides have to agree on.
//
// The five built-in chimes are SYNTHESIZED in the browser (see
// client/src/components/dice/chimes.ts), so this module carries no audio data:
// only the ids and labels the picker shows, and the limits that the upload path
// on both ends has to enforce identically.
//
// A player may upload one sound of their own instead. That file is normalized
// CLIENT-side into 16-bit PCM mono WAV before it is ever sent — the server
// therefore only stores a format we produced ourselves, and `istWavKopf` is the
// check that this actually held.

export type ChimeId = 'tempelglocke' | 'silberglocke' | 'kristall' | 'holzgong' | 'fanfare';

export interface ChimeDef {
  id: ChimeId;
  label: string;
  /** Kurzbeschreibung für die Auswahl — sagt, wonach es klingt. */
  beschreibung: string;
}

// Bewusst fünf deutlich UNTERSCHIEDLICHE Klangcharaktere, nicht fünf Glocken:
// Wer einen Ton auswählt, soll ihn am Klang wiedererkennen, nicht an seiner
// Position in der Liste.
export const CHIMES: ChimeDef[] = [
  { id: 'tempelglocke', label: 'Tempelglocke', beschreibung: 'Tiefe Bronzeglocke, langer Nachklang' },
  { id: 'silberglocke', label: 'Silberglöckchen', beschreibung: 'Hell und kurz' },
  { id: 'kristall', label: 'Kristall', beschreibung: 'Gläserner Zweiklang' },
  { id: 'holzgong', label: 'Holzgong', beschreibung: 'Trockener Klopfer, ohne Nachklang' },
  { id: 'fanfare', label: 'Fanfare', beschreibung: 'Steigender Zweiklang' },
];

/** Die Auswahl im Einstellungs-Menü: aus, einer der fünf, oder der eigene Klang. */
export type TonWahl = 'aus' | ChimeId | 'eigen';

export const CHIME_STANDARD: ChimeId = 'tempelglocke';

// --- Grenzen für den eigenen Klang ---

/** Länger wird hart abgeschnitten, nicht abgelehnt (siehe wavEncode.ts). */
export const MAX_CHIME_SEKUNDEN = 5;

export const CHIME_SAMPLE_RATE = 44_100;

/**
 * Die Obergrenze für den Upload. 5 s × 44100 Hz × 2 Byte (16 Bit) mono sind
 * ~441 KB plus Kopfdaten; 1 MB lässt Luft, ohne dass ein Versehen durchgeht.
 */
export const MAX_CHIME_BYTES = 1_000_000;

/**
 * Was der Browser überhaupt erst zu dekodieren versucht. `decodeAudioData` hält
 * eine 200-MB-Datei komplett im Speicher — das wird abgelehnt, bevor es losgeht.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * „Das sind wirklich die Bytes, die wir selbst erzeugt haben": RIFF/WAVE.
 *
 * Der Vergleich muss bis Byte 12 gehen. WebP fängt ebenfalls mit `RIFF` an und
 * unterscheidet sich erst an Position 8 (`WEBP` statt `WAVE`) — genau der Grund,
 * warum server/src/assets/masse.ts eine WAV-Datei korrekt als „kein Bild"
 * durchgehen lässt.
 */
export function istWavKopf(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const alsText = (von: number) => String.fromCharCode(bytes[von], bytes[von + 1], bytes[von + 2], bytes[von + 3]);
  return alsText(0) === 'RIFF' && alsText(8) === 'WAVE';
}

/** Beschriftung einer Auswahl — für Bestätigungstexte und die Auswahlliste. */
export function tonName(wahl: TonWahl): string {
  if (wahl === 'aus') return 'Aus';
  if (wahl === 'eigen') return 'Eigener Klang';
  return CHIMES.find((c) => c.id === wahl)?.label ?? wahl;
}

export function istChimeId(id: string): id is ChimeId {
  return CHIMES.some((c) => c.id === id);
}

/** Gültige Auswahl aus einem gespeicherten (also möglicherweise veralteten) Wert. */
export function alsTonWahl(wert: unknown, eigenerVorhanden: boolean): TonWahl {
  if (wert === 'aus') return 'aus';
  if (wert === 'eigen') return eigenerVorhanden ? 'eigen' : CHIME_STANDARD;
  return typeof wert === 'string' && istChimeId(wert) ? wert : CHIME_STANDARD;
}
