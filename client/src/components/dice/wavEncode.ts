// Eine beliebige Audiodatei in genau das Format bringen, das die App speichert:
// 16-Bit-PCM, mono, 44,1 kHz, höchstens MAX_CHIME_SEKUNDEN.
//
// Das ist dieselbe Haltung wie bei den Porträts (siehe CropEditor.tsx): NICHT
// hochladen, was der Nutzer ausgesucht hat, sondern was wir daraus gemacht
// haben. Der Server bekommt dadurch nie fremdes Binärmaterial, das er später
// als Medien-Datei wieder ausliefern müsste — er bekommt ein Format, das wir
// erzeugt haben und an seinen Kopfdaten wiedererkennen (`istWavKopf`).
//
// Die Längenbegrenzung kann ohnehin nur hier fallen: der Decoder sitzt im
// Browser, ein Server müsste dafür eine Audiobibliothek mitbringen.
import { CHIME_SAMPLE_RATE, MAX_CHIME_SEKUNDEN, MAX_UPLOAD_BYTES } from '@shared/chimes';
import { audioKontext } from './audioContext';

export interface KodierterKlang {
  wav: ArrayBuffer;
  sekunden: number;
  /** true, wenn die Vorlage länger war und abgeschnitten wurde. */
  gekuerzt: boolean;
}

/** Fehler mit einem Text, der so in der Oberfläche stehen kann. */
export class KlangFehler extends Error {}

const AUSBLENDE_SEKUNDEN = 0.02;
const EINBLENDE_SEKUNDEN = 0.002;
/** Etwas Luft unter der Vollaussteuerung — 1.0 klingt auf manchen Ausgaben hart. */
const ZIEL_SPITZE = 0.89;

/**
 * Hebt den lautesten Ausschlag auf ZIEL_SPITZE an (oder senkt ihn dorthin ab).
 *
 * Der Grund ist nicht Klangkosmetik: ohne das kann ein hochgeladener Klang
 * um ein Vielfaches lauter hereinkommen als jeder eingebaute — mitten in der
 * Sitzung, ohne Vorwarnung. Genau davor schützt das hier.
 */
export function normalisiere(samples: Float32Array): void {
  let spitze = 0;
  for (let i = 0; i < samples.length; i++) {
    const betrag = Math.abs(samples[i]);
    if (betrag > spitze) spitze = betrag;
  }
  if (spitze === 0) return;
  const faktor = ZIEL_SPITZE / spitze;
  for (let i = 0; i < samples.length; i++) samples[i] *= faktor;
}

/**
 * Kurze Rampen an beiden Enden. Ein hart abgeschnittener Klang endet mitten in
 * der Schwingung und knackt — hörbar genau dann, wenn wir selbst gekürzt haben.
 */
function blendeAus(samples: Float32Array, rate: number): void {
  const ein = Math.min(Math.floor(EINBLENDE_SEKUNDEN * rate), samples.length);
  for (let i = 0; i < ein; i++) samples[i] *= i / ein;
  const aus = Math.min(Math.floor(AUSBLENDE_SEKUNDEN * rate), samples.length);
  for (let i = 0; i < aus; i++) samples[samples.length - 1 - i] *= i / aus;
}

/** 16-Bit-PCM-WAV aus Mono-Samples — Kopfdaten von Hand, keine Bibliothek. */
export function alsWav(samples: Float32Array, rate: number): ArrayBuffer {
  const daten = new ArrayBuffer(44 + samples.length * 2);
  const sicht = new DataView(daten);
  const text = (von: number, s: string) => {
    for (let i = 0; i < s.length; i++) sicht.setUint8(von + i, s.charCodeAt(i));
  };

  text(0, 'RIFF');
  sicht.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  sicht.setUint32(16, 16, true); // Länge des fmt-Blocks
  sicht.setUint16(20, 1, true); // 1 = unkomprimiertes PCM
  sicht.setUint16(22, 1, true); // mono
  sicht.setUint32(24, rate, true);
  sicht.setUint32(28, rate * 2, true); // Bytes pro Sekunde
  sicht.setUint16(32, 2, true); // Bytes pro Rahmen
  sicht.setUint16(34, 16, true); // Bits pro Wert
  text(36, 'data');
  sicht.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const begrenzt = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetrisch, weil der Wertebereich es ist: -32768 … 32767.
    sicht.setInt16(44 + i * 2, begrenzt < 0 ? begrenzt * 0x8000 : begrenzt * 0x7fff, true);
  }
  return daten;
}

/**
 * Dekodiert die Datei, macht Mono daraus, rechnet auf CHIME_SAMPLE_RATE um und
 * schneidet auf MAX_CHIME_SEKUNDEN.
 *
 * Mischen und Umrechnen erledigt ein OfflineAudioContext mit einem Ausgabekanal
 * in einem Zug — dessen Abmisch-Regeln sind dieselben, die der Browser auch
 * beim Abspielen anwendet, und das Ergebnis ist besser als eine selbstgebaute
 * Interpolation.
 */
export async function kodiereKlang(datei: File): Promise<KodierterKlang> {
  if (datei.size > MAX_UPLOAD_BYTES) {
    // Vor dem Dekodieren: `decodeAudioData` hält die ganze Datei entpackt im
    // Speicher, eine 200-MB-Vorlage legt damit den Tab lahm.
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new KlangFehler(`Die Datei ist zu groß (höchstens ${mb} MB).`);
  }

  const kontext = audioKontext();
  if (!kontext) throw new KlangFehler('Dieser Browser kann keine Klänge verarbeiten.');

  let roh: AudioBuffer;
  try {
    roh = await kontext.decodeAudioData(await datei.arrayBuffer());
  } catch {
    throw new KlangFehler('Diese Datei konnte nicht gelesen werden — MP3, OGG, WAV oder M4A gehen.');
  }
  if (roh.length === 0) throw new KlangFehler('Die Datei enthält keinen Ton.');

  const gekuerzt = roh.duration > MAX_CHIME_SEKUNDEN;
  const sekunden = Math.min(roh.duration, MAX_CHIME_SEKUNDEN);
  const rahmen = Math.max(1, Math.round(sekunden * CHIME_SAMPLE_RATE));

  const offline = new OfflineAudioContext(1, rahmen, CHIME_SAMPLE_RATE);
  const quelle = offline.createBufferSource();
  quelle.buffer = roh;
  quelle.connect(offline.destination);
  quelle.start();
  const fertig = await offline.startRendering();

  const samples = fertig.getChannelData(0);
  normalisiere(samples);
  blendeAus(samples, CHIME_SAMPLE_RATE);

  return { wav: alsWav(samples, CHIME_SAMPLE_RATE), sekunden, gekuerzt };
}
