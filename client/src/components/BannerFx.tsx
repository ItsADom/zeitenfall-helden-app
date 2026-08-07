import { useEffect, useRef } from 'react';

// Animierte Kopfleisten-Effekte je Theme, auf einem Canvas gezeichnet. Jeder
// Effekt passt zur Region Aventuriens. Bewusst dezent, damit die Leiste lebt,
// ohne vom Inhalt abzulenken. Respektiert prefers-reduced-motion (Standbild) und
// pausiert im Hintergrund-Tab.

type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (v: number, m: number) => ((v % m) + m) % m;

// Thorwal: rollende, tideartige Wellen (Fluss + vor/zurück brandend, wechselnde Höhen)
function makeWaves(): Draw {
  const L = [
    { fill: 'rgba(255,255,255,0.06)', base: 0.5, amp: 7, amp2: 3, f: 0.011, f2: 0.024, tideA: 1.0, tideS: 0.00022, ampS: 0.00034, ph: 0 },
    { fill: 'rgba(255,255,255,0.09)', base: 0.64, amp: 9, amp2: 4, f: 0.008, f2: 0.019, tideA: 1.4, tideS: 0.00031, ampS: 0.00026, ph: 2.1 },
    { fill: 'rgba(255,255,255,0.13)', base: 0.8, amp: 6, amp2: 3, f: 0.015, f2: 0.031, tideA: 1.8, tideS: 0.0004, ampS: 0.00045, ph: 4.2 },
  ];
  return (ctx, t, w, h) => {
    for (const l of L) {
      const swell = 0.575 + 0.425 * Math.sin(t * l.ampS + l.ph);
      const tide = l.tideA * Math.sin(t * l.tideS + l.ph);
      ctx.beginPath();
      ctx.moveTo(0, h + 2);
      for (let x = 0; x <= w; x += 6) {
        const y = h * l.base + l.amp * swell * Math.sin(x * l.f + tide + l.ph) + l.amp2 * Math.sin(x * l.f2 + t * 0.0005 + l.ph);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h + 2);
      ctx.closePath();
      ctx.fillStyle = l.fill;
      ctx.fill();
    }
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
  const ridge = (count: number, top: number, bot: number) => {
    const p: { x: number; y: number }[] = [];
    for (let i = 0; i <= count; i++) p.push({ x: (i / count) * w, y: rand(top, bot) * h });
    return p;
  };
  const back = ridge(6, 0.4, 0.6);
  const front = ridge(9, 0.56, 0.82);
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

// Gareth: kurze, schnelle Metall-Glanzlichter, die immer wieder woanders aufblitzen
function makeGlints(w: number, h: number): Draw {
  const N = Math.min(7, Math.max(3, Math.round(w / 210)));
  const mk = () => ({ x: rand(w * 0.05, w * 0.95), y: rand(h * 0.2, h * 0.85), ang: rand(-0.7, 0.7), len: rand(12, 30), life: rand(420, 820), delay: rand(120, 1500), speed: rand(0.04, 0.1), born: 0 });
  const gs = Array.from({ length: N }, () => ({ ...mk(), born: -rand(0, 2200) }));
  return (ctx, t, W, H) => {
    ctx.lineCap = 'round';
    for (const g of gs) {
      let age = t - g.born;
      if (age > g.life + g.delay) {
        Object.assign(g, mk());
        g.born = t;
        age = 0;
      }
      const aa = age - g.delay;
      if (aa < 0) continue;
      const env = Math.sin(Math.PI * (aa / g.life)); // 0 → 1 → 0 (aufblitzen/verlöschen)
      const dx = Math.cos(g.ang);
      const dy = Math.sin(g.ang);
      const tr = aa * g.speed;
      const x = g.x + dx * tr;
      const y = g.y + dy * tr;
      const grad = ctx.createLinearGradient(x - dx * g.len, y - dy * g.len, x + dx * g.len, y + dy * g.len);
      grad.addColorStop(0, 'rgba(255,240,205,0)');
      grad.addColorStop(0.5, `rgba(255,246,220,${0.6 * env})`);
      grad.addColorStop(1, 'rgba(255,240,205,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - dx * g.len, y - dy * g.len);
      ctx.lineTo(x + dx * g.len, y + dy * g.len);
      ctx.stroke();
      ctx.globalAlpha = 0.85 * env;
      ctx.fillStyle = 'rgba(255,250,232,1)';
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, 6.28);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
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
  };
}

function makeEffect(theme: string, w: number, h: number): Draw | null {
  switch (theme) {
    case 'koenigsblau':
      return makeWaves();
    case 'rot':
      return makeSand(w, h);
    case 'wald':
      return makeLeaves(w, h);
    case 'amethyst':
      return makeDragon(w, h);
    case 'bronze':
      return makeGlints(w, h);
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
