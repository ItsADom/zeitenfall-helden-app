// Colour helpers for the cinematic — and, just as importantly, the ONE part of
// it the overlay may import statically.
//
// This file must never import three, directly or transitively. It exists
// because it once did, by accident: `tinteFuer` originally lived in faces.ts,
// the overlay imported it to work out an ink colour, and that single static
// import pulled faces.ts -> geometry.ts -> three into the main bundle. Nothing
// failed; the chunk simply grew from 203 to 346 KB gzipped and the lazy loading
// quietly stopped meaning anything.
//
// So: anything the overlay needs before the stage is loaded belongs HERE, and
// anything that touches three belongs behind the dynamic import.

/**
 * Resolves ANY colour the browser understands — rgb(), hex, color-mix(), a
 * custom property already resolved by getComputedStyle — to plain channels.
 *
 * Done by painting it rather than by parsing: the app's tokens include
 * color-mix() values, and a hand-written parser would be a second, worse
 * implementation of CSS colour that fails silently on the next token added.
 */
export function kanaele(farbe: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [128, 128, 128];
  ctx.fillStyle = '#808080';
  ctx.fillStyle = farbe; // ignored if the browser cannot parse it, leaving grey
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Relative luminance, per the WCAG definition. */
function leuchtdichte(farbe: string): number {
  const [r, g, b] = kanaele(farbe);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two colours, 1:1 … 21:1. */
export function kontrast(a: string, b: string): number {
  const [hoch, tief] = [leuchtdichte(a), leuchtdichte(b)].sort((p, q) => q - p);
  return (hoch + 0.05) / (tief + 0.05);
}

/**
 * The more readable of two inks on `hintergrund`.
 *
 * Decided by MEASURING both, not by a luminance threshold. A threshold looks
 * equivalent and is not: it has to guess where "light" begins, and every guess
 * is wrong for some pigment. At 0.45 the dark-mode pastels — a #b9a7db d10, for
 * instance — sat just under the line and were given light ink, at 1.97:1.
 * Comparing the two candidates cannot be wrong that way, and it needs no
 * constant to keep tuned.
 *
 * Six colour worlds × light/dark × six die pigments is seventy-two
 * combinations; nobody is going to audit those by eye.
 */
export function tinteFuer(hintergrund: string, hell: string, dunkel: string): string {
  return kontrast(hintergrund, hell) >= kontrast(hintergrund, dunkel) ? hell : dunkel;
}
