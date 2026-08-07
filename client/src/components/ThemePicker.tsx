import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { THEMES } from '../theme';

// Farbthema-Auswahl als Dropdown: der Auslöser zeigt das aktuelle Theme
// (Farbpunkt + Name), die Liste jedes Theme mit Farbvorschau und Namen.
// Umschalt-Logik liegt im useTheme-Hook (App), hier nur Anzeige + Klick.
export default function ThemePicker({ theme, onChange }: { theme: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  // Schließen bei Klick außerhalb oder Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="theme-dropdown" ref={ref}>
      <button
        type="button"
        className="theme-dd-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Farbthema wählen"
      >
        <span className="theme-dot" style={{ '--sw': current.swatch } as CSSProperties} />
        <span className="theme-dd-name">{current.label}</span>
        <span className="theme-dd-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="theme-dd-menu" role="listbox" aria-label="Farbthema">
          {THEMES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-dd-option${t.id === theme ? ' active' : ''}`}
                onClick={() => pick(t.id)}
              >
                <span className="theme-dot" style={{ '--sw': t.swatch } as CSSProperties} />
                <span className="theme-dd-name">{t.label}</span>
                {t.id === theme && (
                  <span className="theme-dd-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
