// The choreography of a „großer Wurf" (/i): everything about the cinematic that
// is pure math, so both ends agree and the whole thing is testable in the one
// workspace that has a test runner.
//
// No I/O, no DOM, and deliberately NO `three` import: vectors and quaternions
// are plain tuples here and the client adapts them (see
// client/src/components/dice/cinematic/orientation.ts). The moment this file
// imports a renderer it stops being testable and starts being a client module.
//
// THREE RULES HOLD THIS FEATURE TOGETHER. Each is easy to break later with an
// edit that looks harmless, so each is stated here rather than in a commit
// message:
//
//   1. mulberry32 is the ONLY source of randomness. Every step of it is 32-bit
//      integer arithmetic (Math.imul, >>>, ^) with a single divide at the end,
//      so it produces bit-identical sequences on every JS engine, OS and CPU.
//      A generator that accumulates floats (or reaches for Math.sin) would not,
//      and the entire point — that everyone at the table watches the same dice
//      fall — dies with it.
//
//   2. Every visual quantity is a CLOSED-FORM function of elapsed time. Nothing
//      is integrated per frame. A 30 Hz laptop and a 144 Hz monitor sample the
//      same continuous function at different points: same show, different
//      smoothness. One innocent-looking "velocity += gravity * delta" anywhere
//      downstream reintroduces frame-rate dependence and undoes rule 1.
//
//   3. Layout is in ABSTRACT WORLD UNITS, never pixels. The camera keeps a
//      fixed vertical fit (VIEW_HEIGHT always spans the canvas height), so a
//      different aspect ratio only adds or removes empty margin left and right —
//      it never moves a die. LAYOUT_WIDTH is therefore sized against the
//      NARROWEST supported aspect (portrait phone), not against a desktop.
//
// What is deliberately NOT synchronised: the wall-clock start differs between
// clients by network latency (tens of milliseconds on a LAN). The requirement is
// "everyone sees the identical animation", not "frame-locked across machines" —
// nobody should build clock synchronisation for a cosmetic feature.

import { findCritTriggers, type CritTrigger } from './dice.js';

export type Vec3 = readonly [number, number, number];
/** Quaternion as [x, y, z, w] — the component order three.js uses. */
export type Quat = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32 — the one random generator of a performance. See rule 1 above for
 * why this one specifically, and not any of the shorter one-liners.
 *
 * The seed is a uint32 drawn once on the server (see rollSeed in
 * server/src/dice.ts) and shipped to every client in the same message.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
function between(rnd: () => number, lo: number, hi: number): number {
  return lo + rnd() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Vector and quaternion math (tuples in, tuples out)
// ---------------------------------------------------------------------------

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function lerpVec(a: Vec3, b: Vec3, u: number): Vec3 {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

/**
 * Any unit vector perpendicular to `v`. Picks the coordinate axis `v` leans on
 * LEAST, because crossing against a nearly-parallel axis is where this loses
 * precision.
 */
export function anyPerpendicular(v: Vec3): Vec3 {
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(v, axis));
}

export function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len === 0 ? [0, 0, 0, 1] : [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const half = angle / 2;
  const s = Math.sin(half);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(half)];
}

/** Hamilton product: applies `b` first, then `a`. */
export function multiplyQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function applyQuat(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * (q_vec × v); v' = v + qw * t + q_vec × t
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Shortest rotation taking unit vector `a` onto unit vector `b`.
 *
 * The antiparallel case (a === -b) has NO unique axis — every axis
 * perpendicular to `a` does the job — so it is handled separately rather than
 * left to a formula that divides by zero there.
 */
export function quaternionFromTo(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d > 1 - 1e-8) return [0, 0, 0, 1];
  if (d < -1 + 1e-8) return quatFromAxisAngle(anyPerpendicular(a), Math.PI);
  const c = cross(a, b);
  return normalizeQuat([c[0], c[1], c[2], 1 + d]);
}

/**
 * The orientation that turns a die's face (given by its outward normal) toward
 * `target`, then spins it by `spin` radians about that target axis.
 *
 * The spin is what stops twenty dice from all resting with their number at the
 * same rotation. It is seeded, so it is still identical on every screen.
 */
export function faceTargetQuaternion(faceNormal: Vec3, target: Vec3, spin: number): Quat {
  return multiplyQuat(quatFromAxisAngle(target, spin), quaternionFromTo(faceNormal, target));
}

/** Shortest-arc spherical interpolation. Flips a sign rather than take the long way round. */
export function slerp(a: Quat, b: Quat, u: number): Quat {
  let [bx, by, bz, bw] = b;
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    d = -d;
  }
  // Nearly identical: lerp and renormalise, which is both cheaper and stable
  // where sin(theta) approaches zero.
  if (d > 0.9995) {
    return normalizeQuat([lerp(a[0], bx, u), lerp(a[1], by, u), lerp(a[2], bz, u), lerp(a[3], bw, u)]);
  }
  const theta = Math.acos(d);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - u) * theta) / sin;
  const wb = Math.sin(u * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);

const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInCubic = (u: number): number => u ** 3;
const easeInQuad = (u: number): number => u * u;
const easeOutQuint = (u: number): number => 1 - (1 - u) ** 5;
const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

/** Progress through [start, end], clamped to 0..1 outside it. */
export function phaseProgress(t: number, start: number, end: number): number {
  return end <= start ? (t >= end ? 1 : 0) : clamp01((t - start) / (end - start));
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

/**
 * Every millisecond of the performance in one place, so pacing is tuned in one
 * file rather than hunted across a renderer.
 *
 * Two overlaps are deliberate. `dim` starts while the fanfare is still opening,
 * so the screen is already darkening as the horns arrive. And nothing MOVES
 * until t = 700: that gap is what hides the 30–80 ms of WebGL context creation,
 * which makes the ordering load-bearing rather than decorative.
 */
export const PHASES = {
  /** The fanfare opens. The page still looks normal. */
  fanfare: { start: 0, end: 450 },
  /** The dim fades up — a CSS transition, not a rendered frame. */
  dim: { start: 250, end: 850 },
  /** Dice fly in from outside the view. */
  throw: { start: 700, end: 1900 },
  /** They settle. The resting orientation is reached EXACTLY at land.end. */
  land: { start: 1900, end: 2600 },
  /** Nothing moves — the beat in which the table reads the dice. */
  hold: { start: 2600, end: 3200 },
  /** To the centre, result face turned to the camera, scaled up. */
  gather: { start: 3200, end: 4200 },
  /** Crit effect. Without a crit this collapses — see effectEnd(). */
  effect: { start: 4200, end: 6200 },
  /** Toward the chat dock, shrinking and fading. */
  suck: { start: 6200, end: 6900 },
  /** The dim falls. The entry is appended at reveal.start, so the eye lands on it. */
  reveal: { start: 6900, end: 7300 },
} as const;

export type PhaseName = keyof typeof PHASES;

/** A roll without a surviving crit does not earn the full effect beat. */
export const EFFECT_MS_WITHOUT_CRIT = 700;

/** When the effect phase ends — and therefore when everything after it shifts to. */
export function effectEnd(hasCrit: boolean): number {
  return hasCrit ? PHASES.effect.end : PHASES.effect.start + EFFECT_MS_WITHOUT_CRIT;
}

/** Start of `suck` for this roll: straight after the effect, however long it was. */
export function suckStart(hasCrit: boolean): number {
  return effectEnd(hasCrit);
}

export function suckEnd(hasCrit: boolean): number {
  return suckStart(hasCrit) + (PHASES.suck.end - PHASES.suck.start);
}

/** When the roll appears in the chat — the dim is still fading at this point. */
export function revealAt(hasCrit: boolean): number {
  return suckEnd(hasCrit);
}

/** Total run time, after which the overlay unmounts. */
export function totalDuration(hasCrit: boolean): number {
  return revealAt(hasCrit) + (PHASES.reveal.end - PHASES.reveal.start);
}

export const CINEMATIC_TOTAL_MS = totalDuration(true);

/**
 * Hard ceiling, comfortably above the longest performance. Armed BEFORE the
 * three.js chunk is even requested, so a 404, a refused WebGL context or a throw
 * inside the renderer still ends with the roll in the chat.
 */
export const SAFETY_TIMEOUT_MS = 12_000;

/** prefers-reduced-motion: how long the static result card stands. */
export const REDUCED_HOLD_MS = 2600;

/**
 * At most this many bursts, however many crits a roll produced — „/i 20w20" is
 * a legal command and should not melt a phone. The timeline does not change.
 */
export const MAX_EFFECT_BURSTS = 6;

/** Milliseconds between two bursts, so three crits read as a sequence, not a mush. */
export const EFFECT_STAGGER_MS = 180;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** World units spanned by the canvas HEIGHT, at every aspect ratio. See rule 3. */
export const VIEW_HEIGHT = 10;

/**
 * The narrowest aspect we lay out for (9:16 portrait). Half the usable width is
 * then VIEW_HEIGHT / 2 * 9 / 16 = 2.8125, so everything must fit inside ±2.8125 —
 * which is why LAYOUT_WIDTH is 5.2 and not a number chosen on a desktop.
 */
export const NARROWEST_ASPECT = 9 / 16;
export const LAYOUT_WIDTH = 5.2;
export const LAYOUT_DEPTH = 3.2;

/**
 * Height of the table the dice land on, in world units.
 *
 * Below the centre of the view, so the throw reads as dice falling onto a
 * surface rather than hovering mid-screen — and so the gather afterwards is a
 * genuine lift toward the viewer rather than a sideways shuffle.
 */
export const TABLE_Y = -2.3;

/**
 * How far a die of scale 1 reaches from its own centre.
 *
 * Every solid is normalised to a CIRCUMRADIUS of 1 when it is built (see
 * geometry.ts), so the true reach is 1.0 and this is that plus a little air.
 * Getting this wrong is not a cosmetic matter: it feeds both the spacing below
 * and the portrait-safe fit, so an over-large value silently packs the dice
 * closer together than their own diameter and they interpenetrate.
 */
export const DIE_EXTENT = 1.05;

/**
 * Centre-to-centre spacing, as a multiple of DIE_EXTENT.
 *
 * Above 2 by design: two dice of radius r need more than 2r between their
 * centres to stay clear of each other, and a little daylight on top of that
 * reads as a thrown handful rather than a stack.
 */
export const SPACING_FACTOR = 2.0;

/** Leave a little of the safe box unused rather than filling it exactly. */
const SAFE_FRACTION = 0.92;

/** Half the usable width at the narrowest supported aspect: 2.8125 world units. */
export const SAFE_HALF_WIDTH = (VIEW_HEIGHT / 2) * NARROWEST_ASPECT;

/**
 * Usable height for the gathered dice. Less than the full view: the beat wants
 * air above and below, and the skip hint sits near the bottom edge.
 */
const SAFE_HEIGHT = VIEW_HEIGHT * 0.72;

/** Gathered dice may grow past life size — being read is the point of that beat. */
const MAX_GATHER_SCALE = 1.65;

/** Width (or height) a row of `n` dice occupies at scale 1, spacing included. */
function extentAtScaleOne(n: number): number {
  return DIE_EXTENT * ((n - 1) * SPACING_FACTOR + 2);
}

/**
 * The biggest scale at which a `cols` × `rows` grid still fits the box.
 *
 * Deriving the scale FROM the constraint rather than hand-tuning a constant is
 * the point: rule 3 says the layout must survive a phone in portrait, and a
 * magic number only survives until someone adjusts a neighbouring one.
 */
function gridScale(cols: number, rows: number, cap: number, height: number): number {
  const byWidth = (2 * SAFE_HALF_WIDTH * SAFE_FRACTION) / extentAtScaleOne(cols);
  const byHeight = (height * SAFE_FRACTION) / extentAtScaleOne(rows);
  return Math.min(cap, byWidth, byHeight);
}

/**
 * The arrangement that shows `n` dice as large as possible.
 *
 * Landscape is preferred (never more rows than columns) because a row of dice
 * reads like a roll on a table, whereas a tall column reads like a list. Among
 * the landscape arrangements the largest scale wins; ties go to the wider one,
 * which keeps the choice deterministic rather than dependent on loop order.
 */
function bestGrid(n: number, cap: number, height: number): { cols: number; rows: number; scale: number } {
  let best = { cols: n, rows: 1, scale: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    if (rows > cols) continue;
    const scale = gridScale(cols, rows, cap, height);
    if (scale > best.scale + 1e-12) best = { cols, rows, scale };
  }
  return best;
}

/**
 * Position along a row, centred on the row's OWN occupancy.
 *
 * A last row with fewer dice than the grid is wide must not be left-aligned
 * under a full one — that reads as a layout bug, because it is one.
 */
function centredOffset(index: number, count: number, cols: number, step: number): number {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const inThisRow = Math.min(cols, count - row * cols);
  return (col - (inThisRow - 1) / 2) * step;
}

export interface LayoutSlot {
  /** Where this die comes to rest on the table. */
  rest: Vec3;
  /** Where it is held up to be read. */
  gather: Vec3;
}

/**
 * Deterministic from the die COUNT alone — no seed. Seeded jitter is added on
 * top per die (see buildFlights), which keeps twenty dice tidy while still
 * looking thrown rather than parked.
 */
export function layoutFor(count: number): { slots: LayoutSlot[]; restScale: number; gatherScale: number } {
  const n = Math.max(1, count);
  // On the table a die never grows past life size, and it spreads over the
  // table's depth rather than the view's height.
  const restGrid = bestGrid(n, 1, LAYOUT_DEPTH * 2);
  const gatherGrid = bestGrid(n, MAX_GATHER_SCALE, SAFE_HEIGHT);

  const step = SPACING_FACTOR * DIE_EXTENT * restGrid.scale;
  const gStep = SPACING_FACTOR * DIE_EXTENT * gatherGrid.scale;

  const slots: LayoutSlot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / restGrid.cols);
    const gRow = Math.floor(i / gatherGrid.cols);
    slots.push({
      rest: [centredOffset(i, n, restGrid.cols, step), TABLE_Y, (row - (restGrid.rows - 1) / 2) * step],
      gather: [centredOffset(i, n, gatherGrid.cols, gStep), ((gatherGrid.rows - 1) / 2 - gRow) * gStep, 0],
    });
  }
  return { slots, restScale: restGrid.scale, gatherScale: gatherGrid.scale };
}

// ---------------------------------------------------------------------------
// Flight plans
// ---------------------------------------------------------------------------

/**
 * Everything about one die's journey that comes from the seed. Deliberately
 * does NOT carry the resting orientation: that depends on the die's geometry,
 * which only the client has. The client derives it with faceTargetQuaternion()
 * using the `restSpin`/`gatherSpin` below, so the seeded part stays here and
 * stays testable.
 */
export interface DieFlight {
  index: number;
  sides: number;
  value: number;
  /** Off-screen point the die enters from. */
  entry: Vec3;
  /** Where it lands, jitter already applied. */
  rest: Vec3;
  /** Where it is held up. */
  gather: Vec3;
  restScale: number;
  gatherScale: number;
  /** Unit axis the die tumbles about on its way in. */
  tumbleAxis: Vec3;
  /** Whole turns about that axis before it settles. */
  turns: number;
  /** Extra lift over the flight path. */
  arc: number;
  /** Height of the settling bounce. Reaches exactly zero at land.end. */
  bounce: number;
  /** Rotation about the up axis at rest — so the numbers do not all align. */
  restSpin: number;
  /** Rotation about the camera axis once gathered. */
  gatherSpin: number;
  /** Milliseconds this die lags the others: throw, gather and suck each get one. */
  throwDelay: number;
  gatherDelay: number;
  suckDelay: number;
}

const MAX_THROW_DELAY = 300;
const MAX_GATHER_DELAY = 200;
const MAX_SUCK_DELAY = 150;

/**
 * Turns a seed plus the rolled dice into one flight plan per die.
 *
 * Same seed and same dice always produce a deep-equal result — that identity is
 * the whole feature, and it is what the tests pin down.
 */
export function buildFlights(seed: number, sides: readonly number[], values: readonly number[]): DieFlight[] {
  const rnd = mulberry32(seed);
  const count = Math.min(sides.length, values.length);
  const { slots, restScale, gatherScale } = layoutFor(count);
  const flights: DieFlight[] = [];

  for (let i = 0; i < count; i++) {
    const slot = slots[i];
    // Dice enter from beyond the left or right edge, high up and a little
    // behind, so they arrive travelling down and forward rather than dropping
    // straight in.
    const fromLeft = rnd() < 0.5;
    const entry: Vec3 = [
      (fromLeft ? -1 : 1) * between(rnd, LAYOUT_WIDTH * 0.9, LAYOUT_WIDTH * 1.35),
      between(rnd, 3.4, 5.2),
      between(rnd, -LAYOUT_DEPTH, LAYOUT_DEPTH * 0.4),
    ];
    const jitterX = between(rnd, -0.25, 0.25);
    const jitterZ = between(rnd, -0.25, 0.25);
    const axis = normalize([between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)]);

    flights.push({
      index: i,
      sides: sides[i],
      value: values[i],
      entry,
      rest: [slot.rest[0] + jitterX, slot.rest[1], slot.rest[2] + jitterZ],
      gather: slot.gather,
      restScale,
      gatherScale,
      // normalize() returns [0,0,0] for a zero vector; falling back to a fixed
      // axis keeps the rotation well-defined in that (astronomically unlikely)
      // case rather than producing a NaN quaternion.
      tumbleAxis: axis[0] === 0 && axis[1] === 0 && axis[2] === 0 ? [0, 1, 0] : axis,
      turns: Math.round(between(rnd, 3, 6)),
      arc: between(rnd, 0.6, 1.6),
      bounce: between(rnd, 0.25, 0.6),
      restSpin: between(rnd, 0, Math.PI * 2),
      gatherSpin: between(rnd, -0.22, 0.22),
      throwDelay: between(rnd, 0, MAX_THROW_DELAY),
      gatherDelay: between(rnd, 0, MAX_GATHER_DELAY),
      suckDelay: between(rnd, 0, MAX_SUCK_DELAY),
    });
  }
  return flights;
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

export interface FlightContext {
  /** Resting orientation: the rolled face up. Derived client-side from the geometry. */
  rest: Quat;
  /** Gathered orientation: the rolled face toward the camera. */
  gather: Quat;
  /** Where the dice vanish to — the chat dock, in world units. */
  suckTarget: Vec3;
  /** Whether a surviving crit lengthens the effect beat. */
  hasCrit: boolean;
}

export interface DiePose {
  pos: Vec3;
  quat: Quat;
  scale: number;
  opacity: number;
}

/**
 * The complete state of one die at elapsed time `t`, in closed form. See rule 2:
 * there is no per-frame state anywhere, which is exactly what lets a slow
 * machine and a fast one show the same performance.
 */
export function poseAt(flight: DieFlight, ctx: FlightContext, t: number): DiePose {
  const landEnd = PHASES.land.end;
  const gStart = PHASES.gather.start + flight.gatherDelay;
  const sStart = suckStart(ctx.hasCrit) + flight.suckDelay;
  const sEnd = suckEnd(ctx.hasCrit);

  // --- Orientation -------------------------------------------------------
  // On the way in the die sits at spinAbout(axis, theta) * rest, with theta
  // easing from -turns*2π up to exactly 0 at land.end. Because theta genuinely
  // reaches zero, the resting orientation is hit EXACTLY rather than
  // approximately — that is the property that makes the rolled number reliably
  // the one facing up.
  const spinU = phaseProgress(t, PHASES.throw.start + flight.throwDelay, landEnd);
  const theta = -flight.turns * 2 * Math.PI * (1 - easeOutQuint(spinU));
  let quat: Quat = multiplyQuat(quatFromAxisAngle(flight.tumbleAxis, theta), ctx.rest);

  if (t > gStart) {
    quat = slerp(ctx.rest, ctx.gather, easeInOutCubic(phaseProgress(t, gStart, PHASES.gather.end)));
  }
  if (t > sStart) {
    // On the way out the die spins up again — it reads as being pulled away
    // rather than merely shrinking.
    const outU = phaseProgress(t, sStart, sEnd);
    quat = multiplyQuat(quatFromAxisAngle(flight.tumbleAxis, outU * outU * 6), ctx.gather);
  }

  // --- Position ----------------------------------------------------------
  let pos: Vec3;
  let scale = flight.restScale;

  if (t >= sStart) {
    const u = easeInCubic(phaseProgress(t, sStart, sEnd));
    pos = lerpVec(flight.gather, ctx.suckTarget, u);
    scale = flight.gatherScale * (1 - u);
  } else if (t >= gStart) {
    const u = easeInOutCubic(phaseProgress(t, gStart, PHASES.gather.end));
    pos = lerpVec(flight.rest, flight.gather, u);
    scale = lerp(flight.restScale, flight.gatherScale, u);
  } else if (t >= PHASES.land.start) {
    // Settling: a damped bounce whose envelope reaches exactly zero at land.end,
    // so `hold` begins with the die genuinely at rest rather than nearly so.
    const u = phaseProgress(t, PHASES.land.start, landEnd);
    const height = flight.bounce * Math.abs(Math.sin(Math.PI * 2 * u)) * (1 - u) ** 2;
    pos = [flight.rest[0], flight.rest[1] + height, flight.rest[2]];
  } else {
    const u = phaseProgress(t, PHASES.throw.start + flight.throwDelay, PHASES.throw.end);
    const flat = easeOutCubic(u);
    const fall = easeInQuad(u);
    pos = [
      lerp(flight.entry[0], flight.rest[0], flat),
      lerp(flight.entry[1], flight.rest[1], fall) + flight.arc * Math.sin(Math.PI * u),
      lerp(flight.entry[2], flight.rest[2], flat),
    ];
  }

  // Fade only over the last stretch of the pull-away: fading from the start
  // would make the dice look like they dissolve rather than travel.
  const opacity = t < sStart ? 1 : 1 - clamp01((phaseProgress(t, sStart, sEnd) - 0.6) / 0.4);

  return { pos, quat, scale, opacity };
}

// ---------------------------------------------------------------------------
// Which crits actually get an effect
// ---------------------------------------------------------------------------

/**
 * The bursts a roll earns.
 *
 * CANCELLED CRITS GET NOTHING, and that is a rules decision rather than a matter
 * of taste. findCritTriggers' own documentation says a cancelled trigger
 * „verliert seine Sonderbedeutung" — it keeps only its confirmation roll. This
 * app treats its visuals as information (see the reduced-motion reasoning in
 * styles.css), so firing fireworks for a 1 the ruleset has already declared
 * meaningless would be the animation lying about the rules — and the feed row
 * appearing seconds later would contradict it in writing.
 *
 * A roll of one 1 and one 20 therefore produces a deliberately anticlimactic
 * performance: the dice land, are held up, and are pulled away with nothing
 * bursting. That is the correct reading of "they cancelled each other out".
 */
export function effectTriggers(dice: readonly number[], sides: number | readonly number[]): CritTrigger[] {
  return findCritTriggers([...dice], typeof sides === 'number' ? sides : [...sides])
    .filter((trigger) => !trigger.cancelled)
    .slice(0, MAX_EFFECT_BURSTS);
}

/** Whether this roll gets the long effect beat at all. */
export function hasSurvivingCrit(dice: readonly number[], sides: number | readonly number[]): boolean {
  return effectTriggers(dice, sides).length > 0;
}
