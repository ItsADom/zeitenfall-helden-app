import { useEffect } from 'react';

// Generischer modaler Dialog: Rahmen (Abdunkelung, Kopf mit Titel/Schließen,
// Fuß mit Aktionen) — der Inhalt kommt vom Aufrufer. Schließt per Escape,
// Klick auf die Abdunkelung, oder den Schließen-Knopf.
export function Dialog({
  open,
  onClose,
  title,
  footer,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
  /** Wider panel (see `.dialog-panel--wide`) for content that doesn't fit the default 420px — a multi-column table, mainly. Omit for every normal dialog. */
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`dialog-panel${wide ? ' dialog-panel--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h4>{title}</h4>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  );
}
