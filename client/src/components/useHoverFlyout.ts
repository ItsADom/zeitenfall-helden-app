import { useEffect, useRef, useState } from 'react';

// Auf-/Zuklappen eines Flyouts per Überfahren bzw. Tastaturfokus, samt
// Klick-außerhalb und Escape. Vorher steckte dieselbe Mechanik wortgleich in
// NavMenu und ProfileMenu; der Würfel-Dock braucht sie ein drittes und viertes
// Mal (Sichtbarkeits-Wahl, Würfel-Favoriten), deshalb hier einmal zentral.
//
// Der kleine Verzug beim Schließen ist Absicht: sonst reißt der Weg von der
// Beschriftung ins Menü ab, sobald der Zeiger die Lücke dazwischen streift.
const CLOSE_DELAY_MS = 120;

export interface HoverFlyout<T extends HTMLElement> {
  open: boolean;
  /** An das umschließende Element hängen — daran hängt „Klick außerhalb". */
  wrapRef: React.RefObject<T | null>;
  openNow: () => void;
  closeSoon: () => void;
  closeNow: () => void;
  /** Fertige Maus-/Fokus-Handler für das umschließende Element. */
  hoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (e: React.FocusEvent) => void;
  };
}

export function useHoverFlyout<T extends HTMLElement = HTMLDivElement>(onOpen?: () => void): HoverFlyout<T> {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<T>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // Über einen Ref, damit ein bei jedem Rendern neu erzeugtes onOpen nicht
  // ständig neue Handler erzwingt.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const openNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
    onOpenRef.current?.();
  };
  const closeSoon = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const closeNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return {
    open,
    wrapRef,
    openNow,
    closeSoon,
    closeNow,
    hoverProps: {
      onMouseEnter: openNow,
      onMouseLeave: closeSoon,
      onFocus: openNow,
      onBlur: (e: React.FocusEvent) => {
        // Verlässt der Fokus die ganze Gruppe, schließen.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeSoon();
      },
    },
  };
}
