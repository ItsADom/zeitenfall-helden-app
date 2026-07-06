import type { ColumnDef, ListSectionDef } from '@shared/sections';
import { ResizeHandle, useResizableColumns } from './resize';

export function NumInput({
  value,
  onChange,
  disabled,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      style={width ? { width } : undefined}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
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
  const cols = def.columns.filter((c) => !hiddenColumns.includes(c.key));
  const { widths, startDrag } = useResizableColumns(
    def.id,
    cols.map(defaultWidth),
  );
  const totalWidth = widths.reduce((s, w) => s + w, 0) + extraColumns.length * 90 + (disabled ? 0 : 40);

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
              {!disabled && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
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
                {!disabled && (
                  <td>
                    <button className="small" title="Zeile entfernen" onClick={() => removeRow(i)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + extraColumns.length + (disabled ? 0 : 1)} className="muted">
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
