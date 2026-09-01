import { Fragment, useState } from 'react';
import type { Item, ItemLocation, KapazitaetArt } from '@shared/items';
import { containerFuellungAnzeige, duplicateItem, itemGewicht, itemsInContainer, lastInfo, makeItem } from '@shared/items';
import { apiPost } from '../api';
import { useAuth } from '../App';
import { applyCategoryCascade, CategoryManagerDialog } from '../components/CategoryManagerDialog';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { AlwaysEditable, useReadOnly } from '../components/displayMode';
import { AddContainerDialog, AddItemDialog, useMoveTargets } from '../components/itemDialogs';
import type { MoveTarget } from '../components/itemDialogs';
import { NumInput } from '../components/inputs';
import { CollapsedText } from '../components/notes';
import { usePersistedState } from '../components/persist';
import { useChar } from '../pages/Character';

// Inventar (Cluster 5b): verfolgt nur, was IN Behältern steckt (plus einen losen
// Alt-Topf aus der Migration). Getragene Ausrüstung lebt im Ausrüstungs-Reiter.
// Innerhalb eines Behälters sind die Gegenstände nach Kategorie gruppiert (kleine
// Kopfzeile, keine Spalte); Ziehen zwischen den Kategorie-Gruppen ordnet um.
// Ziehen und das Ändern der Anzahl gehen auch im Nur-Lesen-Modus.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

interface DropTarget {
  location: ItemLocation;
  containerUid?: string;
  kategorie?: string; // gesetzt: Wurf ändert zusätzlich die Kategorie
}
const dropKey = (t: DropTarget) => `${t.location}:${t.containerUid ?? ''}:${t.kategorie ?? ' '}`;

// Kategorien einer Gegenstandsliste in Anzeigereihenfolge (alphabetisch, „ohne" zuletzt).
function catsOf(list: Item[]): string[] {
  const set = new Set(list.map((it) => it.kategorie));
  const named = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  return set.has('') ? [...named, ''] : named;
}

export default function InventarTab() {
  const { data, update, charId, groupId, catalogs } = useChar();
  const { user } = useAuth();
  const ro = useReadOnly();
  const items = data.items;
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const [over, setOver] = useState<string | null>(null);
  const [addContainerOpen, setAddContainerOpen] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  // uid des Behälters, für den der Gegenstand-Dialog gerade offen ist (null = zu).
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  // uid des Items, das gerade im Bearbeiten-Dialog offen ist (null = zu).
  const [editUid, setEditUid] = useState<string | null>(null);
  const [collapsed, setCollapsed] = usePersistedState<string[]>('inv:collapsed', []);
  const isColl = (k: string) => collapsed.includes(k);
  const toggleColl = (k: string) => setCollapsed((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  // Shared inventories (docs/concepts/shared-inventories.md): „Verschieben
  // nach…"-Ziele fürs Item-Dialog — siehe Ausruestung.tsx für dieselbe Zeile.
  const moveTargets = useMoveTargets(groupId, { type: 'character', id: charId });

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

  // Verschieben ist ein eigener Endpunkt, kein Op (siehe moveItem in
  // server/src/characterData.ts) — nicht zu verwechseln mit moveTo unten, das
  // nur innerhalb DIESES Bestands zwischen Kategorien/Behältern zieht.
  const moveItemToOwner = (uid: string, target: MoveTarget) =>
    void apiPost<{ items: Item[] }>(`/api/characters/${charId}/items/${uid}/move`, {
      toOwnerType: target.toOwnerType,
      toOwnerId: target.toOwnerId,
    }).then((res) => update('items', res.items));

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
    const patch: Partial<Item> = { location: t.location, zone: '', containerUid: t.location === 'behaelter' ? t.containerUid ?? '' : '' };
    if (t.kategorie !== undefined) patch.kategorie = t.kategorie;
    patchItem(uid, patch);
  };

  const isOver = (t: DropTarget) => over === dropKey(t);
  // Ziehen funktioniert auch im Nur-Lesen-Modus. stopPropagation: der innerste
  // Bereich (Zeile/Kategorie) gewinnt, nicht der Behälter darum herum.
  const dropHandlers = (t: DropTarget) => {
    const key = dropKey(t);
    return {
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
  const dropProps = (t: DropTarget) => ({ className: `drop-zone${isOver(t) ? ' over' : ''}`, ...dropHandlers(t) });

  const storageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  const loose = items.filter((it) => it.location === 'inventar' && !it.istBehaelter);
  // Kategorien für das Anlegen-Formular: verwaltete Liste + tatsächlich benutzte.
  const catOptions = [...new Set([...(data.itemCategories ?? []), ...items.map((it) => it.kategorie).filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );

  const load = lastInfo(items, data.attributes, data.meta.traglastBonus);
  const pct = load.max > 0 ? Math.min(100, (load.getragen / load.max) * 100) : 0;
  const setTraglastBonus = (v: number) => update('meta', { ...data.meta, traglastBonus: v });

  const colgroup = (
    <colgroup>
      <col style={{ width: 28 }} />
      <col style={{ width: '22em' }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 78 }} />
      <col style={{ width: 78 }} />
      <col />
    </colgroup>
  );
  const cols = 6;

  // Eine Gegenstandszeile. `target` macht die Zeile zum Wurf-Ziel (ihre Kategorie
  // + ihr Behälter), sodass ein Wurf auf eine Zeile in die passende Gruppe geht.
  // Die Zeile selbst öffnet per Klick den Bearbeiten-Dialog (Name, Gewicht, RS,
  // Haltbarkeit, Behälter, Notiz, Boni, Duplizieren, Löschen) — auch im
  // Nur-Lesen-Modus, wie Ziehen und Anzahl. Nur die Anzahl bleibt in der Zeile
  // selbst editierbar (stoppt die Ausbreitung, damit ein Klick hinein nicht den
  // Dialog öffnet); der Ziehgriff stoppt sie ebenfalls, damit ein bloßer Klick
  // darauf nicht versehentlich den Dialog aufreißt.
  const row = (it: Item, target: DropTarget) => (
    <tr
      key={it.uid}
      className="inv-row"
      title="Klicken für Details — Bearbeiten, Duplizieren, Löschen"
      onClick={() => setEditUid(it.uid)}
      {...dropHandlers(target)}
    >
      <td className="grip-cell" onClick={(e) => e.stopPropagation()}>
        <span
          className="row-grip"
          draggable
          title="Ziehen zum Verschieben (Kategorie / Behälter / Zu Ausrüstung)"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', it.uid);
          }}
        >
          ⠿
        </span>
      </td>
      <td>
        <span className="static-value static-text">{it.name || ' '}</span>
      </td>
      <td className="num" onClick={(e) => e.stopPropagation()}>
        <AlwaysEditable>
          <NumInput value={it.anzahl} min={0} onChange={(v) => patchItem(it.uid, { anzahl: v })} />
        </AlwaysEditable>
      </td>
      <td className="num">
        <span className="static-value static-num">{it.gewicht}</span>
      </td>
      <td className="computed">{kg(itemGewicht(it))}</td>
      <td>
        <CollapsedText text={it.notiz} className="static-value static-text" />
      </td>
    </tr>
  );

  // Kategorie-Gruppen einer Liste als Tabellenzeilen (kleine Kopfzeile je Gruppe,
  // die zugleich Wurf-Ziel für das Umkategorisieren ist). Die Kopfzeile klappt
  // ihre Gruppe ein/aus — wie die Behälter selbst, über denselben persistierten
  // Speicher (Schlüssel je Behälter + Kategorie, damit gleichnamige Kategorien in
  // verschiedenen Behältern unabhängig bleiben). Eingeklappt bleibt die Kopfzeile
  // sichtbar und weiter Wurf-Ziel, nur die Gegenstandszeilen entfallen.
  const groupedRows = (list: Item[], base: DropTarget) => {
    const keyBase = base.containerUid || '__loose';
    return catsOf(list).map((cat) => {
      const rows = list.filter((it) => it.kategorie === cat);
      const sum = rows.reduce((s, it) => s + itemGewicht(it), 0);
      const target: DropTarget = { ...base, kategorie: cat };
      const catKey = `cat:${keyBase}:${cat}`;
      const open = !isColl(catKey);
      return (
        <Fragment key={cat || '__none'}>
          <tr className={`subtle-head cat-head-row${isOver(target) ? ' drop-into' : ''}`} {...dropHandlers(target)}>
            <td colSpan={cols}>
              <button
                type="button"
                className="cat-toggle"
                aria-expanded={open}
                onClick={() => toggleColl(catKey)}
                title={open ? 'Kategorie einklappen' : 'Kategorie ausklappen'}
              >
                <span className="cat-chev" aria-hidden>{open ? '▾' : '▸'}</span>
                <span className="sticky-label">
                  {cat || 'Ohne Kategorie'} <span className="muted">· {rows.length} · {kg(sum)} kg</span>
                </span>
              </button>
            </td>
          </tr>
          {open && rows.map((it) => row(it, target))}
        </Fragment>
      );
    });
  };

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
            {!ro && (
              <label className="last-bonus" title="Zusatz auf die maximale Traglast (kg). Additiv, darf negativ sein.">
                Bonus<NumInput value={data.meta.traglastBonus} onChange={setTraglastBonus} />
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Zu Ausrüstung — auch im Nur-Lesen-Modus (Ziehen ist erlaubt). Klebt oben
          (siehe .inv-equip-drop): sonst ist die Ablage außer Sicht, sobald man
          einen Gegenstand tief unten aus einem Behälter zieht — nativer DnD
          scrollt nicht mit, und man müsste zum Erreichen herauszoomen. */}
      <div className="panel inv-equip-drop">
        <div {...dropProps({ location: 'bench' })}>
          <span className="zone-empty">
            ⇐ Zu Ausrüstung — Gegenstand hierher ziehen; er landet unter „Nicht getragen" im Ausrüstungs-Reiter.
          </span>
        </div>
      </div>

      {!ro && (
        <div className="panel inv-toolbar">
          <button className="small" onClick={() => setAddContainerOpen(true)}>
            + Behälter
          </button>
          <button className="small" onClick={() => setCatDialogOpen(true)}>
            Kategorien verwalten
          </button>
        </div>
      )}
      <CategoryManagerDialog
        open={catDialogOpen}
        onClose={() => setCatDialogOpen(false)}
        categories={data.itemCategories}
        endpoint={`/api/characters/${charId}/item-categories/manage`}
        onSaved={(cats, cascade) => {
          update('itemCategories', cats);
          update('items', applyCategoryCascade(items, cascade));
        }}
      />

      {storageConts.length === 0 && loose.length === 0 && (
        <p className="muted">
          Noch nichts verstaut.{!ro && ' Lege oben einen Behälter an und füge unten Gegenstände hinzu.'}
        </p>
      )}

      {storageConts.map((c) => {
        const inside = itemsInContainer(items, c.uid);
        // Gegen das Fassungsvermögen zählt bei Gewicht-Behältern das effektive
        // (reduzierte) Gewicht, bei Stück-Behältern die Stückzahl des Inhalts.
        const stueck = c.kapazitaetArt === 'stueck';
        const fuell = containerFuellungAnzeige(items, c);
        const voll = c.kapazitaet > 0 && fuell > c.kapazitaet;
        const open = !isColl(c.uid);
        const base: DropTarget = { location: 'behaelter', containerUid: c.uid };
        return (
          <div className={`panel${isOver(base) ? ' drop-over' : ''}`} key={c.uid} {...dropHandlers(base)}>
            <h3
              className="collapsible"
              role="button"
              tabIndex={0}
              onClick={() => toggleColl(c.uid)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleColl(c.uid);
                }
              }}
              title={open ? 'Behälter einklappen' : 'Behälter ausklappen'}
            >
              {ro ? (
                <span className="panel-title"> {c.name || '(ohne Name)'}</span>
              ) : (
                <span className="panel-title" onClick={(e) => e.stopPropagation()}>
                  {' '}
                  <input className="cont-name" value={c.name} onChange={(e) => patchItem(c.uid, { name: e.target.value })} placeholder="Behälter" />
                </span>
              )}
              <span className={`panel-info${voll ? ' over' : ''}`}>
                {inside.length} · {stueck ? fuell : kg(fuell)}
                {c.kapazitaet > 0 ? ` / ${stueck ? c.kapazitaet : kg(c.kapazitaet)}` : ''} {stueck ? 'Stück' : 'kg'}
                {!stueck && c.gewichtsreduktion > 0 && ` · ${c.gewichtsreduktion}% Reduktion`}
              </span>
              <span className="head-rule" aria-hidden />
              {!ro && (
                <span className="panel-actions cont-props" onClick={(e) => e.stopPropagation()}>
                  <label title="Eigengewicht des Behälters selbst (kg), zählt zur Traglast wie jeder andere Gegenstand.">
                    Gew.<NumInput value={c.gewicht} min={0} onChange={(v) => patchItem(c.uid, { gewicht: v })} />
                  </label>
                  <label title="Womit das Fassungsvermögen gemessen wird.">
                    <select
                      value={c.kapazitaetArt}
                      onChange={(e) => patchItem(c.uid, { kapazitaetArt: e.target.value as KapazitaetArt })}
                    >
                      <option value="gewicht">kg</option>
                      <option value="stueck">Stück</option>
                    </select>
                  </label>
                  <label title={stueck ? 'Fassungsvermögen (Stück, 0 = ohne Angabe)' : 'Fassungsvermögen (kg, 0 = ohne Angabe)'}>
                    Kap.<NumInput value={c.kapazitaet} min={0} onChange={(v) => patchItem(c.uid, { kapazitaet: v })} />
                  </label>
                  {!stueck && (
                    <label title="Gewichtsreduktion des Inhalts. 100 % = zählt gar nicht (Beutel des Fassungsvermögens).">
                      −%<NumInput value={c.gewichtsreduktion} min={0} max={100} onChange={(v) => patchItem(c.uid, { gewichtsreduktion: v })} />
                    </label>
                  )}
                  <button
                    type="button"
                    className="small"
                    title="Weitere Details, Duplizieren, Verschieben…"
                    onClick={() => setEditUid(c.uid)}
                  >
                    ⇄
                  </button>
                  <ConfirmDeleteButton title="Behälter entfernen (Inhalt wird lose)" onConfirm={() => removeItem(c.uid)} />
                </span>
              )}
              <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
            </h3>
            {open && (
              <>
                <div className="table-wrap">
                  <table className="sheet inv-table">
                    {colgroup}
                    <tbody>
                      {inside.length === 0 && (
                        <tr>
                          <td colSpan={cols} className="muted">
                            Leer — Gegenstände hierher ziehen{!ro && ' oder unten hinzufügen'}
                          </td>
                        </tr>
                      )}
                      {groupedRows(inside, base)}
                    </tbody>
                  </table>
                </div>
                {!ro && (
                  <div className="inv-add-trigger">
                    <button className="small" onClick={() => setAddItemFor(c.uid)}>
                      + Gegenstand
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {loose.length > 0 && (
        <div className="panel">
          <h3
            className="collapsible"
            role="button"
            tabIndex={0}
            onClick={() => toggleColl('__loose')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleColl('__loose');
              }
            }}
            title={isColl('__loose') ? 'Ausklappen' : 'Einklappen'}
          >
            <span className="panel-title">Nicht in einem Behälter</span>
            <span className="panel-info">Alt-Bestand — in einen Behälter ziehen oder zu Ausrüstung</span>
            <span className="head-rule" aria-hidden />
            <span className="chev" aria-hidden>{isColl('__loose') ? '▸' : '▾'}</span>
          </h3>
          {!isColl('__loose') && (
            <div className="table-wrap">
              <table className="sheet inv-table">
                {colgroup}
                <tbody>{groupedRows(loose, { location: 'inventar' })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <AddContainerDialog
        open={addContainerOpen}
        onClose={() => setAddContainerOpen(false)}
        onAdd={(fields) => setItems([...items, makeItem(fields)])}
      />
      <AddItemDialog
        open={addItemFor !== null}
        onClose={() => setAddItemFor(null)}
        categories={catOptions}
        talents={catalogs.talents}
        specialEnergies={catalogs.specialEnergies}
        isGm={user.isGm}
        onAdd={(fields) => setItems([...items, makeItem({ ...fields, location: 'behaelter', containerUid: addItemFor! })])}
      />
      <AddItemDialog
        open={editUid !== null}
        onClose={() => setEditUid(null)}
        categories={catOptions}
        item={editUid !== null ? byUid.get(editUid) : undefined}
        talents={catalogs.talents}
        specialEnergies={catalogs.specialEnergies}
        isGm={user.isGm}
        onSave={(patch) => editUid && patchItem(editUid, patch)}
        onDuplicate={() => editUid && duplicateItemAt(editUid)}
        onDelete={() => editUid && removeItem(editUid)}
        moveTargets={moveTargets}
        onMove={(target) => editUid && moveItemToOwner(editUid, target)}
      />
    </>
  );
}
