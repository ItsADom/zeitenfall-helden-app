import { useEffect } from 'react';
import { usePersistedState } from './components/persist';

// Farbthemen und Anzeige stehen auf DREI unabhängigen Achsen, alle als
// Attribute am <html> — reines CSS, kein React-Rerender:
//
//   data-theme   Farbwelt (Region Aventuriens). Overrides in styles.css.
//   data-mode    hell/dunkel. Jede Farbwelt hat beide Varianten …
//   data-anim    Kopfleisten-Animation an/aus.
//
// … mit einer Ausnahme: die Schattenlande sind von Natur aus dunkel und kennen
// kein Hell. Sie bleiben eine eigene Farbwelt, ignorieren data-mode (das CSS
// erzwingt Dunkel), und der Hell/Dunkel-Schalter ist dort wirkungslos.

export interface ThemeDef {
  id: string;
  label: string;
  swatch: string; // repräsentative Farbe (Akzent) für die Auswahl-Punkte
}

// 'rot' ist der Standard und braucht keinen Override-Block (= :root).
export const THEMES: ThemeDef[] = [
  { id: 'rot', label: 'Khôm', swatch: '#8b2635' },
  { id: 'wald', label: 'Bornland', swatch: '#2f5d3a' },
  { id: 'koenigsblau', label: 'Thorwal', swatch: '#2f4a7a' },
  { id: 'amethyst', label: 'Drachensteine', swatch: '#5e3a78' },
  { id: 'bronze', label: 'Gareth', swatch: '#8a5a2b' },
  { id: 'nacht', label: 'Schattenlande', swatch: '#d06a5c' },
];

export const DEFAULT_THEME = 'rot';
export const THEME_STORAGE_KEY = 'theme';
export const MODE_STORAGE_KEY = 'theme-mode';
export const ANIM_STORAGE_KEY = 'theme-anim';

export type Mode = 'light' | 'dark';

// Farbwelten ohne Hell-Variante. Bei ihnen ist der Hell/Dunkel-Schalter
// wirkungslos; das CSS zeigt sie immer dunkel.
const DARK_ONLY = new Set(['nacht']);
export const isDarkOnly = (id: string): boolean => DARK_ONLY.has(id);

const isKnown = (id: string): boolean => THEMES.some((t) => t.id === id);

// Systemvorgaben lesen; in Umgebungen ohne matchMedia (Tests) auf hell/an fallen.
const prefersDark = (): boolean => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const prefersReduced = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

// Hell/Dunkel. Ohne getroffene Wahl folgt es der Systemeinstellung; sobald der
// Nutzer einmal umschaltet, gilt dessen Wahl (auch gegen das System). data-mode
// trägt STETS die Wahl des Nutzers — auch während die Schattenlande aktiv sind,
// damit die Wahl erhalten bleibt, wenn er wieder zu einer hellen Farbwelt wechselt.
export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = usePersistedState<Mode>(MODE_STORAGE_KEY, prefersDark() ? 'dark' : 'light');
  const active: Mode = mode === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    document.documentElement.dataset.mode = active;
  }, [active]);

  return [active, setMode];
}

// Kopfleisten-Animation. Ohne getroffene Wahl aus, wenn das System reduzierte
// Bewegung wünscht — sonst an. Eine ausdrückliche Wahl gewinnt über das System.
export function useAnimations(): [boolean, (on: boolean) => void] {
  const [on, setOn] = usePersistedState<boolean>(ANIM_STORAGE_KEY, !prefersReduced());

  useEffect(() => {
    document.documentElement.dataset.anim = on ? 'on' : 'off';
  }, [on]);

  return [on, setOn];
}
