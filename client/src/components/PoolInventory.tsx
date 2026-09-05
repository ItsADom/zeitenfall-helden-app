import { Fragment, useState } from 'react';
import type { Item, ItemLocation, KapazitaetArt } from '@shared/items';
import { itemGewicht, itemsInContainer } from '@shared/items';
import type { MoveTarget } from './itemDialogs';
import { AddContainerDialog, AddItemDialog } from './itemDialogs';
import type { SpecialEnergyCatalogRow, TalentCatalogRow } from './charSheet';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { useReadOnly } from './displayMode';
import { NumInput } from './inputs';
import { CollapsedText } from './notes';
import { usePersistedState } from './persist';

// Shared inventories (docs/concepts/shared-inventories.md): the group pool and
// the GM pool both need the same "pile of items, grouped by category, some of
// them containers" view Inventar.tsx already has — but neither has a single
// character to hang Traglast/body-zones/useChar() off of. Concept 2.4's "no
// drag-and-drop" was about the cross-owner hand-out picker only (drag a chip
// onto a roster card, superseded by the "Verschieben nach…" picker); it never
// meant filing items around WITHIN a pool. Re-filing between categories/
// containers and reordering use the same drag machinery as Inventar.tsx,
// wired through `onMoveWithin` instead of a local setItems. A pool otherwise
// has no "packed gear" fiction, so — unlike a character's Inventar — a loose
// item is a normal, ongoing way to add something, not just migration
// leftovers: both "+ Behälter" and a plain "+ Gegenstand" are offered up
// front.
//
// `onMove`/`moveTargets` wire the "Verschieben nach…" picker (itemDialogs.tsx)
// into every item's edit dialog — containers included, since AddItemDialog
// doesn't care whether the item it's editing happens to hold other items.
//
// Read-only aware via useReadOnly(), same as Inventar.tsx (container name is
// plain text + click-to-collapse when read-only, an editable field only in
// edit mode) — a caller that never wraps this in a DisplayModeProvider (the
// GM pool) gets the "no provider = editable" default from displayMode.tsx,
// so it stays exactly as editable as before; a caller that does (the group
// pool, gated behind its own Bearbeiten toggle) gets the real read-only view.

const kg = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

// Kategorien einer Gegenstandsliste in Anzeigereihenfolge (alphabetisch, „ohne"
// zuletzt) — dieselbe Regel wie Inventar.tsx's catsOf.
function catsOf(list: Item[]): string[] {
  const set = new Set(list.map((it) => it.kategorie));
  const named = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  return set.has('') ? [...named, ''] : named;
}

// Houses (docs/concepts/houses.md): Räume EINES Hauses in einer Item-Liste,
// in Anzeigereihenfolge — dieselbe Herleitung wie catsOf (aus den
// tatsächlich vorhandenen Items, nicht aus der verwalteten Liste, siehe
// shared-inventories.md §3.1/3.2). Betrachtet NUR Items, die tatsächlich zu
// `haus` gehören (ein anderes/kein Haus zählt hier nicht mit — sonst würde
// „alle Räume" beim Filtern eines Hauses Items aus JEDEM anderen Haus
// durchlassen, siehe passtZuHaus/passtZuRaum unten). '' steht für „diesem
// Haus zugeordnet, aber ohne bestimmten Raum" und läuft immer zuletzt.
function raeumeVon(list: Item[], haus: string): string[] {
  const set = new Set(list.filter((it) => it.haus === haus).map((it) => it.raum));
  const named = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  return set.has('') ? [...named, ''] : named;
}

export default function PoolInventory({
  storageKey,
  items,
  categories,
  houses,
  roomsByHaus,
  talents,
  specialEnergies,
  isGm,
  moveTargets,
  onAdd,
  onSave,
  onDuplicate,
  onDelete,
  onPatchAnzahl,
  onMove,
  onMoveWithin,
}: {
  /** Eindeutiger Präfix fürs eingeklappt-Merken (localStorage) — Gruppenpool und
   * GM-Pool brauchen unabhängige Zustände. */
  storageKey: string;
  items: Item[];
  categories: string[];
  /** Houses (docs/concepts/houses.md): nur der Gruppenpool setzt beides — blendet
   * den Raum-Filter ein. Der SL-Vorrat lässt beide weg, keine Häuser dort
   * (siehe AddItemDialog.houses). */
  houses?: string[];
  roomsByHaus?: Record<string, string[]>;
  talents: TalentCatalogRow[];
  specialEnergies: SpecialEnergyCatalogRow[];
  isGm: boolean;
  moveTargets: MoveTarget[];
  onAdd: (fields: Partial<Item>) => void;
  onSave: (uid: string, patch: Partial<Item>) => void;
  onDuplicate: (uid: string) => void;
  onDelete: (uid: string) => void;
  onPatchAnzahl: (uid: string, anzahl: number) => void;
  onMove: (uid: string, target: MoveTarget) => void;
  /** Ziehen INNERHALB des Pools (Kategorie/Behälter/Reihenfolge) — eigener Weg
   * neben onSave, weil eine Umsortierung (beforeUid) das ganze Array betrifft,
   * nicht nur ein Item; siehe reorderItems/dropHandlers unten. */
  onMoveWithin: (uid: string, patch: Partial<Item>, beforeUid?: string) => void;
}) {
  const ro = useReadOnly();
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const [addContainerOpen, setAddContainerOpen] = useState(false);
  const [addLooseOpen, setAddLooseOpen] = useState(false);
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  const [editUid, setEditUid] = useState<string | null>(null);
  const [collapsed, setCollapsed] = usePersistedState<string[]>(`${storageKey}:collapsed`, []);
  const isColl = (k: string) => collapsed.includes(k);
  const toggleColl = (k: string) => setCollapsed((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  // Drag-and-drop innerhalb des Pools (Kategorie/Behälter/Reihenfolge) —
  // dieselbe Mechanik wie Inventar.tsx, nur über onMoveWithin statt einem
  // lokalen setItems. `patch` trägt die Felder, die das Ziel festlegt
  // (kategorie für eine Kategorie-Kopfzeile, haus/raum für eine Raum-Kopfzeile).
  const [over, setOver] = useState<string | null>(null);
  interface DropTarget {
    location: ItemLocation;
    containerUid?: string;
    patch?: Partial<Item>;
  }
  const dropKey = (t: DropTarget) => `${t.location}:${t.containerUid ?? ''}:${JSON.stringify(t.patch ?? {})}`;
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
  const moveTo = (uid: string, t: DropTarget, beforeUid?: string) => {
    if (t.location === 'behaelter' && t.containerUid) {
      if (t.containerUid === uid || ancestors(t.containerUid).has(uid)) return;
    }
    const patch: Partial<Item> = {
      location: t.location,
      containerUid: t.location === 'behaelter' ? (t.containerUid ?? '') : '',
      ...t.patch,
    };
    onMoveWithin(uid, patch, beforeUid);
  };
  const isOver = (t: DropTarget, beforeUid?: string) => over === dropKey(t) + (beforeUid ? `::vor:${beforeUid}` : '');
  const dropHandlers = (t: DropTarget, beforeUid?: string) => {
    const key = dropKey(t) + (beforeUid ? `::vor:${beforeUid}` : '');
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
        if (uid) moveTo(uid, t, beforeUid);
      },
    };
  };

  const allStorageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  const allLoose = items.filter((it) => !(it.location === 'behaelter') && !(it.istBehaelter && it.containerArt === 'storage'));

  const colgroup = (
    <colgroup>
      <col style={{ width: 28 }} />
      <col style={{ width: '24em' }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 78 }} />
      <col style={{ width: 78 }} />
      <col />
    </colgroup>
  );
  const cols = 6;

  const editingItem = editUid !== null ? byUid.get(editUid) : undefined;

  // Houses (docs/concepts/houses.md): welches Haus betrachtet wird. Nur
  // relevant, wenn houses gesetzt ist (Gruppenpool). Die frühere separate
  // Raum-Ansicht (eigene Gruppierung/Zeilenform je Behälter) ist einem reinen
  // Filter gewichen (Entwickler-Entscheidung, siehe ALLE_RAEUME unten): immer
  // Kategorie-gruppiert, ein Raum grenzt nur ein, WELCHE Items/Behälter
  // überhaupt in die Kategorie-Gruppierung einfließen. Das erspart eine
  // zweite Zeilenform samt eigenem Drop-Ziel (Behälter als Tabellenzeile
  // statt als Panel, dessen Ziehfläche in der Praxis knapp und tückisch war).
  const OHNE_HAUS = ' ohne-haus';
  const [activeHausRaw, setActiveHaus] = usePersistedState<string>(`${storageKey}:activeHaus`, '');
  // Wählbare Häuser sind die verwaltete Liste VEREINIGT mit jedem Haus-Wert,
  // der schon auf einem Item steht — dieselbe Regel wie catOptions für
  // Kategorien (shared-inventories.md §3.1): ein frisch auf ein Item
  // getipptes, noch nicht verwaltetes Haus soll sofort umschaltbar sein,
  // nicht erst nach einem Abstecher in „Häuser verwalten".
  const namedHouses = houses
    ? [...new Set([...houses, ...items.map((it) => it.haus).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'de'))
    : undefined;
  const hatOhneHaus = houses && items.some((it) => !it.haus);
  const availableHouses = namedHouses && (hatOhneHaus ? [...namedHouses, OHNE_HAUS] : namedHouses);
  const activeHaus =
    availableHouses && availableHouses.includes(activeHausRaw) ? activeHausRaw : (namedHouses?.[0] ?? OHNE_HAUS);

  // Ein Raum eingrenzen (Entwickler-Feedback): die Raumliste eines belebten
  // Hauses kann lang werden, und Ziehen auf eine Behälter-Zeile ist in einer
  // langen Liste knifflig zu treffen — ein Filter auf einen Raum hält die
  // sichtbare Liste kurz. „Alle Räume" (Sentinel, kollidiert nicht mit dem
  // „Nicht zugeordnet"-Raum, dessen Schlüssel '' ist) bleibt die Vorgabe.
  const ALLE_RAEUME = ' alle';
  const [activeRaumRaw, setActiveRaum] = usePersistedState<string>(`${storageKey}:activeRaum`, ALLE_RAEUME);
  // Wie availableHouses: verwaltete Räume (roomsByHaus) VEREINIGT mit
  // tatsächlich benutzten (raeumeVon) — ein frisch angelegter, noch leerer
  // Raum soll sofort anwählbar sein, nicht erst, wenn ein Item darin liegt.
  const raumHausKey = activeHaus === OHNE_HAUS ? '' : activeHaus;
  const raumInUse = availableHouses ? raeumeVon([...allLoose, ...allStorageConts], raumHausKey) : [];
  const raumNamed = [...new Set([...(activeHaus === OHNE_HAUS ? [] : (roomsByHaus?.[activeHaus] ?? [])), ...raumInUse.filter(Boolean)])].sort(
    (a, b) => a.localeCompare(b, 'de'),
  );
  const raumOptions = raumInUse.includes('') ? [...raumNamed, ''] : raumNamed;
  const activeRaum = activeRaumRaw === ALLE_RAEUME || raumOptions.includes(activeRaumRaw) ? activeRaumRaw : ALLE_RAEUME;
  const passtZuHaus = (it: Item) => !availableHouses || it.haus === raumHausKey;
  const passtZuRaum = (it: Item) => passtZuHaus(it) && (activeRaum === ALLE_RAEUME || it.raum === activeRaum);
  const storageConts = allStorageConts.filter(passtZuRaum);
  const loose = allLoose.filter(passtZuRaum);

  const row = (it: Item, target: DropTarget, hint?: string) => (
    <tr
      key={it.uid}
      className={`inv-row${isOver(target, it.uid) ? ' inv-row-drop-before' : ''}`}
      title="Klicken für Details — Bearbeiten, Duplizieren, Löschen, Verschieben"
      onClick={() => setEditUid(it.uid)}
      {...dropHandlers(target, it.uid)}
    >
      <td className="grip-cell" onClick={(e) => e.stopPropagation()}>
        <span
          className="row-grip"
          draggable
          title="Ziehen zum Verschieben (Kategorie / Behälter)"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', it.uid);
          }}
        >
          ⠿
        </span>
      </td>
      <td>
        <span className="static-value static-text">
          {it.name || ' '}
          {gebrachtBadge(it)}
        </span>
        {hint && <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>{hint}</span>}
      </td>
      <td className="num" onClick={(e) => e.stopPropagation()}>
        <NumInput value={it.anzahl} min={0} onChange={(v) => onPatchAnzahl(it.uid, v)} />
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

  // Ort-Hinweis für eine Kategorie-Zeile — nur, wenn ein Haus zugewiesen ist.
  const ortHinweis = (it: Item) => (it.haus ? `${it.haus}${it.raum ? ' · ' + it.raum : ''}` : undefined);
  // "Gebracht von"-Marker (TODO.md, 2026-09-03): ein Glyph mit Tooltip statt
  // ausgeschriebenem Text direkt neben dem Namen — ein Charaktername ist
  // beliebig lang, und als Text angehängt ließ er die Zeile umbrechen, was bei
  // vielen Items in der Liste spürbar Höhe kostete (Entwickler-Feedback). Ein
  // Glyph hat immer dieselbe, minimale Breite, unabhängig vom Namen dahinter —
  // der volle Name steht weiterhin im title-Tooltip.
  const gebrachtBadge = (it: Pick<Item, 'mitgebrachtVon'>) =>
    it.mitgebrachtVon ? (
      <span className="muted" title={`Zuletzt aus dem Inventar von ${it.mitgebrachtVon} hierher verschoben`} style={{ marginLeft: 6 }}>
        ↪
      </span>
    ) : null;

  const groupedRows = (list: Item[], base: DropTarget) =>
    catsOf(list).map((cat) => {
      const rows = list.filter((it) => it.kategorie === cat);
      const sum = rows.reduce((s, it) => s + itemGewicht(it), 0);
      const target: DropTarget = { ...base, patch: { ...base.patch, kategorie: cat } };
      const keyBase = base.containerUid || '__loose';
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
          {open && rows.map((it) => row(it, target, ortHinweis(it)))}
        </Fragment>
      );
    });

  return (
    <>
      {availableHouses && (availableHouses.length > 1 || raumOptions.length > 0) && (
        <div className="panel inv-toolbar">
          {activeHaus && availableHouses.length > 1 && (
            <select value={activeHaus} onChange={(e) => setActiveHaus(e.target.value)}>
              {availableHouses.map((h) => (
                <option key={h} value={h}>
                  {h === OHNE_HAUS ? 'Ohne Haus' : h}
                </option>
              ))}
            </select>
          )}
          {raumOptions.length > 0 && (
            <select value={activeRaum} onChange={(e) => setActiveRaum(e.target.value)} title="Auf einen Raum eingrenzen">
              <option value={ALLE_RAEUME}>Alle Räume</option>
              {raumOptions.map((r) => (
                <option key={r || '__none'} value={r}>
                  {r || 'Nicht zugeordnet'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {!ro && (
        <div className="panel inv-toolbar">
          <button className="small" onClick={() => setAddContainerOpen(true)}>
            + Behälter
          </button>
          <button className="small" onClick={() => setAddLooseOpen(true)}>
            + Gegenstand
          </button>
        </div>
      )}

      {storageConts.length === 0 && loose.length === 0 && (
        <p className="muted">{activeRaum === ALLE_RAEUME ? 'Noch nichts abgelegt.' : 'Nichts in diesem Raum.'}</p>
      )}

      {storageConts.map((c) => {
        const inside = itemsInContainer(items, c.uid);
        const stueck = c.kapazitaetArt === 'stueck';
        const open = !isColl(c.uid);
        const contBase: DropTarget = { location: 'behaelter', containerUid: c.uid };
        return (
          <div className={`panel${isOver(contBase) ? ' drop-over' : ''}`} key={c.uid} {...dropHandlers(contBase)}>
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
                  <input className="cont-name" value={c.name} onChange={(e) => onSave(c.uid, { name: e.target.value })} placeholder="Behälter" />
                </span>
              )}
              {gebrachtBadge(c)}
              <span className="panel-info">
                {inside.length} · {stueck ? c.kapazitaet : kg(c.kapazitaet)} {stueck ? 'Stück' : 'kg'}
                {ortHinweis(c) && <> · {ortHinweis(c)}</>}
              </span>
              <span className="head-rule" aria-hidden />
              <span className="panel-actions cont-props" onClick={(e) => e.stopPropagation()}>
                {!ro && (
                  <>
                    <label title="Eigengewicht des Behälters selbst (kg).">
                      Gew.<NumInput value={c.gewicht} min={0} onChange={(v) => onSave(c.uid, { gewicht: v })} />
                    </label>
                    <label title="Womit das Fassungsvermögen gemessen wird.">
                      <select value={c.kapazitaetArt} onChange={(e) => onSave(c.uid, { kapazitaetArt: e.target.value as KapazitaetArt })}>
                        <option value="gewicht">kg</option>
                        <option value="stueck">Stück</option>
                      </select>
                    </label>
                    <label title={stueck ? 'Fassungsvermögen (Stück, 0 = ohne Angabe)' : 'Fassungsvermögen (kg, 0 = ohne Angabe)'}>
                      Kap.<NumInput value={c.kapazitaet} min={0} onChange={(v) => onSave(c.uid, { kapazitaet: v })} />
                    </label>
                  </>
                )}
                {/* Bleibt erreichbar wie ein Item-Klick auch im Nur-Lesen-Modus
                    (AddItemDialog bleibt über AlwaysEditable bearbeitbar) —
                    sonst gäbe es keinen Weg, einen Behälter zu verschieben,
                    ohne vorher das ganze Blatt aufzuschließen. */}
                <button
                  type="button"
                  className="small"
                  title="Weitere Details, Duplizieren, Verschieben…"
                  onClick={() => setEditUid(c.uid)}
                >
                  ⇄
                </button>
                {!ro && <ConfirmDeleteButton title="Behälter entfernen (Inhalt wird lose)" onConfirm={() => onDelete(c.uid)} />}
              </span>
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
                            Leer — unten hinzufügen
                          </td>
                        </tr>
                      )}
                      {groupedRows(inside, contBase)}
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
          <div className="table-wrap">
            <table className="sheet inv-table">
              {colgroup}
              <tbody>{groupedRows(loose, { location: 'inventar' })}</tbody>
            </table>
          </div>
        </div>
      )}

      <AddContainerDialog open={addContainerOpen} onClose={() => setAddContainerOpen(false)} onAdd={onAdd} />
      <AddItemDialog
        open={addLooseOpen}
        onClose={() => setAddLooseOpen(false)}
        categories={categories}
        houses={houses}
        roomsByHaus={roomsByHaus}
        talents={talents}
        specialEnergies={specialEnergies}
        isGm={isGm}
        onAdd={(fields) => onAdd({ ...fields, location: 'inventar' })}
      />
      {/* Kein houses/roomsByHaus hier: Inhalt eines Behälters trägt keinen
          eigenen Raum — nur der Behälter (das Wurzel-Item) tut das (docs/
          concepts/houses.md, „Container carry their contents implicitly"). */}
      <AddItemDialog
        open={addItemFor !== null}
        onClose={() => setAddItemFor(null)}
        categories={categories}
        talents={talents}
        specialEnergies={specialEnergies}
        isGm={isGm}
        onAdd={(fields) => onAdd({ ...fields, location: 'behaelter', containerUid: addItemFor! })}
      />
      <AddItemDialog
        open={editUid !== null}
        onClose={() => setEditUid(null)}
        categories={categories}
        houses={editingItem?.location !== 'behaelter' ? houses : undefined}
        roomsByHaus={roomsByHaus}
        item={editingItem}
        talents={talents}
        specialEnergies={specialEnergies}
        isGm={isGm}
        onSave={(patch) => editUid && onSave(editUid, patch)}
        onDuplicate={() => editUid && onDuplicate(editUid)}
        onDelete={() => editUid && onDelete(editUid)}
        moveTargets={moveTargets}
        onMove={(target) => editUid && onMove(editUid, target)}
      />
    </>
  );
}
