import { useEffect, useMemo, useRef, useState } from 'react';
import { CollapseChevron, CollapsedNote, useCollapsed } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { ColumnDivider, TableTools, useTableLayout } from '../components/tableLayout';
import type { Attributes } from '@shared/types';
import {
  computeProbeCell,
  containerSlotCount,
  DYN_CONTAINER_KEY,
  DYN_NOTIZ_KEY,
  DYN_SLOTS_KEY,
  readSlots,
} from '@shared/dynamicSections';
import type { DynColumn, DynColType, DynRow, DynSection, DynTab } from '@shared/dynamicSections';
import { apiDelete, apiPost, apiPut } from '../api';
import { useReadOnly } from '../components/displayMode';
import { NumInput, TextInput } from '../components/inputs';

// Ein konfigurierbarer Inhalts-Tab: enthält mehrere generische Sektionen
// (Tabellen/Notizfelder). Probe-Spalten rechnen live aus einem Attribut-Ausdruck.

const COL_TYPES: { value: DynColType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'bool', label: 'Ja/Nein' },
  { value: 'probe', label: 'Probe (berechnet)' },
  { value: 'equipment', label: 'Ausrüstung (Behälter)' },
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
  // Reiter-Verwaltung (Umbenennen/Verschieben/Löschen) im Kopf dieses Views.
  // Auf der Charakterseite ausgeschaltet — dort läuft das über die Einstellungen;
  // die Gruppenseite verwaltet ihre gemeinsamen Reiter weiterhin hier.
  showTabControls = true,
  onDirtyChange,
  onSectionsChange,
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
  showTabControls?: boolean;
  // Meldet dem Eltern-Element, ob noch ungespeicherte Zeilen anstehen — damit
  // eine Hintergrund-Aktualisierung die laufende Bearbeitung nicht überschreibt.
  onDirtyChange?: (dirty: boolean) => void;
  // Meldet geänderte Sektionen/Zeilen ans Eltern-Element, damit dessen tab-Daten
  // aktuell bleiben — sonst zeigt ein Remount (Tab-Wechsel) den veralteten Stand.
  onSectionsChange?: (sections: DynSection[]) => void;
  onRenameTab?: (name: string) => void;
  onDeleteTab?: () => void;
  onMoveTab?: (dir: -1 | 1) => void;
}) {
  const readOnly = useReadOnly();
  const [sections, setSections] = useState<DynSection[]>(tab.sections);
  const [saveState, setSaveState] = useState('');
  const timers = useRef<Map<number, number>>(new Map());
  // Sektionen mit noch nicht gespeicherten Zeilen; solange nicht leer, gilt der
  // Tab als „dirty" und eine Hintergrund-Aktualisierung wird ausgesetzt.
  const pending = useRef<Set<number>>(new Set());

  // Änderungen ans Eltern-Element hochreichen, damit dessen tab-Daten aktuell
  // bleiben. Der erste Lauf (Initialstand) wird übersprungen — nur echte
  // Änderungen zählen. So zeigt ein Remount (Tab-Wechsel) den aktuellen Stand.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    onSectionsChange?.(sections);
    // onSectionsChange bewusst nicht in den Deps: nur auf Sektions-Änderungen reagieren
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const patchSection = (id: number, patch: Partial<DynSection>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const saveRowsDebounced = (section: DynSection, rows: DynRow[]) => {
    patchSection(section.id, { rows });
    window.clearTimeout(timers.current.get(section.id));
    pending.current.add(section.id);
    onDirtyChange?.(true);
    const t = window.setTimeout(async () => {
      setSaveState('Speichere…');
      try {
        await apiPut(`${basePath}/sections/${section.id}/rows`, rows);
        setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
      } catch (e) {
        setSaveState(`Fehler: ${e instanceof Error ? e.message : e}`);
      } finally {
        pending.current.delete(section.id);
        if (pending.current.size === 0) onDirtyChange?.(false);
      }
    }, 1500);
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
      {showTabControls ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <input
            className="section-title"
            defaultValue={tab.name}
            key={tab.name}
            disabled={tab.locked || readOnly}
            title={tab.locked ? 'Pflicht-Tab (nicht umbenennbar)' : 'Tab umbenennen'}
            onBlur={(e) => onRenameTab?.(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {tab.locked && <span className="muted">🔒 Pflicht-Tab</span>}
          <span style={{ flex: 1 }} />
          <span className="savestate">{saveState}</span>
          {!readOnly && (
            <>
              <button className="small" disabled={isFirst} onClick={() => onMoveTab?.(-1)} title="Tab nach links">
                ←
              </button>
              <button className="small" disabled={isLast} onClick={() => onMoveTab?.(1)} title="Tab nach rechts">
                →
              </button>
            </>
          )}
          {!tab.locked && !readOnly && (
            <button
              className="small"
              onClick={() => confirm(`Tab „${tab.name}" mit allen Sektionen löschen?`) && onDeleteTab?.()}
              title="Tab löschen"
            >
              Tab löschen
            </button>
          )}
        </div>
      ) : (
        // Ohne Reiter-Verwaltung (Charakterseite) nur der Speicherhinweis der Inhalte.
        saveState && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <span className="savestate">{saveState}</span>
          </div>
        )
      )}

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

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={() => addSection('table')}>
            + Tabelle
          </button>
          <button className="small" onClick={() => addSection('notes')}>
            + Notizfeld
          </button>
        </div>
      )}
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
  const readOnly = useReadOnly();
  // Die Überschrift ist hier ein Eingabefeld — ein Klick darauf muss den Namen
  // bearbeiten, nicht die Sektion zuklappen. Also übernimmt das Sigel davor
  // die Rolle des Schalters.
  const [collapsed, toggleCollapsed] = useCollapsed(`sec:${section.id}`);
  const [editCols, setEditCols] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const [capEdit, setCapEdit] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const cols = section.columns.filter((c) => c.key !== DYN_NOTIZ_KEY);

  // Behälter-Funktion (📦 feste Fächer) nur zeigen, wenn die Sektion eine
  // Ausrüstungs-Spalte hat — so bleiben normale Text-Tabellen unbehelligt.
  // Zusätzlich einblenden, wenn eine Zeile schon Behälter ist (Altbestand ohne
  // Ausrüstungs-Spalte bleibt bearbeitbar).
  const hasEquipmentCol = cols.some((c) => c.type === 'equipment');
  const showContainerCol = hasEquipmentCol || section.rows.some((r) => containerSlotCount(r) > 0);
  // Zusatzspalten je Zeile: Notiz, optional Behälter, Löschen. Ohne Bearbeiten
  // fallen Behälter-Knopf und Löschen weg — die Zahl muss mitgehen, sonst passt
  // das colSpan der Notiz- und Fächerzeilen nicht mehr.
  const extraCols = readOnly ? 1 : showContainerCol ? 3 : 2;

  // Diese Tabelle bringt ihre Spalten selbst mit, deshalb wohnt die Breite in
  // der Spaltendefinition und wird über denselben Weg gespeichert wie
  // Bezeichnung und Typ — nicht in der Ablage für die eingebauten Tabellen.
  const fixedPx = extraCols * 40;
  const layout = useTableLayout(`sec:${section.id}`, cols.length, {
    stored: cols.map((c) => c.width),
    save: (widths) => onColumns(cols.map((c, i) => ({ ...c, width: widths[i] }))),
    fixedPx,
  });

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
  // Öffnet/schließt den Fächer-Anzahl-Editor einer Zeile. Die Fächer-Inhalte
  // selbst sind bei einem Behälter (Anzahl > 0) ohnehin dauerhaft sichtbar.
  const toggleCap = (i: number) =>
    setCapEdit((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="title-marker as-button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Sektion ausklappen' : 'Sektion einklappen'}
        />
        {/* Direkt neben dem Sigel, nicht hinter dem Titelfeld: sonst schwebt
            der Pfeil mitten in der Zeile und gehört sichtbar zu nichts. */}
        <CollapseChevron open={!collapsed} />
        <input
          className="section-title"
          defaultValue={section.name}
          key={section.name}
          disabled={readOnly}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span style={{ flex: 1 }} />
        {showVisibility && (
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} title="Für Gruppenmitglieder sichtbar">
            <input type="checkbox" checked={section.visible} disabled={readOnly} onChange={(e) => onVisible(e.target.checked)} /> sichtbar
          </label>
        )}
        {!readOnly && (
          <>
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
          </>
        )}
      </div>

      {collapsed ? (
        // Zeilenzahl nur bei Tabellen: ein Notizfeld hat immer genau eine
        // Zeile, „1 Zeile" wäre dort keine Auskunft.
        <CollapsedNote rows={section.type === 'notes' ? undefined : section.rows.length} onOpen={toggleCollapsed} />
      ) : section.type === 'notes' ? (
        <textarea
          className="note-area"
          rows={4}
          placeholder="Freitext…"
          value={String(section.rows[0]?.text ?? '')}
          readOnly={readOnly}
          onChange={(e) => onRows([{ text: e.target.value }])}
        />
      ) : (
        <>
          {editCols && !readOnly && <ColumnEditor columns={section.columns} allowProbe={allowProbe} onChange={onColumns} />}
          <TableTools layout={layout} label={section.name} />
          <div className="table-wrap">
            <table
              ref={layout.tableRef}
              className="sheet"
              style={{ tableLayout: 'fixed', width: '100%', minWidth: cols.length * 64 + fixedPx }}
            >
              <colgroup>
                {cols.map((c, i) => (
                  <col key={c.key} style={{ width: layout.colWidth(i) }} />
                ))}
                <col style={{ width: 40 }} />
                {showContainerCol && !readOnly && <col style={{ width: 40 }} />}
                {!readOnly && <col style={{ width: 40 }} />}
              </colgroup>
              <thead>
                <tr>
                  {cols.map((c, i) => (
                    <th
                      key={c.key}
                      className="sortable"
                      title={`${c.label} — zum Sortieren klicken`}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      <span className="sort-caret">{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                      {/* Der Trennstrich schluckt seine Klicks selbst, sonst
                          würde jedes Ziehen die Spalte mitsortieren. */}
                      {i < cols.length - 1 && <ColumnDivider layout={layout} index={i} />}
                    </th>
                  ))}
                  <th />
                  {showContainerCol && !readOnly && <th />}
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody>
                {order.map((i) => {
                  const row = section.rows[i];
                  const notiz = String(row[DYN_NOTIZ_KEY] ?? '');
                  const slotCount = containerSlotCount(row);
                  const showDetail = slotCount > 0 || capEdit.has(i);
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
                      {showContainerCol && !readOnly && (
                        <td>
                          <button
                            className={`small container-btn${slotCount > 0 ? ' active' : ''}`}
                            title={
                              slotCount > 0
                                ? `Behälter mit ${slotCount} ${slotCount === 1 ? 'Fach' : 'Fächern'} — Anzahl ändern`
                                : 'Als Behälter mit festen Fächern einrichten'
                            }
                            onClick={() => toggleCap(i)}
                          >
                            📦
                          </button>
                        </td>
                      )}
                      {!readOnly && (
                        <td>
                          <ConfirmDeleteButton title="Zeile entfernen" onConfirm={() => removeRow(i)} />
                        </td>
                      )}
                    </tr>,
                    openNotes.has(i) ? (
                      <tr key={`n${i}`} className="note-row">
                        <td colSpan={cols.length + extraCols}>
                          <textarea
                            className="note-area"
                            rows={2}
                            placeholder="Notiz…"
                            value={notiz}
                            readOnly={readOnly}
                            autoFocus
                            onChange={(e) => setRow(i, { ...row, [DYN_NOTIZ_KEY]: e.target.value })}
                          />
                        </td>
                      </tr>
                    ) : null,
                    showDetail ? (
                      <tr key={`s${i}`} className="slot-row">
                        <td colSpan={cols.length + extraCols}>
                          {capEdit.has(i) && (
                            <div className="slots-cap">
                              <label>
                                Feste Fächer:{' '}
                                <input
                                  type="number"
                                  min={0}
                                  value={slotCount}
                                  autoFocus
                                  onChange={(e) =>
                                    setRow(i, { ...row, [DYN_CONTAINER_KEY]: Math.max(0, Number(e.target.value) || 0) })
                                  }
                                />
                              </label>
                            </div>
                          )}
                          {slotCount > 0 &&
                            readSlots(row).map((val, si) => (
                              <div key={si} className="slot-line">
                                <span className="slot-branch" aria-hidden>
                                  └
                                </span>
                                <span className="slot-num">{si + 1}</span>
                                <input
                                  value={val}
                                  placeholder="leer"
                                  readOnly={readOnly}
                                  onChange={(e) => {
                                    const next = readSlots(row).slice();
                                    next[si] = e.target.value;
                                    setRow(i, { ...row, [DYN_SLOTS_KEY]: next });
                                  }}
                                />
                              </div>
                            ))}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                {section.rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + extraCols} className="muted">
                      Keine Einträge
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <button className="small add-row" onClick={addRow}>
              + Zeile
            </button>
          )}
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
  const readOnly = useReadOnly();
  if (col.type === 'probe') {
    const v = computeProbeCell(attributes, col, row);
    return <span className="computed" style={{ display: 'block' }}>{v ?? '—'}</span>;
  }
  // Über NumInput statt über ein rohes <input>: so gilt hier dasselbe wie
  // überall sonst — fester Text im Nur-Lesen-Modus, und die führende 0
  // verschwindet beim Hineinklicken.
  if (col.type === 'number') {
    return <NumInput value={Number(row[col.key]) || 0} onChange={(v) => onChange({ ...row, [col.key]: v })} />;
  }
  if (col.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={!!row[col.key]}
        disabled={readOnly}
        onChange={(e) => onChange({ ...row, [col.key]: e.target.checked })}
      />
    );
  }
  // 'equipment' verhält sich in der Zelle wie Text (Gegenstandsname); die
  // Behälter-Fächer hängen an der Zeile und werden separat gerendert.
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
    <div className="panel" style={{ background: 'var(--surface-sunken)', marginBottom: 10 }}>
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
