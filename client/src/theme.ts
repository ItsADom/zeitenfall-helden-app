import { useEffect } from 'react';
import { usePersistedState } from './components/persist';

// Farbthemen: jedes Theme ist ein Satz CSS-Variablen-Overrides in styles.css
// (:root[data-theme="<id>"]). Hier stehen nur die Metadaten für die Auswahl.
// Umschalten = data-theme am <html> setzen — reines CSS, kein React-Rerender.

export interface ThemeDef {
  id: string;
  label: string;
  swatch: string; // repräsentative Farbe (Akzent) für die Auswahl-Punkte
}

// 'rot' ist der Standard und braucht keinen Override-Block (= :root).
export const THEMES: ThemeDef[] = [
  { id: 'rot', label: 'Rot (Standard)', swatch: '#8b2635' },
  { id: 'wald', label: 'Wald', swatch: '#2f5d3a' },
  { id: 'koenigsblau', label: 'Königsblau', swatch: '#2f4a7a' },
  { id: 'amethyst', label: 'Amethyst', swatch: '#5e3a78' },
  { id: 'bronze', label: 'Bronze', swatch: '#8a5a2b' },
  { id: 'nacht', label: 'Nacht (dunkel)', swatch: '#c2564a' },
];

export const DEFAULT_THEME = 'rot';
export const THEME_STORAGE_KEY = 'theme';

const isKnown = (id: string): boolean => THEMES.some((t) => t.id === id);

// Einzige Quelle der Wahrheit fürs Theme: gemerkt in localStorage, angewandt als
// data-theme am <html>. Der Inline-Schnipsel in index.html setzt es schon vor
// dem Mount (kein Aufblitzen); dieser Hook hält es danach synchron.
export function useTheme(): [string, (id: string) => void] {
  const [theme, setThemeRaw] = usePersistedState<string>(THEME_STORAGE_KEY, DEFAULT_THEME);
  const active = isKnown(theme) ? theme : DEFAULT_THEME;

  useEffect(() => {
    document.documentElement.dataset.theme = active;
  }, [active]);

  const setTheme = (id: string) => setThemeRaw(isKnown(id) ? id : DEFAULT_THEME);
  return [active, setTheme];
}
