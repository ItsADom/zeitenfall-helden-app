import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Ability, Attributes } from '@shared/abilities';
import { groupAbilities } from '@shared/abilities';
import { probeExprZahl } from '@shared/rules';
import { AlwaysEditable } from '../components/displayMode';
import { NumInput } from '../components/inputs';
import { usePersistedState } from '../components/persist';
import { useChar } from '../pages/Character';

// Gemeinsame Ansicht für die Reiter „Zauber" und „Fähigkeiten": eine reine
// Anzeige auf die Stammliste (verwaltet unter „Zauber & Fähigkeiten verwalten").
// Alles außer dem Fortschritt wird nur dargestellt; der Fortschritt ist auch im
// Nur-Lesen-Modus editierbar, weil er im Spiel oft angefasst wird. Suchen,
// Filtern, Sortieren und Gruppieren helfen, wenn die Liste groß wird.

export type GroupBy = 'element' | 'kategorie';
const GROUP_LABEL: Record<GroupBy, string> = { element: 'Element', kategorie: 'Kategorie' };
const GROUP_NONE: Record<GroupBy, string> = { element: 'Ohne Element', kategorie: 'Ohne Kategorie' };

type SortBy = '' | 'name' | 'stufe' | 'fortschritt';
const SORT_LABEL: Record<SortBy, string> = { '': 'Reihenfolge', name: 'Name', stufe: 'Stufe', fortschritt: 'Fortschritt' };

export function AbilityTable({ magisch, persistKey, groupOptions }: { magisch: boolean; persistKey: string; groupOptions: GroupBy[] }) {
  const { data, update, charId } = useChar();
  const list = data.abilities.filter((a) => a.magisch === magisch);
  const [stored, setGroupBy] = usePersistedState<GroupBy>(`${persistKey}:group`, groupOptions[0]);
  const by = groupOptions.includes(stored) ? stored : groupOptions[0];

  const [q, setQ] = useState('');
  const [fEl, setFEl] = useState('');
  const [fKat, setFKat] = useState('');
  const [fPassiv, setFPassiv] = useState<'' | 'passiv' | 'aktiv'>('');
  const [sort, setSort] = useState<SortBy>('');

  const setFort = (uid: string, v: number) =>
    update('abilities', data.abilities.map((a) => (a.uid === uid ? { ...a, fortschritt: v } : a)));

  const elemente = [...new Set(list.map((a) => a.element).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const kategorien = [...new Set(list.map((a) => a.kategorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  const needle = q.trim().toLowerCase();
  const filtered = list.filter((a) => {
    if (needle && !(a.name.toLowerCase().includes(needle) || a.effekt.toLowerCase().includes(needle) || a.notiz.toLowerCase().includes(needle))) return false;
    if (fEl && a.element !== fEl) return false;
    if (fKat && a.kategorie !== fKat) return false;
    if (fPassiv === 'passiv' && !a.passiv) return false;
    if (fPassiv === 'aktiv' && a.passiv) return false;
    return true;
  });
  const sortFn = (a: Ability, b: Ability): number => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name, 'de');
      case 'stufe':
        return a.stufe - b.stufe;
      case 'fortschritt':
        return b.fortschritt - a.fortschritt;
      default:
        return 0;
    }
  };

  const groups = groupAbilities(filtered, by);
  const cols = magisch ? 7 : 6;
  const filtering = needle !== '' || fEl !== '' || fKat !== '' || fPassiv !== '';

  return (
    <div className="panel">
      <div className="abil-toolbar">
        <input className="abil-search" type="text" placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        {magisch && elemente.length > 0 && (
          <select value={fEl} onChange={(e) => setFEl(e.target.value)} title="Nach Element filtern">
            <option value="">alle Elemente</option>
            {elemente.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
        {kategorien.length > 0 && (
          <select value={fKat} onChange={(e) => setFKat(e.target.value)} title="Nach Kategorie filtern">
            <option value="">alle Kategorien</option>
            {kategorien.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        <select value={fPassiv} onChange={(e) => setFPassiv(e.target.value as '' | 'passiv' | 'aktiv')} title="Passiv/aktiv">
          <option value="">alle</option>
          <option value="aktiv">nur aktive</option>
          <option value="passiv">nur passive</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortBy)} title="Sortieren">
          {(Object.keys(SORT_LABEL) as SortBy[]).map((s) => (
            <option key={s} value={s}>
              Sortieren: {SORT_LABEL[s]}
            </option>
          ))}
        </select>
        {groupOptions.length > 1 && (
          <span className="abil-groupsel">
            <span className="muted">Gruppe</span>
            {groupOptions.map((g) => (
              <button key={g} className={`small${by === g ? ' active' : ''}`} onClick={() => setGroupBy(g)}>
                {GROUP_LABEL[g]}
              </button>
            ))}
          </span>
        )}
        <Link className="abil-werk-link" to={`/charakter/${charId}/zauber-faehigkeiten`}>
          Bearbeiten →
        </Link>
      </div>

      {list.length === 0 ? (
        <p className="muted">
          Noch nichts. Unter <Link to={`/charakter/${charId}/zauber-faehigkeiten`}>Zauber &amp; Fähigkeiten verwalten</Link> anlegen.
        </p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nichts gefunden.</p>
      ) : (
        <div className="table-wrap">
          <table className="sheet abil-tab">
            <colgroup>
              <col />
              <col style={{ width: 52 }} />
              {magisch && <col style={{ width: 52 }} />}
              <col style={{ width: '7em' }} />
              <col style={{ width: '9em' }} />
              <col style={{ width: 74 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Stufe</th>
                {magisch && <th className="num">Kx</th>}
                <th>Kosten</th>
                <th>Probe</th>
                <th className="num">Fortschritt</th>
                <th>Effekt</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([key, rows]) => (
                <Fragment key={key || '__none'}>
                  <tr className="subtle-head">
                    <td colSpan={cols}>
                      <span className="sticky-label">
                        {key || GROUP_NONE[by]} <span className="muted">· {rows.length}</span>
                      </span>
                    </td>
                  </tr>
                  {[...rows].sort(sortFn).map((a) => (
                    <AbilityRow key={a.uid} a={a} magisch={magisch} attrs={data.attributes} onFort={(v) => setFort(a.uid, v)} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtering && <p className="muted abil-count">{filtered.length} von {list.length} angezeigt.</p>}
    </div>
  );
}

function AbilityRow({ a, magisch, attrs, onFort }: { a: Ability; magisch: boolean; attrs: Attributes; onFort: (v: number) => void }) {
  const pz = probeExprZahl(attrs, a.probe);
  return (
    <tr>
      <td>
        <span className="abil-name">{a.name || '—'}</span>
        {a.passiv && <span className="abil-badge">passiv</span>}
      </td>
      <td className="num">{a.stufe || ''}</td>
      {magisch && <td className="num">{a.komplexitaet || ''}</td>}
      <td>{a.kosten}</td>
      <td className="abil-probe">
        {a.probe}
        {pz != null && <span className="muted"> ({pz})</span>}
      </td>
      <td className="num">
        <AlwaysEditable>
          <NumInput value={a.fortschritt} min={0} onChange={onFort} />
        </AlwaysEditable>
      </td>
      <td className="abil-effekt">
        {a.effekt}
        {a.notiz && <div className="abil-note muted">{a.notiz}</div>}
      </td>
    </tr>
  );
}
