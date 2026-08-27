import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTIZ_KEY } from '@shared/sections';
import type { ColumnDef, ListSectionDef } from '@shared/sections';
import { fitSoon, observeAutosize } from './autosize';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useReadOnly } from './displayMode';
import { ColumnDivider, TableTools, useTableLayout } from './tableLayout';

/**
 * Beschriftetes Steuerfeld mit „eingekerbtem" Rahmen: die Beschriftung sitzt in
 * einer Lücke der oberen Rahmenlinie (natives fieldset/legend). Für Such-,
 * Filter- und Sortierfelder — der Rahmen fasst zusammen, was zusammengehört, und
 * die Beschriftung sagt, was das Feld tut, ohne Platz in einer eigenen Zeile.
 * Nimmt ein einzelnes Kind (input/select) auf; die Reihe außenrum ordnet an.
 */
export function Field({
  label,
  children,
  active,
  className,
}: {
  label: string;
  children: React.ReactNode;
  /** Rahmen in Akzentfarbe, wenn das Feld gerade etwas einschränkt (z. B. ein aktiver Filter). */
  active?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={`notch${active ? ' notch--active' : ''}${className ? ` ${className}` : ''}`}>
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

export function NumInput({
  value,
  onChange,
  disabled,
  width,
  max,
  min,
  className,
  onEnter,
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
  className?: string;
  /** Enter im Feld — z. B. AktuellFeld's Betragsfeld wirkt wie der Standard-Knopf. */
  onEnter?: () => void;
}) {
  const readOnly = useReadOnly();
  // Was gerade im Feld STEHT, solange getippt wird — nicht was der Charakter
  // hat. Beides auseinanderzuhalten ist der ganze Punkt: das Feld muss
  // Zwischenstände zeigen dürfen, die noch keine Zahl sind ("", "-"), und beim
  // Betreten die 0 loswerden. Sonst steht die 0 im Weg und man tippt "05".
  // null = kein Entwurf, es gilt der Wert des Charakters.
  const [draft, setDraft] = useState<string | null>(null);
  const safe = Number.isFinite(value) ? value : 0;

  if (readOnly) return <span className="static-value static-num">{safe}</span>;

  const type = (raw: string) => {
    setDraft(raw);
    // Zwischenstand, noch keine Zahl — stehen lassen und nichts speichern.
    if (raw === '' || raw === '-') return;
    const typed = Number(raw);
    if (!Number.isFinite(typed)) return;
    let v = typed;
    if (max !== undefined) v = Math.min(v, max);
    if (min !== undefined) v = Math.max(v, min);
    onChange(v);
    // Gekappt: der Entwurf zeigte etwas anderes als das Gespeicherte, also weg
    // damit — das Feld springt sofort auf die Grenze statt erst beim Verlassen.
    if (v !== typed) setDraft(null);
  };

  return (
    <input
      type="number"
      className={className}
      value={draft ?? String(safe)}
      disabled={disabled}
      max={max}
      min={min}
      style={width ? { width } : undefined}
      // Eine 0 ist fast nie das, was jemand behalten will, der das Feld
      // anklickt — sie verschwindet, damit man einfach lostippen kann.
      onFocus={() => safe === 0 && setDraft('')}
      onBlur={() => setDraft(null)}
      onChange={(e) => type(e.target.value)}
      onKeyDown={
        onEnter
          ? (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEnter();
                // Enter ist ein Commit wie Blur — sonst zeigt das Feld den
                // getippten Entwurf weiter an, selbst wenn onEnter den Wert von
                // außen (z. B. AktuellFeld's Reset auf 0) geändert hat.
                setDraft(null);
              }
            }
          : undefined
      }
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
  const readOnly = useReadOnly();
  const ref = useRef<HTMLTextAreaElement>(null);
  // `readOnly` gehört in beide Abhängigkeitslisten: beim Umschalten auf
  // Bearbeiten entsteht das Textfeld neu und braucht Höhe und Beobachter
  // wieder — ohne das bliebe es nach dem ersten Umschalten einzeilig.
  useLayoutEffect(() => {
    if (ref.current) fitSoon(ref.current);
  }, [value, readOnly]);
  // Die Höhe hängt nicht nur am Inhalt, sondern auch an der Breite: eine
  // verstellte Spalte oder ein schmaleres Fenster ändert die Zahl der Zeilen.
  useEffect(() => {
    const el = ref.current;
    return el ? observeAutosize(el) : undefined;
  }, [readOnly]);

  // Ein geschütztes Leerzeichen, wo nichts steht: sonst fällt die Zeile in sich
  // zusammen und die Tabelle zappelt beim Umschalten.
  if (readOnly) return <div className="static-value static-text">{value || ' '}</div>;

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
  // Nur-Lesen wirkt wie das schon vorhandene `disabled`: die Löschen-Spalte
  // fällt weg, „+ Zeile" auch. Von hier an zählt nur noch `ro`.
  const readOnly = useReadOnly();
  const ro = disabled || readOnly;
  const cols = def.columns.filter((c) => !hiddenColumns.includes(c.key) && c.key !== NOTIZ_KEY);
  const hasNotiz = def.columns.some((c) => c.key === NOTIZ_KEY);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const trailingCols = extraColumns.length + (hasNotiz ? 1 : 0) + (ro ? 0 : 1);
  // Was die festen Spalten am rechten Rand belegen; den Rest teilen sich die
  // Datenspalten nach ihren Prozentanteilen.
  const fixedPx = extraColumns.length * EXTRA_PX + (hasNotiz ? TRAILING_PX : 0) + (ro ? 0 : TRAILING_PX);
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
            {!ro && <col style={{ width: TRAILING_PX }} />}
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
              {!ro && <th />}
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
                        <CellInput col={c} row={row} disabled={ro} onChange={(r) => setRow(i, r)} />
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
                  {!ro && (
                    <td>
                      <ConfirmDeleteButton title="Zeile entfernen" onConfirm={() => removeRow(i)} />
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
                        readOnly={ro}
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
      {!ro && (
        <button className="small add-row" onClick={addRow}>
          + Zeile
        </button>
      )}
    </>
  );
}
