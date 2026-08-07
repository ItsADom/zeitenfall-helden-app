import { useEffect, useRef } from 'react';

// Animierte Kopfleisten-Effekte je Theme, auf einem Canvas gezeichnet. Jeder
// Effekt passt zur Region Aventuriens. Bewusst dezent, damit die Leiste lebt,
// ohne vom Inhalt abzulenken. Respektiert prefers-reduced-motion (Standbild) und
// pausiert im Hintergrund-Tab.

type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (v: number, m: number) => ((v % m) + m) % m;

// Thorwal: rollende, tideartige Wellen (Fluss + vor/zurück brandend, wechselnde Höhen)
function makeWaves(w: number, h: number): Draw {
  const L = [
    { fill: 'rgba(255,255,255,0.06)', base: 0.5, amp: 7, amp2: 3, f: 0.011, f2: 0.024, tideA: 1.0, tideS: 0.00022, ampS: 0.00034, ph: 0 },
    { fill: 'rgba(255,255,255,0.09)', base: 0.64, amp: 9, amp2: 4, f: 0.008, f2: 0.019, tideA: 1.4, tideS: 0.00031, ampS: 0.00026, ph: 2.1 },
    { fill: 'rgba(255,255,255,0.13)', base: 0.8, amp: 6, amp2: 3, f: 0.015, f2: 0.031, tideA: 1.8, tideS: 0.0004, ampS: 0.00045, ph: 4.2 },
  ];
  // Gischt/Schaum-Flöckchen, die über den Wellen treiben und leicht funkeln
  const foam = Array.from({ length: Math.min(30, Math.max(8, Math.round(w / 40))) }, () => ({ x: rand(0, w), y: rand(h * 0.4, h * 0.92), r: rand(0.6, 1.7), spd: rand(-10, 18), bob: rand(1, 3), bobS: rand(0.001, 0.002), ph: rand(0, 6.28), tw: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
    for (const l of L) {
      const swell = 0.575 + 0.425 * Math.sin(t * l.ampS + l.ph);
      const tide = l.tideA * Math.sin(t * l.tideS + l.ph);
      ctx.beginPath();
      ctx.moveTo(0, H + 2);
      for (let x = 0; x <= W; x += 6) {
        const y = H * l.base + l.amp * swell * Math.sin(x * l.f + tide + l.ph) + l.amp2 * Math.sin(x * l.f2 + t * 0.0005 + l.ph);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H + 2);
      ctx.closePath();
      ctx.fillStyle = l.fill;
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (const f of foam) {
      const x = wrap(f.x + t * 0.001 * f.spd, W + 6);
      const y = f.y + Math.sin(t * f.bobS + f.ph) * f.bob;
      ctx.globalAlpha = 0.1 + 0.14 * (0.5 + 0.5 * Math.sin(t * 0.0006 + f.tw));
      ctx.beginPath();
      ctx.arc(x, y, f.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}

// Khôm: greller Sonnenschein von oben, darunter wehender Sand und Dünenkämme
function makeSand(w: number, h: number): Draw {
  const n = Math.min(140, Math.round(w / 12));
  const g = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), s: rand(0.6, 1.8), spd: rand(12, 30), amp: rand(1, 4), ph: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
    const sun = ctx.createRadialGradient(W * 0.5, -H * 0.4, 0, W * 0.5, -H * 0.4, H * 2.4);
    sun.addColorStop(0, 'rgba(255,238,200,0.20)');
    sun.addColorStop(1, 'rgba(255,238,200,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 2; k++) {
      const a = 3 + k * 2;
      ctx.beginPath();
      ctx.moveTo(0, H + 2);
      for (let x = 0; x <= W; x += 8) {
        const y = H * (0.72 + 0.12 * k) + Math.sin(x * 0.01 + t * 0.0002 + k * 0.6) * a;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H + 2);
      ctx.closePath();
      ctx.fillStyle = k ? 'rgba(0,0,0,0.05)' : 'rgba(255,240,220,0.05)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,244,225,1)';
    ctx.globalAlpha = 0.13;
    for (const p of g) {
      const x = wrap(p.x + t * 0.001 * p.spd, W + 8);
      const y = p.y + Math.sin(t * 0.0012 + p.ph) * p.amp;
      ctx.fillRect(x, y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  };
}

// Bornland: viele Blätter, die fallen UND seitwärts driften (keine festen Spalten)
function makeLeaves(w: number, h: number): Draw {
  const n = Math.min(42, Math.max(16, Math.round(w / 40)));
  const L = Array.from({ length: n }, () => ({
    x: rand(0, w), y: rand(0, h), r: rand(2.2, 4.8), vy: rand(4, 11), vx: rand(-6, 16),
    sway: rand(4, 12), swayS: rand(0.0008, 0.0018), rot: rand(0, 6.28), rotS: rand(-0.0013, 0.0013), ph: rand(0, 6.28),
  }));
  return (ctx, t, W, H) => {
    ctx.fillStyle = 'rgba(210,235,200,0.18)';
    for (const lf of L) {
      const y = wrap(lf.y + t * 0.001 * lf.vy, H + 12);
      const x = wrap(lf.x + t * 0.001 * lf.vx + Math.sin(t * lf.swayS + lf.ph) * lf.sway, W + 12);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lf.rot + t * lf.rotS);
      ctx.beginPath();
      ctx.ellipse(0, 0, lf.r, lf.r * 0.5, 0, 0, 6.28);
      ctx.fill();
      ctx.restore();
    }
  };
}

// Drachensteine: gezackte Bergsilhouetten + Vulkanglut, davor aufsteigende Funken
function makeDragon(w: number, h: number): Draw {
  // Rauer, ungleichmäßiger Grat: gejitterte x-Abstände, breite Höhenspanne und
  // gelegentliche scharfe Spitzen über das Band hinaus — kein „aufgeräumtes" Profil.
  const ridge = (count: number, top: number, bot: number, spike: number) => {
    const p: { x: number; y: number }[] = [{ x: 0, y: rand(top, bot) * h }];
    for (let i = 1; i < count; i++) {
      const x = (i / count) * w + rand(-0.34, 0.34) * (w / count);
      let yf = rand(top, bot);
      if (Math.random() < spike) yf = top - rand(0.03, 0.14); // scharfe Spitze
      p.push({ x, y: yf * h });
    }
    p.push({ x: w, y: rand(top, bot) * h });
    p.sort((a, b) => a.x - b.x);
    return p;
  };
  const back = ridge(11, 0.28, 0.62, 0.28);
  const front = ridge(15, 0.46, 0.9, 0.32);
  const fillRidge = (ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], H: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(0, H + 2);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(w, H + 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const n = Math.min(46, Math.max(16, Math.round(w / 34)));
  const e = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.7, 2), spd: rand(6, 16), drift: rand(-6, 6), driftS: rand(0.0008, 0.0016), ph: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
    const glow = ctx.createRadialGradient(W * 0.5, H * 1.15, 0, W * 0.5, H * 1.15, H * 1.7);
    glow.addColorStop(0, 'rgba(255,120,80,0.12)');
    glow.addColorStop(1, 'rgba(255,120,80,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    fillRidge(ctx, back, H, 'rgba(0,0,0,0.13)');
    ctx.fillStyle = 'rgba(255,190,150,1)';
    for (const p of e) {
      const prog = wrap(t * 0.001 * p.spd + p.y, H + 10);
      const y = H - prog;
      const x = p.x + Math.sin(t * p.driftS + p.ph) * p.drift;
      ctx.globalAlpha = Math.max(0, 0.32 - 0.32 * (prog / H));
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    fillRidge(ctx, front, H, 'rgba(0,0,0,0.24)');
  };
}

// Gareth: eine goldene Lichtsäule, die alle paar Sekunden einmal von links nach
// rechts über die Leiste zieht — dazu feine goldene Motes.
function makeShimmer(w: number, h: number): Draw {
  const motes = Array.from({ length: Math.min(18, Math.max(6, Math.round(w / 70))) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.8, 1.8), spd: rand(3, 8), ph: rand(0, 6.28) }));
  // immer von links nach rechts, ruhiges Tempo, mehrere Sekunden Pause dazwischen
  const spawn = () => ({ x0: rand(w * 0.02, w * 0.45), dist: rand(w * 0.16, w * 0.34), dur: rand(750, 1150), gap: rand(2600, 4600), half: rand(30, 52), born: 0 });
  const c = { ...spawn(), born: -rand(0, 1500) };
  return (ctx, t, W, H) => {
    let age = t - c.born;
    if (age > c.dur + c.gap) {
      Object.assign(c, spawn());
      c.born = t;
      age = 0;
    }
    if (age <= c.dur) {
      const p = age / c.dur;
      const env = Math.sin(Math.PI * p); // sanft auf- und abblenden
      const x = c.x0 + c.dist * p; // immer nach rechts
      const g = ctx.createLinearGradient(x - c.half, 0, x + c.half, 0);
      g.addColorStop(0, 'rgba(255,244,215,0)');
      g.addColorStop(0.5, `rgba(255,247,224,${0.32 * env})`);
      g.addColorStop(1, 'rgba(255,244,215,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - c.half, 0, c.half * 2, H);
    }
    ctx.fillStyle = 'rgba(255,235,190,1)';
    ctx.globalAlpha = 0.13;
    for (const m of motes) {
      const x = wrap(m.x + t * 0.001 * m.spd, W + 6);
      const y = m.y + Math.sin(t * 0.0009 + m.ph) * 3;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}

// Schattenlande: wirbelnder, verschmelzender Nebel — Schwaden kreisen auf Bahnen
// und rotieren dabei, sodass sie sich winden (deutlich anders als die Wellen).
function makeFog(w: number, h: number): Draw {
  const N = 5;
  const b = Array.from({ length: N }, (_, i) => ({
    cx: rand(0, w), cy: rand(h * 0.3, h * 0.7), rx: rand(w * 0.16, w * 0.32), ry: rand(h * 0.8, h * 1.5),
    ax: rand(w * 0.08, w * 0.2), ay: rand(h * 0.2, h * 0.5),
    sx: rand(0.00012, 0.00026) * (i % 2 ? -1 : 1), sy: rand(0.00018, 0.00036) * (i % 2 ? 1 : -1),
    rot: rand(0, 6.28), rotS: rand(0.00012, 0.0003) * (i % 2 ? 1 : -1), ph: rand(0, 6.28), op: rand(0.05, 0.1),
  }));
  // herabschwebende Asche: teils dunkle Flocken (gegen den Nebel sichtbar),
  // teils fahles Grau (gegen den dunklen Grund sichtbar)
  const ash = Array.from({ length: Math.min(36, Math.max(12, Math.round(w / 38))) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.6, 1.7), vy: rand(3, 8), vx: rand(-4, 8), sway: rand(3, 10), swayS: rand(0.0007, 0.0016), ph: rand(0, 6.28), dark: Math.random() < 0.5 }));
  return (ctx, t, W, H) => {
    for (const s of b) {
      const cx = s.cx + Math.sin(t * s.sx + s.ph) * s.ax;
      const cy = s.cy + Math.cos(t * s.sy + s.ph) * s.ay;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.rot + t * s.rotS);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(s.rx, s.ry));
      g.addColorStop(0, `rgba(205,212,228,${s.op})`);
      g.addColorStop(1, 'rgba(205,212,228,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, 6.28);
      ctx.fill();
      ctx.restore();
    }
    for (const p of ash) {
      const y = wrap(p.y + t * 0.001 * p.vy, H + 8);
      const x = wrap(p.x + t * 0.001 * p.vx + Math.sin(t * p.swayS + p.ph) * p.sway, W + 8);
      ctx.globalAlpha = p.dark ? 0.28 : 0.16;
      ctx.fillStyle = p.dark ? 'rgba(24,22,20,1)' : 'rgba(150,145,140,1)';
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}

function makeEffect(theme: string, w: number, h: number): Draw | null {
  switch (theme) {
    case 'koenigsblau':
      return makeWaves(w, h);
    case 'rot':
      return makeSand(w, h);
    case 'wald':
      return makeLeaves(w, h);
    case 'amethyst':
      return makeDragon(w, h);
    case 'bronze':
      return makeShimmer(w, h);
    case 'nacht':
      return makeFog(w, h);
    default:
      return null;
  }
}

export default function BannerFx({ theme }: { theme: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    measure();
    // Mit makeEffect initialisieren (Typ Draw | null), damit die Variable nicht
    // auf 'null' eingeengt wird und die Aufrufe unten typprüfen.
    let draw = makeEffect(theme, w, h);
    const resize = () => {
      measure();
      draw = makeEffect(theme, w, h); // Partikel-Zustand an die neue Größe anpassen
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const loop = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      if (draw) draw(ctx, t, w, h);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) {
      ctx.clearRect(0, 0, w, h);
      draw?.(ctx, 0, w, h); // ein ruhiges Standbild
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onVis = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduce && !raf) {
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [theme]);

  return <canvas ref={ref} className="banner-canvas" aria-hidden="true" />;
}
