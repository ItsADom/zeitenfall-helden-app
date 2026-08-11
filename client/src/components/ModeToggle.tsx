import { useThemeControls } from '../App';
import { isDarkOnly } from '../theme';

// Hell/Dunkel-Schalter in der Kopfleiste — für alle sichtbar, unabhängig von der
// Farbwelt-Auswahl. Zeigt den aktuellen Zustand (Sonne/Mond) und schaltet die
// persönliche Ansicht um. Bei einer reinen Dunkel-Farbwelt (Schattenlande) ist
// er wirkungslos und deshalb deaktiviert.
export default function ModeToggle() {
  const { theme, mode, setMode } = useThemeControls();
  const locked = isDarkOnly(theme);
  const dark = mode === 'dark' || locked;
  const title = locked
    ? 'Die Schattenlande sind immer dunkel'
    : dark
      ? 'Zu heller Ansicht wechseln'
      : 'Zu dunkler Ansicht wechseln';
  return (
    <button
      type="button"
      className="mode-toggle"
      role="switch"
      aria-checked={dark}
      aria-label={title}
      title={title}
      disabled={locked}
      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
    >
      {dark ? '☾' : '☀︎'}
    </button>
  );
}
