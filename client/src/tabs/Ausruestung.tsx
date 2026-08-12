import { useState } from 'react';
import type { ContainerArt, Item, ItemLocation } from '@shared/items';
import {
  BODY_ZONES,
  containerFuellung,
  effektiverRs,
  itemsInContainer,
  itemsInZone,
  itemGewicht,
  lastInfo,
  makeUid,
} from '@shared/items';
import { useReadOnly } from '../components/displayMode';
import { NumInput, TextInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Ausrüstung (Cluster 5b): verfolgt, WAS der Charakter trägt — nicht das Inventar
// gespiegelt. Körperzonen zeigen getragene Ausrüstung; Schnellzugriff-Behälter
// (Gürtel) zeigen ihren Inhalt direkt in der Zone. Dazu eine „nicht getragen"-
// Bank zum Umrüsten und die Stauraum-Behälter als Ablage. Reine Waren landen im
// Inventar (Behälter-Inhalt); hierher zieht man Gerät.
//
// Ziehen geht auch im Nur-Lesen-Modus (Umrüsten ist eine schnelle Spielaktion);
// nur das Anlegen/Bearbeiten der Detailfelder braucht den Bearbeiten-Modus.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

interface DropTarget {
  location: ItemLocation;
  zone?: string;
  containerUid?: string;
}
const dropKey = (t: DropTarget) => `${t.location}:${t.zone ?? ''}:${t.containerUid ?? ''}`;

export default function AusruestungTab() {
  const { data, update } = useChar();
  const ro = useReadOnly();
  const items = data.items;
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const [over, setOver] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);

  const setItems = (next: Item[]) => update('items', next);
  const patchItem = (uid: string, patch: Partial<Item>) => setItems(items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  const removeItem = (uid: string) =>
    setItems(
      items
        .filter((it) => it.uid !== uid)
        .map((it) => (it.containerUid === uid ? { ...it, location: 'inventar', containerUid: '' } : it)),
    );

  const blank = (over: Partial<Item>): Item => ({
    id: 0, uid: makeUid(), name: '', anzahl: 1, gewicht: 0, kategorie: '', location: 'bench',
    zone: '', containerUid: '', istBehaelter: false, containerArt: 'storage', kapazitaet: 0,
    gewichtsreduktion: 0, rs: 0, notiz: '', ...over,
  });
  const addTo = (over: Partial<Item>) => {
    const it = blank(over);
    setItems([...items, it]);
    setOpenUid(it.uid);
  };

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
  const allowed = (uid: string, t: DropTarget): boolean => {
    if (t.location === 'behaelter' && t.containerUid) {
      if (t.containerUid === uid) return false;
      if (ancestors(t.containerUid).has(uid)) return false;
    }
    return true;
  };
  const moveTo = (uid: string, t: DropTarget) => {
    if (!allowed(uid, t)) return;
    patchItem(uid, {
      location: t.location,
      zone: t.location === 'getragen' ? t.zone ?? '' : '',
      containerUid: t.location === 'behaelter' ? t.containerUid ?? '' : '',
    });
  };

  // Zieh-Bereich. stopPropagation ist wichtig: der Schnellzugriff-Behälter liegt
  // IN einer Körperzone — ohne das würde ein Wurf in den Behälter auch bei der
  // Zone ankommen und dort landen. Ziehen ist auch im Nur-Lesen-Modus erlaubt.
  const dropProps = (t: DropTarget) => {
    const key = dropKey(t);
    return {
      className: `drop-zone${over === key ? ' over' : ''}`,
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver((o) => (o === key ? null : o)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        const uid = e.dataTransfer.getData('text/plain');
        if (uid) moveTo(uid, t);
      },
    };
  };

  const chip = (it: Item) => (
    <ItemChip
      key={it.uid}
      item={it}
      ro={ro}
      open={openUid === it.uid}
      onToggleOpen={() => setOpenUid((u) => (u === it.uid ? null : it.uid))}
      onPatch={(p) => patchItem(it.uid, p)}
      onRemove={() => removeItem(it.uid)}
    >
      {it.istBehaelter && it.containerArt === 'quick' && (
        <div className="quick-contents">
          <div {...dropProps({ location: 'behaelter', containerUid: it.uid })}>
            {itemsInContainer(items, it.uid).map(chip)}
            {itemsInContainer(items, it.uid).length === 0 && <span className="zone-empty">leer — hierher ziehen</span>}
          </div>
        </div>
      )}
    </ItemChip>
  );

  const load = lastInfo(items, data.attributes);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;
  const rs = effektiverRs(items);

  const bench = items.filter((it) => it.location === 'bench');
  const storageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  const wornNoZone = items.filter((it) => it.location === 'getragen' && !BODY_ZONES.includes(it.zone as never));

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

      {/* Am Körper — Körperzonen */}
      <div className="panel">
        <h3>Am Körper</h3>
        <div className="zone-grid">
          {BODY_ZONES.map((z) => {
            const zi = itemsInZone(items, z);
            return (
              <div className="zone-cell" key={z}>
                <div className="zone-name">
                  {z}
                  {!ro && (
                    <button className="zone-add" title={`Ausrüstung auf „${z}" anlegen`} onClick={() => addTo({ location: 'getragen', zone: z })}>
                      +
                    </button>
                  )}
                </div>
                <div {...dropProps({ location: 'getragen', zone: z })}>
                  {zi.map(chip)}
                  {zi.length === 0 && <span className="zone-empty">—</span>}
                </div>
              </div>
            );
          })}
        </div>
        {wornNoZone.length > 0 && (
          <div className="zone-cell" style={{ marginTop: 10 }}>
            <div className="zone-name">Getragen, ohne Zone</div>
            <div {...dropProps({ location: 'getragen', zone: '' })}>{wornNoZone.map(chip)}</div>
          </div>
        )}
      </div>

      {/* Nicht getragen — Bank zum Umrüsten */}
      <div className="panel">
        <h3>
          Nicht getragen
          {!ro && (
            <button className="small add-inline" onClick={() => addTo({ location: 'bench' })} title="Ausrüstung anlegen">
              + Ausrüstung
            </button>
          )}
        </h3>
        <div {...dropProps({ location: 'bench' })}>
          {bench.map(chip)}
          {bench.length === 0 && <span className="zone-empty">—</span>}
        </div>
      </div>

      {/* Behälter (Stauraum): Ablage — hierher gezogen landet der Inhalt im Inventar.
          Angelegt und befüllt werden Stauraum-Behälter im Inventar-Reiter. */}
      <div className="panel">
        <h3>Behälter (Stauraum)</h3>
        {storageConts.length === 0 && (
          <p className="muted">Noch keine Stauraum-Behälter. Lege sie im Inventar-Reiter an; ihr Inhalt befindet sich dort.</p>
        )}
        <div className="container-grid">
          {storageConts.map((c) => {
            const inside = itemsInContainer(items, c.uid);
            const fuell = containerFuellung(items, c.uid);
            const voll = c.kapazitaet > 0 && fuell > c.kapazitaet;
            return (
              <div className="container-panel" key={c.uid}>
                <div className="container-head">
                  <span className="container-name">{c.name || '(ohne Name)'}</span>
                  <span className={`container-cap${voll ? ' over' : ''}`}>
                    {inside.length} · {kg(fuell)}
                    {c.kapazitaet > 0 ? ` / ${kg(c.kapazitaet)}` : ''} kg
                    {c.gewichtsreduktion > 0 && <span className="muted"> · −{c.gewichtsreduktion}%</span>}
                  </span>
                </div>
                <div {...dropProps({ location: 'behaelter', containerUid: c.uid })}>
                  <span className="zone-empty">Inhalt im Inventar · hierher ziehen zum Verstauen</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ItemChip({
  item,
  ro,
  open,
  onToggleOpen,
  onPatch,
  onRemove,
  children,
}: {
  item: Item;
  ro: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onPatch: (patch: Partial<Item>) => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  const w = itemGewicht(item);
  return (
    <span className={`chip-wrap${open ? ' open' : ''}`}>
      <span
        className={`item-chip${item.istBehaelter ? ' is-container' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.uid);
        }}
        title={item.notiz || undefined}
      >
        <span className="chip-name">{item.name || '(ohne Name)'}</span>
        {item.anzahl !== 1 && <span className="chip-mult"> ×{item.anzahl}</span>}
        {w > 0 && <span className="chip-kg"> · {kg(w)} kg</span>}
        {item.rs > 0 && <span className="chip-rs" title="Rüstungsschutz"> RS {item.rs}</span>}
        {!ro && (
          <button className="chip-btn" title="Details bearbeiten" onClick={onToggleOpen}>
            {open ? '▾' : '✎︎'}
          </button>
        )}
      </span>
      {!ro && open && (
        <div className="chip-editor">
          <label>Name<TextInput value={item.name} onChange={(v) => onPatch({ name: v })} /></label>
          <label>Anzahl<NumInput value={item.anzahl} min={0} onChange={(v) => onPatch({ anzahl: v })} /></label>
          <label>kg/St.<NumInput value={item.gewicht} min={0} onChange={(v) => onPatch({ gewicht: v })} /></label>
          <label>RS<NumInput value={item.rs} min={0} onChange={(v) => onPatch({ rs: v })} /></label>
          <label className="chip-check">
            <input type="checkbox" checked={item.istBehaelter} onChange={(e) => onPatch({ istBehaelter: e.target.checked })} />
            Behälter
          </label>
          {item.istBehaelter && (
            <>
              <label>
                Art
                <select value={item.containerArt} onChange={(e) => onPatch({ containerArt: e.target.value as ContainerArt })}>
                  <option value="storage">Stauraum (Inventar)</option>
                  <option value="quick">Schnellzugriff (inline)</option>
                </select>
              </label>
              <label>Kap. kg<NumInput value={item.kapazitaet} min={0} onChange={(v) => onPatch({ kapazitaet: v })} /></label>
              <label title="Gewichtsreduktion des Inhalts. 100 % = zählt gar nicht (Beutel des Fassungsvermögens).">
                −%<NumInput value={item.gewichtsreduktion} min={0} max={100} onChange={(v) => onPatch({ gewichtsreduktion: v })} />
              </label>
            </>
          )}
          <label className="chip-notiz">Notiz<TextInput value={item.notiz} onChange={(v) => onPatch({ notiz: v })} /></label>
          <button className="small chip-del" onClick={onRemove} title="Gegenstand entfernen">
            🗑 Löschen
          </button>
        </div>
      )}
      {children}
    </span>
  );
}
