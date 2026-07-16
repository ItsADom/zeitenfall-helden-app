import { useState } from 'react';
import { NOTIZ_KEY } from '@shared/sections';
import type { ColumnDef, ListSectionDef } from '@shared/sections';
import { ResizeHandle, useResizableColumns } from './resize';

export function NumInput({
  value,
  onChange,
  disabled,
  width,
  max,
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
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      max={max}
      style={width ? { width } : undefined}
      onChange={(e) => {
        const v = Number(e.target.value) || 0;
        onChange(max !== undefined ? Math.min(v, max) : v);
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
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

// Standard-Spaltenbreite in px aus der relativen Breite der Sektions-Definition
function defaultWidth(col: ColumnDef): number {
  if (col.type === 'number') return 72;
  if (col.type === 'bool') return 90;
  return Math.max(90, (col.width ?? 2) * 60);
}

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
  const { widths, startDrag } = useResizableColumns(
    def.id,
    cols.map(defaultWidth),
  );
  const trailingCols = extraColumns.length + (hasNotiz ? 1 : 0) + (disabled ? 0 : 1);
  const totalWidth = widths.reduce((s, w) => s + w, 0) + extraColumns.length * 90 + (hasNotiz ? 40 : 0) + (disabled ? 0 : 40);

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

  return (
    <>
      <div className="table-wrap">
        <table className="sheet" style={{ tableLayout: 'fixed', minWidth: totalWidth }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
            {extraColumns.map((c) => (
              <col key={c.label} style={{ width: 90 }} />
            ))}
            {hasNotiz && <col style={{ width: 40 }} />}
            {!disabled && <col style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} title={c.label}>
                  {c.label}
                  <ResizeHandle index={i} startDrag={startDrag} />
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
