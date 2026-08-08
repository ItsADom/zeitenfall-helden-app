import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTIZ_KEY } from '@shared/sections';
import type { ColumnDef, ListSectionDef } from '@shared/sections';
import { fitSoon, observeAutosize } from './autosize';
import { CollapsedNote, ColumnDivider, TableTools, useTableLayout } from './tableLayout';

export function NumInput({
  value,
  onChange,
  disabled,
  width,
  max,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  width?: number;
  /**
   * Obergrenze. Höhere Eingaben werden darauf gekappt — nur nach oben:
   * ein Vorrat darf unter null fallen (Wunden), aber nie über sein Maximum.
   */
  max?: number;
  /**
   * Untergrenze. Niedrigere Eingaben werden darauf gekappt — z. B. Geld,
   * das nicht negativ werden darf.
   */
  min?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      max={max}
      min={min}
      style={width ? { width } : undefined}
      onChange={(e) => {
        let v = Number(e.target.value) || 0;
        if (max !== undefined) v = Math.min(v, max);
        if (min !== undefined) v = Math.max(v, min);
        onChange(v);
      }}
    />
  );
}

// Textfeld, das bei langem Inhalt umbricht und nach unten mitwächst, statt
// seitlich zu scrollen. Startet einzeilig; die Höhe folgt dem Inhalt.
export function TextInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fitSoon(ref.current);
  }, [value]);
  // Die Höhe hängt nicht nur am Inhalt, sondern auch an der Breite: eine
  // verstellte Spalte oder ein schmaleres Fenster ändert die Zahl der Zeilen.
  useEffect(() => {
    const el = ref.current;
    return el ? observeAutosize(el) : undefined;
  }, []);
  return (
    <textarea
      ref={ref}
      className="text-input"
      rows={1}
      value={value ?? ''}
      title={value || undefined}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export type Row = Record<string, unknown>;

function CellInput({ col, row, onChange, disabled }: { col: ColumnDef; row: Row; onChange: (row: Row) => void; disabled?: boolean }) {
  if (col.type === 'number') {
    return <NumInput value={Number(row[col.key]) || 0} disabled={disabled} onChange={(v) => onChange({ ...row, [col.key]: v })} />;
  }
  if (col.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={!!row[col.key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...row, [col.key]: e.target.checked })}
      />
    );
  }
  return <TextInput value={String(row[col.key] ?? '')} disabled={disabled} onChange={(v) => onChange({ ...row, [col.key]: v })} />;
}

export interface ExtraColumn {
  label: string;
  render: (row: Row, index: number) => React.ReactNode;
}

// Ausgangsverhältnis einer Spalte, wenn noch nichts gespeichert ist. Der
// Maßstab ist gleichgültig — normalizeWidths rechnet daraus Prozente.
function defaultWeight(col: ColumnDef): number {
  if (col.type === 'number') return 1;
  if (col.type === 'bool') return 1.2;
  return Math.max(1.5, col.width ?? 2);
}

// Breite der Spalten am rechten Rand (Notiz, Löschen, berechnete Zusatzspalten).
// Die bleiben in Pixeln: ein Knopf wird nicht schöner, wenn er mitwächst.
const TRAILING_PX = 40;
const EXTRA_PX = 90;
// Damit die Tabelle auf schmalen Geräten nicht zerquetscht wird, sondern
// waagerecht scrollt.
const MIN_COL_PX = 64;

// Generischer Tabellen-Editor für Listen-Sektionen mit verstellbaren Spalten.
export function ListEditor({
  def,
  rows,
  onChange,
  disabled,
  extraColumns = [],
  hiddenColumns = [],
  customCell,
  emptyRow,
}: {
  def: ListSectionDef;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  disabled?: boolean;
  extraColumns?: ExtraColumn[];
  hiddenColumns?: string[];
  customCell?: (col: ColumnDef, row: Row, update: (row: Row) => void) => React.ReactNode | undefined;
  emptyRow?: Row;
}) {
  const cols = def.columns.filter((c) => !hiddenColumns.includes(c.key) && c.key !== NOTIZ_KEY);
  const hasNotiz = def.columns.some((c) => c.key === NOTIZ_KEY);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const trailingCols = extraColumns.length + (hasNotiz ? 1 : 0) + (disabled ? 0 : 1);
  // Was die festen Spalten am rechten Rand belegen; den Rest teilen sich die
  // Datenspalten nach ihren Prozentanteilen.
  const fixedPx = extraColumns.length * EXTRA_PX + (hasNotiz ? TRAILING_PX : 0) + (disabled ? 0 : TRAILING_PX);
  const layout = useTableLayout(`list:${def.id}`, cols.length, { defaults: cols.map(defaultWeight), fixedPx });
  const minWidth = cols.length * MIN_COL_PX + fixedPx;

  const toggleNote = (i: number) => {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const setRow = (i: number, row: Row) => {
    const next = rows.slice();
    next[i] = row;
    onChange(next);
  };
  const addRow = () => {
    const fresh: Row = emptyRow ? { ...emptyRow } : {};
    for (const c of def.columns) {
      if (!(c.key in fresh)) fresh[c.key] = c.type === 'number' ? 0 : c.type === 'bool' ? false : '';
    }
    onChange([...rows, fresh]);
  };
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));

  if (layout.collapsed) {
    return (
      <>
        <TableTools layout={layout} label={def.label} />
        <CollapsedNote rows={rows.length} onOpen={layout.toggleCollapsed} />
      </>
    );
  }

  return (
    <>
      <TableTools layout={layout} label={def.label} />
      <div className="table-wrap">
        <table ref={layout.tableRef} className="sheet" style={{ tableLayout: 'fixed', width: '100%', minWidth }}>
          <colgroup>
            {cols.map((c, i) => (
              <col key={c.key} style={{ width: layout.colWidth(i) }} />
            ))}
            {extraColumns.map((c) => (
              <col key={c.label} style={{ width: EXTRA_PX }} />
            ))}
            {hasNotiz && <col style={{ width: TRAILING_PX }} />}
            {!disabled && <col style={{ width: TRAILING_PX }} />}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} title={c.label}>
                  {c.label}
                  {i < cols.length - 1 && <ColumnDivider layout={layout} index={i} />}
                </th>
              ))}
              {extraColumns.map((c) => (
                <th key={c.label} title={c.label}>
                  {c.label}
                </th>
              ))}
              {hasNotiz && <th />}
              {!disabled && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const notiz = String(row[NOTIZ_KEY] ?? '');
              return [
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.type === 'number' ? 'num' : undefined}>
                      {customCell?.(c, row, (r) => setRow(i, r)) ?? (
                        <CellInput col={c} row={row} disabled={disabled} onChange={(r) => setRow(i, r)} />
                      )}
                    </td>
                  ))}
                  {extraColumns.map((c) => (
                    <td key={c.label} className="computed">
                      {c.render(row, i)}
                    </td>
                  ))}
                  {hasNotiz && (
                    <td>
                      <button
                        className={`small note-btn${notiz ? ' has-note' : ''}`}
                        title={notiz || 'Notiz hinzufügen'}
                        onClick={() => toggleNote(i)}
                      >
                        {notiz ? '📝' : '✎'}
                      </button>
                    </td>
                  )}
                  {!disabled && (
                    <td>
                      <button className="small" title="Zeile entfernen" onClick={() => removeRow(i)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>,
                hasNotiz && openNotes.has(i) ? (
                  <tr key={`note-${i}`} className="note-row">
                    <td colSpan={cols.length + trailingCols}>
                      <textarea
                        className="note-area"
                        rows={2}
                        placeholder="Notiz…"
                        value={notiz}
                        disabled={disabled}
                        autoFocus
                        onChange={(e) => setRow(i, { ...row, [NOTIZ_KEY]: e.target.value })}
                      />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + trailingCols} className="muted">
                  Keine Einträge
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <button className="small add-row" onClick={addRow}>
          + Zeile
        </button>
      )}
    </>
  );
}
