// The solids a „großer Wurf" throws, and — the actual work — recovering which
// triangles make up which FACE, so a number can be put on each one.
//
// three's polyhedra are non-indexed triangle soups: a dodecahedron arrives as 36
// triangles with no notion that every three of them are one pentagon. Faces are
// therefore recovered by grouping triangles whose flat normals agree.
//
// GROUPING IS ANGULAR, NOT BY ROUNDED KEY. Rounding each normal to a fixed
// number of decimals and using that as a map key looks equivalent and is not:
// components that land on a rounding boundary fall into different buckets, which
// silently yields 17 faces for a dodecahedron instead of 12. Clustering on the
// dot product has no boundary to straddle, and the margin is enormous — the
// closest DISTINCT faces of any of these solids are 63° apart (dot 0.4472),
// against a 0.999 threshold.
import {
  BoxGeometry,
  BufferGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Vec3 } from '@shared/diceCinematic';

/** Two triangles belong to the same face above this dot product. */
const GLEICHE_FLAECHE = 0.999;

export interface Solid {
  /** Positions and UVs; UVs address the atlas cell of each face. */
  geometry: BufferGeometry;
  /** Outward unit normal per face, in the deterministic face order. */
  faceNormals: Vec3[];
  /**
   * Which way is UP on each face's printed number — the in-plane axis the atlas
   * cell's own vertical maps to.
   *
   * Exported because it is not recoverable from the outside: the UV basis below
   * is chosen per face and lands wherever it lands. Without it the stage can aim
   * a face at the viewer but has no idea whether the number on it is the right
   * way round, and on a d20 an upside-down 6 with its underline above it is
   * precisely a 9.
   */
  faceUps: Vec3[];
}

/**
 * A pentagonal trapezohedron — the d10 shape, which three does not ship.
 *
 * Its ten kite faces are PLANAR only at one ratio of band height to apex height.
 * With the half-step α = π/5, ring radius r, band at ±b and apexes at ±h, the
 * plane through an apex and the two near ring vertices has normal
 * (b−h, −r·cos α, 0); requiring the far ring vertex (r, −b, 0) to lie in it gives
 *
 *     (b − h) + cos(α)·(b + h) = 0   ⇒   b = h · (1 − cos α) / (1 + cos α)
 *
 * — independent of the radius. Get this ratio wrong and every kite folds into
 * two non-coplanar triangles, which shows up as twenty faces instead of ten.
 *
 * The winding matters just as much: wound the other way the upper kites' normals
 * point INWARD, and because a trapezohedron's faces come in antipodal pairs each
 * inward normal then coincides exactly with the outward normal of the face
 * opposite it — ten faces collapse into five. Both mistakes were made on the way
 * here; the face-count check below is what catches them.
 */
function trapezoeder10(hoehe = 1.2, radius = 1): BufferGeometry {
  const ALPHA = Math.PI / 5;
  const band = hoehe * ((1 - Math.cos(ALPHA)) / (1 + Math.cos(ALPHA)));
  const ring = (y: number, versatz: number): Vector3[] =>
    Array.from({ length: 5 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 5 + versatz;
      return new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
    });

  const oben = new Vector3(0, hoehe, 0);
  const unten = new Vector3(0, -hoehe, 0);
  const hoch = ring(band, ALPHA);
  const tief = ring(-band, 0);

  const ecken: Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    const k = (i + 2) % 5;
    ecken.push(oben, hoch[j], tief[j], oben, tief[j], hoch[i]);
    ecken.push(unten, tief[j], hoch[j], unten, hoch[j], tief[k]);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(ecken.flatMap((v) => [v.x, v.y, v.z]), 3));
  return g;
}

/**
 * The base shape for a die of `sides`.
 *
 * Anything outside 4/6/8/10/12/20 gets a plain box — the same rule Die.tsx
 * already applies to its silhouettes. The parser allows up to 1000 sides, and
 * there IS no 1000-face isohedron: past the platonic solids and the
 * trapezohedron there is nothing correct to build, so this is a prop rather than
 * a die and the box carries the rolled number on every face. Do not "fix" this.
 */
function rohform(sides: number): { geometry: BufferGeometry; flaechen: number } {
  switch (sides) {
    case 4:
      return { geometry: new TetrahedronGeometry(1), flaechen: 4 };
    case 6:
      return { geometry: new BoxGeometry(1.2, 1.2, 1.2), flaechen: 6 };
    case 8:
      return { geometry: new OctahedronGeometry(1), flaechen: 8 };
    case 10:
      return { geometry: trapezoeder10(), flaechen: 10 };
    case 12:
      return { geometry: new DodecahedronGeometry(1), flaechen: 12 };
    case 20:
      return { geometry: new IcosahedronGeometry(1), flaechen: 20 };
    default:
      return { geometry: new BoxGeometry(1.2, 1.2, 1.2), flaechen: 6 };
  }
}

/** How many atlas cells across, for a die with this many faces. */
export function atlasRaster(flaechen: number): { spalten: number; zeilen: number } {
  const spalten = Math.ceil(Math.sqrt(flaechen));
  return { spalten, zeilen: Math.ceil(flaechen / spalten) };
}

interface Flaeche {
  normal: Vector3;
  /** Indices of this face's triangles. */
  dreiecke: number[];
}

const zwischenspeicher = new Map<number, Solid>();

/**
 * Geometry plus face normals for a die of `sides`, cached at module scope.
 *
 * Cached because it depends only on the side count: the same twenty-sided solid
 * serves every d20 of every roll, and rebuilding it per die would also make a
 * StrictMode double-mount pay for it twice.
 */
export function solidFor(sides: number): Solid {
  const vorhanden = zwischenspeicher.get(sides);
  if (vorhanden) return vorhanden;

  const { geometry: roh, flaechen: erwartet } = rohform(sides);
  // Indexed geometries (BoxGeometry is one, the polyhedra are not) have to be
  // expanded first, or per-face UVs would fight over shared vertices.
  const geometry = roh.index ? roh.toNonIndexed() : roh;
  if (geometry !== roh) roh.dispose();

  const pos = geometry.getAttribute('position');
  const dreiecke = pos.count / 3;

  // --- group triangles into faces ------------------------------------------
  const flaechen: Flaeche[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < dreiecke; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    const normal = new Vector3()
      .crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a))
      .normalize();
    const treffer = flaechen.find((f) => f.normal.dot(normal) > GLEICHE_FLAECHE);
    if (treffer) treffer.dreiecke.push(t);
    else flaechen.push({ normal, dreiecke: [t] });
  }

  // Sorted rather than left in triangle order: face k must mean the same face on
  // every machine and after any three.js update, since it decides which number
  // sits where.
  flaechen.sort((p, q) => p.normal.x - q.normal.x || p.normal.y - q.normal.y || p.normal.z - q.normal.z);

  if (flaechen.length !== erwartet) {
    // Cheap insurance against a three.js version that regroups a solid's
    // triangles: without it that would silently put the wrong number face-up,
    // which is the one bug this whole module exists to prevent. Deliberately
    // not gated to development — if it ever fires in production the dice are
    // lying about the roll, and that is worth a line in the console.
    console.warn(`[kino] W${sides}: ${flaechen.length} Flächen statt ${erwartet}`);
  }

  // --- normalise size ------------------------------------------------------
  // Every die is scaled to a circumradius of 1, so DIE_EXTENT in the shared
  // layout means the same thing for all of them.
  let weiteste = 0;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    weiteste = Math.max(weiteste, v.length());
  }
  if (weiteste > 0 && Math.abs(weiteste - 1) > 1e-6) {
    geometry.scale(1 / weiteste, 1 / weiteste, 1 / weiteste);
  }

  // --- one atlas cell per face ---------------------------------------------
  const { spalten, zeilen } = atlasRaster(flaechen.length);
  const uv = new Float32Array(pos.count * 2);
  const hoch: Vec3[] = [];
  const mitte = new Vector3();
  const achseU = new Vector3();
  const achseV = new Vector3();
  const p = new Vector3();

  flaechen.forEach((flaeche, k) => {
    // Centre of the face, from its own triangles.
    mitte.set(0, 0, 0);
    let n = 0;
    for (const t of flaeche.dreiecke) {
      for (let e = 0; e < 3; e++) {
        p.fromBufferAttribute(pos, t * 3 + e);
        mitte.add(p);
        n++;
      }
    }
    mitte.divideScalar(n);

    // A 2D basis lying in the face, so the cell can be addressed as a flat
    // square regardless of how the face is oriented in space.
    achseU.set(0, 0, 0);
    const nx = Math.abs(flaeche.normal.x);
    const ny = Math.abs(flaeche.normal.y);
    const nz = Math.abs(flaeche.normal.z);
    const hilfs = nx <= ny && nx <= nz ? new Vector3(1, 0, 0) : ny <= nz ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    achseU.crossVectors(flaeche.normal, hilfs).normalize();
    achseV.crossVectors(flaeche.normal, achseU).normalize();
    // Copied out, not referenced: both axes are scratch vectors reused by every
    // face of the loop.
    hoch.push([achseV.x, achseV.y, achseV.z]);

    let radius = 0;
    for (const t of flaeche.dreiecke) {
      for (let e = 0; e < 3; e++) {
        p.fromBufferAttribute(pos, t * 3 + e).sub(mitte);
        radius = Math.max(radius, Math.hypot(p.dot(achseU), p.dot(achseV)));
      }
    }
    if (radius === 0) radius = 1;

    const spalte = k % spalten;
    const zeile = Math.floor(k / spalten);
    for (const t of flaeche.dreiecke) {
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        p.fromBufferAttribute(pos, i).sub(mitte);
        const lu = p.dot(achseU) / radius; // −1 … 1
        const lv = p.dot(achseV) / radius;
        uv[i * 2] = (spalte + (lu * 0.5 + 0.5)) / spalten;
        // Canvas textures run top-down while UV space runs bottom-up.
        uv[i * 2 + 1] = 1 - (zeile + (0.5 - lv * 0.5)) / zeilen;
      }
    }
  });
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();

  const solid: Solid = {
    geometry,
    faceNormals: flaechen.map((f) => [f.normal.x, f.normal.y, f.normal.z] as Vec3),
    faceUps: hoch,
  };
  zwischenspeicher.set(sides, solid);
  return solid;
}

/**
 * Which face carries `value` on a die of `sides`.
 *
 * Face k shows k+1. A die outside the six real shapes is a box with the rolled
 * number on every face, so any of them will do.
 */
export function faceIndexFor(sides: number, value: number, faceCount: number): number {
  if (faceCount !== sides) return 0;
  const i = value - 1;
  return i >= 0 && i < faceCount ? i : 0;
}
