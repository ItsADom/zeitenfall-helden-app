import { useRef, useState } from 'react';
import type { Attributes } from '@shared/types';
import { computeProbeCell, DYN_NOTIZ_KEY } from '@shared/dynamicSections';
import type { DynColumn, DynColType, DynRow, DynSection } from '@shared/dynamicSections';
import { apiDelete, apiPost, apiPut } from '../api';

// Datengesteuerte Sektionen: der Spieler legt eigene Tabellen mit eigenen
// Spalten an. Probe-Spalten rechnen live aus einem Attribut-Ausdruck.

const COL_TYPES: { value: DynColType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'bool', label: 'Ja/Nein' },
  { value: 'probe', label: 'Probe (berechnet)' },
];

let keyCounter = 0;
const freshKey = () => `c${Date.now().toString(36)}${keyCounter++}`;

export default function DynamicSectionsTab({
  charId,
  initial,
  attributes,
}: {
  charId: number;
  initial: DynSection[];
  attributes: Attributes;
}) {
  const [sections, setSections] = useState<DynSection[]>(initial);
  const [saveState, setSaveState] = useState('');
  const timers = useRef<Map<number, number>>(new Map());

  const patchSection = (id: number, patch: Partial<DynSection>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const saveRowsDebounced = (section: DynSection, rows: DynRow[]) => {
    patchSection(section.id, { rows });
    window.clearTimeout(timers.current.get(section.id));
    const t = window.setTimeout(async () => {
      setSaveState('Speichere…');
      try {
        await apiPut(`/api/characters/${charId}/sections/${section.id}/rows`, rows);
        setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
      } catch (e) {
        setSaveState(`Fehler: ${e instanceof Error ? e.message : e}`);
      }
    }, 700);
    timers.current.set(section.id, t);
  };

  const saveColumns = async (section: DynSection, columns: DynColumn[]) => {
    patchSection(section.id, { columns });
    await apiPut(`/api/characters/${charId}/sections/${section.id}`, { columns });
  };

  const addSection = async (type: 'table' | 'notes') => {
    const name = type === 'notes' ? 'Neue Notiz' : 'Neue Sektion';
    const columns: DynColumn[] =
      type === 'notes' ? [] : [{ key: freshKey(), label: 'Name', type: 'text' }];
    const { id } = await apiPost<{ id: number }>(`/api/characters/${charId}/sections`, { name, type, columns });
    setSections((prev) => [...prev, { id, name, type, columns, rows: [], pos: prev.length }]);
  };

  const renameSection = async (section: DynSection, name: string) => {
    if (name === section.name) return;
    patchSection(section.id, { name });
    await apiPut(`/api/characters/${charId}/sections/${section.id}`, { name });
  };

  const deleteSection = async (section: DynSection) => {
    if (!confirm(`Sektion „${section.name}" mit ${section.rows.length} Zeile(n) löschen?`)) return;
    await apiDelete(`/api/characters/${charId}/sections/${section.id}`);
    setSections((prev) => prev.filter((s) => s.id !== section.id));
  };

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setSections(next);
    await apiPut(`/api/characters/${charId}/sections/reorder`, { order: next.map((s) => s.id) });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, flex: 1 }}>
          Eigene Bereiche dieses Charakters. Spalten frei definierbar; „Probe"-Spalten berechnen sich aus einem
          Attribut-Ausdruck (z.&nbsp;B. <code>FF+KL+GE</code>) und optional einem TaW-Wert.
        </p>
        <span className="savestate">{saveState}</span>
      </div>

      {sections.map((section, i) => (
        <SectionPanel
          key={section.id}
          section={section}
          attributes={attributes}
          isFirst={i === 0}
          isLast={i === sections.length - 1}
          onRows={(rows) => saveRowsDebounced(section, rows)}
          onColumns={(cols) => saveColumns(section, cols)}
          onRename={(name) => renameSection(section, name)}
          onDelete={() => deleteSection(section)}
          onMove={(dir) => move(i, dir)}
        />
      ))}
      {sections.length === 0 && <p className="muted">Noch keine eigenen Sektionen.</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={() => addSection('table')}>
          + Tabelle
        </button>
        <button className="small" onClick={() => addSection('notes')}>
          + Notizfeld
        </button>
      </div>
    </>
  );
}

function SectionPanel({
  section,
  attributes,
  isFirst,
  isLast,
  onRows,
  onColumns,
  onRename,
  onDelete,
  onMove,
}: {
  section: DynSection;
  attributes: Attributes;
  isFirst: boolean;
  isLast: boolean;
  onRows: (rows: DynRow[]) => void;
  onColumns: (cols: DynColumn[]) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [editCols, setEditCols] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const cols = section.columns.filter((c) => c.key !== DYN_NOTIZ_KEY);

  const setRow = (i: number, row: DynRow) => {
    const rows = section.rows.slice();
    rows[i] = row;
    onRows(rows);
  };
  const addRow = () => onRows([...section.rows, {}]);
  const removeRow = (i: number) => onRows(section.rows.filter((_, j) => j !== i));
  const toggleNote = (i: number) =>
    setOpenNotes((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input
          className="section-title"
          defaultValue={section.name}
          key={section.name}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span style={{ flex: 1 }} />
        <button className="small" disabled={isFirst} onClick={() => onMove(-1)} title="nach oben">
          ↑
        </button>
        <button className="small" disabled={isLast} onClick={() => onMove(1)} title="nach unten">
          ↓
        </button>
        {section.type === 'table' && (
          <button className="small" onClick={() => setEditCols((v) => !v)}>
            {editCols ? 'Fertig' : 'Spalten'}
          </button>
        )}
        <button className="small" onClick={onDelete} title="Sektion löschen">
          Löschen
        </button>
      </div>

      {section.type === 'notes' ? (
        <textarea
          className="note-area"
          rows={4}
          placeholder="Freitext…"
          value={String(section.rows[0]?.text ?? '')}
          onChange={(e) => onRows([{ text: e.target.value }])}
        />
      ) : (
        <>
          {editCols && <ColumnEditor columns={section.columns} onChange={onColumns} />}
          <div className="table-wrap">
            <table className="sheet" style={{ minWidth: cols.length * 130 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} title={c.label}>
                      {c.label}
                    </th>
                  ))}
                  <th style={{ width: 40 }} />
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, i) => {
                  const notiz = String(row[DYN_NOTIZ_KEY] ?? '');
                  return [
                    <tr key={i}>
                      {cols.map((c) => (
                        <td key={c.key} className={c.type === 'number' || c.type === 'probe' ? 'num' : undefined}>
                          <Cell col={c} row={row} attributes={attributes} onChange={(r) => setRow(i, r)} />
                        </td>
                      ))}
                      <td>
                        <button
                          className={`small note-btn${notiz ? ' has-note' : ''}`}
                          title={notiz || 'Notiz'}
                          onClick={() => toggleNote(i)}
                        >
                          {notiz ? '📝' : '✎'}
                        </button>
                      </td>
                      <td>
                        <button className="small" title="Zeile entfernen" onClick={() => removeRow(i)}>
                          ✕
                        </button>
                      </td>
                    </tr>,
                    openNotes.has(i) ? (
                      <tr key={`n${i}`} className="note-row">
                        <td colSpan={cols.length + 2}>
                          <textarea
                            className="note-area"
                            rows={2}
                            placeholder="Notiz…"
                            value={notiz}
                            autoFocus
                            onChange={(e) => setRow(i, { ...row, [DYN_NOTIZ_KEY]: e.target.value })}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                {section.rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 2} className="muted">
                      Keine Einträge
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button className="small add-row" onClick={addRow}>
            + Zeile
          </button>
        </>
      )}
    </div>
  );
}

function Cell({
  col,
  row,
  attributes,
  onChange,
}: {
  col: DynColumn;
  row: DynRow;
  attributes: Attributes;
  onChange: (row: DynRow) => void;
}) {
  if (col.type === 'probe') {
    const v = computeProbeCell(attributes, col, row);
    return <span className="computed" style={{ display: 'block' }}>{v ?? '—'}</span>;
  }
  if (col.type === 'number') {
    return (
      <input
        type="number"
        value={Number(row[col.key]) || 0}
        onChange={(e) => onChange({ ...row, [col.key]: Number(e.target.value) || 0 })}
      />
    );
  }
  if (col.type === 'bool') {
    return <input type="checkbox" checked={!!row[col.key]} onChange={(e) => onChange({ ...row, [col.key]: e.target.checked })} />;
  }
  return (
    <input
      type="text"
      value={String(row[col.key] ?? '')}
      title={String(row[col.key] ?? '')}
      onChange={(e) => onChange({ ...row, [col.key]: e.target.value })}
    />
  );
}

function ColumnEditor({ columns, onChange }: { columns: DynColumn[]; onChange: (cols: DynColumn[]) => void }) {
  const cols = columns.filter((c) => c.key !== DYN_NOTIZ_KEY);
  const textCols = cols.filter((c) => c.type === 'text');
  const numCols = cols.filter((c) => c.type === 'number');

  const patch = (key: string, p: Partial<DynColumn>) => onChange(cols.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const remove = (key: string) => onChange(cols.filter((c) => c.key !== key));
  const add = () => onChange([...cols, { key: freshKey(), label: 'Spalte', type: 'text' }]);
  const moveCol = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    const next = cols.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="panel" style={{ background: '#fbf8ee', marginBottom: 10 }}>
      <strong>Spalten</strong>
      <table className="sheet" style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th style={{ width: 150 }}>Typ</th>
            <th>Probe-Konfiguration</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={c.key}>
              <td>
                <input value={c.label} onChange={(e) => patch(c.key, { label: e.target.value })} />
              </td>
              <td>
                <select value={c.type} onChange={(e) => patch(c.key, { type: e.target.value as DynColType })}>
                  {COL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {c.type === 'probe' ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="muted">Ausdruck aus</span>
                    <select value={c.probeExprKey ?? ''} onChange={(e) => patch(c.key, { probeExprKey: e.target.value })}>
                      <option value="">— Textspalte —</option>
                      {textCols.map((tc) => (
                        <option key={tc.key} value={tc.key}>
                          {tc.label}
                        </option>
                      ))}
                    </select>
                    <span className="muted">+ TaW aus</span>
                    <select value={c.probeTawKey ?? ''} onChange={(e) => patch(c.key, { probeTawKey: e.target.value || undefined })}>
                      <option value="">— (keine) —</option>
                      {numCols.map((nc) => (
                        <option key={nc.key} value={nc.key}>
                          {nc.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="small" disabled={i === 0} onClick={() => moveCol(i, -1)} title="nach links">
                  ←
                </button>
                <button className="small" disabled={i === cols.length - 1} onClick={() => moveCol(i, 1)} title="nach rechts">
                  →
                </button>
                <button className="small" onClick={() => remove(c.key)} title="Spalte entfernen">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small add-row" onClick={add}>
        + Spalte
      </button>
    </div>
  );
}
