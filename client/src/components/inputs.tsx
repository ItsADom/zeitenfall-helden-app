import type { ColumnDef, ListSectionDef } from '@shared/sections';

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
  return <input type="text" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
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

// Generischer Tabellen-Editor für Listen-Sektionen.
// columnsOverride erlaubt es, Spalten auszublenden oder eigene Editoren einzusetzen.
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
  const totalWidth = cols.reduce((s, c) => s + (c.width ?? 2), 0);
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
    <table className="sheet">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} style={{ width: `${((c.width ?? 2) / totalWidth) * 100}%` }}>
              {c.label}
            </th>
          ))}
          {extraColumns.map((c) => (
            <th key={c.label}>{c.label}</th>
          ))}
          {!disabled && <th style={{ width: 30 }} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} className={c.type === 'number' ? 'num' : undefined}>
                {customCell?.(c, row, (r) => setRow(i, r)) ?? <CellInput col={c} row={row} disabled={disabled} onChange={(r) => setRow(i, r)} />}
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
        {!disabled && (
          <tr>
            <td colSpan={cols.length + extraColumns.length + 1} style={{ border: 'none' }}>
              <button className="small" onClick={addRow}>
                + Zeile
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
