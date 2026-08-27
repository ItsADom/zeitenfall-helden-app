// „Welcher Klang jetzt" — die Schicht zwischen der Auswahl des Spielers und dem
// tatsächlichen Abspielen.
//
// chimes.ts weiß, wie eine Tempelglocke klingt. Dieses Modul weiß, dass gerade
// „eigen" ausgewählt ist, dass der eigene Klang noch geladen werden muss, und
// dass drei Anfragen innerhalb einer Sekunde trotzdem nur einmal läuten.
import { CHIME_SAMPLE_RATE, type TonWahl, istChimeId } from '@shared/chimes';
import { audioKontext } from './audioContext';
import { chimePuffer, spielePuffer } from './chimes';

/**
 * Eine Gruppenanfrage fächert sich in mehrere Ereignisse auf, und zwei
 * Spielleiter-Klicks kurz hintereinander sind normal. Ohne diese Sperre wird
 * daraus ein Maschinengewehr.
 */
const SPERRE_MS = 1500;
let zuletzt = 0;

// --- Eigener Klang ---
// Einmal geholt und dekodiert behalten. `null` heißt „geprüft, es gibt keinen",
// `undefined` heißt „noch nicht nachgesehen" — der Unterschied entscheidet, ob
// noch einmal geladen werden muss.
let eigener: AudioBuffer | null | undefined;
let eigenerLaeuft: Promise<AudioBuffer | null> | null = null;

async function holeEigenen(): Promise<AudioBuffer | null> {
  const ctx = audioKontext();
  if (!ctx) return null;
  try {
    const res = await fetch('/api/me/chime', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function eigenenKlangLaden(): Promise<AudioBuffer | null> {
  if (eigener !== undefined) return Promise.resolve(eigener);
  if (eigenerLaeuft) return eigenerLaeuft;
  eigenerLaeuft = holeEigenen().then((b) => {
    eigener = b;
    eigenerLaeuft = null;
    return b;
  });
  return eigenerLaeuft;
}

/** Nach Hochladen oder Löschen aufrufen — sonst spielt weiter der alte Klang. */
export function eigenenKlangVergessen(): void {
  eigener = undefined;
  eigenerLaeuft = null;
}

/**
 * Übernimmt die soeben kodierten Bytes direkt als neuen eigenen Klang, ohne den
 * Umweg über einen zweiten Abruf — beim Hochladen liegen sie ohnehin schon hier.
 */
export function eigenenKlangSetzen(wav: ArrayBuffer): void {
  const ctx = audioKontext();
  if (!ctx) return;
  // decodeAudioData übernimmt den Puffer („detached"), deshalb auf einer Kopie
  // arbeiten: der Aufrufer schickt dieselben Bytes noch zum Server.
  void ctx
    .decodeAudioData(wav.slice(0))
    .then((b) => {
      eigener = b;
    })
    .catch(() => {
      eigener = undefined;
    });
}

async function pufferFuer(wahl: TonWahl): Promise<AudioBuffer | null> {
  if (wahl === 'aus') return null;
  if (wahl === 'eigen') return eigenenKlangLaden();
  return istChimeId(wahl) ? chimePuffer(wahl) : null;
}

/** Ohne Sperre — für den Vorhören-Knopf, der auf jeden Klick antworten soll. */
export function vorhoeren(wahl: TonWahl, lautstaerke: number): void {
  void pufferFuer(wahl)
    .then((b) => {
      if (b) spielePuffer(b, lautstaerke);
    })
    .catch(() => {});
}

/**
 * Der Benachrichtigungsklang. Alles daran darf fehlschlagen, ohne dass es
 * jemanden stört: ist Ton gesperrt, nicht geladen oder abgeschaltet, trägt der
 * Puls am Chat-Reiter die Nachricht allein.
 */
export function spieleTon(wahl: TonWahl, lautstaerke: number): void {
  if (wahl === 'aus' || lautstaerke <= 0) return;
  const jetzt = Date.now();
  if (jetzt - zuletzt < SPERRE_MS) return;
  zuletzt = jetzt;
  vorhoeren(wahl, lautstaerke);
}

/** Sekunden, gerundet — für die Anzeige „eigener Klang (2,4 s)". */
export const dauerAusBytes = (bytes: number): number =>
  Math.max(0, (bytes - 44) / 2 / CHIME_SAMPLE_RATE);
