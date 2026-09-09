import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clamp, hexToRgb, hslToRgb, hsvToRgb, rgbToHex, rgbToHsl, rgbToHsv, type HSL, type HSV, type RGB } from '@shared/color';

type Mode = 'hex' | 'rgb' | 'hsl';
const MODES: Mode[] = ['hex', 'rgb', 'hsl'];

// EyeDropper (Bildschirm-Farbaufnahme) fehlt noch in den TS-DOM-Typen und ist
// nur in Chromium implementiert — daher das eigene minimal-Interface statt
// `lib.dom` zu erweitern, und ein Feature-Check statt eines Browser-Sniffs.
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperCtor {
  new (): { open(): Promise<EyeDropperResult> };
}

interface ColorPickerProps {
  /** #rrggbb, keine Deckkraft — die regeln die Aufrufer selbst (siehe VirtualTable.tsx). */
  value: string;
  onChange: (hex: string) => void;
  title?: string;
}

/**
 * Ersetzt das native <input type="color"> überall auf der virtuellen
 * Tischplatte (Marken-/Ring-Farbe, Kachel-/Einfärbe-Picker, Messform-Farbe —
 * siehe die frühere ColorSwatchInput-Sammelstelle). Grund: TODO.md's Eintrag
 * "Natives Farb-Swatch öffnet sich beim zweiten Klick erneut, statt zu
 * schließen" ließ sich nicht zuverlässig fixen, weil ein natives Farbdialog
 * kein DOM-Knoten ist — dieses eigene Popover hält Auf/Zu selbst nach, das
 * Problem existiert damit strukturell nicht mehr. Zusätzlicher Vorteil:
 * gleiches Aussehen in jedem Browser statt des jeweiligen OS-Dialogs.
 *
 * Sättigung/Hellwert-Quadrat + Farbton-Regler (wie Edges natives Popover,
 * das als Vorlage diente) halten HSV als einzigen Wahrheits-Stand; RGB/HSL/
 * Hex sind reine Anzeigen, umschaltbar über einen Knopf (dieselbe Idee wie
 * Edges Umschalter unten im Popover). Ein Aufnahme-Knopf nutzt
 * window.EyeDropper, wo der Browser das unterstützt (nur Chromium) — sonst
 * bleibt er weg, statt einen kaputten Knopf zu zeigen.
 */
export function ColorPicker({ value, onChange, title }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('hex');
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Ins body-Ende portiert und `position: fixed` statt eines normalen
  // In-Flow-`position: absolute`-Popovers: der Swatch steckt oft in einem
  // Flyout mit eigenem niedrigen z-index (.vtt-tile-picker: 6) und/oder
  // eigenem overflow (dessen Scroll-Box), beides schneidet ein einfaches
  // absolut positioniertes Popover ab bzw. lässt es hinter der Kopfleiste
  // verschwinden — z-index gilt nur INNERHALB des Stapelkontexts seines
  // Elternteils, kommt also aus einem z-index:6-Elternteil nie darüber
  // hinaus, egal welchen eigenen z-index das Popover selbst trägt. Ein
  // Portal ans body-Ende verlässt diesen Stapelkontext komplett.
  // Bevorzugt oberhalb des Swatches (der meist im unteren Teil eines Panels
  // sitzt, z. B. der Marken-Editor) — fällt aber auf unterhalb zurück, wenn
  // darüber nicht genug Platz ist (z. B. der Kachel-Picker, dessen Swatch
  // nahe am oberen Rand der Tischplatte sitzt). Einmalig beim Öffnen
  // gemessen, nicht laufend nachgeführt — Scrollen/Resize schließt das
  // Popover stattdessen (siehe der zweite Effekt unten), der Swatch bewegt
  // sich sonst nicht, während es offen ist.
  const [pos, setPos] = useState<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: 0, bottom: null });
  useLayoutEffect(() => {
    if (!open) return;
    const swatch = rootRef.current;
    const popover = popoverRef.current;
    if (!swatch || !popover) return;
    const gap = 6;
    const margin = 8;
    const swatchRect = swatch.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const left = clamp(swatchRect.left, margin, window.innerWidth - popoverRect.width - margin);
    const fitsAbove = swatchRect.top - gap >= popoverRect.height;
    setPos(
      fitsAbove
        ? { left, top: null, bottom: window.innerHeight - swatchRect.top + gap }
        : { left, top: swatchRect.bottom + gap, bottom: null },
    );
  }, [open]);

  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value) ?? { r: 0, g: 0, b: 0 }));
  // Nur nachziehen, wenn `value` wirklich von AUSSEN kam (anderer Zug, Wechsel
  // der Marke/Form) — sonst würde die eigene hsv→rgb→hex-Rundung das Quadrat
  // unter der Maus zittern lassen, während man gerade zieht.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const rgb = hexToRgb(value);
    if (rgb) setHsv(rgbToHsv(rgb));
    lastEmitted.current = value;
  }, [value]);

  const emit = (next: HSV) => {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next));
    lastEmitted.current = hex;
    onChange(hex);
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // Popover ist per Portal kein Nachfahre von rootRef mehr — beide
      // Container gelten als "innen".
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Scrollt irgendein Vorfahre (z. B. die eigene Scroll-Box eines Flyouts)
    // oder wird die Fensterbreite/-höhe anders, würde ein `fixed` Popover
    // vom Swatch abdriften, ohne mitzuwandern — statt dem hinterherzurechnen,
    // einfach schließen (capture:true fängt auch verschachtelte Scroll-Boxen).
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const rgb = hsvToRgb(hsv);
  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);

  // Eigener Entwurf statt direkt an `hex` gebunden: ein Zwischenstand beim
  // Tippen ("#1e6e") ist meistens kein gültiger Wert, und ein an `hex`
  // gebundenes Feld würde jeden ungültigen Tastendruck sofort zurückdrehen.
  // Der Effekt zieht nur nach, wenn `hex` sich WIRKLICH ändert — während des
  // Tippens einer (noch) ungültigen Eingabe bleibt `hex` unverändert (emit
  // wird ja nicht aufgerufen), der Entwurf bleibt also unangetastet stehen.
  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);
  const commitHex = (v: string) => {
    setHexDraft(v);
    const parsed = hexToRgb(v);
    if (parsed) emit(rgbToHsv(parsed));
  };

  const svFromPointer = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const v = clamp(100 - ((e.clientY - rect.top) / rect.height) * 100, 0, 100);
    emit({ ...hsv, s, v });
  };
  const hueFromPointer = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = clamp(((e.clientX - rect.left) / rect.width) * 360, 0, 360);
    emit({ ...hsv, h });
  };
  const dragSv = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    svFromPointer(e);
  };
  const dragHue = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    hueFromPointer(e);
  };

  const eyeDropperCtor = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;
  const pickFromScreen = async () => {
    if (!eyeDropperCtor) return;
    try {
      const result = await new eyeDropperCtor().open();
      const picked = hexToRgb(result.sRGBHex);
      if (picked) emit(rgbToHsv(picked));
    } catch {
      // Mit Escape abgebrochen — nichts zu tun.
    }
  };

  const setRgbChannel = (patch: Partial<RGB>) => emit(rgbToHsv({ ...rgb, ...patch }));
  const setHslChannel = (patch: Partial<HSL>) => emit(rgbToHsv(hslToRgb({ ...hsl, ...patch })));

  const numberField = (label: string, val: number, max: number, onSet: (v: number) => void) => (
    <label key={label} className="color-picker-field">
      <input
        type="number"
        min={0}
        max={max}
        value={Math.round(val)}
        onChange={(e) => onSet(clamp(Number(e.target.value) || 0, 0, max))}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="color-picker" ref={rootRef}>
      <button
        type="button"
        className="color-picker-swatch"
        style={{ background: hex }}
        title={title}
        aria-label={title ?? 'Farbe wählen'}
        onClick={() => setOpen((o) => !o)}
      />
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="color-picker-popover"
            style={{ left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined }}
          >
            <div
              ref={svRef}
              className="color-picker-sv"
              style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
              onPointerDown={dragSv}
              onPointerMove={(e) => e.buttons === 1 && svFromPointer(e)}
            >
              <div className="color-picker-sv-handle" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
            </div>
            <div ref={hueRef} className="color-picker-hue" onPointerDown={dragHue} onPointerMove={(e) => e.buttons === 1 && hueFromPointer(e)}>
              <div className="color-picker-hue-handle" style={{ left: `${(hsv.h / 360) * 100}%` }} />
            </div>
            <div className="color-picker-fields-row">
              <div className="color-picker-preview" style={{ background: hex }} aria-hidden />
              {eyeDropperCtor && (
                <button type="button" className="color-picker-eyedrop" title="Farbe vom Bildschirm aufnehmen" onClick={pickFromScreen}>
                  💧
                </button>
              )}
              <div className="color-picker-fields">
                {mode === 'hex' && (
                  <label className="color-picker-field color-picker-field-hex">
                    <input value={hexDraft} maxLength={7} onChange={(e) => commitHex(e.target.value)} />
                    <span>Hex</span>
                  </label>
                )}
                {mode === 'rgb' && (
                  <>
                    {numberField('R', rgb.r, 255, (v) => setRgbChannel({ r: v }))}
                    {numberField('G', rgb.g, 255, (v) => setRgbChannel({ g: v }))}
                    {numberField('B', rgb.b, 255, (v) => setRgbChannel({ b: v }))}
                  </>
                )}
                {mode === 'hsl' && (
                  <>
                    {numberField('H', hsl.h, 360, (v) => setHslChannel({ h: v }))}
                    {numberField('S', hsl.s, 100, (v) => setHslChannel({ s: v }))}
                    {numberField('L', hsl.l, 100, (v) => setHslChannel({ l: v }))}
                  </>
                )}
              </div>
              <button
                type="button"
                className="color-picker-mode-toggle"
                title="Anzeige wechseln (Hex/RGB/HSL)"
                onClick={() => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])}
              >
                ⇅
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
