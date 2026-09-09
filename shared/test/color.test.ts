import { describe, expect, it } from 'vitest';
import { clamp, hexToRgb, hslToRgb, hsvToRgb, rgbToHex, rgbToHsl, rgbToHsv } from '../src/color.js';

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe('hexToRgb', () => {
  it('parses a 6-digit hex', () => {
    expect(hexToRgb('#1e6edc')).toEqual({ r: 30, g: 110, b: 220 });
  });

  it('parses without the leading #', () => {
    expect(hexToRgb('1e6edc')).toEqual({ r: 30, g: 110, b: 220 });
  });

  it('expands a 3-digit shorthand', () => {
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#1E6EDC')).toEqual({ r: 30, g: 110, b: 220 });
  });

  it('returns null for invalid input', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#12')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('round-trips with hexToRgb', () => {
    expect(rgbToHex({ r: 30, g: 110, b: 220 })).toBe('#1e6edc');
  });

  it('clamps and rounds out-of-range channels', () => {
    expect(rgbToHex({ r: -10, g: 128.6, b: 999 })).toBe('#0081ff');
  });
});

describe('rgbToHsv / hsvToRgb', () => {
  it('pure red', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
  });

  it('pure green', () => {
    const hsv = rgbToHsv({ r: 0, g: 255, b: 0 });
    expect(hsv.h).toBeCloseTo(120);
    expect(hsv.s).toBeCloseTo(100);
    expect(hsv.v).toBeCloseTo(100);
  });

  it('pure blue', () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 255 });
    expect(hsv.h).toBeCloseTo(240);
  });

  it('white has no saturation', () => {
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 100 });
  });

  it('black has no value', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
  });

  it('round-trips an arbitrary colour', () => {
    const rgb = { r: 30, g: 110, b: 220 };
    const back = hsvToRgb(rgbToHsv(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 5);
    expect(back.g).toBeCloseTo(rgb.g, 5);
    expect(back.b).toBeCloseTo(rgb.b, 5);
  });
});

describe('rgbToHsl / hslToRgb', () => {
  it('pure red', () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(hsl.h).toBeCloseTo(0);
    expect(hsl.s).toBeCloseTo(100);
    expect(hsl.l).toBeCloseTo(50);
  });

  it('grey has no saturation', () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBeCloseTo(0);
  });

  it('round-trips an arbitrary colour', () => {
    const rgb = { r: 30, g: 110, b: 220 };
    const back = hslToRgb(rgbToHsl(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 5);
    expect(back.g).toBeCloseTo(rgb.g, 5);
    expect(back.b).toBeCloseTo(rgb.b, 5);
  });
});
