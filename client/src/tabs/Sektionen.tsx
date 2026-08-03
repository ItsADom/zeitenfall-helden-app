import { useMemo, useRef, useState } from 'react';
import type { Attributes } from '@shared/types';
import { computeProbeCell, DYN_NOTIZ_KEY } from '@shared/dynamicSections';
import type { DynColumn, DynColType, DynRow, DynSection, DynTab } from '@shared/dynamicSections';
import { apiDelete, apiPost, apiPut } from '../api';
import { TextInput } from '../components/inputs';

// Ein konfigurierbarer Inhalts-Tab: enthält mehrere generische Sektionen
// (Tabellen/Notizfelder). Probe-Spalten rechnen live aus einem Attribut-Ausdruck.

const COL_TYPES: { value: DynColType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'bool', label: 'Ja/Nein' },
  { value: 'probe', label: 'Probe (berechnet)' },
];

let keyCounter = 0;
const freshKey = () => `c${Date.now().toString(36)}${keyCounter++}`;

export default function ContentTabView({
  basePath,
  tab,
  attributes,
  isFirst,
  isLast,
  showVisibility = true,
  allowProbe = true,
  onRenameTab,
  onDeleteTab,
  onMoveTab,
}: {
  // API-Wurzel des Besitzers, z. B. "/api/characters/6" oder "/api/groups/3"
  basePath: string;
  tab: DynTab;
  attributes: Attributes;
  isFirst: boolean;
  isLast: boolean;
  showVisibility?: boolean;
  allowProbe?: boolean;
  onRenameTab: (name: string) => void;
  onDeleteTab: () => void;
  onMoveTab: (dir: -1 | 1) => void;
}) {
  const [sections, setSections] = useState<DynSection[]>(tab.sections);
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
        await apiPut(`${basePath}/sections/${section.id}/rows`, rows);
        setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
      } catch (e) {
        setSaveState(`Fehler: ${e instanceof Error ? e.message : e}`);
      }
    }, 700);
    timers.current.set(section.id, t);
  };

  const saveColumns = async (section: DynSection, columns: DynColumn[]) => {
    patchSection(section.id, { columns });
    await apiPut(`${basePath}/sections/${section.id}`, { columns });
  };

  const addSection = async (type: 'table' | 'notes') => {
    const name = type === 'notes' ? 'Neue Notiz' : 'Neue Tabelle';
    const columns: DynColumn[] = type === 'notes' ? [] : [{ key: freshKey(), label: 'Name', type: 'text' }];
    const { id } = await apiPost<{ id: number }>(`${basePath}/sections`, { tabId: tab.id, name, type, columns });
    setSections((prev) => [...prev, { id, name, type, columns, rows: [], pos: prev.length, visible: false }]);
  };

  const renameSection = async (section: DynSection, name: string) => {
    if (name === section.name) return;
    patchSection(section.id, { name });
    await apiPut(`${basePath}/sections/${section.id}`, { name });
  };

  const setVisible = async (section: DynSection, visible: boolean) => {
    patchSection(section.id, { visible });
    await apiPut(`${basePath}/sections/${section.id}`, { visible });
  };

  const deleteSection = async (section: DynSection) => {
    if (!confirm(`Sektion „${section.name}" mit ${section.rows.length} Zeile(n) löschen?`)) return;
    await apiDelete(`${basePath}/sections/${section.id}`);
    setSections((prev) => prev.filter((s) => s.id !== section.id));
  };

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setSections(next);
    await apiPut(`${basePath}/sections/reorder`, { order: next.map((s) => s.id) });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input
          className="section-title"
          defaultValue={tab.name}
          key={tab.name}
          disabled={tab.locked}
          title={tab.locked ? 'Pflicht-Tab (nicht umbenennbar)' : 'Tab umbenennen'}
          onBlur={(e) => onRenameTab(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {tab.locked && <span className="muted">🔒 Pflicht-Tab</span>}
        <span style={{ flex: 1 }} />
        <span className="savestate">{saveState}</span>
        <button className="small" disabled={isFirst} onClick={() => onMoveTab(-1)} title="Tab nach links">
          ←
        </button>
        <button className="small" disabled={isLast} onClick={() => onMoveTab(1)} title="Tab nach rechts">
          →
        </button>
        {!tab.locked && (
          <button
            className="small"
            onClick={() => confirm(`Tab „${tab.name}" mit allen Sektionen löschen?`) && onDeleteTab()}
            title="Tab löschen"
          >
            Tab löschen
          </button>
        )}
      </div>

      {sections.map((section, i) => (
        <SectionPanel
          key={section.id}
          section={section}
          attributes={attributes}
          isFirst={i === 0}
          isLast={i === sections.length - 1}
          showVisibility={showVisibility}
          allowProbe={allowProbe}
          onRows={(rows) => saveRowsDebounced(section, rows)}
          onColumns={(cols) => saveColumns(section, cols)}
          onRename={(name) => renameSection(section, name)}
          onDelete={() => deleteSection(section)}
          onMove={(dir) => move(i, dir)}
          onVisible={(v) => setVisible(section, v)}
        />
      ))}
      {sections.length === 0 && <p className="muted">Noch keine Sektionen in diesem Tab.</p>}

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
  showVisibility,
  allowProbe,
  onRows,
  onColumns,
  onRename,
  onDelete,
  onMove,
  onVisible,
}: {
  section: DynSection;
  attributes: Attributes;
  isFirst: boolean;
  isLast: boolean;
  showVisibility: boolean;
  allowProbe: boolean;
  onRows: (rows: DynRow[]) => void;
  onColumns: (cols: DynColumn[]) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onVisible: (visible: boolean) => void;
}) {
  const [editCols, setEditCols] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const cols = section.columns.filter((c) => c.key !== DYN_NOTIZ_KEY);

  // Sortier-Wert einer Zelle (Proben werden berechnet, Zahlen numerisch verglichen)
  const sortValue = (col: DynColumn, row: DynRow): number | string => {
    if (col.type === 'probe') return Number(computeProbeCell(attributes, col, row) ?? -Infinity);
    if (col.type === 'number') return Number(row[col.key]) || 0;
    if (col.type === 'bool') return row[col.key] ? 1 : 0;
    return String(row[col.key] ?? '');
  };

  // Anzeige-Reihenfolge: Indizes auf section.rows, damit Bearbeiten/Löschen
  // weiterhin die echte Zeile trifft
  const order = useMemo(() => {
    const idx = section.rows.map((_, i) => i);
    if (!sort) return idx;
    const col = cols.find((c) => c.key === sort.key);
    if (!col) return idx;
    return idx.sort((a, b) => {
      const va = sortValue(col, section.rows[a]);
      const vb = sortValue(col, section.rows[b]);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), 'de', { numeric: true, sensitivity: 'base' });
      return cmp * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.rows, sort, section.columns]);

  const toggleSort = (key: string) =>
    setSort((prev) => (prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null));

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
        <span className="title-marker" aria-hidden />
        <input
          className="section-title"
          defaultValue={section.name}
          key={section.name}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span style={{ flex: 1 }} />
        {showVisibility && (
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} title="Für Gruppenmitglieder sichtbar">
            <input type="checkbox" checked={section.visible} onChange={(e) => onVisible(e.target.checked)} /> sichtbar
          </label>
        )}
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
          {editCols && <ColumnEditor columns={section.columns} allowProbe={allowProbe} onChange={onColumns} />}
          <div className="table-wrap">
            <table className="sheet" style={{ minWidth: cols.length * 130 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className="sortable"
                      title={`${c.label} — zum Sortieren klicken`}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      <span className="sort-caret">{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                    </th>
                  ))}
                  <th style={{ width: 40 }} />
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {order.map((i) => {
                  const row = section.rows[i];
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
  return <TextInput value={String(row[col.key] ?? '')} onChange={(v) => onChange({ ...row, [col.key]: v })} />;
}

function ColumnEditor({
  columns,
  allowProbe,
  onChange,
}: {
  columns: DynColumn[];
  allowProbe: boolean;
  onChange: (cols: DynColumn[]) => void;
}) {
  // Ohne Attribute (z. B. bei Gruppen) gibt es nichts zu würfeln
  const colTypes = allowProbe ? COL_TYPES : COL_TYPES.filter((t) => t.value !== 'probe');
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
                  {colTypes.map((t) => (
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
