// The numbers on the dice, drawn at runtime.
//
// No image asset ships, for the same reasons Die.tsx gives for its inline SVG
// and chimes.ts for its synthesized sounds: a texture describable in code costs
// no bytes in the build, needs no cache-busting on a home server and raises no
// licensing question.
//
// One canvas per die type, laid out as a grid of cells; face k is drawn into
// cell k and the geometry's UVs address it (see geometry.ts).
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { atlasRaster, type Solid } from './geometry';
import { tinteFuer } from './kontrast';

// Re-exported so the stage keeps one import site; the implementation lives in
// kontrast.ts precisely so the overlay can reach it WITHOUT pulling in three.
export { tinteFuer };

/** Pixels per cell. A d20 atlas is therefore 5×4 cells = 640×512. */
const ZELLE = 128;

export interface AtlasWunsch {
  sides: number;
  flaechen: number;
  /** One label per face, in face order. */
  beschriftung: string[];
  koerper: string;
  tinte: string;
}

const zwischenspeicher = new Map<string, Texture>();

function schluessel(w: AtlasWunsch): string {
  return `${w.sides}|${w.flaechen}|${w.koerper}|${w.tinte}|${w.beschriftung.join(',')}`;
}

/**
 * The texture for one die type in one colour.
 *
 * Cached at module scope and never disposed: the set of (die type × theme ×
 * colour) actually used in a session is small, and rebuilding an atlas per roll
 * would be visible work for no gain. A theme switch simply adds entries.
 */
export function atlasFuer(wunsch: AtlasWunsch): Texture {
  const key = schluessel(wunsch);
  const vorhanden = zwischenspeicher.get(key);
  if (vorhanden) return vorhanden;

  const { spalten, zeilen } = atlasRaster(wunsch.flaechen);
  const cv = document.createElement('canvas');
  cv.width = spalten * ZELLE;
  cv.height = zeilen * ZELLE;
  const ctx = cv.getContext('2d');

  if (ctx) {
    ctx.fillStyle = wunsch.koerper;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = wunsch.tinte;
    ctx.strokeStyle = wunsch.tinte;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The app's own serif — the same register the headings and the wordmark use.
    ctx.font = `600 ${Math.round(ZELLE * 0.44)}px Georgia, 'Times New Roman', serif`;

    for (let k = 0; k < wunsch.flaechen; k++) {
      const text = wunsch.beschriftung[k] ?? '';
      const x = (k % spalten) * ZELLE + ZELLE / 2;
      const y = Math.floor(k / spalten) * ZELLE + ZELLE / 2;
      ctx.fillText(text, x, y);
      // 6 and 9 are the one genuinely ambiguous pair, and only on dice that
      // carry both. A rule every real dice set follows.
      if ((text === '6' || text === '9') && wunsch.flaechen >= 9) {
        const breite = ctx.measureText(text).width;
        ctx.lineWidth = Math.max(2, ZELLE * 0.035);
        ctx.beginPath();
        ctx.moveTo(x - breite * 0.42, y + ZELLE * 0.26);
        ctx.lineTo(x + breite * 0.42, y + ZELLE * 0.26);
        ctx.stroke();
      }
    }
  }

  const textur = new CanvasTexture(cv);
  textur.colorSpace = SRGBColorSpace;
  textur.anisotropy = 4;
  zwischenspeicher.set(key, textur);
  return textur;
}

/**
 * What is printed on each face, in face order.
 *
 * Straight from the solid's own numbering, which pairs opposite faces to sum to
 * sides + 1 — NOT k+1, which is the order the faces happen to be stored in. A
 * die outside the six real shapes is a box carrying the rolled value on every
 * face; it is a prop, and it says so by having no other numbers at all.
 */
export function beschriftungFuer(solid: Solid, sides: number, value: number): string[] {
  if (solid.faceNumbers.length !== sides) return solid.faceNumbers.map(() => String(value));
  return solid.faceNumbers.map((n) => String(n));
}
