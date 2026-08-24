// The WebGL stage for a „großer Wurf".
//
// This is the ONLY module that imports three at runtime, and it is reached only
// through a dynamic import() (see preload.ts). That is not a style preference:
// three is roughly 131 KB gzipped, larger than the rest of this app's bundle put
// together, and it is served from a home connection. A single static import of
// this file from anything reachable by App.tsx would silently move all of it
// into the chunk every page load fetches.
//
// Nothing here decides WHAT happens — that is shared/src/diceCinematic.ts, whose
// poseAt() is a closed-form function of elapsed time. This module only turns a
// pose into pixels, so a slow machine and a fast one show the same performance
// sampled at different rates.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  DIE_EXTENT,
  PHASES,
  effectTriggers,
  TABLE_Y,
  VIEW_HEIGHT,
  buildFlights,
  faceTargetQuaternion,
  normalize,
  phaseProgress,
  poseAt,
  type DieFlight,
  type FlightContext,
  type Vec3,
} from '@shared/diceCinematic';
import type { CritTrigger } from '@shared/dice';
import { createEffects, type EffektFarben, type Effekte } from './effects';
import { beschriftungFuer, atlasFuer } from './faces';
import { faceIndexFor, solidFor } from './geometry';

const FOV = 38;
/** How far the camera is tipped down toward the table. */
const NEIGUNG = (12 * Math.PI) / 180;
/** Shadows cost more than they are worth on a phone. */
const SCHATTEN_AB_BREITE = 700;

export interface StageWuerfel {
  sides: number;
  value: number;
  /** Resolved CSS colour of the die body. */
  koerper: string;
  /** Resolved CSS colour for the number on it. */
  tinte: string;
}

export interface StageOptions {
  seed: number;
  wuerfel: StageWuerfel[];
  hasCrit: boolean;
  /** Colours for the crit effects, resolved from the app's own tokens. */
  effektFarben: EffektFarben;
  /**
   * Where the dice are pulled at the end, in VIEWPORT PIXELS — the chat dock.
   *
   * The one deliberate exception to "layout is resolution-independent", and it
   * is the correct one: everyone seeing the same animation is not violated by
   * the dice converging on each viewer's own chat window.
   */
  saugZielPx: { x: number; y: number } | null;
}

export interface Stage {
  /** Draw the frame for `t` milliseconds into the performance. */
  render(t: number): void;
  dispose(): void;
}

export function createStage(canvas: HTMLCanvasElement, opts: StageOptions): Stage {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearAlpha(0);
  // Same cap BannerFx uses. A 3× phone renders at 2×, which is a necessity
  // rather than a compromise.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);

  // Fixed vertical fit: VIEW_HEIGHT world units always span the canvas height,
  // whatever the aspect ratio. Aspect only ever adds or removes empty margin at
  // the sides — it never moves a die. See rule 3 in diceCinematic.ts.
  const abstand = VIEW_HEIGHT / 2 / Math.tan((FOV * Math.PI) / 360);
  camera.position.set(0, Math.sin(NEIGUNG) * abstand, Math.cos(NEIGUNG) * abstand);
  camera.lookAt(0, 0, 0);

  scene.add(new AmbientLight(0xffffff, 0.62));
  const sonne = new DirectionalLight(0xffffff, 1.15);
  sonne.position.set(-4, 8, 5);
  scene.add(sonne);

  // Shadows land on a plane that renders NOTHING but them, so the dice look
  // grounded while the page still shows through the dim behind the canvas.
  const schattenEbene = new PlaneGeometry(40, 40);
  const SCHATTEN_STAERKE = 0.3;
  const schattenStoff = new ShadowMaterial({ opacity: SCHATTEN_STAERKE });
  const boden = new Mesh(schattenEbene, schattenStoff);
  boden.rotation.x = -Math.PI / 2;
  boden.receiveShadow = true;
  scene.add(boden);

  const flights: DieFlight[] = buildFlights(
    opts.seed,
    opts.wuerfel.map((w) => w.sides),
    opts.wuerfel.map((w) => w.value),
  );

  const schatten = window.innerWidth >= SCHATTEN_AB_BREITE;
  renderer.shadowMap.enabled = schatten;
  sonne.castShadow = schatten;
  if (schatten) {
    sonne.shadow.mapSize.set(512, 512);
    const k = sonne.shadow.camera;
    k.left = -7;
    k.right = 7;
    k.top = 7;
    k.bottom = -7;
    k.near = 1;
    k.far = 25;
    k.updateProjectionMatrix();
  }

  // The dice rest ON the table rather than half inside it.
  boden.position.y = TABLE_Y - (flights[0]?.restScale ?? 1) * 0.92;

  const gruppe = new Group();
  scene.add(gruppe);

  const kameraRichtung = new Vector3().copy(camera.position).normalize();
  const zurKamera: Vec3 = normalize([kameraRichtung.x, kameraRichtung.y, kameraRichtung.z]);

  interface Aufbau {
    flight: DieFlight;
    mesh: Mesh;
    stoff: MeshStandardMaterial;
    ctx: FlightContext;
  }

  const aufbauten: Aufbau[] = flights.map((flight, i) => {
    const w = opts.wuerfel[i];
    const solid = solidFor(w.sides);
    const flaechen = solid.faceNormals.length;
    const k = faceIndexFor(w.sides, w.value, flaechen);
    const normale = solid.faceNormals[k] ?? ([0, 1, 0] as Vec3);

    const stoff = new MeshStandardMaterial({
      map: atlasFuer({
        sides: w.sides,
        flaechen,
        beschriftung: beschriftungFuer(w.sides, w.value, flaechen),
        koerper: w.koerper,
        tinte: w.tinte,
      }),
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
    });
    const mesh = new Mesh(solid.geometry, stoff);
    mesh.castShadow = schatten;
    gruppe.add(mesh);

    return {
      flight,
      mesh,
      stoff,
      ctx: {
        // Resting: the rolled face up. Gathered: the same face turned to the
        // camera, which is the pose the table actually reads.
        rest: faceTargetQuaternion(normale, [0, 1, 0], flight.restSpin),
        gather: faceTargetQuaternion(normale, zurKamera, flight.gatherSpin),
        suckTarget: [0, 0, 0],
        hasCrit: opts.hasCrit,
      },
    };
  });

  // --- viewport pixels → world units ---------------------------------------
  let saugZiel: Vec3 = [0, 0, 0];
  function bestimmeSaugZiel(): void {
    const halbeHoehe = VIEW_HEIGHT / 2;
    const halbeBreite = halbeHoehe * (canvas.clientWidth / Math.max(1, canvas.clientHeight));
    if (!opts.saugZielPx) {
      // No dock on screen: the bottom-right corner is still where a chat lives.
      saugZiel = [halbeBreite * 0.86, -halbeHoehe * 0.86, 0];
      return;
    }
    const x = (opts.saugZielPx.x / Math.max(1, window.innerWidth)) * 2 - 1;
    const y = (opts.saugZielPx.y / Math.max(1, window.innerHeight)) * 2 - 1;
    saugZiel = [x * halbeBreite, -y * halbeHoehe, 0];
  }

  function passeAn(): void {
    const breite = canvas.clientWidth || window.innerWidth;
    const hoehe = canvas.clientHeight || window.innerHeight;
    renderer.setSize(breite, hoehe, false);
    camera.aspect = breite / Math.max(1, hoehe);
    camera.updateProjectionMatrix();
    bestimmeSaugZiel();
    for (const a of aufbauten) a.ctx.suckTarget = saugZiel;
  }
  passeAn();

  const beobachter = new ResizeObserver(passeAn);
  beobachter.observe(canvas);

  // Which dice earned an effect. Cancelled crits are already filtered out in
  // shared, because that is a rules decision rather than a visual one.
  const seitenAlle = opts.wuerfel.map((w) => w.sides);
  const ausloeser: CritTrigger[] = effectTriggers(
    opts.wuerfel.map((w) => w.value),
    seitenAlle,
  );
  const gatherOrte = new Map<number, Vec3>();
  for (const a of aufbauten) gatherOrte.set(a.flight.index, a.flight.gather);
  const effekte: Effekte = createEffects(gruppe, {
    seed: opts.seed,
    triggers: ausloeser,
    positionen: gatherOrte,
    farben: opts.effektFarben,
    zurKamera: camera.quaternion.clone(),
  });

  const pos = new Vector3();
  const quat = new Quaternion();

  return {
    render(t: number): void {
      // The table only exists while the dice are on it. Once they lift toward
      // the camera their shadows would otherwise stay behind as a dark smudge
      // on a surface nothing is resting on any more.
      schattenStoff.opacity = SCHATTEN_STAERKE * (1 - phaseProgress(t, PHASES.gather.start, PHASES.gather.start + 400));

      for (const a of aufbauten) {
        const pose = poseAt(a.flight, a.ctx, t);
        pos.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        quat.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
        a.mesh.position.copy(pos);
        a.mesh.quaternion.copy(quat);
        a.mesh.scale.setScalar(pose.scale);
        a.stoff.opacity = pose.opacity;
        const glut = effekte.glut(a.flight.index, t);
        if (glut) {
          a.stoff.emissive.copy(glut.farbe);
          a.stoff.emissiveIntensity = glut.staerke;
        }
        // A die scaled to nothing still costs a draw call.
        a.mesh.visible = pose.scale > 0.001 && pose.opacity > 0.01;
      }
      effekte.update(t);
      renderer.render(scene, camera);
    },

    dispose(): void {
      beobachter.disconnect();
      effekte.dispose();
      for (const a of aufbauten) {
        gruppe.remove(a.mesh);
        // The GEOMETRY is module-scope cached and shared by every die of its
        // type, so it is deliberately not disposed here. The material is ours.
        a.stoff.dispose();
      }
      scene.remove(gruppe);
      scene.remove(boden);
      schattenEbene.dispose();
      schattenStoff.dispose();
      renderer.dispose();
      // The part everyone forgets, and exactly what produces "too many active
      // WebGL contexts" after a dozen or so rolls in Chrome: dispose() releases
      // three's own objects but not the browser's context.
      renderer.forceContextLoss();
    },
  };
}

/** Circumradius of a die at scale 1 — re-exported so callers need not guess. */
export const WUERFEL_RADIUS = DIE_EXTENT;

/** Turn a colour token into something the atlas can paint with. */
export function farbeAus(wert: string, ersatz: string): string {
  const s = wert.trim();
  if (!s) return ersatz;
  try {
    return new Color(s).getStyle();
  } catch {
    return s;
  }
}
