import { describe, expect, it } from 'vitest';
import { CHIMES, CHIME_STANDARD, alsTonWahl, istChimeId, istWavKopf } from '../src/chimes.js';

/** Ein RIFF-Container mit frei wählbarer Formkennung an Position 8. */
const riff = (art: string, laenge = 44): Uint8Array => {
  const b = new Uint8Array(laenge);
  const schreibe = (von: number, text: string) => {
    for (let i = 0; i < text.length; i++) b[von + i] = text.charCodeAt(i);
  };
  schreibe(0, 'RIFF');
  schreibe(8, art);
  return b;
};

describe('istWavKopf', () => {
  it('accepts a WAV header', () => {
    expect(istWavKopf(riff('WAVE'))).toBe(true);
  });

  // Der eigentliche Punkt dieses Tests: WebP fängt genauso mit `RIFF` an. Wer
  // nur die ersten vier Bytes prüft, nimmt ein Bild als Klang entgegen.
  it('rejects a WebP, which also starts with RIFF', () => {
    expect(istWavKopf(riff('WEBP'))).toBe(false);
  });

  it('rejects anything that is not RIFF at all', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(istWavKopf(png)).toBe(false);
  });

  it('rejects a buffer too short to carry the form type', () => {
    expect(istWavKopf(riff('WAVE', 11))).toBe(false);
    expect(istWavKopf(new Uint8Array(0))).toBe(false);
  });
});

describe('istChimeId', () => {
  it('accepts every built-in id', () => {
    for (const c of CHIMES) expect(istChimeId(c.id)).toBe(true);
  });

  it('rejects the picker values that are not chimes', () => {
    expect(istChimeId('aus')).toBe(false);
    expect(istChimeId('eigen')).toBe(false);
    expect(istChimeId('')).toBe(false);
  });
});

describe('CHIMES', () => {
  it('has unique ids and labels', () => {
    expect(new Set(CHIMES.map((c) => c.id)).size).toBe(CHIMES.length);
    expect(new Set(CHIMES.map((c) => c.label)).size).toBe(CHIMES.length);
  });

  it('contains the default', () => {
    expect(istChimeId(CHIME_STANDARD)).toBe(true);
  });
});

describe('alsTonWahl', () => {
  it('keeps a valid stored choice', () => {
    expect(alsTonWahl('aus', false)).toBe('aus');
    expect(alsTonWahl('holzgong', false)).toBe('holzgong');
  });

  // „eigen" bleibt in localStorage stehen, auch wenn der eigene Klang inzwischen
  // gelöscht wurde — sonst wäre der Ton stumm, ohne dass es jemand ansieht.
  it('falls back when the custom sound is gone', () => {
    expect(alsTonWahl('eigen', true)).toBe('eigen');
    expect(alsTonWahl('eigen', false)).toBe(CHIME_STANDARD);
  });

  it('falls back for junk', () => {
    expect(alsTonWahl('gibtsnicht', true)).toBe(CHIME_STANDARD);
    expect(alsTonWahl(null, true)).toBe(CHIME_STANDARD);
    expect(alsTonWahl(42, true)).toBe(CHIME_STANDARD);
  });
});
