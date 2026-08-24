import { describe, expect, it } from 'vitest';
import {
  applyQuat,
  buildFlights,
  CINEMATIC_TOTAL_MS,
  DIE_EXTENT,
  dot,
  effectEnd,
  effectTriggers,
  faceTargetQuaternion,
  hasSurvivingCrit,
  layoutFor,
  SPACING_FACTOR,
  MAX_EFFECT_BURSTS,
  mulberry32,
  normalize,
  PHASES,
  phaseProgress,
  poseAt,
  quaternionFromTo,
  REDUCED_HOLD_MS,
  revealAt,
  SAFE_HALF_WIDTH,
  SAFETY_TIMEOUT_MS,
  slerp,
  VIEW_HEIGHT,
  suckEnd,
  suckStart,
  totalDuration,
  type FlightContext,
  type Quat,
  type Vec3,
} from '../src/diceCinematic.js';

const closeVec = (got: Vec3, want: Vec3, eps = 1e-9): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(eps);
};

/** q and -q are the same rotation, so compare by |dot| rather than component-wise. */
const sameRotation = (got: Quat, want: Quat, eps = 1e-9): void => {
  const d = Math.abs(got[0] * want[0] + got[1] * want[1] + got[2] * want[2] + got[3] * want[3]);
  expect(Math.abs(d - 1)).toBeLessThan(eps);
};

describe('mulberry32', () => {
  // Golden vectors. These are the load-bearing property of the whole feature:
  // if this generator ever produces different numbers on a different machine,
  // the table stops seeing the same dice. Any change that moves these values is
  // a breaking change, not a refactor.
  it('produces its documented sequence for known seeds', () => {
    expect(Array.from({ length: 4 }, mulberry32(0))).toEqual([
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
    ]);
    expect(Array.from({ length: 4 }, mulberry32(12345))).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
    ]);
    // The top of the uint32 range must not wrap into a different stream.
    expect(Array.from({ length: 4 }, mulberry32(4294967295))).toEqual([
      0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677,
    ]);
  });

  it('stays in [0, 1) and does not repeat itself early', () => {
    const rnd = mulberry32(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBe(5000);
  });

  it('treats a negative or fractional seed as its uint32 form rather than throwing', () => {
    expect(Array.from({ length: 3 }, mulberry32(-1))).toEqual(Array.from({ length: 3 }, mulberry32(4294967295)));
  });
});

// The real face normals of the solids the cinematic builds. Written out
// analytically rather than imported, so this test never needs three.js — the
// whole reason the orientation math lives in `shared`.
const PHI = (1 + Math.sqrt(5)) / 2;
const cyc = (a: number, b: number, c: number): Vec3[] => [
  [a, b, c],
  [b, c, a],
  [c, a, b],
];
const signs = (v: Vec3): Vec3[] => {
  const out: Vec3[] = [];
  for (const sx of [1, -1])
    for (const sy of [1, -1])
      for (const sz of [1, -1])
        out.push([v[0] * sx, v[1] * sy, v[2] * sz]);
  return out;
};
const dedupe = (vs: Vec3[]): Vec3[] => {
  const out: Vec3[] = [];
  for (const v of vs.map(normalize)) {
    if (!out.some((o) => dot(o, v) > 0.9999)) out.push(v);
  }
  return out;
};

const SOLID_NORMALS: Record<number, Vec3[]> = {
  // tetrahedron
  4: dedupe([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]),
  // cube
  6: dedupe([
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]),
  // octahedron
  8: dedupe(signs([1, 1, 1])),
  // dodecahedron: face normals are the icosahedron's vertices
  12: dedupe(cyc(0, 1, PHI).flatMap(signs)),
  // icosahedron: face normals are the dodecahedron's vertices
  20: dedupe([...signs([1, 1, 1]), ...cyc(0, 1 / PHI, PHI).flatMap(signs)]),
};

describe('SOLID_NORMALS fixture', () => {
  it('really describes the solids it claims to', () => {
    expect(SOLID_NORMALS[4]).toHaveLength(4);
    expect(SOLID_NORMALS[6]).toHaveLength(6);
    expect(SOLID_NORMALS[8]).toHaveLength(8);
    expect(SOLID_NORMALS[12]).toHaveLength(12);
    expect(SOLID_NORMALS[20]).toHaveLength(20);
  });
});

describe('quaternionFromTo', () => {
  const UP: Vec3 = [0, 1, 0];

  it('is the identity when the vectors already agree', () => {
    sameRotation(quaternionFromTo(UP, UP), [0, 0, 0, 1]);
  });

  it('handles the antiparallel case, which has no unique axis', () => {
    const q = quaternionFromTo(UP, [0, -1, 0]);
    closeVec(applyQuat(q, UP), [0, -1, 0]);
    // Whatever axis it picked must be perpendicular to the input, or it would
    // not be a half turn taking UP to DOWN.
    expect(Math.abs(dot(normalize([q[0], q[1], q[2]]), UP))).toBeLessThan(1e-9);
  });

  it('handles antiparallel along each coordinate axis', () => {
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
      const opposite: Vec3 = [-v[0], -v[1], -v[2]];
      closeVec(applyQuat(quaternionFromTo(v, opposite), v), opposite);
    }
  });

  it('takes every face normal of every solid onto every other one', () => {
    for (const normals of Object.values(SOLID_NORMALS)) {
      for (const from of normals) {
        for (const to of normals) {
          closeVec(applyQuat(quaternionFromTo(from, to), from), to);
        }
      }
    }
  });
});

describe('faceTargetQuaternion', () => {
  const UP: Vec3 = [0, 1, 0];
  const TOWARD_CAMERA: Vec3 = [0, 0, 1];

  it('puts the chosen face on the target axis for every face of every solid', () => {
    for (const [sides, normals] of Object.entries(SOLID_NORMALS)) {
      normals.forEach((n, face) => {
        for (const target of [UP, TOWARD_CAMERA]) {
          // A spin that varies per face, to prove the spin never disturbs the aim.
          const q = faceTargetQuaternion(n, target, (face / Number(sides)) * Math.PI * 2);
          closeVec(applyQuat(q, n), target, 1e-9);
        }
      });
    }
  });

  it('actually spins about the target axis rather than ignoring the argument', () => {
    const n = normalize([1, 1, 1]);
    const a = faceTargetQuaternion(n, [0, 1, 0], 0);
    const b = faceTargetQuaternion(n, [0, 1, 0], Math.PI / 2);
    // Same aim...
    closeVec(applyQuat(a, n), [0, 1, 0]);
    closeVec(applyQuat(b, n), [0, 1, 0]);
    // ...different orientation.
    expect(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])).toBeLessThan(0.99);
  });
});

describe('slerp', () => {
  it('returns the endpoints exactly', () => {
    const a = faceTargetQuaternion(normalize([1, 0, 0]), [0, 1, 0], 0.3);
    const b = faceTargetQuaternion(normalize([0, 0, 1]), [0, 1, 0], 2.1);
    sameRotation(slerp(a, b, 0), a);
    sameRotation(slerp(a, b, 1), b);
  });

  it('stays a unit quaternion in between', () => {
    const a: Quat = [0, 0, 0, 1];
    const b = faceTargetQuaternion(normalize([1, 2, 3]), [0, 1, 0], 1.0);
    for (let u = 0; u <= 1; u += 0.05) {
      const q = slerp(a, b, u);
      expect(Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1)).toBeLessThan(1e-9);
    }
  });

  it('takes the short way round when the inputs point opposite ways', () => {
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, 0, 0, -1]; // the same rotation, negated
    sameRotation(slerp(a, b, 0.5), a);
  });
});

describe('the phase table', () => {
  it('runs without gaps from throw to reveal', () => {
    expect(PHASES.throw.end).toBe(PHASES.land.start);
    expect(PHASES.land.end).toBe(PHASES.hold.start);
    expect(PHASES.hold.end).toBe(PHASES.gather.start);
    expect(PHASES.gather.end).toBe(PHASES.effect.start);
    expect(PHASES.effect.end).toBe(PHASES.suck.start);
    expect(PHASES.suck.end).toBe(PHASES.reveal.start);
  });

  it('opens with the fanfare and starts dimming before anything moves', () => {
    expect(PHASES.fanfare.start).toBe(0);
    // The dim overlaps the fanfare deliberately.
    expect(PHASES.dim.start).toBeLessThan(PHASES.fanfare.end);
    // Nothing moves until the dim is well under way — that gap is what hides
    // WebGL context creation.
    expect(PHASES.throw.start).toBeGreaterThan(PHASES.dim.start + 300);
  });

  it('every phase has positive length and they are in order', () => {
    const order = ['fanfare', 'dim', 'throw', 'land', 'hold', 'gather', 'effect', 'suck', 'reveal'] as const;
    let previousStart = -1;
    for (const name of order) {
      const phase = PHASES[name];
      expect(phase.end).toBeGreaterThan(phase.start);
      expect(phase.start).toBeGreaterThanOrEqual(previousStart);
      previousStart = phase.start;
    }
  });

  it('shortens the effect beat when no crit survived, and shifts everything after it', () => {
    expect(effectEnd(true)).toBe(PHASES.effect.end);
    expect(effectEnd(false)).toBeLessThan(effectEnd(true));
    expect(suckStart(false)).toBe(effectEnd(false));
    // The pull-away keeps its full length either way.
    expect(suckEnd(true) - suckStart(true)).toBe(suckEnd(false) - suckStart(false));
    expect(revealAt(false)).toBeLessThan(revealAt(true));
    expect(totalDuration(false)).toBeLessThan(totalDuration(true));
  });

  it('agrees with the exported total, and the safety timeout clears it', () => {
    expect(CINEMATIC_TOTAL_MS).toBe(totalDuration(true));
    expect(CINEMATIC_TOTAL_MS).toBe(PHASES.reveal.end);
    // The timeout is a backstop, not a race: it must sit well clear of the
    // longest legitimate performance.
    expect(SAFETY_TIMEOUT_MS).toBeGreaterThan(totalDuration(true) + 3000);
    expect(REDUCED_HOLD_MS).toBeLessThan(totalDuration(false));
  });
});

describe('phaseProgress', () => {
  it('clamps outside the window and is linear inside it', () => {
    expect(phaseProgress(-100, 0, 100)).toBe(0);
    expect(phaseProgress(0, 0, 100)).toBe(0);
    expect(phaseProgress(25, 0, 100)).toBe(0.25);
    expect(phaseProgress(100, 0, 100)).toBe(1);
    expect(phaseProgress(1000, 0, 100)).toBe(1);
  });

  it('does not divide by zero on an empty window', () => {
    expect(phaseProgress(5, 10, 10)).toBe(0);
    expect(phaseProgress(10, 10, 10)).toBe(1);
    expect(phaseProgress(15, 10, 10)).toBe(1);
  });
});

describe('layoutFor', () => {
  // Rule 3: a phone in portrait is the binding constraint, so this is checked
  // for every die count the parser can produce (MAX_DICE_COUNT is 20).
  it('keeps every die inside the portrait-safe box, at rest and gathered', () => {
    for (let n = 1; n <= 20; n++) {
      const { slots, restScale, gatherScale } = layoutFor(n);
      expect(slots).toHaveLength(n);
      for (const slot of slots) {
        expect(Math.abs(slot.rest[0]) + restScale * DIE_EXTENT).toBeLessThanOrEqual(SAFE_HALF_WIDTH);
        expect(Math.abs(slot.gather[0]) + gatherScale * DIE_EXTENT).toBeLessThanOrEqual(SAFE_HALF_WIDTH);
      }
    }
  });

  it('centres the arrangement on the origin', () => {
    for (const n of [1, 2, 3, 5, 9, 20]) {
      const { slots } = layoutFor(n);
      const sumX = slots.reduce((acc, s) => acc + s.gather[0], 0);
      expect(Math.abs(sumX)).toBeLessThan(1e-9);
    }
  });

  it('never gathers dice smaller than they rested', () => {
    // Gathering is the beat the table reads, so it must never be the beat where
    // the dice got harder to see. A large pool is width-bound in both layouts
    // and comes out equal; a small one genuinely grows.
    for (let n = 1; n <= 20; n++) {
      const { restScale, gatherScale } = layoutFor(n);
      expect(gatherScale).toBeGreaterThanOrEqual(restScale);
    }
    expect(layoutFor(1).gatherScale).toBeGreaterThan(layoutFor(1).restScale);
    expect(layoutFor(3).gatherScale).toBeGreaterThan(layoutFor(3).restScale);
  });

  it('keeps the gathered dice inside the view vertically as well', () => {
    for (let n = 1; n <= 20; n++) {
      const { slots, gatherScale } = layoutFor(n);
      for (const slot of slots) {
        expect(Math.abs(slot.gather[1]) + gatherScale * DIE_EXTENT).toBeLessThanOrEqual(VIEW_HEIGHT / 2);
      }
    }
  });

  it('centres a short final row under a full one', () => {
    // 7 dice in a 3-wide grid means a last row of one. Left-aligning it under a
    // row of three reads as a bug, because it is one.
    const { slots } = layoutFor(7);
    const rows = new Map<number, number[]>();
    for (const slot of slots) {
      const key = Math.round(slot.gather[1] * 1e6);
      rows.set(key, [...(rows.get(key) ?? []), slot.gather[0]]);
    }
    expect(rows.size).toBeGreaterThan(1);
    for (const xs of rows.values()) {
      expect(Math.abs(xs.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
    }
  });

  it('shrinks dice as the pool grows, never the other way round', () => {
    let previous = Infinity;
    for (const n of [1, 4, 9, 16, 20]) {
      const { restScale } = layoutFor(n);
      expect(restScale).toBeLessThanOrEqual(previous);
      previous = restScale;
    }
  });

  it('treats a nonsensical count as one die rather than producing nothing', () => {
    expect(layoutFor(0).slots).toHaveLength(1);
    expect(layoutFor(-3).slots).toHaveLength(1);
  });

  it('never lets two dice sit on top of each other', () => {
    // Measured in 3D: interleaved rows may share an x range, and only the row
    // separation keeps them apart. Comparing x alone would report a collision
    // that is not there.
    for (let n = 2; n <= 20; n++) {
      const { slots, restScale, gatherScale } = layoutFor(n);
      for (const [key, scale] of [
        ['rest', restScale],
        ['gather', gatherScale],
      ] as const) {
        const minGap = SPACING_FACTOR * DIE_EXTENT * scale * 0.99;
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) {
            const a = slots[i][key];
            const b = slots[j][key];
            expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(minGap);
          }
        }
      }
    }
  });
});

describe('buildFlights', () => {
  const sides = [20, 20, 6, 10];
  const values = [1, 20, 4, 7];

  it('is a pure function of seed and dice — the whole feature rests on this', () => {
    expect(buildFlights(4711, sides, values)).toEqual(buildFlights(4711, sides, values));
  });

  it('produces a different performance for a different seed', () => {
    expect(buildFlights(1, sides, values)).not.toEqual(buildFlights(2, sides, values));
  });

  it('produces a plan per die, carrying that die through unchanged', () => {
    const flights = buildFlights(7, sides, values);
    expect(flights).toHaveLength(4);
    flights.forEach((f, i) => {
      expect(f.index).toBe(i);
      expect(f.sides).toBe(sides[i]);
      expect(f.value).toBe(values[i]);
    });
  });

  it('never produces NaN, and every tumble axis is a unit vector', () => {
    for (const seed of [0, 1, 12345, 4294967295, 999999]) {
      for (const f of buildFlights(seed, Array(20).fill(20), Array(20).fill(11))) {
        const numbers = [...f.entry, ...f.rest, ...f.gather, ...f.tumbleAxis, f.arc, f.bounce, f.turns, f.restSpin, f.gatherSpin, f.throwDelay, f.gatherDelay, f.suckDelay];
        for (const v of numbers) expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(Math.hypot(...f.tumbleAxis) - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('enters from outside the laid-out area, so dice fly in rather than appear', () => {
    for (const f of buildFlights(2024, Array(20).fill(20), Array(20).fill(3))) {
      expect(Math.abs(f.entry[0])).toBeGreaterThan(SAFE_HALF_WIDTH);
      expect(f.entry[1]).toBeGreaterThan(2);
    }
  });

  it('staggers dice without letting any of them miss their phase', () => {
    for (const f of buildFlights(31337, Array(20).fill(20), Array(20).fill(9))) {
      // A delay must never push a die past the end of the phase it belongs to.
      expect(PHASES.throw.start + f.throwDelay).toBeLessThan(PHASES.throw.end);
      expect(PHASES.gather.start + f.gatherDelay).toBeLessThan(PHASES.gather.end);
      expect(suckStart(true) + f.suckDelay).toBeLessThan(suckEnd(true));
      expect(suckStart(false) + f.suckDelay).toBeLessThan(suckEnd(false));
    }
  });

  it('ignores dice with no matching value rather than inventing one', () => {
    expect(buildFlights(1, [20, 20, 20], [5])).toHaveLength(1);
    expect(buildFlights(1, [], [])).toHaveLength(0);
  });
});

describe('poseAt', () => {
  const REST: Quat = faceTargetQuaternion(normalize([0.3, 0.9, -0.2]), [0, 1, 0], 1.1);
  const GATHER: Quat = faceTargetQuaternion(normalize([0.3, 0.9, -0.2]), [0, 0, 1], 0.2);
  const ctx = (hasCrit: boolean): FlightContext => ({
    rest: REST,
    gather: GATHER,
    suckTarget: [4.4, -3.1, 0.5],
    hasCrit,
  });

  const flight = buildFlights(555, [20, 20, 20], [1, 11, 20])[1];

  it('reaches the resting pose EXACTLY when landing ends', () => {
    // This is the property that makes the rolled number reliably the one facing
    // up. An "almost" here is a die that visibly settles onto the wrong face.
    const pose = poseAt(flight, ctx(true), PHASES.land.end);
    closeVec(pose.pos, flight.rest, 1e-12);
    sameRotation(pose.quat, REST, 1e-12);
    expect(pose.scale).toBe(flight.restScale);
    expect(pose.opacity).toBe(1);
  });

  it('holds that pose, motionless, through the hold beat', () => {
    const c = ctx(true);
    const a = poseAt(flight, c, PHASES.hold.start);
    const b = poseAt(flight, c, PHASES.hold.end - 1);
    closeVec(a.pos, b.pos, 1e-12);
    sameRotation(a.quat, b.quat, 1e-12);
  });

  it('reaches the gathered pose exactly when gathering ends', () => {
    const pose = poseAt(flight, ctx(true), PHASES.gather.end);
    closeVec(pose.pos, flight.gather, 1e-12);
    sameRotation(pose.quat, GATHER, 1e-12);
    expect(pose.scale).toBeCloseTo(flight.gatherScale, 12);
  });

  it('stands still through the effect beat, with and without a crit', () => {
    for (const hasCrit of [true, false]) {
      const c = ctx(hasCrit);
      const a = poseAt(flight, c, PHASES.effect.start);
      const b = poseAt(flight, c, effectEnd(hasCrit) - 1);
      closeVec(a.pos, b.pos, 1e-9);
      expect(a.scale).toBeCloseTo(b.scale, 9);
    }
  });

  it('arrives at the dock and vanishes completely', () => {
    for (const hasCrit of [true, false]) {
      const c = ctx(hasCrit);
      const pose = poseAt(flight, c, suckEnd(hasCrit));
      closeVec(pose.pos, c.suckTarget, 1e-12);
      expect(pose.scale).toBe(0);
      expect(pose.opacity).toBe(0);
    }
  });

  it('is still fully opaque when the pull-away begins, so dice travel rather than dissolve', () => {
    const c = ctx(true);
    expect(poseAt(flight, c, suckStart(true) + flight.suckDelay).opacity).toBe(1);
    expect(poseAt(flight, c, suckStart(true) + flight.suckDelay + 1).opacity).toBeGreaterThan(0.9);
  });

  it('produces finite, sane values at every millisecond of a full run', () => {
    for (const hasCrit of [true, false]) {
      const c = ctx(hasCrit);
      for (let t = 0; t <= totalDuration(hasCrit); t += 7) {
        const pose = poseAt(flight, c, t);
        for (const v of [...pose.pos, ...pose.quat, pose.scale, pose.opacity]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(pose.scale).toBeGreaterThanOrEqual(0);
        expect(pose.opacity).toBeGreaterThanOrEqual(0);
        expect(pose.opacity).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.hypot(...pose.quat) - 1)).toBeLessThan(1e-6);
      }
    }
  });

  it('never rewinds: a die does not jump backwards between adjacent frames', () => {
    const c = ctx(true);
    let previous = poseAt(flight, c, 0);
    for (let t = 1; t <= totalDuration(true); t += 3) {
      const pose = poseAt(flight, c, t);
      const jump = Math.hypot(pose.pos[0] - previous.pos[0], pose.pos[1] - previous.pos[1], pose.pos[2] - previous.pos[2]);
      // 3 ms of travel. Anything larger is a discontinuity between phases.
      expect(jump).toBeLessThan(0.25);
      previous = pose;
    }
  });

  it('gives the same answer whenever it is asked — no hidden per-frame state', () => {
    // Rule 2. Sampling out of order must not change anything, which is what lets
    // a 30 Hz machine and a 144 Hz machine agree.
    const c = ctx(true);
    const forwards = [];
    for (let t = 0; t <= 7300; t += 100) forwards.push(poseAt(flight, c, t));
    const backwards = [];
    for (let t = 7300; t >= 0; t -= 100) backwards.push(poseAt(flight, c, t));
    expect(forwards).toEqual([...backwards].reverse());
  });
});

describe('effectTriggers', () => {
  it('gives a burst to a surviving natural 1 and 20', () => {
    expect(effectTriggers([1, 5, 7], 20)).toEqual([{ dieIndex: 0, trigger: 1, cancelled: false }]);
    expect(effectTriggers([20, 5, 7], 20)).toEqual([{ dieIndex: 0, trigger: 20, cancelled: false }]);
  });

  it('drops cancelled crits, because the ruleset already declared them meaningless', () => {
    // A 1 and a 20 cancel pairwise. Firing fireworks anyway would be the
    // animation contradicting the feed row that follows it.
    expect(effectTriggers([20, 1], 20)).toEqual([]);
    expect(hasSurvivingCrit([20, 1], 20)).toBe(false);
  });

  it('keeps the crit that survives an uneven cancellation', () => {
    const triggers = effectTriggers([20, 1, 20], 20);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual({ dieIndex: 2, trigger: 20, cancelled: false });
  });

  it('ignores non-d20 dice even when they show a 1 or a 20', () => {
    expect(effectTriggers([1, 1, 1], 6)).toEqual([]);
    // A mixed pool: only the d20 part can crit.
    expect(effectTriggers([1, 1], [6, 20])).toEqual([{ dieIndex: 1, trigger: 1, cancelled: false }]);
  });

  it('caps the bursts so "/i 20w20" cannot melt a phone', () => {
    const allOnes = Array(20).fill(1);
    expect(effectTriggers(allOnes, 20)).toHaveLength(MAX_EFFECT_BURSTS);
  });

  it('preserves die order, so the bursts tell the story of the roll left to right', () => {
    const triggers = effectTriggers([1, 5, 1, 9, 1], 20);
    expect(triggers.map((t) => t.dieIndex)).toEqual([0, 2, 4]);
  });

  it('reports no crit for an ordinary roll', () => {
    expect(effectTriggers([5, 12, 8], 20)).toEqual([]);
    expect(hasSurvivingCrit([5, 12, 8], 20)).toBe(false);
    expect(hasSurvivingCrit([1], 20)).toBe(true);
  });
});
