// What a surviving crit looks like.
//
// The dividing line with CSS: anything positioned in 3D SPACE is WebGL, anything
// that colours the WHOLE SCREEN is CSS. Sparks have to be able to pass behind
// the die being held up, which a separate 2D overlay could never do — it is
// always entirely in front or entirely behind — while the dim pulsing darker on
// a fumble is one fixed div and belongs in the stylesheet next to its own
// reduced-motion override.
//
// Like everything else in the cinematic, every value here is a closed-form
// function of elapsed time. Particles follow p(τ) = p₀ + v·τ + ½·g·τ², not a
// velocity accumulator, so the burst looks the same at 30 Hz and at 144 Hz.
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  DoubleSide,
} from 'three';
import { EFFECT_STAGGER_MS, PHASES, mulberry32, phaseProgress, type Vec3 } from '@shared/diceCinematic';
import type { CritTrigger } from '@shared/dice';

/**
 * A round, soft-edged spark.
 *
 * PointsMaterial draws plain squares without this, and at spark size that reads
 * as pixel litter rather than as light. Built once at module scope from a
 * radial gradient — no asset, same argument as the face atlas.
 */
let funkenTextur: CanvasTexture | null = null;
function funkenBild(): CanvasTexture {
  if (funkenTextur) return funkenTextur;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  funkenTextur = new CanvasTexture(cv);
  return funkenTextur;
}

/** Sparks per burst. Enough to read as a shower, few enough for one draw call. */
const FUNKEN = 140;
const FUNKEN_DAUER = 1500;
const SCHOCK_DAUER = 520;
const RISS_DAUER = 260;
/** Downward pull on the sparks, in world units per second squared. */
const SCHWERKRAFT = -9;

export interface EffektFarben {
  /** Gold — the app's own --mastery. */
  gold: string;
  /** The blue the feed already gives a natural 1 (--over-line). */
  glueck: string;
  /** The red the feed already gives a natural 20 (--crit-line). */
  patzer: string;
}

export interface EffektOptionen {
  seed: number;
  triggers: CritTrigger[];
  /** Where each die is held up, by die index. */
  positionen: Map<number, Vec3>;
  farben: EffektFarben;
  /** Orientation that turns a flat shape to face the camera. */
  zurKamera: Quaternion;
}

interface Burst {
  /** Milliseconds into the performance at which this burst begins. */
  ab: number;
  trigger: 20 | 1;
  ursprung: Vec3;
  punkte?: Points;
  geschwindigkeiten?: Float32Array;
  ringe: Mesh[];
  riss?: LineSegments;
}

export interface Effekte {
  update(t: number): void;
  /** Emissive strength and colour for a die at time `t`, or null for none. */
  glut(dieIndex: number, t: number): { farbe: Color; staerke: number } | null;
  dispose(): void;
}

export function createEffects(eltern: Group, opts: EffektOptionen): Effekte {
  const gruppe = new Group();
  eltern.add(gruppe);

  const gold = new Color(opts.farben.gold);
  const glueck = new Color(opts.farben.glueck);
  const patzer = new Color(opts.farben.patzer);

  const zuEntsorgen: { dispose(): void }[] = [];
  const bursts: Burst[] = [];

  opts.triggers.forEach((trigger, i) => {
    const ursprung = opts.positionen.get(trigger.dieIndex) ?? ([0, 0, 0] as Vec3);
    // Bursts play in DIE ORDER, staggered, so three crits read as a sequence
    // telling the story of the roll rather than one indistinct flash.
    const ab = PHASES.effect.start + i * EFFECT_STAGGER_MS;
    // Seeded per die, so the sparks fly the same way on every screen while
    // still differing between dice.
    const rnd = mulberry32((opts.seed ^ ((trigger.dieIndex + 1) * 0x9e3779b9)) >>> 0);
    const burst: Burst = { ab, trigger: trigger.trigger, ursprung, ringe: [] };

    if (trigger.trigger === 1) {
      // --- critical success: fireworks -------------------------------------
      const orte = new Float32Array(FUNKEN * 3);
      const farben = new Float32Array(FUNKEN * 3);
      const tempo = new Float32Array(FUNKEN * 3);
      const mische = new Color();
      for (let p = 0; p < FUNKEN; p++) {
        // Evenly distributed directions: acos gives an unbiased polar angle,
        // where a naive uniform angle would bunch sparks at the poles.
        const phi = rnd() * Math.PI * 2;
        const theta = Math.acos(2 * rnd() - 1);
        const v = 1.6 + rnd() * 3.4;
        tempo[p * 3] = Math.sin(theta) * Math.cos(phi) * v;
        tempo[p * 3 + 1] = Math.cos(theta) * v * 0.85 + 1.2;
        tempo[p * 3 + 2] = Math.sin(theta) * Math.sin(phi) * v;
        orte[p * 3] = ursprung[0];
        orte[p * 3 + 1] = ursprung[1];
        orte[p * 3 + 2] = ursprung[2];
        // Gold shading into the blue the feed uses for a natural 1, so the
        // burst and the chat entry afterwards are recognisably the same event.
        mische.copy(gold).lerp(glueck, rnd() * 0.55);
        farben[p * 3] = mische.r;
        farben[p * 3 + 1] = mische.g;
        farben[p * 3 + 2] = mische.b;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(orte, 3));
      geo.setAttribute('color', new Float32BufferAttribute(farben, 3));
      const stoff = new PointsMaterial({
        size: 0.2,
        map: funkenBild(),
        alphaTest: 0.01,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      });
      const punkte = new Points(geo, stoff);
      punkte.visible = false;
      gruppe.add(punkte);
      zuEntsorgen.push(geo, stoff);
      burst.punkte = punkte;
      burst.geschwindigkeiten = tempo;
    } else {
      // --- critical failure: shockwave and cracks ---------------------------
      for (const verzug of [0, 0.4]) {
        const geo = new RingGeometry(0.62, 0.78, 48);
        const stoff = new MeshBasicMaterial({
          color: patzer,
          transparent: true,
          side: DoubleSide,
          depthWrite: false,
        });
        const ring = new Mesh(geo, stoff);
        ring.position.set(ursprung[0], ursprung[1], ursprung[2]);
        ring.quaternion.copy(opts.zurKamera);
        ring.visible = false;
        ring.userData.verzug = verzug;
        gruppe.add(ring);
        zuEntsorgen.push(geo, stoff);
        burst.ringe.push(ring);
      }

      // Jagged radial lines, drawn in rather than fracturing the mesh: far
      // cheaper, and far more legible at this size.
      const strahlen = 24;
      const punkte: number[] = [];
      for (let r = 0; r < strahlen; r++) {
        const winkel = (r / strahlen) * Math.PI * 2 + rnd() * 0.16;
        let radius = 0.55;
        let x = Math.cos(winkel) * radius;
        let y = Math.sin(winkel) * radius;
        const glieder = 3;
        for (let g = 0; g < glieder; g++) {
          const naechster = radius + 0.35 + rnd() * 0.5;
          const knick = winkel + (rnd() - 0.5) * 0.5;
          const nx = Math.cos(knick) * naechster;
          const ny = Math.sin(knick) * naechster;
          punkte.push(x, y, 0, nx, ny, 0);
          x = nx;
          y = ny;
          radius = naechster;
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(punkte, 3));
      const stoff = new LineBasicMaterial({ color: patzer, transparent: true, depthWrite: false });
      const riss = new LineSegments(geo, stoff);
      riss.position.set(ursprung[0], ursprung[1], ursprung[2]);
      riss.quaternion.copy(opts.zurKamera);
      riss.visible = false;
      gruppe.add(riss);
      zuEntsorgen.push(geo, stoff);
      burst.riss = riss;
    }

    bursts.push(burst);
  });

  /** Which burst, if any, belongs to this die. */
  const proWuerfel = new Map<number, Burst>();
  opts.triggers.forEach((trigger, i) => proWuerfel.set(trigger.dieIndex, bursts[i]));

  return {
    update(t: number): void {
      for (const burst of bursts) {
        if (burst.punkte && burst.geschwindigkeiten) {
          const u = phaseProgress(t, burst.ab, burst.ab + FUNKEN_DAUER);
          burst.punkte.visible = t >= burst.ab && u < 1;
          if (burst.punkte.visible) {
            const tau = (t - burst.ab) / 1000;
            const attr = burst.punkte.geometry.getAttribute('position') as Float32BufferAttribute;
            const arr = attr.array as Float32Array;
            for (let p = 0; p < FUNKEN; p++) {
              const v = burst.geschwindigkeiten;
              arr[p * 3] = burst.ursprung[0] + v[p * 3] * tau;
              arr[p * 3 + 1] = burst.ursprung[1] + v[p * 3 + 1] * tau + 0.5 * SCHWERKRAFT * tau * tau;
              arr[p * 3 + 2] = burst.ursprung[2] + v[p * 3 + 2] * tau;
            }
            attr.needsUpdate = true;
            const stoff = burst.punkte.material as PointsMaterial;
            // Bright while they fly, gone by the time they would land.
            stoff.opacity = 1 - u * u;
          }
        }

        for (const ring of burst.ringe) {
          const verzug = (ring.userData.verzug as number) * SCHOCK_DAUER;
          const u = phaseProgress(t, burst.ab + verzug, burst.ab + verzug + SCHOCK_DAUER);
          ring.visible = t >= burst.ab + verzug && u < 1;
          if (ring.visible) {
            ring.scale.setScalar(0.1 + u * 5.9);
            (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - u) ** 2;
          }
        }

        if (burst.riss) {
          const u = phaseProgress(t, burst.ab, burst.ab + RISS_DAUER);
          const halten = phaseProgress(t, burst.ab + RISS_DAUER, burst.ab + FUNKEN_DAUER);
          burst.riss.visible = t >= burst.ab && halten < 1;
          if (burst.riss.visible) {
            burst.riss.scale.setScalar(0.35 + u * 0.9);
            (burst.riss.material as LineBasicMaterial).opacity = 0.95 * u * (1 - halten);
          }
        }
      }
    },

    glut(dieIndex: number, t: number) {
      const burst = proWuerfel.get(dieIndex);
      if (!burst) return null;
      if (burst.trigger === 20) {
        // A fumble shows from the GATHER onward, so the turn toward the camera
        // IS the reveal — and it stays, because the die is what went wrong.
        const an = phaseProgress(t, PHASES.gather.start, PHASES.gather.end);
        return { farbe: patzer, staerke: an * 0.75 };
      }
      // A natural 1 flares with its burst and settles back.
      const u = phaseProgress(t, burst.ab, burst.ab + 900);
      return { farbe: gold, staerke: t < burst.ab ? 0 : Math.sin(u * Math.PI) * 0.8 };
    },

    dispose(): void {
      for (const d of zuEntsorgen) d.dispose();
      eltern.remove(gruppe);
    },
  };
}
