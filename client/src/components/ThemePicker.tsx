import { THEMES } from '../theme';
import type { CSSProperties } from 'react';

// Kompakte Farbthema-Auswahl für die Kopfleiste: eine Reihe runder Farbpunkte,
// der aktive ist umrandet. Bewusst schlank — die Umschalt-Logik liegt im
// useTheme-Hook (in App aufgerufen), hier nur Anzeige + Klick.
export default function ThemePicker({ theme, onChange }: { theme: string; onChange: (id: string) => void }) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Farbthema">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`theme-swatch${t.id === theme ? ' active' : ''}`}
          style={{ '--sw': t.swatch } as CSSProperties}
          title={t.label}
          aria-label={t.label}
          role="radio"
          aria-checked={t.id === theme}
          onClick={() => onChange(t.id)}
        />
      ))}
    </div>
  );
}
