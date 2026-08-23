// Die fünf eingebauten Benachrichtigungsklänge — im Browser erzeugt, nicht
// mitgeliefert.
//
// Warum synthetisiert: bis hierhin hat die App nie eine Tondatei ausgeliefert.
// Ein Glockenklang ist ohnehin nichts anderes als eine Handvoll unharmonischer
// Teiltöne mit exponentiellem Abfall — das lässt sich hier in einer Tabelle
// beschreiben, kostet kein Byte im Build und wirft keine Lizenzfrage auf.
//
// Die Tabelle ist zugleich die Naht, an der sich das später austauschen lässt:
// Wer echte Aufnahmen möchte, gibt einem Eintrag eine Datei statt eines
// Rezepts; nur `baueRezept` unten muss sich dann verzweigen. Deshalb stehen Ids
// und Beschriftungen in shared/src/chimes.ts und nicht hier — die Auswahl kennt
// nur Namen, nie die Machart.
import { CHIME_SAMPLE_RATE, type ChimeId } from '@shared/chimes';
import { audioKontext } from './audioContext';
import { normalisiere } from './wavEncode';

interface Teilton {
  /** Vielfaches des Grundtons. Krumme Werte sind Absicht: Glocken klingen unharmonisch. */
  verhaeltnis: number;
  pegel: number;
  /** Sekunden bis auf ein Tausendstel abgeklungen. */
  abfall: number;
}

interface Anschlag {
  pegel: number;
  abfall: number;
  /** Bandmitte des Rauschfilters in Hz. */
  mitte: number;
  guete: number;
}

interface Rezept {
  grundton: number;
  teiltoene: Teilton[];
  dauer: number;
  /** Ein zweiter Schlag, höher — macht aus einem Ton einen Zweiklang. */
  zweiter?: { verzoegerung: number; faktor: number; pegel: number };
  /** Geräuschanteil des Anschlags: das Holzige bzw. der Klöppel auf der Glocke. */
  anschlag?: Anschlag;
}

// Bewusst fünf verschiedene FAMILIEN, nicht fünf Glocken in fünf Tonhöhen:
// tief/lang, hoch/kurz, gläsern, trocken, steigend.
const REZEPTE: Record<ChimeId, Rezept> = {
  // Tiefe Bronzeglocke. Die Verhältnisse folgen dem klassischen Glockenaufbau
  // (Summton, Prim, kleine Terz, Quinte, Oktav-Nominale) — daher der volle,
  // leicht schwebende Klang statt eines reinen Sinus.
  tempelglocke: {
    grundton: 220,
    dauer: 2.9,
    teiltoene: [
      { verhaeltnis: 0.5, pegel: 0.55, abfall: 2.7 },
      { verhaeltnis: 1.0, pegel: 1.0, abfall: 2.2 },
      { verhaeltnis: 1.19, pegel: 0.5, abfall: 1.6 },
      { verhaeltnis: 1.5, pegel: 0.33, abfall: 1.3 },
      { verhaeltnis: 2.0, pegel: 0.5, abfall: 1.1 },
      { verhaeltnis: 2.51, pegel: 0.2, abfall: 0.8 },
      { verhaeltnis: 3.0, pegel: 0.14, abfall: 0.55 },
      { verhaeltnis: 4.21, pegel: 0.09, abfall: 0.35 },
    ],
    anschlag: { pegel: 0.22, abfall: 0.05, mitte: 2600, guete: 1.2 },
  },
  // Hell und schnell vorbei — das Gegenstück zur Tempelglocke.
  silberglocke: {
    grundton: 1568,
    dauer: 0.8,
    teiltoene: [
      { verhaeltnis: 1.0, pegel: 1.0, abfall: 0.5 },
      { verhaeltnis: 2.76, pegel: 0.28, abfall: 0.3 },
      { verhaeltnis: 5.4, pegel: 0.1, abfall: 0.16 },
    ],
    anschlag: { pegel: 0.15, abfall: 0.02, mitte: 5200, guete: 1.5 },
  },
  // Gläsern: fast reine Sinus, kaum Anschlag, dazu eine Quinte kurz danach.
  kristall: {
    grundton: 1046.5,
    dauer: 1.5,
    teiltoene: [
      { verhaeltnis: 1.0, pegel: 1.0, abfall: 1.0 },
      { verhaeltnis: 2.0, pegel: 0.22, abfall: 0.65 },
      { verhaeltnis: 3.01, pegel: 0.07, abfall: 0.4 },
    ],
    zweiter: { verzoegerung: 0.12, faktor: 1.5, pegel: 0.8 },
  },
  // Trockener Klopfer: fast nur gefiltertes Rauschen, ein kurzer tiefer Rest
  // Tonhöhe darunter. Kein Nachklang — das ist der Punkt.
  holzgong: {
    grundton: 320,
    dauer: 0.32,
    teiltoene: [
      { verhaeltnis: 1.0, pegel: 0.5, abfall: 0.09 },
      { verhaeltnis: 2.4, pegel: 0.2, abfall: 0.05 },
    ],
    anschlag: { pegel: 1.0, abfall: 0.045, mitte: 900, guete: 3.5 },
  },
  // Steigender Zweiklang mit harmonischer Kante (ganzzahlige Teiltöne, anders
  // als bei den Glocken oben) — klingt nach Signal, nicht nach Geläut.
  fanfare: {
    grundton: 587.33,
    dauer: 1.1,
    teiltoene: [
      { verhaeltnis: 1.0, pegel: 1.0, abfall: 0.55 },
      { verhaeltnis: 2.0, pegel: 0.38, abfall: 0.4 },
      { verhaeltnis: 3.0, pegel: 0.16, abfall: 0.28 },
      { verhaeltnis: 4.0, pegel: 0.07, abfall: 0.2 },
    ],
    zweiter: { verzoegerung: 0.17, faktor: 1.5, pegel: 0.95 },
  },
};

/** Weißes Rauschen als Puffer — Vorlage für den Anschlag. */
function rauschPuffer(ctx: BaseAudioContext, sekunden: number): AudioBuffer {
  const puffer = ctx.createBuffer(1, Math.max(1, Math.ceil(sekunden * ctx.sampleRate)), ctx.sampleRate);
  const kanal = puffer.getChannelData(0);
  for (let i = 0; i < kanal.length; i++) kanal[i] = Math.random() * 2 - 1;
  return puffer;
}

function schlage(ctx: BaseAudioContext, rezept: Rezept, ab: number, faktor: number, pegel: number): void {
  for (const t of rezept.teiltoene) {
    const osz = ctx.createOscillator();
    osz.type = 'sine';
    osz.frequency.value = rezept.grundton * t.verhaeltnis * faktor;
    const huelle = ctx.createGain();
    // setTargetAtTime fällt exponentiell wie ein ausschwingender Körper; die
    // Zeitkonstante ist ein Drittel der gewünschten Abklingzeit (rund -60 dB).
    huelle.gain.setValueAtTime(t.pegel * pegel, ab);
    huelle.gain.setTargetAtTime(0, ab, t.abfall / 3);
    osz.connect(huelle).connect(ctx.destination);
    osz.start(ab);
    osz.stop(ab + rezept.dauer);
  }
}

/** Rendert ein Rezept einmal in einen Puffer — danach ist Abspielen nur noch Kopieren. */
async function baueRezept(rezept: Rezept): Promise<AudioBuffer> {
  const rahmen = Math.ceil(rezept.dauer * CHIME_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, rahmen, CHIME_SAMPLE_RATE);

  schlage(ctx, rezept, 0, 1, 1);
  if (rezept.zweiter) {
    schlage(ctx, rezept, rezept.zweiter.verzoegerung, rezept.zweiter.faktor, rezept.zweiter.pegel);
  }

  if (rezept.anschlag) {
    const a = rezept.anschlag;
    const quelle = ctx.createBufferSource();
    quelle.buffer = rauschPuffer(ctx, a.abfall * 4);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = a.mitte;
    band.Q.value = a.guete;
    const huelle = ctx.createGain();
    huelle.gain.setValueAtTime(a.pegel, 0);
    huelle.gain.setTargetAtTime(0, 0, a.abfall / 3);
    quelle.connect(band).connect(huelle).connect(ctx.destination);
    quelle.start(0);
  }

  const fertig = await ctx.startRendering();
  // Dieselbe Normalisierung wie beim eigenen Klang (siehe wavEncode.ts): alle
  // sechs Möglichkeiten kommen dadurch auf vergleichbarer Lautstärke an.
  normalisiere(fertig.getChannelData(0));
  return fertig;
}

// Einmal gebaut, dann behalten. Das Rendern kostet nur ein paar Millisekunden,
// aber es ist auch asynchron — und eine Benachrichtigung soll nicht auf ihren
// eigenen Klang warten müssen.
const gebaut = new Map<ChimeId, AudioBuffer>();
const imBau = new Map<ChimeId, Promise<AudioBuffer>>();

export function chimePuffer(id: ChimeId): Promise<AudioBuffer> {
  const fertig = gebaut.get(id);
  if (fertig) return Promise.resolve(fertig);
  const laufend = imBau.get(id);
  if (laufend) return laufend;
  const p = baueRezept(REZEPTE[id]).then((b) => {
    gebaut.set(id, b);
    imBau.delete(id);
    return b;
  });
  imBau.set(id, p);
  return p;
}

/** Baut alle fünf im Hintergrund vor — beim Öffnen der Einstellungen sinnvoll. */
export function chimesVorbereiten(): void {
  for (const id of Object.keys(REZEPTE) as ChimeId[]) void chimePuffer(id).catch(() => {});
}

/**
 * Spielt einen fertigen Puffer.
 *
 * `lautstaerke` ist 0…1 und wird quadriert: ein linearer Regler fühlt sich
 * falsch an, weil Lautheit nicht linear an der Amplitude hängt.
 */
export function spielePuffer(puffer: AudioBuffer, lautstaerke: number): void {
  const ctx = audioKontext();
  if (!ctx) return;
  try {
    const quelle = ctx.createBufferSource();
    quelle.buffer = puffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, lautstaerke)) ** 2;
    quelle.connect(gain).connect(ctx.destination);
    quelle.start();
  } catch {
    // Ein stummer Hinweis ist kein Grund, irgendetwas anderes scheitern zu
    // lassen — Punkt und Puls am Reiter tragen die Nachricht ohnehin.
  }
}
