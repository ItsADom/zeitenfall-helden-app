// Anzeigemodus: entscheidet, ob ein Wert als Eingabefeld oder als fester Text
// erscheint — und ob überhaupt etwas verändert werden darf.
//
// Der Kniff ist, dass NICHT jede Tabelle und jeder Tab das selbst wissen muss.
// Alles Bearbeitbare der Anwendung läuft durch zwei Bausteine (NumInput und
// TextInput); lesen die beiden den Modus selbst, legt ein einziger Provider das
// ganze Blatt um.
//
// Drei Modi, aber nur zwei Verhaltensweisen:
//
//   edit      Eingabefelder — der Normalzustand beim Bearbeiten.
//   readonly  fester Text. Der VOREINGESTELLTE Zustand eines Charakterblatts:
//             Bearbeiten wird bewusst eingeschaltet, damit niemand im Vorbeigehen
//             die Werte eines anderen verstellt.
//   print     fester Text. Getrennt von `readonly`, weil der Druck zusätzlich
//             eingeklappte Tabellen aufklappt (siehe tableLayout) und die
//             Ausnahme-Inseln unten NICHT gelten dürfen.
//
// Warum fester Text und nicht bloß `disabled`: ein gesperrtes Eingabefeld ist
// blass und schwer zu lesen, und im Druck kommt es gar nicht erst an — die
// mitwachsenden Textfelder messen ihre Höhe beim Einhängen, und in der
// Druckansicht sind sie da noch unsichtbar, also null hoch. Fester Text hat
// beide Probleme nicht.
import { createContext, useContext } from 'react';

export type DisplayMode = 'edit' | 'readonly' | 'print';

// Ohne Provider bearbeitbar: die Gruppenseite und die Verwaltung bringen keinen
// mit und sollen weiterarbeiten wie bisher.
const DisplayModeCtx = createContext<DisplayMode>('edit');

export function DisplayModeProvider({ mode, children }: { mode: DisplayMode; children: React.ReactNode }) {
  return <DisplayModeCtx.Provider value={mode}>{children}</DisplayModeCtx.Provider>;
}

export const useDisplayMode = (): DisplayMode => useContext(DisplayModeCtx);

/**
 * Darf hier gerade etwas verändert werden? Steuert beides: Werte erscheinen als
 * fester Text, und die Struktur-Knöpfe (+ Zeile, Spalten, Löschen …) fallen weg.
 * Die kommen NICHT durch die beiden Eingabe-Bausteine und müssen einzeln fragen.
 */
export const useReadOnly = (): boolean => useContext(DisplayModeCtx) !== 'edit';

/**
 * Ausnahme-Insel: bleibt bearbeitbar, auch wenn das Blatt auf Nur-Lesen steht.
 * Für die Übersicht und das Seitenpanel — dort stehen die Werte, die sich im
 * Spiel ständig bewegen (Energien, Psyche, Geld), und die will man im Zweifel
 * mitten im Kampf ändern können, ohne vorher irgendwo Bearbeiten einzuschalten.
 *
 * Im Druck gilt die Ausnahme bewusst nicht — auf Papier gehören keine
 * Eingabefelder.
 */
export function AlwaysEditable({ children }: { children: React.ReactNode }) {
  const mode = useDisplayMode();
  if (mode === 'print') return <>{children}</>;
  return <DisplayModeCtx.Provider value="edit">{children}</DisplayModeCtx.Provider>;
}
