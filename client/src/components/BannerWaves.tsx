import { useEffect, useRef } from 'react';

// Thorwal: gezeichnete Wellen auf einem Canvas. Jede Welle wird pro Frame aus
// Sinus-Funktionen neu berechnet — dadurch kein Kachel-Sprung, jede Welle ändert
// ihre Höhe im Verlauf (swell) und die Brandung schwappt vor und zurück (tide),
// statt nur in eine Richtung zu scrollen.
interface WaveLayer {
  fill: string;
  base: number; // Ruhelage (Anteil der Höhe)
  amp: number; // Grund-Amplitude in px
  amp2: number; // zweite, feinere Welle für ungleiche Kammhöhen
  freq: number;
  freq2: number;
  tideAmp: number; // wie weit die Brandung vor/zurück schwappt (Phasen-Hub)
  tideSpeed: number;
  ampSpeed: number; // Tempo des Höhen-An- und Abschwellens
  drift: number; // langsames Wandern der feinen Zweitwelle
  phase: number;
}

const LAYERS: WaveLayer[] = [
  { fill: 'rgba(255,255,255,0.06)', base: 0.5, amp: 7, amp2: 3, freq: 0.011, freq2: 0.024, tideAmp: 1.0, tideSpeed: 0.00022, ampSpeed: 0.00034, drift: 0.00040, phase: 0 },
  { fill: 'rgba(255,255,255,0.09)', base: 0.64, amp: 9, amp2: 4, freq: 0.008, freq2: 0.019, tideAmp: 1.4, tideSpeed: 0.00031, ampSpeed: 0.00026, drift: -0.00055, phase: 2.1 },
  { fill: 'rgba(255,255,255,0.13)', base: 0.8, amp: 6, amp2: 3, freq: 0.015, freq2: 0.031, tideAmp: 1.8, tideSpeed: 0.0004, ampSpeed: 0.00045, drift: 0.0007, phase: 4.2 },
];

export default function BannerWaves() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const L of LAYERS) {
        // Höhe schwillt langsam an und ab (0.15 … 1.0)
        const swell = 0.575 + 0.425 * Math.sin(t * L.ampSpeed + L.phase);
        // Brandung: oszillierender Phasen-Versatz → vor und zurück statt Dauerlauf
        const tide = L.tideAmp * Math.sin(t * L.tideSpeed + L.phase);
        ctx.beginPath();
        ctx.moveTo(0, height + 2);
        for (let x = 0; x <= width; x += 6) {
          const y =
            height * L.base +
            L.amp * swell * Math.sin(x * L.freq + tide + L.phase) +
            L.amp2 * Math.sin(x * L.freq2 + t * L.drift + L.phase);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height + 2);
        ctx.closePath();
        ctx.fillStyle = L.fill;
        ctx.fill();
      }
    };

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) {
      draw(0); // ein statisches Bild, keine Animation
    } else {
      raf = requestAnimationFrame(loop);
    }

    // Im Hintergrund-Tab nicht weiterrechnen
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
  }, []);

  return <canvas ref={ref} className="banner-waves" aria-hidden="true" />;
}
