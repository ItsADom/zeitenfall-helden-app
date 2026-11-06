// Wie hoch ist das, was oben am Bildschirm kleben bleibt?
//
// Zwei Dinge kleben: die Kopfleiste und darunter die Reiterleiste. Beider Höhe
// steht NICHT fest — die Reiter brechen um, sobald der Charakter genug eigene
// Tabs hat oder das Fenster schmal wird, und aus einer Zeile werden zwei.
// Alles, was darunter ebenfalls kleben soll (die Talentsuche) oder sich an der
// verbleibenden Fläche orientiert (die Höhe der Tabellen), braucht deshalb
// gemessene Werte statt geschätzter.
//
// Jeder Haken schreibt GENAU EINE Variable ans Wurzelelement; zusammengerechnet
// wird in der Stilvorlage per calc(). So muss keiner der beiden den Wert des
// anderen kennen — sonst hinge das Ergebnis daran, wer zuerst misst.
import { useCallback, useEffect, useRef } from 'react';

export const TOPBAR_VAR = '--topbar-h';
export const CHARHEAD_VAR = '--charhead-h';
export const TABS_VAR = '--tabs-h';
export const SEARCH_VAR = '--search-h';
export const EINSTHEAD_VAR = '--einsthead-h';
export const EINSTNAV_VAR = '--einstnav-h';
export const WIKIKOPF_VAR = '--wikikopf-h';
export const WIKIBAR_VAR = '--wikibar-h';
export const VTTBAR_VAR = '--vtt-toolbar-h';

/**
 * Schreibt die Höhe eines klebenden Elements in eine CSS-Variable am
 * Wurzelelement und hält sie per ResizeObserver aktuell.
 *
 * Bewusst eine Rückruf-Referenz und kein Effekt mit `useRef`: die Charakter-
 * seite zeigt zuerst „Lade…" und hat die Reiterleiste da noch gar nicht. Ein
 * Effekt liefe genau einmal — mit leerer Referenz — und danach nie wieder,
 * weil sich die Referenz selbst nicht ändert. Die Rückruf-Referenz feuert
 * dagegen genau dann, wenn der Knoten wirklich entsteht. (Dasselbe Muster wie
 * `attachTable` in tableLayout.tsx, aus demselben Grund.)
 */
function useMeasuredHeight(cssVar: string): (el: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  return useCallback(
    (el: HTMLElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      const root = document.documentElement;
      if (!el) {
        // Aufräumen: ohne das Element gibt es keine Höhe, und ein stehen
        // gebliebener Wert wäre schlicht falsch (die Reiterleiste etwa gibt es
        // nur auf der Charakterseite).
        root.style.removeProperty(cssVar);
        return;
      }
      // offsetHeight statt getBoundingClientRect: ganze Pixel reichen, und ein
      // gebrochener Wert ließe die Tabellenhöhe bei jedem Zoomschritt neu
      // rechnen.
      const update = () => root.style.setProperty(cssVar, `${el.offsetHeight}px`);
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(update);
      ro.observe(el);
      observer.current = ro;
    },
    [cssVar],
  );
}

/** Referenz für die Kopfleiste — setzt `--topbar-h`. */
export const useTopbarHeight = () => useMeasuredHeight(TOPBAR_VAR);

/**
 * Referenz für die Kopfzeile des Charakterbogens (Name, Spieler, Gruppe,
 * Bearbeiten-Schalter) — setzt `--charhead-h`. Die klebt zwischen Kopf- und
 * Reiterleiste; ihre Höhe wechselt, wenn der Name in den Bearbeiten-Modus geht
 * oder das Fenster schmal wird und die Zeile umbricht. Gibt es nur auf der
 * Charakterseite; überall sonst bleibt die Variable ungesetzt (calc → 0).
 */
export const useCharHeadHeight = () => useMeasuredHeight(CHARHEAD_VAR);

/**
 * Referenz für die Reiterleiste — setzt `--tabs-h`.
 *
 * Schmal läuft die Leiste einzeilig und scrollt seitwärts (siehe `.tabs` in
 * styles.css). Dann muss der aktive Reiter sichtbar sein, auch wenn er per Link
 * (?tab=…) oder Programm gewechselt wurde. Das macht dieselbe Referenz mit, damit
 * Character, Group und Admin nichts einzeln verdrahten müssen: ein
 * MutationObserver sieht den Wechsel der Klasse `active` und zentriert den
 * Reiter. Gescrollt wird nur die Leiste selbst (scrollTo auf ihr), nie die Seite.
 */
export function useTabsHeight(): (el: HTMLElement | null) => void {
  const measure = useMeasuredHeight(TABS_VAR);
  const mo = useRef<MutationObserver | null>(null);

  useEffect(() => () => mo.current?.disconnect(), []);

  return useCallback(
    (el: HTMLElement | null) => {
      measure(el);
      mo.current?.disconnect();
      mo.current = null;
      if (!el || typeof MutationObserver === 'undefined') return;
      const reveal = () => {
        if (el.scrollWidth <= el.clientWidth) return; // nichts abgeschnitten
        const aktiv = el.querySelector<HTMLElement>('button.active');
        if (!aktiv) return;
        const ziel = aktiv.offsetLeft - (el.clientWidth - aktiv.offsetWidth) / 2;
        if (Math.abs(el.scrollLeft - ziel) > 1) el.scrollTo({ left: Math.max(0, ziel) });
      };
      reveal();
      const m = new MutationObserver(reveal);
      m.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      mo.current = m;
    },
    [measure],
  );
}

/**
 * Referenz für die Talent-Suchleiste — setzt `--search-h`. Die gibt es nur in
 * einem Reiter; überall sonst ist die Variable nicht gesetzt und die
 * Stilvorlage rechnet mit 0.
 */
export const useSearchHeight = () => useMeasuredHeight(SEARCH_VAR);

/** Referenz für die klebende Kopfzeile der Einstellungen-Seite — setzt `--einsthead-h`. */
export const useEinstHeadHeight = () => useMeasuredHeight(EINSTHEAD_VAR);

/** Referenz für die Sprung-Navigation der Einstellungen-Seite — setzt `--einstnav-h`. */
export const useEinstNavHeight = () => useMeasuredHeight(EINSTNAV_VAR);

/**
 * Referenz für die Wiki-Leiste (Suche, Kategorien, Letzte Änderungen) — setzt
 * `--wikikopf-h`. Die klebt auf jeder Wiki-Seite unter der Kopfleiste; ihre
 * Höhe wechselt, sobald die Einträge auf schmalen Fenstern umbrechen.
 */
export const useWikiKopfHeight = () => useMeasuredHeight(WIKIKOPF_VAR);

/**
 * Referenz für die Bearbeitungsleiste im Wiki — setzt `--wikibar-h`. Eigene
 * Variable neben `--wikikopf-h`, keine gemeinsame: die Bearbeitungsleiste
 * klebt UNTER der Wiki-Leiste, und beide messen sich getrennt, damit keine von
 * der Reihenfolge abhängt, in der sie entstehen.
 */
export const useWikiBarHeight = () => useMeasuredHeight(WIKIBAR_VAR);

/**
 * Referenz für die Werkzeugleiste des Virtuellen Tischs — setzt `--vtt-toolbar-h`.
 * Die Leiste bricht je nach Breite und GM-Werkzeugen auf zwei Zeilen um; die
 * Auswahl-Flyouts darunter (`.vtt-tile-picker`, `.vtt-settings-pop`) sitzen
 * absolut in der Kartenspalte und brauchen ihre tatsächliche Höhe als Versatz,
 * statt eines festen Wertes, der nur für eine Zeile stimmte.
 */
export const useVttToolbarHeight = () => useMeasuredHeight(VTTBAR_VAR);
