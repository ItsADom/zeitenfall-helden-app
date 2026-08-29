import { useState } from 'react';
import type { Item, ItemBonus, ItemLocation } from '@shared/items';
import {
  BODY_ZONES,
  containerFuellungAnzeige,
  duplicateItem,
  effektiverRs,
  haltbarkeitPct,
  isPairedZone,
  itemsInContainer,
  lastInfo,
  makeItem,
  TRAGLAST_BONUS_KEY,
  zoneView,
} from '@shared/items';
import type { AttrCode, BaseValueKey, ResourceKey } from '@shared/types';
import { ATTR_LABELS, BASE_VALUE_LABELS, RESOURCE_LABELS } from '@shared/types';
import type { SpecialEnergyCatalogRow, TalentCatalogRow } from '../components/charSheet';
import { BonusWert } from '../components/BonusWert';
import { useReadOnly } from '../components/displayMode';
import { AddItemDialog } from '../components/itemDialogs';
import { NumInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Kurzbeschreibung eines Bonus fürs Chip-Tooltip (siehe .chip-bonus) — dieselbe
// Zielraum-Aufschlüsselung wie im Bonus-Editor des Dialogs (itemDialogs.tsx),
// nur als lesbarer Text statt als <select>.
function bonusLabel(b: ItemBonus, talents: TalentCatalogRow[], specialEnergies: SpecialEnergyCatalogRow[]): string {
  const sign = b.wert > 0 ? '+' : '';
  switch (b.kind) {
    case 'attr':
      return `${ATTR_LABELS[b.code as AttrCode] ?? b.code} ${sign}${b.wert}`;
    case 'baseValue':
      return `${BASE_VALUE_LABELS[b.code as BaseValueKey]?.label ?? b.code} ${sign}${b.wert}`;
    case 'resource':
      return `${RESOURCE_LABELS[b.code as ResourceKey]?.label ?? b.code} ${sign}${b.wert}`;
    case 'talent': {
      const t = talents.find((x) => x.id === Number(b.code));
      return `${t?.name ?? '?'}${b.feld ? ` (${b.feld.toUpperCase()})` : ''} ${sign}${b.wert}`;
    }
    case 'spezial': {
      const e = specialEnergies.find((x) => x.id === Number(b.code));
      return `${e?.name ?? '?'} ${sign}${b.wert}`;
    }
    case 'psyche':
      return `Psyche ${sign}${b.wert}`;
    case 'traglast':
      return `Traglast ${sign}${b.wert} kg`;
  }
}

// Ausrüstung (Cluster 5b): verfolgt, WAS der Charakter trägt — nicht das Inventar
// gespiegelt. Körperzonen zeigen getragene Ausrüstung; Schnellzugriff-Behälter
// (Gürtel) zeigen ihren Inhalt direkt in der Zone. Dazu eine „nicht getragen"-
// Bank zum Umrüsten und die Stauraum-Behälter als Ablage. Reine Waren landen im
// Inventar (Behälter-Inhalt); hierher zieht man Gerät.
//
// Ziehen geht auch im Nur-Lesen-Modus (Umrüsten ist eine schnelle Spielaktion);
// nur das Anlegen/Bearbeiten der Detailfelder braucht den Bearbeiten-Modus.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

interface DropTarget {
  location: ItemLocation;
  zone?: string;
  containerUid?: string;
  // Nur an einer seitengetrennten Zone gesetzt: Ziel ist der schmale "↔ beide"-
  // Streifen der Zelle, nicht die Zelle selbst (siehe moveTo).
  beidseitig?: boolean;
}
const dropKey = (t: DropTarget) => `${t.location}:${t.zone ?? ''}:${t.containerUid ?? ''}:${t.beidseitig ? 'both' : ''}`;

export default function AusruestungTab() {
  const { data, update, catalogs, stats } = useChar();
  const ro = useReadOnly();
  const items = data.items;
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const [over, setOver] = useState<string | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editUid, setEditUid] = useState<string | null>(null);

  const setItems = (next: Item[]) => update('items', next);
  const patchItem = (uid: string, patch: Partial<Item>) => setItems(items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  // Direkt neben dem Original einfügen, nicht ans Ende — sonst muss man die
  // Kopie erst suchen gehen.
  const duplicateItemAt = (uid: string) =>
    setItems(items.flatMap((it) => (it.uid === uid ? [it, duplicateItem(it)] : [it])));

  const removeItem = (uid: string) =>
    setItems(
      items
        .filter((it) => it.uid !== uid)
        .map((it) => (it.containerUid === uid ? { ...it, location: 'inventar', containerUid: '' } : it)),
    );

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
    const zone = t.location === 'getragen' ? t.zone ?? '' : '';
    // „Beidseitig" wird ausschließlich durchs Ziehen auf den "↔ beide"-Streifen
    // gesetzt (t.beidseitig) — jedes andere Ziel, auch die normale Zellfläche
    // derselben seitengetrennten Zone, löscht es wieder. Kein Bewahren mehr.
    const beidseitig = t.location === 'getragen' && isPairedZone(zone) ? !!t.beidseitig : false;
    patchItem(uid, {
      location: t.location,
      zone,
      beidseitig,
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
      onEdit={() => setEditUid(it.uid)}
      bonusTitle={it.bonusse.length > 0 ? it.bonusse.map((b) => bonusLabel(b, catalogs.talents, catalogs.specialEnergies)).join(', ') : ''}
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

  const load = lastInfo(items, data.attributes, data.meta.traglastBonus);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;
  const rs = effektiverRs(items);
  const setTraglastBonus = (v: number) => update('meta', { ...data.meta, traglastBonus: v });

  const bench = items.filter((it) => it.location === 'bench');
  const storageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  const wornNoZone = items.filter((it) => it.location === 'getragen' && !BODY_ZONES.includes(it.zone as never));
  const catOptions = [...new Set([...(data.itemCategories ?? []), ...items.map((it) => it.kategorie).filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, 'de'),
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
            <strong>{kg(load.getragen)}</strong> /{' '}
            <BonusWert quellen={stats.quellen[TRAGLAST_BONUS_KEY]}>{kg(load.max)}</BonusWert> kg
            {load.ueberladen && <span className="last-warn"> · überladen</span>}
            {!ro && (
              <label className="last-bonus" title="Zusatz auf die maximale Traglast (kg). Additiv, darf negativ sein.">
                Bonus<NumInput value={data.meta.traglastBonus} onChange={setTraglastBonus} />
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Am Körper — Körperzonen */}
      <div className="panel">
        <h3>Am Körper</h3>
        <div className="zone-grid">
          {BODY_ZONES.map((z) => {
            // zoneView: die hier abgelegten Gegenstände PLUS die beidseitig
            // getragenen der Gegenseite (gespiegelt). Ein Datensatz, zwei Zellen.
            const zi = zoneView(items, z);
            const bothProps = dropProps({ location: 'getragen', zone: z, beidseitig: true });
            return (
              <div className="zone-cell" key={z}>
                <div className="zone-name">{z}</div>
                <div {...dropProps({ location: 'getragen', zone: z })}>
                  {zi.map(chip)}
                  {zi.length === 0 && <span className="zone-empty">—</span>}
                </div>
                {isPairedZone(z) && (
                  <div
                    {...bothProps}
                    className={`zone-both-strip ${bothProps.className}`}
                    title="Hierher ziehen: beidseitig getragen (erscheint gespiegelt auf der Gegenseite)"
                  >
                    ↔ beide
                  </div>
                )}
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
        <h3>Nicht getragen</h3>
        <div {...dropProps({ location: 'bench' })}>
          {bench.map(chip)}
          {bench.length === 0 && <span className="zone-empty">—</span>}
        </div>
        {!ro && (
          <div className="inv-add-trigger">
            <button className="small" onClick={() => setAddItemOpen(true)}>
              + Gegenstand
            </button>
          </div>
        )}
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
            const stueck = c.kapazitaetArt === 'stueck';
            // Bei Gewicht-Behältern zählt das effektive (reduzierte) Gewicht gegen
            // das Fassungsvermögen, bei Stück-Behältern die Stückzahl des Inhalts.
            const fuell = containerFuellungAnzeige(items, c);
            const voll = c.kapazitaet > 0 && fuell > c.kapazitaet;
            return (
              <div className="container-panel" key={c.uid}>
                <div className="container-head">
                  <span className="container-name">{c.name || '(ohne Name)'}</span>
                  <span className={`container-cap${voll ? ' over' : ''}`}>
                    {inside.length} · {stueck ? fuell : kg(fuell)}
                    {c.kapazitaet > 0 ? ` / ${stueck ? c.kapazitaet : kg(c.kapazitaet)}` : ''} {stueck ? 'Stück' : 'kg'}
                    {!stueck && c.gewichtsreduktion > 0 && <span className="muted"> · −{c.gewichtsreduktion}%</span>}
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

      <AddItemDialog
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        categories={catOptions}
        initialMode="ausruestung"
        talents={catalogs.talents}
        specialEnergies={catalogs.specialEnergies}
        onAdd={(fields) => setItems([...items, makeItem({ ...fields, location: 'bench' })])}
      />
      <AddItemDialog
        open={editUid !== null}
        onClose={() => setEditUid(null)}
        categories={catOptions}
        item={editUid !== null ? byUid.get(editUid) : undefined}
        talents={catalogs.talents}
        specialEnergies={catalogs.specialEnergies}
        onSave={(patch) => editUid && patchItem(editUid, patch)}
        onDuplicate={() => editUid && duplicateItemAt(editUid)}
        onDelete={() => editUid && removeItem(editUid)}
      />
    </>
  );
}

function ItemChip({
  item,
  onEdit,
  bonusTitle,
  children,
}: {
  item: Item;
  /** Öffnet AddItemDialog im Bearbeiten-Modus — Name/kg/RS/Haltbarkeit/Behälter/Notiz/Boni, plus Duplizieren/Löschen im Fuß. Auch im Nur-Lesen-Modus, wie Ziehen. */
  onEdit: () => void;
  /** Zusammenfassung der Boni fürs Tooltip, '' wenn keine — steuert den Marker. */
  bonusTitle: string;
  children?: React.ReactNode;
}) {
  return (
    <span className="chip-wrap">
      <span
        className={`item-chip${item.istBehaelter ? ' is-container' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.uid);
        }}
        onClick={onEdit}
        title={`Klicken zum Bearbeiten, Ziehen zum Verschieben${item.notiz ? ` — ${item.notiz}` : ''}`}
      >
        <span className="chip-name">{item.name || '(ohne Name)'}</span>
        {item.anzahl !== 1 && <span className="chip-mult"> ×{item.anzahl}</span>}
        {item.rs > 0 && <span className="chip-rs" title="Rüstungsschutz"> RS {item.rs}</span>}
        {bonusTitle && (
          <span className="chip-bonus" title={`Boni beim Tragen: ${bonusTitle}`}> ✦</span>
        )}
        {(() => {
          const pct = haltbarkeitPct(item);
          if (pct === null) return null;
          return (
            <span className={`chip-haltbarkeit${pct <= 25 ? ' chip-haltbarkeit--low' : ''}`} title="Haltbarkeit">
              {' '}
              {pct}%
            </span>
          );
        })()}
        {item.beidseitig && (
          <span className="chip-both" title="Beidseitig getragen — dasselbe Stück erscheint auf beiden Seiten"> ⇄</span>
        )}
      </span>
      {children}
    </span>
  );
}
