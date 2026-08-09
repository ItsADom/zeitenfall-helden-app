import { useState } from 'react';
import type { Item } from '@shared/items';
import { itemGewicht, lastInfo } from '@shared/items';
import { useReadOnly } from '../components/displayMode';
import { NumInput, TextInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Inventar auf dem einheitlichen Gegenstands-Modell (Cluster 5a). Alles ist EIN
// Item mit Gewicht (kg/Stück), Kategorie und Ort. Gruppiert nach den selbst
// verwalteten Kategorien, mit Gewichts-Summe je Gruppe und einer Traglast-
// Anzeige oben (getragen / Maximum), die bei Überladung warnt.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

// Neue (noch nicht gespeicherte) Gegenstände brauchen einen eindeutigen
// Schlüssel; der Server vergibt beim Speichern echte IDs. Absteigend negativ,
// damit sie nie mit einer DB-ID kollidieren.
let tempId = -1;
const newId = () => tempId--;

export default function InventarTab() {
  const { data, update } = useChar();
  const ro = useReadOnly();
  const items = data.items;
  const cats = data.itemCategories;

  const setItems = (next: Item[]) => update('items', next);
  const setItem = (idx: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const addItem = (kategorie: string) =>
    setItems([...items, { id: newId(), name: '', anzahl: 1, gewicht: 0, kategorie, location: 'inventar', notiz: '' }]);

  const setCats = (next: string[]) => update('itemCategories', next);
  const addCat = (name: string) => {
    const n = name.trim();
    if (n && !cats.includes(n)) setCats([...cats, n]);
  };
  const renameCat = (oldName: string, next: string) => {
    const n = next.trim();
    if (!n || n === oldName || cats.includes(n)) return;
    setCats(cats.map((c) => (c === oldName ? n : c)));
    // Die Gegenstände der Kategorie ziehen mit (Umbenennen aktualisiert sie).
    setItems(items.map((it) => (it.kategorie === oldName ? { ...it, kategorie: n } : it)));
  };
  const removeCat = (name: string) => setCats(cats.filter((c) => c !== name));

  // Anzuzeigende Gruppen: erst die verwalteten Kategorien (in ihrer Reihenfolge),
  // dann verwaiste (an Gegenständen, aber nicht in der Liste), zuletzt „ohne".
  const usedCats = new Set(items.map((i) => i.kategorie).filter(Boolean));
  const orphanCats = [...usedCats].filter((c) => !cats.includes(c)).sort((a, b) => a.localeCompare(b, 'de'));
  const hasUncat = items.some((i) => !i.kategorie);
  const groupKeys = [...cats, ...orphanCats, ...(hasUncat ? [''] : [])];

  const load = lastInfo(items, data.attributes);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;

  // Gegenstände mit ihrem ursprünglichen Index (zum Bearbeiten der flachen Liste).
  const indexed = items.map((it, idx) => ({ it, idx }));

  return (
    <>
      <div className="panel">
        <h3>Traglast</h3>
        <div className={`last-meter${load.ueberladen ? ' over' : ''}`}>
          <div className="last-bar" aria-hidden>
            <div className="last-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="last-num">
            <strong>{kg(load.getragen)}</strong> / {kg(load.max)} kg
            {load.ueberladen && <span className="last-warn"> · überladen</span>}
          </div>
        </div>
      </div>

      {!ro && (
        <div className="panel">
          <h3>Kategorien</h3>
          <div className="cat-manage">
            {cats.map((c) => (
              <CategoryChip key={c} name={c} onRename={(n) => renameCat(c, n)} onRemove={() => removeCat(c)} />
            ))}
            <AddCategory onAdd={addCat} />
          </div>
        </div>
      )}

      {groupKeys.length === 0 && (
        <p className="muted">
          Noch keine Gegenstände.{!ro && ' Lege oben Kategorien an und füge unten Gegenstände hinzu.'}
        </p>
      )}

      {groupKeys.map((g) => {
        const rows = indexed.filter(({ it }) => it.kategorie === g);
        // Im Nur-Lesen-Modus leere Gruppen (etwa angelegte, noch ungenutzte
        // Kategorien) ausblenden — beim Bearbeiten bleiben sie sichtbar.
        if (rows.length === 0 && ro) return null;
        const summe = rows.reduce((s, { it }) => s + itemGewicht(it), 0);
        return (
          <div className="panel" key={g || '__none'}>
            <h3>
              <span className="panel-title">{g || 'Ohne Kategorie'}</span>
              <span className="head-rule" aria-hidden />
              <span className="muted inv-sum">{kg(summe)} kg</span>
            </h3>
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Gegenstand</th>
                    <th style={{ width: 70 }}>Anzahl</th>
                    <th style={{ width: 90 }}>kg/St.</th>
                    <th style={{ width: 80 }}>Σ kg</th>
                    {!ro && <th style={{ width: 150 }}>Kategorie</th>}
                    <th>Notiz</th>
                    {!ro && <th style={{ width: 40 }} />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={ro ? 5 : 7} className="muted">
                        Keine Gegenstände
                      </td>
                    </tr>
                  )}
                  {rows.map(({ it, idx }) => (
                    <tr key={it.id}>
                      <td>
                        <TextInput value={it.name} onChange={(v) => setItem(idx, { name: v })} />
                      </td>
                      <td className="num">
                        <NumInput value={it.anzahl} min={0} onChange={(v) => setItem(idx, { anzahl: v })} />
                      </td>
                      <td className="num">
                        <NumInput value={it.gewicht} min={0} onChange={(v) => setItem(idx, { gewicht: v })} />
                      </td>
                      <td className="computed">{kg(itemGewicht(it))}</td>
                      {!ro && (
                        <td>
                          <select value={it.kategorie} onChange={(e) => setItem(idx, { kategorie: e.target.value })}>
                            <option value="">— ohne —</option>
                            {cats.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                            {it.kategorie && !cats.includes(it.kategorie) && (
                              <option value={it.kategorie}>{it.kategorie}</option>
                            )}
                          </select>
                        </td>
                      )}
                      <td>
                        <TextInput value={it.notiz} onChange={(v) => setItem(idx, { notiz: v })} />
                      </td>
                      {!ro && (
                        <td>
                          <button className="small" title="Gegenstand entfernen" onClick={() => removeItem(idx)}>
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!ro && (
              <button className="small add-row" onClick={() => addItem(g)}>
                + Gegenstand
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

// Eine Kategorie in der Verwaltung: umbenennbar (Enter/Blur), entfernbar.
function CategoryChip({ name, onRename, onRemove }: { name: string; onRename: (n: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <span className="cat-chip">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(name);
        }}
      />
      <button className="small" title="Kategorie entfernen" onClick={onRemove}>
        ✕
      </button>
    </span>
  );
}

function AddCategory({ onAdd }: { onAdd: (name: string) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    onAdd(draft);
    setDraft('');
  };
  return (
    <span className="cat-add">
      <input
        placeholder="Neue Kategorie…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <button className="small" disabled={!draft.trim()} onClick={commit}>
        Hinzufügen
      </button>
    </span>
  );
}
