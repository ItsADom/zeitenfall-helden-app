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

export default function PoolInventory({
  storageKey,
  items,
  categories,
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

  const row = (it: Item) => (
    <tr key={it.uid} className="inv-row" title="Klicken für Details — Bearbeiten, Duplizieren, Löschen, Verschieben" onClick={() => setEditUid(it.uid)}>
      <td>
        <span className="static-value static-text">{it.name || ' '}</span>
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
          {open && rows.map(row)}
        </Fragment>
      );
    });

  return (
    <>
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

      {storageConts.map((c) => {
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
              <span className="panel-info">
                {inside.length} · {stueck ? c.kapazitaet : kg(c.kapazitaet)} {stueck ? 'Stück' : 'kg'}
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

      {loose.length > 0 && (
        <div className="panel">
          <div className="table-wrap">
            <table className="sheet inv-table">
              {colgroup}
              <tbody>{groupedRows(loose, '__loose')}</tbody>
            </table>
          </div>
        </div>
      )}

      <AddContainerDialog open={addContainerOpen} onClose={() => setAddContainerOpen(false)} onAdd={onAdd} />
      <AddItemDialog
        open={addLooseOpen}
        onClose={() => setAddLooseOpen(false)}
        categories={categories}
        talents={talents}
        specialEnergies={specialEnergies}
        isGm={isGm}
        onAdd={(fields) => onAdd({ ...fields, location: 'inventar' })}
      />
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
