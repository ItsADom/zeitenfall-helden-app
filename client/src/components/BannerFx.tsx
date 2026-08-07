import { useEffect, useRef } from 'react';

// Animierte Kopfleisten-Effekte je Theme, auf einem Canvas gezeichnet. Jeder
// Effekt passt zur Region Aventuriens. Bewusst dezent (niedrige Deckkraft), damit
// die Leiste lebt, ohne vom Inhalt abzulenken. Respektiert prefers-reduced-motion
// und pausiert im Hintergrund-Tab.

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

// Khôm: wehender Wüstensand — feine Körner ziehen im Wind, darunter sanfte Dünenkämme
function makeSand(w: number, h: number): Draw {
  const n = Math.min(130, Math.round(w / 13));
  const g = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), s: rand(0.6, 1.7), spd: rand(10, 26), amp: rand(1, 4), ph: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
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
    ctx.globalAlpha = 0.12;
    for (const p of g) {
      const x = wrap(p.x + t * 0.001 * p.spd, W + 8);
      const y = p.y + Math.sin(t * 0.0012 + p.ph) * p.amp;
      ctx.fillRect(x, y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  };
}

// Bornland: sacht fallende Blätter mit leichtem Pendeln und Drehen
function makeLeaves(w: number, h: number): Draw {
  const n = Math.min(20, Math.max(7, Math.round(w / 110)));
  const leaves = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(2.2, 4.4), spd: rand(5, 12), sway: rand(6, 16), swayS: rand(0.0006, 0.0014), rot: rand(0, 6.28), rotS: rand(-0.001, 0.001), ph: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
    ctx.fillStyle = 'rgba(210,235,200,0.16)';
    for (const lf of leaves) {
      const y = wrap(lf.y + t * 0.001 * lf.spd, H + 8);
      const x = lf.x + Math.sin(t * lf.swayS + lf.ph) * lf.sway;
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

// Drachensteine: aufsteigende Funken, die nach oben hin verglühen
function makeEmbers(w: number, h: number): Draw {
  const n = Math.min(44, Math.max(14, Math.round(w / 38)));
  const e = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.7, 2), spd: rand(6, 16), drift: rand(-6, 6), driftS: rand(0.0008, 0.0016), ph: rand(0, 6.28) }));
  return (ctx, t, W, H) => {
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
  };
}

// Gareth: langsamer goldener Lichtschweif quer über die Leiste, dazu feine Motes
function makeShimmer(w: number, h: number): Draw {
  const motes = Array.from({ length: Math.min(18, Math.max(6, Math.round(w / 70))) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.8, 1.8), spd: rand(3, 8), ph: rand(0, 6.28) }));
  const period = 9000;
  return (ctx, t, W, H) => {
    const p = (t % period) / period;
    const cx = -W * 0.4 + p * (W * 1.8);
    const grad = ctx.createLinearGradient(cx - 70, 0, cx + 70, H);
    grad.addColorStop(0, 'rgba(255,235,190,0)');
    grad.addColorStop(0.5, 'rgba(255,238,200,0.12)');
    grad.addColorStop(1, 'rgba(255,235,190,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
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

function makeEffect(theme: string, w: number, h: number): Draw | null {
  switch (theme) {
    case 'koenigsblau':
      return makeWaves();
    case 'rot':
      return makeSand(w, h);
    case 'wald':
      return makeLeaves(w, h);
    case 'amethyst':
      return makeEmbers(w, h);
    case 'bronze':
      return makeShimmer(w, h);
    default:
      return null; // z. B. 'nacht' hat seinen eigenen CSS-Nebel
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
