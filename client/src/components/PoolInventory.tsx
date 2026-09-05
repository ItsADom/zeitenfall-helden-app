import { Fragment, useState } from 'react';
import type { Item, KapazitaetArt } from '@shared/items';
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
// character to hang Traglast/body-zones/useChar() off of, and per the concept
// (2.4) neither wants drag-and-drop ("GroupOverview.tsx needs no drop targets
// and stays free of drag plumbing" — generalized here to both pools). This is
// that view, extracted and simplified: no drag, no Traglast, category
// re-filing happens by editing an item's category in the dialog instead of
// dragging it onto a group header. A pool otherwise has no "packed gear"
// fiction, so — unlike a character's Inventar — a loose item is a normal,
// ongoing way to add something, not just migration leftovers: both "+
// Behälter" and a plain "+ Gegenstand" are offered up front.
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
// shared-inventories.md §3.1/3.2). '' steht für „nicht diesem Haus/Raum
// zugeordnet" (kein Haus, oder ein anderes Haus als das gerade Betrachtete)
// und läuft immer zuletzt.
function raeumeVon(list: Item[], haus: string): string[] {
  const set = new Set(list.map((it) => (it.haus === haus && haus ? it.raum : '')));
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
}: {
  /** Eindeutiger Präfix fürs eingeklappt-Merken (localStorage) — Gruppenpool und
   * GM-Pool brauchen unabhängige Zustände. */
  storageKey: string;
  items: Item[];
  categories: string[];
  /** Houses (docs/concepts/houses.md): nur der Gruppenpool setzt beides — blendet
   * den Kategorie-/Raum-Umschalter ein. Der SL-Vorrat lässt beide weg, keine
   * Häuser dort (siehe AddItemDialog.houses). */
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

  // Raum view (docs/concepts/houses.md): a Stauraum-Behälter sorts into its
  // room here instead of keeping its own always-visible panel (see the
  // raumView branch in the JSX below and groupedByRaum's container branch).
  // Contents start collapsed so a furnished room doesn't turn into a wall of
  // open wardrobes — reusing the same `collapsed` array with the membership
  // test INVERTED (present = expanded) gets that "closed by default" for
  // free, no separate default list to maintain.
  const isContOpen = (uid: string) => collapsed.includes(`raumcont:${uid}`);
  const toggleContOpen = (uid: string) => toggleColl(`raumcont:${uid}`);

  const storageConts = items.filter((it) => it.istBehaelter && it.containerArt === 'storage');
  const loose = items.filter((it) => !(it.location === 'behaelter') && !(it.istBehaelter && it.containerArt === 'storage'));

  const colgroup = (
    <colgroup>
      <col style={{ width: '24em' }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 78 }} />
      <col style={{ width: 78 }} />
      <col />
    </colgroup>
  );
  const cols = 5;

  const editingItem = editUid !== null ? byUid.get(editUid) : undefined;

  // Houses (docs/concepts/houses.md): persistierte Ansicht — Kategorie- oder
  // Raum-Gruppierung derselben Liste, plus welches Haus im Raum-Modus gerade
  // betrachtet wird. Nur relevant, wenn houses gesetzt ist (Gruppenpool).
  const [view, setView] = usePersistedState<'kategorie' | 'raum'>(`${storageKey}:view`, 'kategorie');
  const [activeHausRaw, setActiveHaus] = usePersistedState<string>(`${storageKey}:activeHaus`, '');
  // Wählbare Häuser sind die verwaltete Liste VEREINIGT mit jedem Haus-Wert,
  // der schon auf einem Item steht — dieselbe Regel wie catOptions für
  // Kategorien (shared-inventories.md §3.1): ein frisch auf ein Item
  // getipptes, noch nicht verwaltetes Haus soll sofort umschaltbar sein,
  // nicht erst nach einem Abstecher in „Häuser verwalten".
  const availableHouses = houses
    ? [...new Set([...houses, ...items.map((it) => it.haus).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'de'))
    : undefined;
  const activeHaus = availableHouses && availableHouses.includes(activeHausRaw) ? activeHausRaw : (availableHouses?.[0] ?? '');
  const raumView = view === 'raum' && !!availableHouses;

  const row = (it: Item, hint?: string) => (
    <tr key={it.uid} className="inv-row" title="Klicken für Details — Bearbeiten, Duplizieren, Löschen, Verschieben" onClick={() => setEditUid(it.uid)}>
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

  const groupedRows = (list: Item[], keyBase: string) =>
    catsOf(list).map((cat) => {
      const rows = list.filter((it) => it.kategorie === cat);
      const sum = rows.reduce((s, it) => s + itemGewicht(it), 0);
      const catKey = `cat:${keyBase}:${cat}`;
      const open = !isColl(catKey);
      return (
        <Fragment key={cat || '__none'}>
          <tr className="subtle-head cat-head-row">
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
          {open && rows.map((it) => row(it, ortHinweis(it)))}
        </Fragment>
      );
    });

  // Raum view only (per developer decision — Kategorie view keeps a
  // Stauraum-Behälter in its own always-visible panel, see the raumView
  // branch below): renders a container as a normal row in its room's group
  // instead of its own panel, collapsed by default (isContOpen/toggleContOpen
  // above), expandable to its contents via groupedRows — same nesting the
  // Kategorie-view panel uses, just tighter to fit inside an ordinary row.
  const containerRoomRow = (c: Item) => {
    const inside = itemsInContainer(items, c.uid);
    const open = isContOpen(c.uid);
    return (
      <Fragment key={c.uid}>
        <tr className="inv-row" title="Klicken für Details — Bearbeiten, Duplizieren, Löschen, Verschieben" onClick={() => setEditUid(c.uid)}>
          <td>
            <button
              type="button"
              className="cat-toggle"
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                toggleContOpen(c.uid);
              }}
              title={open ? 'Behälter einklappen' : 'Behälter ausklappen'}
            >
              <span className="cat-chev" aria-hidden>{open ? '▾' : '▸'}</span>
            </button>
            <span className="static-value static-text">
              {c.name || '(ohne Name)'}
              {gebrachtBadge(c)}
            </span>
            <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
              Behälter · {inside.length}
              {c.kategorie && <> · {c.kategorie}</>}
            </span>
          </td>
          <td className="num" onClick={(e) => e.stopPropagation()}>
            <NumInput value={c.anzahl} min={0} onChange={(v) => onPatchAnzahl(c.uid, v)} />
          </td>
          <td className="num">
            <span className="static-value static-num">{c.gewicht}</span>
          </td>
          <td className="computed">{kg(itemGewicht(c))}</td>
          <td>
            <CollapsedText text={c.notiz} className="static-value static-text" />
          </td>
        </tr>
        {open && inside.length === 0 && (
          <tr>
            <td colSpan={cols} className="muted" style={{ paddingLeft: '2em' }}>
              Leer
            </td>
          </tr>
        )}
        {open && groupedRows(inside, c.uid)}
      </Fragment>
    );
  };

  // Houses (docs/concepts/houses.md): dieselbe Gruppierungs-/Einklapp-Mechanik
  // wie groupedRows, nur nach raum (innerhalb activeHaus) statt kategorie —
  // '' fasst „nicht diesem Haus/Raum zugeordnet" zusammen (kein Haus, oder ein
  // anderes Haus als das gerade betrachtete), läuft dank raeumeVon immer
  // zuletzt. Jede Zeile zeigt ihre Kategorie als Hinweis statt des Orts, außer
  // bei einem Stauraum-Behälter — der sortiert hier selbst mit ein (siehe
  // containerRoomRow), statt in seinem eigenen Panel zu bleiben.
  const groupedByRaum = (list: Item[], keyBase: string) =>
    raeumeVon(list, activeHaus).map((raum) => {
      const rows = list.filter((it) => (it.haus === activeHaus && activeHaus ? it.raum : '') === raum);
      const sum = rows.reduce((s, it) => s + itemGewicht(it), 0);
      const raumKey = `raum:${keyBase}:${raum}`;
      const open = !isColl(raumKey);
      return (
        <Fragment key={raum || '__none'}>
          <tr className="subtle-head cat-head-row">
            <td colSpan={cols}>
              <button
                type="button"
                className="cat-toggle"
                aria-expanded={open}
                onClick={() => toggleColl(raumKey)}
                title={open ? 'Raum einklappen' : 'Raum ausklappen'}
              >
                <span className="cat-chev" aria-hidden>{open ? '▾' : '▸'}</span>
                <span className="sticky-label">
                  {raum || 'Nicht zugeordnet'} <span className="muted">· {rows.length} · {kg(sum)} kg</span>
                </span>
              </button>
            </td>
          </tr>
          {open &&
            rows.map((it) =>
              it.istBehaelter && it.containerArt === 'storage'
                ? containerRoomRow(it)
                : row(it, it.kategorie || undefined),
            )}
        </Fragment>
      );
    });

  return (
    <>
      {availableHouses && (
        <div className="panel inv-toolbar">
          {activeHaus && availableHouses.length > 1 && (
            <select value={activeHaus} onChange={(e) => setActiveHaus(e.target.value)} disabled={!raumView}>
              {availableHouses.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
          <div className="dlg-seg">
            <button type="button" className={view === 'kategorie' ? 'active' : ''} onClick={() => setView('kategorie')}>
              Kategorie
            </button>
            <button
              type="button"
              className={view === 'raum' ? 'active' : ''}
              disabled={!activeHaus}
              title={activeHaus ? undefined : 'Noch kein Haus angelegt'}
              onClick={() => setView('raum')}
            >
              Raum
            </button>
          </div>
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

      {storageConts.length === 0 && loose.length === 0 && <p className="muted">Noch nichts abgelegt.</p>}

      {/* Raum view sorts a Stauraum-Behälter into its room instead (see
          containerRoomRow/groupedByRaum) — this panel stays Kategorie-view-only. */}
      {!raumView && storageConts.map((c) => {
        const inside = itemsInContainer(items, c.uid);
        const stueck = c.kapazitaetArt === 'stueck';
        const open = !isColl(c.uid);
        return (
          <div className="panel" key={c.uid}>
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
                      {groupedRows(inside, c.uid)}
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

      {(loose.length > 0 || (raumView && storageConts.length > 0)) && (
        <div className="panel">
          <div className="table-wrap">
            <table className="sheet inv-table">
              {colgroup}
              <tbody>{raumView ? groupedByRaum([...loose, ...storageConts], '__loose') : groupedRows(loose, '__loose')}</tbody>
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
