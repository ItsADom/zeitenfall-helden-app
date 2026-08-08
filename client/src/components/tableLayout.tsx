// Gemeinsame Bedienung aller Tabellen: Ein-/Ausklappen und Spaltenbreiten.
//
// Die Breiten werden wie in einer Tabellenkalkulation direkt am Trennstrich
// zwischen zwei Spaltenköpfen gezogen; ein Doppelklick auf den Strich passt die
// linke Spalte an ihren Inhalt an.
//
// GESPEICHERT wird in Prozent (siehe shared/tableLayout) — so bleiben die
// Verhältnisse erhalten, wenn das Fenster schmaler oder breiter wird.
// GERENDERT wird dagegen in Pixeln: `<col style="width: 312px">`. Prozente oder
// gar calc()-Ausdrücke im <col> sind bei `table-layout: fixed` nicht
// verlässlich; Pixel sind es. Ein ResizeObserver rechnet die Prozente bei jeder
// Breitenänderung frisch um, wodurch das responsive Verhalten erhalten bleibt.
//
// Während des Ziehens werden die beiden betroffenen <col>-Elemente DIREKT
// beschrieben, ohne React einzuschalten. Sonst würde jede Mausbewegung ein
// Neuzeichnen der gesamten Tabelle auslösen — bei den Talentlisten mit über
// hundert Zeilen voller Eingabefelder ruckelt das sichtbar. In den React-Zustand
// wandert das Ergebnis erst beim Loslassen.
//
// Abgelegt werden die Breiten auf zwei Wegen, je nachdem, wem die Spalten
// gehören:
//
//   • Selbst angelegte Tabellen bringen ihre Spalten mit — dort steckt die
//     Breite in der Spaltendefinition (DynColumn.width) und wandert mit ihr.
//     Solche Tabellen geben `stored`/`save` mit und brauchen den Kontext nicht.
//   • Die fest eingebauten Tabellen (Talente, Waffen, Sprachen, Listen) haben
//     keine eigene Definition in der Datenbank. Ihre Breiten liegen deshalb in
//     einer eigenen Ablage am Charakter, die der Kontext bereitstellt.
//
// Der eingeklappte Zustand gehört bewusst NICHT dazu: er beschreibt, was gerade
// jemand auf seinem Bildschirm sehen will, nicht wie der Charakter aussieht. Er
// liegt daher pro Gerät im localStorage — so wie das Einklappen der
// Talentgruppen, das es schon vorher gab.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { evenWidths, normalizeWidths, resizeAgainstNeighbour } from '@shared/tableLayout';
import { usePersistedState } from './persist';

interface TableLayoutCtxValue {
  widths: Record<string, number[]>;
  save: (key: string, widths: number[]) => void;
}

const TableLayoutCtx = createContext<TableLayoutCtxValue | null>(null);

// In der Druckansicht darf nichts eingeklappt sein: dort hängen dieselben
// Tabellen mit denselben Schlüsseln im DOM, und wer eine Tabelle am Bildschirm
// zugeklappt hat, will sie trotzdem auf dem Ausdruck haben.
const PrintScopeCtx = createContext(false);

export function PrintScope({ children }: { children: React.ReactNode }) {
  return <PrintScopeCtx.Provider value={true}>{children}</PrintScopeCtx.Provider>;
}

export function TableLayoutProvider({
  widths,
  save,
  children,
}: {
  widths: Record<string, number[]>;
  save: (key: string, widths: number[]) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ widths, save }), [widths, save]);
  return <TableLayoutCtx.Provider value={value}>{children}</TableLayoutCtx.Provider>;
}

// Innenabstand einer Zelle plus Rahmen und etwas Luft — was beim Anpassen an
// den Inhalt zur reinen Textbreite hinzukommt.
const CELL_CHROME_PX = 30;

// Breite des längsten Inhalts einer Spalte in Pixeln. Gemessen wird auf einer
// Canvas statt im Dokument: das kostet keinen Umbruch des Layouts und bleibt
// auch bei den langen Talentlisten flott.
function measureColumnPx(table: HTMLTableElement, colIndex: number, headCellCount: number): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;

  const widthOf = (el: Element, text: string): number => {
    if (!text) return 0;
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(text).width;
  };

  let max = 0;
  for (const row of Array.from(table.rows)) {
    // Zeilen mit zusammengefassten Zellen (Gruppen-Überschriften, Notizzeilen)
    // haben eine andere Spaltenzahl — die passen nicht auf diesen Index.
    if (row.cells.length !== headCellCount) continue;
    const cell = row.cells[colIndex];
    if (!cell) continue;
    const field = cell.querySelector('input, textarea, select') as HTMLInputElement | HTMLSelectElement | null;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      max = Math.max(max, 20);
      continue;
    }
    const text = field ? field.value || field.getAttribute('placeholder') || '' : (cell.textContent ?? '');
    max = Math.max(max, widthOf(cell, text.trim()));
  }
  return max > 0 ? max + CELL_CHROME_PX : 0;
}

export interface TableLayout {
  widths: number[];
  /** Muss am <table> hängen — daraus kommt die verfügbare Breite. */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** Breite für das <col> der Datenspalte `i`, in Pixeln sobald gemessen. */
  colWidth: (i: number) => string;
  collapsed: boolean;
  toggleCollapsed: () => void;
  reset: () => void;
  /** Zieht den Trennstrich rechts neben Spalte `index`. */
  beginDrag: (index: number, e: React.MouseEvent) => void;
  /** Passt Spalte `index` an ihren längsten Inhalt an. */
  fitToContent: (index: number, e: React.MouseEvent) => void;
}

// `key` muss die Tabelle eindeutig benennen und über Neuladen hinweg gleich
// bleiben — z. B. 'list:vorteile', 'talente:kampf' oder 'sec:42'.
//
// `defaults` ist das Ausgangsverhältnis, solange nichts gespeichert ist (der
// Maßstab ist gleichgültig, es zählen nur die Verhältnisse). `stored`/`save`
// setzen den Kontext außer Kraft, wenn die Tabelle ihre Breiten selbst
// mitbringt. `fixedPx` ist der Platz der festen Spalten am rechten Rand
// (Notiz- und Löschknöpfe), der nicht mit verteilt wird.
export function useTableLayout(
  key: string,
  count: number,
  opts?: {
    defaults?: readonly (number | undefined)[];
    stored?: readonly (number | undefined)[];
    save?: (widths: number[]) => void;
    fixedPx?: number;
  },
): TableLayout {
  const ctx = useContext(TableLayoutCtx);
  const ownStore = opts?.stored !== undefined || opts?.save !== undefined;
  const stored = ownStore ? opts?.stored : ctx?.widths[key];
  const defaults = opts?.defaults;
  const fixedPx = opts?.fixedPx ?? 0;

  // Der gespeicherte Stand, immer bereinigt: fehlende Spalten aufgefüllt,
  // Summe auf 100. Damit ist der Rest der Oberfläche jede Prüfung los.
  const base = useMemo(() => {
    if (stored && stored.length === count) return normalizeWidths(stored);
    if (defaults && defaults.length === count) return normalizeWidths(defaults);
    return normalizeWidths(new Array<undefined>(count).fill(undefined));
  }, [stored, defaults, count]);

  const [draft, setDraft] = useState<number[] | null>(null);
  const live = useRef<number[]>(base);
  const [collapsed, setCollapsed] = usePersistedState<boolean>(`tbl-zu:${key}`, false);
  const forPrint = useContext(PrintScopeCtx);

  const widths = draft ?? base;
  live.current = widths;

  // Verfügbare Breite für die Datenspalten, in Pixeln. Wird bei jeder
  // Größenänderung der Tabelle neu gemessen — das ist der Punkt, an dem die
  // gespeicherten Prozente wieder responsiv werden.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = tableRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setAvail(Math.max(0, el.clientWidth - fixedPx));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // `collapsed` steht mit drin, weil die Tabelle beim Ausklappen neu entsteht
    // und der alte Beobachter dann ins Leere zeigt.
  }, [fixedPx, collapsed, count]);

  const pxFor = (percent: number) => `${((avail * percent) / 100).toFixed(2)}px`;
  const colWidth = (i: number) => {
    const p = widths[i] ?? 100 / Math.max(1, count);
    // Vor der ersten Messung als Prozent — dann steht wenigstens etwas
    // Sinnvolles da, bis der Beobachter das erste Mal gelaufen ist.
    return avail > 0 ? pxFor(p) : `${p}%`;
  };

  const persist = (next: number[]) => {
    if (opts?.save) opts.save(next);
    else if (!ownStore) ctx?.save(key, next);
  };

  // Schreibt die beiden betroffenen Spalten direkt ins DOM — ohne React.
  const paint = (next: number[], a: number, b: number) => {
    const cols = tableRef.current?.querySelectorAll('col');
    if (!cols) return;
    for (const i of [a, b]) {
      const el = cols[i] as HTMLTableColElement | undefined;
      if (el) el.style.width = pxFor(next[i]);
    }
  };

  const commit = (next: number[]) => {
    live.current = next;
    persist(next);
    setDraft(next);
  };

  const beginDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    if (avail <= 0) return;

    const start = live.current.slice();
    const startX = e.clientX;
    let latest = start;
    handle.classList.add('active');
    document.body.classList.add('col-resizing');

    const onMove = (ev: MouseEvent) => {
      // Gezogene Pixel in Prozent der verfügbaren Breite — exakt, weil `avail`
      // genau der Bezugsrahmen der Spaltenbreiten ist.
      const deltaPercent = ((ev.clientX - startX) / avail) * 100;
      latest = resizeAgainstNeighbour(start, index, start[index] + deltaPercent);
      paint(latest, index, index + 1);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('active');
      document.body.classList.remove('col-resizing');
      commit(latest);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const fitToContent = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th') as HTMLTableCellElement | null;
    const table = tableRef.current;
    if (!th || !table || avail <= 0) return;

    const headCells = th.parentElement instanceof HTMLTableRowElement ? th.parentElement.cells.length : 0;
    const contentPx = measureColumnPx(table, th.cellIndex, headCells);
    if (contentPx <= 0) return;

    const next = resizeAgainstNeighbour(live.current, index, (contentPx / avail) * 100);
    paint(next, index, index + 1);
    commit(next);
  };

  return {
    widths,
    tableRef,
    colWidth,
    collapsed: forPrint ? false : collapsed,
    toggleCollapsed: () => setCollapsed((v) => !v),
    reset: () => commit(evenWidths(count)),
    beginDrag,
    fitToContent,
  };
}

// Der Trennstrich am rechten Rand eines Spaltenkopfes. Wird NICHT hinter der
// letzten Spalte gesetzt — dort trennt er nichts.
export function ColumnDivider({ layout, index }: { layout: TableLayout; index: number }) {
  return (
    <span
      className="col-divider"
      role="separator"
      aria-orientation="vertical"
      title="Ziehen zum Verschieben · Doppelklick passt die Spalte an ihren Inhalt an"
      onMouseDown={(e) => layout.beginDrag(index, e)}
      onDoubleClick={(e) => layout.fitToContent(index, e)}
      // Sonst löst der Klick zusätzlich das Sortieren der Spalte aus.
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// Knöpfe über der Tabelle: einklappen und Breiten zurücksetzen.
// `showCollapse={false}`, wenn die Tabelle schon auf andere Weise eingeklappt
// wird — die Talent-Kategorien etwa klappen über ihre Überschrift.
export function TableTools({
  layout,
  label,
  showCollapse = true,
}: {
  layout: TableLayout;
  label?: string;
  showCollapse?: boolean;
}) {
  return (
    <div className="table-tools">
      {showCollapse && (
        <button
          className="small"
          onClick={layout.toggleCollapsed}
          title={layout.collapsed ? 'Tabelle ausklappen' : 'Tabelle einklappen'}
          aria-expanded={!layout.collapsed}
        >
          <span aria-hidden>{layout.collapsed ? '▸' : '▾'}</span> {layout.collapsed ? 'Ausklappen' : 'Einklappen'}
        </button>
      )}
      {!layout.collapsed && (
        <button className="small" onClick={layout.reset} title={`Alle Spalten gleich breit machen${label ? ` — ${label}` : ''}`}>
          ⇔ Breiten zurücksetzen
        </button>
      )}
    </div>
  );
}

// Platzhalter anstelle einer eingeklappten Tabelle.
export function CollapsedNote({ rows, onOpen }: { rows: number; onOpen: () => void }) {
  return (
    <p className="muted collapsed-note" onClick={onOpen} title="Tabelle ausklappen">
      Eingeklappt — {rows} {rows === 1 ? 'Zeile' : 'Zeilen'}
    </p>
  );
}
