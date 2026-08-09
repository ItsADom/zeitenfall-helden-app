import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { THEMES, isDarkOnly } from '../theme';
import type { Mode } from '../theme';

// Farbthema-Auswahl als Dropdown: der Auslöser zeigt das aktuelle Theme
// (Farbpunkt + Name), die Liste jedes Theme mit Farbvorschau und Namen. Darunter
// zwei Schalter — Hell/Dunkel und Animation an/aus.
// Umschalt-Logik liegt in den Hooks (App), hier nur Anzeige + Klick.
export default function ThemePicker({
  theme,
  onChange,
  mode,
  onModeChange,
  animate,
  onAnimateChange,
}: {
  theme: string;
  onChange: (id: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  animate: boolean;
  onAnimateChange: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  // Die Schattenlande sind dunkel-only — der Hell/Dunkel-Schalter ist dort ohne
  // Wirkung und wird deshalb deaktiviert und zeigt Dunkel.
  const modeLocked = isDarkOnly(theme);
  const modeDark = mode === 'dark' || modeLocked;

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
          <li className="theme-dd-sep" role="presentation" />
          <li className="theme-dd-toggle-row" role="presentation">
            <span className="theme-dd-toggle-label">Ansicht</span>
            <button
              type="button"
              className={`theme-switch mode${modeDark ? ' on' : ''}`}
              role="switch"
              aria-checked={modeDark}
              disabled={modeLocked}
              title={
                modeLocked ? 'Die Schattenlande sind immer dunkel'
                : modeDark ? 'Zu heller Ansicht wechseln'
                : 'Zu dunkler Ansicht wechseln'
              }
              onClick={() => onModeChange(mode === 'dark' ? 'light' : 'dark')}
            >
              <span className="theme-switch-track" aria-hidden>
                <span className="theme-switch-knob">{modeDark ? '☾' : '☀︎'}</span>
              </span>
              <span className="theme-switch-text">{modeDark ? 'Dunkel' : 'Hell'}</span>
            </button>
          </li>
          <li className="theme-dd-toggle-row" role="presentation">
            <span className="theme-dd-toggle-label">Animation</span>
            <button
              type="button"
              className={`theme-switch${animate ? ' on' : ''}`}
              role="switch"
              aria-checked={animate}
              title={animate ? 'Kopfleisten-Animation ausschalten' : 'Kopfleisten-Animation einschalten'}
              onClick={() => onAnimateChange(!animate)}
            >
              <span className="theme-switch-track" aria-hidden>
                <span className="theme-switch-knob" />
              </span>
              <span className="theme-switch-text">{animate ? 'An' : 'Aus'}</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
