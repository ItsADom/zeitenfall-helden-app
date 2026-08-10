import { useState } from 'react';
import type { Item, ItemLocation } from '@shared/items';
import {
  BODY_ZONES,
  containerFuellung,
  containers,
  itemGewicht,
  itemsInContainer,
  itemsInZone,
  lastInfo,
} from '@shared/items';
import { useReadOnly } from '../components/displayMode';
import { NumInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Ausrüstung (Cluster 5b): eine räumliche Sicht auf denselben Gegenstands-
// Bestand wie das Inventar. `location` (+ `zone`/`containerUid`) ist die einzige
// Wahrheit; per Ziehen wandert ein Gegenstand zwischen Rucksack, Behälter,
// Körperzone und Tier. Das Inventar bleibt das vollständige Verzeichnis, hier
// steht, WO die Dinge sind und was getragen wird.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

// Ziel eines Wurfs: der neue Ort plus (je nach Ort) Zone bzw. Behälter.
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

  // Welcher Wurf-Bereich liegt gerade unter dem Zeiger (für die Hervorhebung).
  const [over, setOver] = useState<string | null>(null);

  const setItems = (next: Item[]) => update('items', next);
  const patchItem = (uid: string, patch: Partial<Item>) =>
    setItems(items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  // Kette der Behälter oberhalb eines Gegenstands (zum Verhindern von Kreisen).
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

  // Darf `uid` in dieses Ziel? Ein Behälter darf nicht in sich selbst oder in
  // einen seiner eigenen Inhalte wandern.
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

  // Einen Gegenstand zum Behälter machen / auflösen. Beim Auflösen wandern die
  // Inhalte zurück in den Rucksack, damit nichts verwaist liegen bleibt.
  const toggleContainer = (uid: string) => {
    const it = byUid.get(uid);
    if (!it) return;
    if (it.istBehaelter) {
      setItems(
        items.map((x) =>
          x.uid === uid ? { ...x, istBehaelter: false, kapazitaet: 0 }
          : x.location === 'behaelter' && x.containerUid === uid ? { ...x, location: 'inventar', containerUid: '' }
          : x,
        ),
      );
    } else {
      patchItem(uid, { istBehaelter: true });
    }
  };

  // Gegenstände im Rucksack: lose (inventar) plus Verwaiste (Behälter-Inhalt
  // ohne existierenden Behälter) — so geht auch nach dem Löschen nichts verloren.
  const pool = items.filter(
    (it) => it.location === 'inventar' || (it.location === 'behaelter' && !byUid.has(it.containerUid)),
  );
  const tierItems = items.filter((it) => it.location === 'tier');
  const wornNoZone = items.filter((it) => it.location === 'getragen' && !BODY_ZONES.includes(it.zone as never));
  const conts = containers(items);

  const load = lastInfo(items, data.attributes);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;

  // Gemeinsame Wurf-Eigenschaften eines Bereichs.
  const dropProps = (t: DropTarget) => {
    const key = dropKey(t);
    return {
      className: `drop-zone${over === key ? ' over' : ''}`,
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

  const chip = (it: Item) => <ItemChip key={it.uid} item={it} ro={ro} onToggleContainer={() => toggleContainer(it.uid)} />;

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
        {!ro && (
          <p className="muted" style={{ marginTop: 8 }}>
            Ziehe Gegenstände zwischen Rucksack, Behältern, Körperzonen und Tier. Am Körper Getragenes und auf dem
            Tier Verstautes zählt nicht zur Traglast.
          </p>
        )}
      </div>

      {/* Am Körper getragen — Körperzonen */}
      <div className="panel">
        <h3>Am Körper</h3>
        <div className="zone-grid">
          {BODY_ZONES.map((z) => {
            const zi = itemsInZone(items, z);
            return (
              <div className="zone-cell" key={z}>
                <div className="zone-name">{z}</div>
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

      {/* Behälter */}
      <div className="panel">
        <h3>Behälter</h3>
        {conts.length === 0 && (
          <p className="muted">
            Noch keine Behälter.{!ro && ' Mach unten im Rucksack einen Gegenstand über 📦 zum Behälter.'}
          </p>
        )}
        <div className="container-grid">
          {conts.map((c) => {
            const inside = itemsInContainer(items, c.uid);
            const fuell = containerFuellung(items, c.uid);
            const voll = c.kapazitaet > 0 && fuell > c.kapazitaet;
            return (
              <div className="container-panel" key={c.uid}>
                <div className="container-head">
                  <span className="container-name">{c.name || '(ohne Name)'}</span>
                  <span className={`container-cap${voll ? ' over' : ''}`}>
                    {kg(fuell)}
                    {c.kapazitaet > 0 ? ` / ${kg(c.kapazitaet)}` : ''} kg
                  </span>
                  {!ro && (
                    <label className="container-cap-edit" title="Fassungsvermögen (kg, 0 = ohne Angabe)">
                      Kapazität
                      <NumInput value={c.kapazitaet} min={0} onChange={(v) => patchItem(c.uid, { kapazitaet: v })} />
                    </label>
                  )}
                </div>
                <div {...dropProps({ location: 'behaelter', containerUid: c.uid })}>
                  {inside.map(chip)}
                  {inside.length === 0 && <span className="zone-empty">leer — hierher ziehen</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auf dem Tier */}
      <div className="panel">
        <h3>Auf dem Tier / Reittier</h3>
        <div {...dropProps({ location: 'tier' })}>
          {tierItems.map(chip)}
          {tierItems.length === 0 && <span className="zone-empty">—</span>}
        </div>
      </div>

      {/* Rucksack / loses Inventar — die Quelle zum Ziehen */}
      <div className="panel">
        <h3>Rucksack</h3>
        <div {...dropProps({ location: 'inventar' })}>
          {pool.map(chip)}
          {pool.length === 0 && <span className="zone-empty">—</span>}
        </div>
        {!ro && (
          <p className="muted" style={{ marginTop: 8 }}>
            Neue Gegenstände legst du im <strong>Inventar</strong>-Reiter an; hier ordnest du sie ein.
          </p>
        )}
      </div>
    </>
  );
}

function ItemChip({ item, ro, onToggleContainer }: { item: Item; ro: boolean; onToggleContainer: () => void }) {
  const w = itemGewicht(item);
  return (
    <span
      className={`item-chip${item.istBehaelter ? ' is-container' : ''}`}
      draggable={!ro}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.uid);
      }}
      title={item.notiz || undefined}
    >
      {item.istBehaelter && <span aria-hidden>📦 </span>}
      <span className="chip-name">{item.name || '(ohne Name)'}</span>
      {item.anzahl !== 1 && <span className="chip-mult"> ×{item.anzahl}</span>}
      {w > 0 && <span className="chip-kg"> · {kg(w)} kg</span>}
      {!ro && (
        <button
          className="chip-btn"
          title={item.istBehaelter ? 'Kein Behälter mehr (Inhalt zurück in den Rucksack)' : 'Zum Behälter machen'}
          onClick={onToggleContainer}
        >
          {item.istBehaelter ? '✕📦' : '📦'}
        </button>
      )}
    </span>
  );
}
