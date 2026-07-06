import { useCallback, useRef, useState } from 'react';

// Spaltenbreiten mit Zieh-Griff, gemerkt in localStorage.
// defaults: Breiten in px. storageKey: eindeutig pro Tabelle.

const MIN_WIDTH = 56;

function load(storageKey: string, defaults: number[]): number[] {
  try {
    const raw = localStorage.getItem(`colw:${storageKey}`);
    if (raw) {
      const parsed = JSON.parse(raw) as number[];
      if (Array.isArray(parsed) && parsed.length === defaults.length) return parsed;
    }
  } catch {
    // localStorage nicht verfügbar oder Inhalt defekt — Standardbreiten nutzen
  }
  return defaults;
}

export function useResizableColumns(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => load(storageKey, defaults));
  const drag = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  // Wenn sich die Spaltenzahl ändert (z. B. neue Definition), zurücksetzen
  if (widths.length !== defaults.length) setWidths(load(storageKey, defaults));

  const startDrag = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      handle.classList.add('active');
      drag.current = { index, startX: e.clientX, startWidth: widths[index] };
      const onMove = (ev: MouseEvent) => {
        if (!drag.current) return;
        const w = Math.max(MIN_WIDTH, drag.current.startWidth + ev.clientX - drag.current.startX);
        setWidths((prev) => {
          const next = prev.slice();
          next[drag.current!.index] = w;
          try {
            localStorage.setItem(`colw:${storageKey}`, JSON.stringify(next));
          } catch {
            // Speichern optional
          }
          return next;
        });
      };
      const onUp = () => {
        drag.current = null;
        handle.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [storageKey, widths],
  );

  return { widths, startDrag };
}

export function ResizeHandle({ index, startDrag }: { index: number; startDrag: (i: number, e: React.MouseEvent) => void }) {
  return <span className="col-resize" onMouseDown={(e) => startDrag(index, e)} title="Spalte verbreitern" />;
}
