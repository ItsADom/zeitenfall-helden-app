import { useState } from 'react';
import type { Item, ItemLocation } from '@shared/items';
import { containerFuellung, itemGewicht, itemsInContainer, lastInfo, makeUid } from '@shared/items';
import { useReadOnly } from '../components/displayMode';
import { NumInput, TextInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Inventar (Cluster 5b): verfolgt nur, was IN Behältern steckt (plus einen losen
// Alt-Topf aus der Migration). Getragene Ausrüstung lebt im Ausrüstungs-Reiter.
// Von hier zieht man Dinge über „Zu Ausrüstung" hinüber, oder zwischen Behältern.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

interface DropTarget {
  location: ItemLocation;
  containerUid?: string;
}
const dropKey = (t: DropTarget) => `${t.location}:${t.containerUid ?? ''}`;

export default function InventarTab() {
  const { data, update } = useChar();
  const ro = useReadOnly();
  const items = data.items;
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const [over, setOver] = useState<string | null>(null);

  const setItems = (next: Item[]) => update('items', next);
  const patchItem = (uid: string, patch: Partial<Item>) => setItems(items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));
  // Beim Löschen eines Behälters wandert sein Inhalt zurück ins lose Inventar.
  const removeItem = (uid: string) =>
    setItems(
      items
        .filter((it) => it.uid !== uid)
        .map((it) => (it.containerUid === uid ? { ...it, location: 'inventar', containerUid: '' } : it)),
    );

  const blank = (over: Partial<Item>): Item => ({
    id: 0, uid: makeUid(), name: '', anzahl: 1, gewicht: 0, kategorie: '', location: 'inventar',
    zone: '', containerUid: '', istBehaelter: false, containerArt: 'storage', kapazitaet: 0,
    gewichtsreduktion: 0, rs: 0, notiz: '', ...over,
  });
  const addContainer = () => setItems([...items, blank({ name: 'Neuer Behälter', istBehaelter: true, containerArt: 'storage' })]);
  const addInto = (containerUid: string) => setItems([...items, blank({ location: 'behaelter', containerUid })]);

  // Kreis-Schutz wie in der Ausrüstung.
  const ancestors = (uid: string): Set<string> => {
    const seen = new Set<string>();
    let cur = byUid.get(uid);
    while (cur && cur.location === 'behaelter' && cur.containerUid) {
      if (seen.has(cur.containerUid)) break;
      seen.add(cur.containerUid);
      cur = byUid.get(cur.containerUid);
    }
    return seen;
  };
  const moveTo = (uid: string, t: DropTarget) => {
    if (t.location === 'behaelter' && t.containerUid) {
      if (t.containerUid === uid || ancestors(t.containerUid).has(uid)) return;
    }
    patchItem(uid, { location: t.location, zone: '', containerUid: t.location === 'behaelter' ? t.containerUid ?? '' : '' });
  };

  const isOver = (t: DropTarget) => over === dropKey(t);
  // Nur die Zieh-Handler (ohne className) — damit sie sich auf ein Panel legen
  // lassen, das schon eine eigene Klasse trägt.
  const dropHandlers = (t: DropTarget) => {
    const key = dropKey(t);
    return {
      onDragOver: (e: React.DragEvent) => {
        if (ro) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver((o) => (o === key ? null : o)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(null);
        const uid = e.dataTransfer.getData('text/plain');
        if (uid) moveTo(uid, t);
      },
    };
  };
  const dropProps = (t: DropTarget) => ({ className: `drop-zone${isOver(t) ? ' over' : ''}`, ...dropHandlers(t) });

  const storageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  // Lose Gegenstände: mitgeführt, kein Behälter (Alt-Bestand aus der Migration).
  const loose = items.filter((it) => it.location === 'inventar' && !it.istBehaelter);
  const looseCats = [...new Set(loose.map((it) => it.kategorie))].sort((a, b) => a.localeCompare(b, 'de'));

  const load = lastInfo(items, data.attributes);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;

  const row = (it: Item) => (
    <tr key={it.uid}>
      {!ro && (
        <td className="grip-cell">
          <span
            className="row-grip"
            draggable
            title="Ziehen zum Verschieben (anderer Behälter / Zu Ausrüstung)"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', it.uid);
            }}
          >
            ⠿
          </span>
        </td>
      )}
      <td>
        <TextInput value={it.name} onChange={(v) => patchItem(it.uid, { name: v })} />
      </td>
      <td className="num">
        <NumInput value={it.anzahl} min={0} onChange={(v) => patchItem(it.uid, { anzahl: v })} />
      </td>
      <td className="num">
        <NumInput value={it.gewicht} min={0} onChange={(v) => patchItem(it.uid, { gewicht: v })} />
      </td>
      <td className="computed">{kg(itemGewicht(it))}</td>
      <td>
        <TextInput value={it.notiz} onChange={(v) => patchItem(it.uid, { notiz: v })} />
      </td>
      {!ro && (
        <td>
          <button className="small" title="Gegenstand entfernen" onClick={() => removeItem(it.uid)}>
            ✕
          </button>
        </td>
      )}
    </tr>
  );

  const colgroup = (
    <colgroup>
      {!ro && <col style={{ width: 28 }} />}
      <col style={{ width: '24em' }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 78 }} />
      <col style={{ width: 78 }} />
      <col />
      {!ro && <col style={{ width: 44 }} />}
    </colgroup>
  );
  const thead = (
    <thead>
      <tr>
        {!ro && <th />}
        <th>Gegenstand</th>
        <th>Anzahl</th>
        <th>kg/St.</th>
        <th>Σ kg</th>
        <th>Notiz</th>
        {!ro && <th />}
      </tr>
    </thead>
  );

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
          <div {...dropProps({ location: 'bench' })}>
            <span className="zone-empty">
              ⇐ Zu Ausrüstung — Gegenstand hierher ziehen; er landet unter „Nicht getragen" im Ausrüstungs-Reiter.
            </span>
          </div>
        </div>
      )}

      {!ro && (
        <div className="panel inv-toolbar">
          <button className="small" onClick={addContainer}>
            + Behälter (Stauraum)
          </button>
        </div>
      )}

      {storageConts.length === 0 && loose.length === 0 && (
        <p className="muted">
          Noch nichts verstaut.{!ro && ' Lege oben einen Behälter an und ziehe Gegenstände hinein.'}
        </p>
      )}

      {storageConts.map((c) => {
        const inside = itemsInContainer(items, c.uid);
        const fuell = containerFuellung(items, c.uid);
        const voll = c.kapazitaet > 0 && fuell > c.kapazitaet;
        return (
          <div
            className={`panel${isOver({ location: 'behaelter', containerUid: c.uid }) ? ' drop-over' : ''}`}
            key={c.uid}
            {...dropHandlers({ location: 'behaelter', containerUid: c.uid })}
          >
            <h3 className="inv-cont-head">
              <span className="panel-title">📦 </span>
              {!ro ? (
                <input className="cont-name" value={c.name} onChange={(e) => patchItem(c.uid, { name: e.target.value })} placeholder="Behälter" />
              ) : (
                <span className="panel-title">{c.name || '(ohne Name)'}</span>
              )}
              <span className={`muted inv-sum${voll ? ' over' : ''}`}>
                · {inside.length} · {kg(fuell)}
                {c.kapazitaet > 0 ? ` / ${kg(c.kapazitaet)}` : ''} kg
                {c.gewichtsreduktion > 0 && ` · −${c.gewichtsreduktion}%`}
              </span>
              {!ro && (
                <span className="cont-props">
                  <label title="Fassungsvermögen (kg, 0 = ohne Angabe)">
                    Kap.<NumInput value={c.kapazitaet} min={0} onChange={(v) => patchItem(c.uid, { kapazitaet: v })} />
                  </label>
                  <label title="Gewichtsreduktion des Inhalts. 100 % = zählt gar nicht (Beutel des Fassungsvermögens).">
                    −%<NumInput value={c.gewichtsreduktion} min={0} max={100} onChange={(v) => patchItem(c.uid, { gewichtsreduktion: v })} />
                  </label>
                  <button className="small" title="Behälter entfernen (Inhalt wird lose)" onClick={() => removeItem(c.uid)}>
                    ✕
                  </button>
                </span>
              )}
            </h3>
            <div className="table-wrap">
              <table className="sheet inv-table">
                {colgroup}
                {thead}
                <tbody>
                  {inside.length === 0 && (
                    <tr>
                      <td colSpan={ro ? 5 : 7} className="muted">
                        Leer{!ro && ' — Gegenstände hierher ziehen oder unten hinzufügen'}
                      </td>
                    </tr>
                  )}
                  {inside.map(row)}
                </tbody>
              </table>
            </div>
            {!ro && (
              <button className="small add-row" onClick={() => addInto(c.uid)}>
                + Gegenstand
              </button>
            )}
          </div>
        );
      })}

      {loose.length > 0 && (
        <div className="panel">
          <h3>
            <span className="panel-title">Nicht in einem Behälter</span>
            <span className="muted inv-sum"> · Alt-Bestand — in einen Behälter ziehen oder zu Ausrüstung</span>
          </h3>
          {looseCats.map((cat) => {
            const rows = loose.filter((it) => it.kategorie === cat);
            return (
              <div key={cat || '__none'} className="loose-group">
                <div className="loose-cat">{cat || 'Ohne Kategorie'}</div>
                <div className="table-wrap">
                  <table className="sheet inv-table">
                    {colgroup}
                    {thead}
                    <tbody>{rows.map(row)}</tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
