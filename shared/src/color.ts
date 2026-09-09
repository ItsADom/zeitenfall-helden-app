// Reine Farbraum-Konvertierungen für den custom ColorPicker
// (client/src/components/ColorPicker.tsx) — HSV ist dort der eine
// Wahrheits-Stand für Sättigung/Hellwert-Quadrat und Farbton-Regler, RGB/HSL/
// Hex werden für die drei Anzeige-Modi jeweils daraus abgeleitet bzw. beim
// Eintippen wieder dorthin zurückgerechnet.

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Akzeptiert #rgb und #rrggbb (mit oder ohne #) — grosszügig beim Parsen,
// weil ein Nutzer hier frei tippt (Hex-Feld) statt nur einen vorher gültigen
// Wert zu übernehmen. null bei ungültiger Eingabe, statt eine Rateleistung
// zu erzwingen.
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbHueChroma({ r, g, b }: RGB): { h: number; max: number; min: number; d: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, max, min, d };
}

function hueToRgb1(h: number, c: number, x: number): RGB {
  const hp = (((h % 360) + 360) % 360) / 60;
  if (hp < 1) return { r: c, g: x, b: 0 };
  if (hp < 2) return { r: x, g: c, b: 0 };
  if (hp < 3) return { r: 0, g: c, b: x };
  if (hp < 4) return { r: 0, g: x, b: c };
  if (hp < 5) return { r: x, g: 0, b: c };
  return { r: c, g: 0, b: x };
}

export function rgbToHsv(rgb: RGB): HSV {
  const { h, max, d } = rgbHueChroma(rgb);
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const { r, g, b } = hueToRgb1(h, c, x);
  const m = vn - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsl(rgb: RGB): HSL {
  const { h, max, min, d } = rgbHueChroma(rgb);
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const { r, g, b } = hueToRgb1(h, c, x);
  const m = ln - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
