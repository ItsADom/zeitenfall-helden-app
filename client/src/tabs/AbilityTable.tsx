import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { Ability, Attributes } from '@shared/abilities';
import { groupAbilities } from '@shared/abilities';
import { probeExprZahl } from '@shared/rules';
import { AlwaysEditable } from '../components/displayMode';
import { NumInput } from '../components/inputs';
import { usePersistedState } from '../components/persist';
import { useChar } from '../pages/Character';

// Gemeinsame Ansicht für die Reiter „Zauber" und „Fähigkeiten": eine reine
// Anzeige auf die Werkstatt-Stammliste. Alles außer dem Fortschritt wird nur
// dargestellt (bearbeitet wird in der Werkstatt); der Fortschritt ist auch im
// Nur-Lesen-Modus editierbar, weil er im Spiel oft angefasst wird.

export type GroupBy = 'gruppe' | 'element' | 'kategorie';
const GROUP_LABEL: Record<GroupBy, string> = { gruppe: 'Gruppe', element: 'Element', kategorie: 'Kategorie' };
const GROUP_NONE: Record<GroupBy, string> = { gruppe: 'Ohne Gruppe', element: 'Ohne Element', kategorie: 'Ohne Kategorie' };

export function AbilityTable({ magisch, persistKey, groupOptions }: { magisch: boolean; persistKey: string; groupOptions: GroupBy[] }) {
  const { data, update, charId } = useChar();
  const list = data.abilities.filter((a) => a.magisch === magisch);
  const [stored, setGroupBy] = usePersistedState<GroupBy>(persistKey, groupOptions[0]);
  const by = groupOptions.includes(stored) ? stored : groupOptions[0];

  const setFort = (uid: string, v: number) =>
    update('abilities', data.abilities.map((a) => (a.uid === uid ? { ...a, fortschritt: v } : a)));

  const groups = groupAbilities(list, by);
  const cols = magisch ? 7 : 6;

  return (
    <div className="panel">
      <div className="abil-toolbar">
        <span className="muted">Gruppieren</span>
        {groupOptions.map((g) => (
          <button key={g} className={`small${by === g ? ' active' : ''}`} onClick={() => setGroupBy(g)}>
            {GROUP_LABEL[g]}
          </button>
        ))}
        <Link className="abil-werk-link" to={`/charakter/${charId}/werkstatt`}>
          Bearbeiten in der Werkstatt →
        </Link>
      </div>

      {list.length === 0 ? (
        <p className="muted">
          Noch nichts. In der <Link to={`/charakter/${charId}/werkstatt`}>Werkstatt</Link> anlegen.
        </p>
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
                  {rows.map((a) => (
                    <AbilityRow key={a.uid} a={a} magisch={magisch} attrs={data.attributes} onFort={(v) => setFort(a.uid, v)} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
