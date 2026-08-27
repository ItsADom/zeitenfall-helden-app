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

/** Ein Ton innerhalb einer Folge — dieselben Größen, die `schlage` ohnehin nimmt. */
interface Schlag {
  /** Sekunden ab Beginn. */
  ab: number;
  /** Vielfaches des Grundtons: 1 = Grundton, 1.5 = Quinte, 2 = Oktave. */
  faktor: number;
  pegel: number;
}

interface Rezept {
  grundton: number;
  teiltoene: Teilton[];
  dauer: number;
  /** Ein zweiter Schlag, höher — macht aus einem Ton einen Zweiklang. */
  zweiter?: { verzoegerung: number; faktor: number; pegel: number };
  /** Geräuschanteil des Anschlags: das Holzige bzw. der Klöppel auf der Glocke. */
  anschlag?: Anschlag;
  /**
   * Mehr als zwei Schläge: eine ganze Tonfolge statt eines Zweiklangs.
   *
   * Replaces `zweiter` without removing it — `zweiter` is exactly the short
   * form of a two-note sequence, and the five existing recipes keep using it.
   * Migrating them would be churn that risks audibly changing five sounds
   * people have already chosen.
   */
  folge?: Schlag[];
  /**
   * Anschwellzeit in Sekunden. Eine Glocke schlägt sofort an, ein Blechbläser
   * schwillt an. Ohne diesen Wert bleibt es beim harten Einsatz von bisher.
   */
  anstieg?: number;
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

/**
 * „Großer Wurf" (/i): ein heraldischer Blechbläser-Ruf, keine Glocke.
 *
 * Two things set it apart from the five notification chimes. Its partials are
 * WHOLE-NUMBER multiples and roll off slowly — that is a brass spectrum, not the
 * inharmonic clang of a bell — and it plays a real motif rather than a two-note
 * chord.
 *
 * The factors are JUSTLY tuned, not equal-tempered: 1.25 is the pure major third
 * and 1.5 the pure fifth. Against whole-number partials the equal-tempered
 * 1.2599 would audibly beat.
 *
 * Deliberately NOT a ChimeId. shared/src/chimes.ts's CHIMES array is rendered
 * directly as the notification-sound picker, and a 2.8-second brass call has no
 * business in that dropdown or in the „/mute" cycle.
 */
const WICHTIG_REZEPT: Rezept = {
  grundton: 174.61, // F3 — a horn's register, not a piccolo trumpet's
  dauer: 3.1,
  anstieg: 0.034,
  anschlag: { pegel: 0.08, abfall: 0.035, mitte: 1100, guete: 2 },
  // Weighted toward the FUNDAMENTAL, unlike the bells above. Perceived pitch
  // follows the strongest partials, not the nominal one: with the octave twice
  // as loud as the root — which is how this was first written — the call read an
  // octave higher than the notes say it is, and sounded shrill with it.
  teiltoene: [
    { verhaeltnis: 1, pegel: 1.0, abfall: 1.1 },
    { verhaeltnis: 2, pegel: 0.62, abfall: 0.95 },
    { verhaeltnis: 3, pegel: 0.34, abfall: 0.8 },
    { verhaeltnis: 4, pegel: 0.19, abfall: 0.66 },
    { verhaeltnis: 5, pegel: 0.1, abfall: 0.55 },
    { verhaeltnis: 6, pegel: 0.06, abfall: 0.46 },
    { verhaeltnis: 8, pegel: 0.03, abfall: 0.38 },
  ],
  // The same motif an octave down: the call, the third, the fifth, the arrival.
  // Doubled at the octave BELOW the arrival rather than above it, which is where
  // a brass section puts its weight.
  folge: [
    { ab: 0.0, faktor: 1.0, pegel: 0.85 }, // F3 — the call
    { ab: 0.18, faktor: 1.0, pegel: 0.8 },
    { ab: 0.36, faktor: 1.25, pegel: 0.9 }, // A3 — the third
    { ab: 0.6, faktor: 1.5, pegel: 0.95 }, // C4 — the fifth
    { ab: 0.84, faktor: 1.25, pegel: 0.75 },
    { ab: 1.02, faktor: 1.5, pegel: 0.85 },
    { ab: 1.26, faktor: 2.0, pegel: 1.0 }, // F4 — the arrival, held
    { ab: 1.26, faktor: 1.5, pegel: 0.6 }, // lower voices, for weight
    { ab: 1.26, faktor: 1.0, pegel: 0.7 },
    { ab: 1.26, faktor: 0.5, pegel: 0.5 }, // F2 — the floor under it all
  ],
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
    if (rezept.anstieg) {
      huelle.gain.setValueAtTime(0, ab);
      huelle.gain.linearRampToValueAtTime(t.pegel * pegel, ab + rezept.anstieg);
      huelle.gain.setTargetAtTime(0, ab + rezept.anstieg, t.abfall / 3);
    } else {
      huelle.gain.setValueAtTime(t.pegel * pegel, ab);
      huelle.gain.setTargetAtTime(0, ab, t.abfall / 3);
    }
    osz.connect(huelle).connect(ctx.destination);
    osz.start(ab);
    osz.stop(ab + rezept.dauer);
  }
}

/** Rendert ein Rezept einmal in einen Puffer — danach ist Abspielen nur noch Kopieren. */
async function baueRezept(rezept: Rezept): Promise<AudioBuffer> {
  const rahmen = Math.ceil(rezept.dauer * CHIME_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, rahmen, CHIME_SAMPLE_RATE);

  // `zweiter` is just a two-note `folge`, so both go through one loop.
  //
  // Known quirk, deliberately left alone: schlage() stops each oscillator at
  // `ab + rezept.dauer`, so a note starting late nominally stops past the end of
  // the buffer. OfflineAudioContext simply stops rendering there.
  const folge: Schlag[] = rezept.folge ?? [
    { ab: 0, faktor: 1, pegel: 1 },
    ...(rezept.zweiter ? [{ ab: rezept.zweiter.verzoegerung, faktor: rezept.zweiter.faktor, pegel: rezept.zweiter.pegel }] : []),
  ];
  for (const s of folge) schlage(ctx, rezept, s.ab, s.faktor, s.pegel);

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

// Same memoisation as the chimes above, but a single slot: the fanfare is not
// selectable, so it needs no id. chimesVorbereiten() iterates REZEPTE and is
// therefore untouched by it.
let wichtigGebaut: AudioBuffer | null = null;
let wichtigImBau: Promise<AudioBuffer> | null = null;

export function wichtigPuffer(): Promise<AudioBuffer> {
  if (wichtigGebaut) return Promise.resolve(wichtigGebaut);
  if (wichtigImBau) return wichtigImBau;
  wichtigImBau = baueRezept(WICHTIG_REZEPT).then((b) => {
    wichtigGebaut = b;
    wichtigImBau = null;
    return b;
  });
  return wichtigImBau;
}

/**
 * Render it ahead of time — an announcement should not wait on its own sound.
 *
 * Worth doing for EVERYONE in a room, not just whoever types „/i": players never
 * type it, and seventy oscillators over 3.1 s take tens of milliseconds to
 * render. The call is the first thing that happens and the beat everything else
 * is timed against, so a late entry would shift the whole announcement.
 */
export function wichtigVorbereiten(): void {
  void wichtigPuffer().catch(() => {});
}

/**
 * Spielt einen fertigen Puffer.
 *
 * `lautstaerke` ist 0…1 und wird quadriert: ein linearer Regler fühlt sich
 * falsch an, weil Lautheit nicht linear an der Amplitude hängt.
 */
export function spielePuffer(puffer: AudioBuffer, lautstaerke: number): AudioBufferSourceNode | null {
  const ctx = audioKontext();
  if (!ctx) return null;
  try {
    const quelle = ctx.createBufferSource();
    quelle.buffer = puffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, lautstaerke)) ** 2;
    quelle.connect(gain).connect(ctx.destination);
    quelle.start();
    // Returned so a skipped cinematic can cut its fanfare short. Every existing
    // caller ignores it.
    return quelle;
  } catch {
    // Ein stummer Hinweis ist kein Grund, irgendetwas anderes scheitern zu
    // lassen — Punkt und Puls am Reiter tragen die Nachricht ohnehin.
    return null;
  }
}
