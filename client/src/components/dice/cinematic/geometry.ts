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
  /**
   * The number PRINTED on each face, opposite faces summing to sides + 1 — the
   * rule every real die of these shapes follows. Not simply k+1: see the
   * numbering step in solidFor.
   */
  faceNumbers: number[];
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

  // --- number the faces the way a real die is numbered -----------------------
  // Opposite faces sum to sides + 1: 7 on a d6, 21 on a d20. That is the one
  // rule every real die of these shapes follows, and it is visible — a third of
  // the faces are on screen at once, so a d12 with 2 opposite 12 reads as a prop.
  //
  // Done EXPLICITLY, rather than by numbering faces in the order they were
  // sorted into. That order happens to produce the right pairing when the sort
  // is a clean reversal under negation, which it is in exact arithmetic — and
  // is not, in floats: two normals whose x should be identical differ in the
  // last bit, the tie-break goes the other way, and the d10 and d12 came out
  // with opposite pairs summing to 10, 11 AND 12. Deriving the pairing from the
  // geometry cannot drift like that.
  const gegenueber = flaechen.map((f) => flaechen.findIndex((o) => o.normal.dot(f.normal) < -0.999));
  const nummern = new Array<number>(flaechen.length).fill(0);
  let naechste = 1;
  for (let k = 0; k < flaechen.length; k++) {
    if (nummern[k] !== 0) continue;
    nummern[k] = naechste;
    // A tetrahedron has no opposite faces at all — every face touches every
    // other — so its four simply count up.
    if (gegenueber[k] >= 0) nummern[gegenueber[k]] = flaechen.length + 1 - naechste;
    naechste++;
  }

  // A real d6 is also CHIRAL, and the pairing above does not fix which mirror
  // image you get. Western dice are right-handed: with the 1, the 2 and the 3
  // around one corner, they read counter-clockwise seen from outside it. Ours
  // came out the other way — the Japanese arrangement, which does exist and is
  // not what anybody at this table owns.
  //
  // Swapping ONE opposite pair mirrors the whole die, and it cannot disturb the
  // sums: 2 and 5 simply change places, and both still face a 5 and a 2.
  //
  // Deliberately not generalised past the cube. The 1-2-3 corner is a fact about
  // d6s; d20s and d10s are sold in both handednesses with no convention to
  // honour, so a "rule" applied to them would be one this file invented.
  if (flaechen.length === 6) {
    const flaecheMit = (n: number): Vector3 => flaechen[nummern.indexOf(n)].normal;
    const gegenUhrzeigersinn = flaecheMit(1).dot(new Vector3().crossVectors(flaecheMit(2), flaecheMit(3))) > 0;
    if (!gegenUhrzeigersinn) {
      const zwei = nummern.indexOf(2);
      const fuenf = nummern.indexOf(5);
      nummern[zwei] = 5;
      nummern[fuenf] = 2;
    }
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
    // --- the face's own corners ---------------------------------------------
    // Deduplicated, because a face is a fan of triangles that shares vertices,
    // and averaging the raw list weights the shared ones twice or three times:
    // a pentagon's "centre" then sits 4% of its radius toward the fan's hub.
    const ecken: Vector3[] = [];
    for (const t of flaeche.dreiecke) {
      for (let e = 0; e < 3; e++) {
        p.fromBufferAttribute(pos, t * 3 + e);
        if (!ecken.some((q) => q.distanceToSquared(p) < 1e-10)) ecken.push(p.clone());
      }
    }
    mitte.set(0, 0, 0);
    for (const ecke of ecken) mitte.add(ecke);
    mitte.divideScalar(Math.max(1, ecken.length));

    // --- put them in boundary order ------------------------------------------
    // A throwaway basis, only to sort the corners by angle around the centre.
    // Every face here is a convex polygon, so angular order IS boundary order,
    // and consecutive pairs are therefore its edges — the fan's inner diagonals
    // are not.
    const nx = Math.abs(flaeche.normal.x);
    const ny = Math.abs(flaeche.normal.y);
    const nz = Math.abs(flaeche.normal.z);
    const hilfs = nx <= ny && nx <= nz ? new Vector3(1, 0, 0) : ny <= nz ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    achseU.crossVectors(flaeche.normal, hilfs).normalize();
    achseV.crossVectors(flaeche.normal, achseU).normalize();
    const winkel = new Map<Vector3, number>();
    for (const ecke of ecken) {
      const d = ecke.clone().sub(mitte);
      winkel.set(ecke, Math.atan2(d.dot(achseV), d.dot(achseU)));
    }
    ecken.sort((a, b) => (winkel.get(a) ?? 0) - (winkel.get(b) ?? 0));

    // --- is this face regular? -----------------------------------------------
    // Every solid here has regular faces except the d10, whose kites are not.
    // The distinction matters below, because "rest on an edge" is the right
    // rule for a regular face and the wrong one for a kite.
    const kantenlaengen = ecken.map((v, i) => v.distanceTo(ecken[(i + 1) % ecken.length]));
    const radien = ecken.map((v) => v.distanceTo(mitte));
    const regelmaessig =
      Math.max(...kantenlaengen) - Math.min(...kantenlaengen) < 1e-6 &&
      Math.max(...radien) - Math.min(...radien) < 1e-6;

    // --- which way is UP for the number on this face --------------------------
    // From the middle of one EDGE toward the centre, so that edge ends up at the
    // bottom and the number's baseline runs parallel to it. That is how a real
    // die is printed, and it is the whole reason this basis may not come from a
    // world axis: `hilfs` above knows nothing about the face's shape, so the
    // number landed at whatever angle the arithmetic produced — on a d20's
    // triangles, consistently about 90° out from any edge.
    //
    // Works for every shape here rather than just triangles: put an edge at the
    // bottom and a triangle stands on its base, a square sits square, a
    // pentagon rests on a side. Aiming at a VERTEX instead would do the same for
    // the odd-sided faces and stand the d6 on its corner.
    //
    // WHICH edge is a free choice — the three of a triangle are 120° apart and
    // all of them look right — but it must be the SAME free choice everywhere,
    // or two clients letter their dice differently. Hence the lexicographically
    // smallest midpoint: no dependence on vertex order, iteration order or
    // anything else that a three.js version could quietly change.
    const kandidat = regelmaessig ? null : spiegelachse(ecken, mitte, flaeche.normal);
    if (kandidat) {
      // An IRREGULAR face — in practice the d10's kite. It has exactly one axis
      // of symmetry and it runs corner to corner, so there is no edge to stand
      // the number on: laying it along an edge instead put every numeral 66° off
      // the kite it was printed on, which is what a d10 reading sideways looks
      // like. Up the axis, sharp end first, is how a real d10 carries its digits.
      achseV.copy(kandidat);
    } else {
      const mittelpunkt = new Vector3();
      let beste: Vector3 | null = null;
      let besteRichtung: Vector3 | null = null;
      for (let i = 0; i < ecken.length; i++) {
        const a = ecken[i];
        const b = ecken[(i + 1) % ecken.length];
        mittelpunkt.addVectors(a, b).multiplyScalar(0.5);
        if (
          beste === null ||
          mittelpunkt.x < beste.x - 1e-9 ||
          (Math.abs(mittelpunkt.x - beste.x) < 1e-9 &&
            (mittelpunkt.y < beste.y - 1e-9 ||
              (Math.abs(mittelpunkt.y - beste.y) < 1e-9 && mittelpunkt.z < beste.z - 1e-9)))
        ) {
          beste = mittelpunkt.clone();
          besteRichtung = new Vector3().subVectors(b, a).normalize();
        }
      }
      // Perpendicular to the edge, not merely "toward the centre". Those
      // coincide on a regular polygon and would not on anything else.
      achseV.subVectors(mitte, beste ?? mitte);
      if (besteRichtung) achseV.addScaledVector(besteRichtung, -achseV.dot(besteRichtung));
      achseV.normalize();
    }
    // Right-handed with the outward normal, matching orthoFrame() in
    // diceCinematic.ts: right x up = out. Get this backwards and every number is
    // mirrored.
    achseU.crossVectors(achseV, flaeche.normal).normalize();
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
    faceNumbers: nummern,
  };
  zwischenspeicher.set(sides, solid);
  return solid;
}

/**
 * The face's own axis of symmetry, sharp end up — or null if it has none.
 *
 * A face is symmetric about the line through its centre and a corner when
 * reflecting its corners in that line maps the set back onto itself. A kite has
 * exactly two such corners (the ends of one axis); of those the SHARPER one goes
 * up, which is the way a d10 is read — tip toward the pole, digits across the
 * wide part below it.
 *
 * Only ever consulted for irregular faces. A regular polygon has an axis through
 * every corner, and choosing among them by angle would be a coin toss between
 * identical options.
 */
function spiegelachse(ecken: Vector3[], mitte: Vector3, normal: Vector3): Vector3 | null {
  const quer = new Vector3();
  const abstand = new Vector3();
  const gespiegelt = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  let beste: { richtung: Vector3; winkel: number } | null = null;

  for (let i = 0; i < ecken.length; i++) {
    const richtung = new Vector3().subVectors(ecken[i], mitte).normalize();
    quer.crossVectors(richtung, normal);
    const symmetrisch = ecken.every((v) => {
      abstand.subVectors(v, mitte);
      gespiegelt.copy(abstand).addScaledVector(quer, -2 * abstand.dot(quer)).add(mitte);
      return ecken.some((w) => w.distanceToSquared(gespiegelt) < 1e-8);
    });
    if (!symmetrisch) continue;
    a.subVectors(ecken[(i - 1 + ecken.length) % ecken.length], ecken[i]).normalize();
    b.subVectors(ecken[(i + 1) % ecken.length], ecken[i]).normalize();
    const winkel = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    if (!beste || winkel < beste.winkel - 1e-9) beste = { richtung, winkel };
  }
  return beste?.richtung ?? null;
}

/**
 * Which face of `solid` carries `value` on a die of `sides`.
 *
 * A lookup rather than `value - 1`: faces are numbered so that opposite ones sum
 * to sides + 1 (see solidFor), which is emphatically not the order they are
 * stored in. A die outside the six real shapes is a box carrying the rolled
 * number on every face, so any of them will do.
 */
export function faceIndexFor(solid: Solid, sides: number, value: number): number {
  if (solid.faceNumbers.length !== sides) return 0;
  const i = solid.faceNumbers.indexOf(value);
  return i >= 0 ? i : 0;
}
