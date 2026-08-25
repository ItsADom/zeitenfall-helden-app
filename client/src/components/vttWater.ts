// Generated water textures for the virtual table (Phase 6). Ported from the
// reviewed prototype (docs/concepts/virtual-table-mockup/Texturen.html) — see
// "Water is deliberately generated, not photographed" in docs/concepts/
// virtual-table.md: the CC0 libraries have no usable top-down water surface,
// and a photograph of still water tiles visibly badly on a featureless
// surface. The generated ripple is seamless by construction and costs no
// file. Generated once per session (256×256 canvas, cheap) and cached.

const SIZE = 256;
const TAU = Math.PI * 2;

function rng(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lattices = new Map<string, Float32Array>();
function lattice(period: number, seed: number): Float32Array {
  const k = period + ':' + seed;
  let g = lattices.get(k);
  if (!g) {
    g = new Float32Array(period * period);
    const r = rng(seed * 2654435761 + period * 40503);
    for (let i = 0; i < g.length; i++) g[i] = r();
    lattices.set(k, g);
  }
  return g;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function noise2(g: Float32Array, p: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (a: number, b: number) => g[(((b % p) + p) % p) * p + (((a % p) + p) % p)];
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const u = smooth(fx);
  const v = smooth(fy);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(size: number, period: number, octaves: number, seed: number): (x: number, y: number) => number {
  const gs: [number, Float32Array][] = [];
  for (let o = 0; o < octaves; o++) gs.push([period << o, lattice(period << o, seed + o * 77)]);
  return (x, y) => {
    let s = 0;
    let amp = 1;
    let tot = 0;
    for (const [p, g] of gs) {
      s += amp * noise2(g, p, (x / size) * p, (y / size) * p);
      tot += amp;
      amp *= 0.5;
    }
    return s / tot;
  };
}

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (c1: number[], c2: number[], t: number): number[] => {
  t = clamp(t);
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
};

function paint(fn: (x: number, y: number) => number[]): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      const col = fn(x, y);
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const WATER_SEED = 7;

function genTief(): string {
  const n = fbm(SIZE, 6, 4, WATER_SEED);
  const m = fbm(SIZE, 3, 2, WATER_SEED + 9);
  return paint((x, y) => {
    const w = Math.sin((x / SIZE) * TAU * 3 + m(x, y) * 5) * 0.5 + 0.5;
    return mix([18, 42, 74], [40, 82, 124], n(x, y) * 0.7 + w * 0.3);
  });
}

function genSeicht(): string {
  const n = fbm(SIZE, 8, 4, WATER_SEED);
  const m = fbm(SIZE, 4, 2, WATER_SEED + 5);
  return paint((x, y) => {
    const w = Math.sin((y / SIZE) * TAU * 4 + m(x, y) * 6) * 0.5 + 0.5;
    return mix([58, 116, 140], [122, 176, 186], n(x, y) * 0.6 + w * 0.4);
  });
}

const cache = new Map<string, string>();

/** Data-URI PNG for a generated water material key, computed once and cached. */
export function generatedWaterTexture(key: 'wasser-tief' | 'wasser-seicht'): string {
  let uri = cache.get(key);
  if (!uri) {
    uri = key === 'wasser-tief' ? genTief() : genSeicht();
    cache.set(key, uri);
  }
  return uri;
}
