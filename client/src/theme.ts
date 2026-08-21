import { useEffect } from 'react';
import { usePersistedState } from './components/persist';

// Farbthemen und Anzeige stehen auf DREI unabhängigen Achsen, alle als
// Attribute am <html> — reines CSS, kein React-Rerender:
//
//   data-theme   Farbwelt (Region Aventuriens). Overrides in styles.css.
//   data-mode    hell/dunkel. Jede Farbwelt hat beide Varianten …
//   data-anim    Kopfleisten-Animation an/aus.
//   data-dice-icons  Würfelformen im Chat an/aus.
//
// … mit einer Ausnahme: die Schattenlande sind von Natur aus dunkel und kennen
// kein Hell. Sie bleiben eine eigene Farbwelt, ignorieren data-mode (das CSS
// erzwingt Dunkel), und der Hell/Dunkel-Schalter ist dort wirkungslos.

export interface ThemeDef {
  id: string;
  label: string;
  swatch: string; // repräsentative Farbe (Akzent) für die Auswahl-Punkte
}

// 'rot' ist die Basis-Farbwelt (= :root, kein Override-Block). Als VORGABE für
// neue Nutzer dient aber 'bronze' (Gareth) — ein ruhigeres, neutraleres Warm-
// grau als das kräftige Khôm-Rot, freundlicher als erster Eindruck. Wer will,
// stellt jede Farbwelt frei ein; die Wahl bleibt gespeichert.
export const THEMES: ThemeDef[] = [
  { id: 'rot', label: 'Khôm', swatch: '#8b2635' },
  { id: 'wald', label: 'Bornland', swatch: '#2f5d3a' },
  { id: 'koenigsblau', label: 'Thorwal', swatch: '#2f4a7a' },
  { id: 'amethyst', label: 'Drachensteine', swatch: '#5e3a78' },
  { id: 'bronze', label: 'Gareth', swatch: '#8a5a2b' },
  { id: 'nacht', label: 'Schattenlande', swatch: '#d06a5c' },
];

export const DEFAULT_THEME = 'bronze';
export const THEME_STORAGE_KEY = 'theme';
export const MODE_STORAGE_KEY = 'theme-mode';
export const ANIM_STORAGE_KEY = 'theme-anim';
export const DICE_ICONS_STORAGE_KEY = 'dice-icons';

export type Mode = 'light' | 'dark';

// Farbwelten ohne Hell-Variante. Bei ihnen ist der Hell/Dunkel-Schalter
// wirkungslos; das CSS zeigt sie immer dunkel.
const DARK_ONLY = new Set(['nacht']);
export const isDarkOnly = (id: string): boolean => DARK_ONLY.has(id);

export const isKnownTheme = (id: string): boolean => THEMES.some((t) => t.id === id);
const isKnown = isKnownTheme;

// Systemvorgaben lesen; in Umgebungen ohne matchMedia (Tests) auf hell/an fallen.
const prefersDark = (): boolean => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const prefersReduced = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Persönliche Standard-Farbwelt (localStorage). Das ANWENDEN von data-theme
// liegt bewusst NICHT hier, sondern in App: dort wird die persönliche Vorgabe
// ggf. durch die Farbwelt des gerade geöffneten Charakters überschrieben — und
// beide (Farbe UND Kopfleisten-Animation) sollen derselben Quelle folgen.
export function useTheme(): [string, (id: string) => void] {
  const [theme, setThemeRaw] = usePersistedState<string>(THEME_STORAGE_KEY, DEFAULT_THEME);
  const active = isKnown(theme) ? theme : DEFAULT_THEME;
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

// Würfelformen im Chat: an heißt jeder Würfel in seiner Polyeder-Silhouette und
// seinem Sortenton, aus heißt der schlichte Kasten wie vor der Umstellung. Reine
// Anzeigesache, deshalb dieselbe Machart wie oben — ein Attribut am <html>, den
// Rest erledigt das Stylesheet, ohne dass eine Würfelkomponente davon weiß.
// Vorgabe ist AN; wer es abschaltet, hat sich bewusst dagegen entschieden.
export function useDiceIcons(): [boolean, (on: boolean) => void] {
  const [on, setOn] = usePersistedState<boolean>(DICE_ICONS_STORAGE_KEY, true);

  useEffect(() => {
    document.documentElement.dataset.diceIcons = on ? 'on' : 'off';
  }, [on]);

  return [on, setOn];
}
