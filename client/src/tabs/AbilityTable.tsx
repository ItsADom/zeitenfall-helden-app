import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Ability, Attributes } from '@shared/abilities';
import { groupAbilities } from '@shared/abilities';
import { probeExprHasWeaponTerm, probeExprZahl } from '@shared/rules';
import { AlwaysEditable } from '../components/displayMode';
import AbilityWeaponRollButton from '../components/dice/AbilityWeaponRollButton';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import { FavPin } from '../components/FavPin';
import { Field, NumInput } from '../components/inputs';
import { CollapsedText } from '../components/notes';
import { usePersistedState } from '../components/persist';
import { useChar } from '../pages/Character';

// Gemeinsame Ansicht für die Reiter „Zauber" und „Fähigkeiten": eine reine
// Anzeige auf die Stammliste (verwaltet unter „Zauber & Fähigkeiten verwalten").
// Alles außer dem Fortschritt wird nur dargestellt; der Fortschritt ist auch im
// Nur-Lesen-Modus editierbar, weil er im Spiel oft angefasst wird. Suchen,
// Filtern, Sortieren und Gruppieren helfen, wenn die Liste groß wird.

export type GroupBy = 'element' | 'kategorie';
// Gruppierung inklusive „keine" — dann läuft die Liste flach durch.
type Grouping = GroupBy | 'none';
const GROUP_LABEL: Record<GroupBy, string> = { element: 'Element', kategorie: 'Kategorie' };
const GROUP_NONE: Record<GroupBy, string> = { element: 'Ohne Element', kategorie: 'Ohne Kategorie' };

type SortBy = '' | 'name' | 'stufe' | 'fortschritt';
const SORT_LABEL: Record<Exclude<SortBy, ''>, string> = { name: 'Name', stufe: 'Stufe', fortschritt: 'Fortschritt' };
const SORT_ORDER: SortBy[] = ['', 'name', 'stufe', 'fortschritt'];

export function AbilityTable({
  magisch,
  persistKey,
  groupOptions,
  listSortLabel = 'Nach Liste',
}: {
  magisch: boolean;
  persistKey: string;
  groupOptions: GroupBy[];
  listSortLabel?: string;
}) {
  const { data, update, charId } = useChar();
  const list = data.abilities.filter((a) => a.magisch === magisch);
  // Voreinstellung: keine Gruppierung — die Liste läuft flach durch. Wer aktiv
  // eine Gruppierung wählt, behält sie (persistiert je Nutzer).
  const [stored, setGroupBy] = usePersistedState<Grouping>(`${persistKey}:group`, 'none');
  const by: Grouping = stored === 'none' || groupOptions.includes(stored as GroupBy) ? stored : 'none';

  const [q, setQ] = useState('');
  const [fEl, setFEl] = useState('');
  const [fKat, setFKat] = useState('');
  const [fPassiv, setFPassiv] = useState<'' | 'passiv' | 'aktiv'>('');
  const [sort, setSort] = useState<SortBy>('');

  const setFort = (uid: string, v: number) =>
    update('abilities', data.abilities.map((a) => (a.uid === uid ? { ...a, fortschritt: v } : a)));
  const setFavorit = (uid: string, v: boolean) =>
    update('abilities', data.abilities.map((a) => (a.uid === uid ? { ...a, favorit: v } : a)));

  const elemente = [...new Set(list.map((a) => a.element).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const kategorien = [...new Set(list.flatMap((a) => a.kategorien).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  const needle = q.trim().toLowerCase();
  // Suchen hat Vorrang und ignoriert die Auswahlfilter — man sucht im ganzen
  // Bestand, nicht nur im gerade gefilterten Ausschnitt.
  const filtered = list.filter((a) => {
    if (needle) return a.name.toLowerCase().includes(needle) || a.effekt.toLowerCase().includes(needle) || a.notiz.toLowerCase().includes(needle);
    if (fEl && a.element !== fEl) return false;
    if (fKat && !a.kategorien.includes(fKat)) return false;
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

  // Der Signatur-Zauber (meistgenutzt) steht immer ganz oben — solange er im
  // aktuellen Filter überhaupt sichtbar ist. Er wird aus den Gruppen herausgelöst
  // und als angeheftete Zeile über allem gezeigt (nicht scroll-klebend).
  const sig = filtered.find((a) => a.signatur);
  const rest = sig ? filtered.filter((a) => a.uid !== sig.uid) : filtered;
  const groups = by === 'none' ? null : groupAbilities(rest, by);
  const cols = magisch ? 7 : 6;
  const filtering = needle !== '' || fEl !== '' || fKat !== '' || fPassiv !== '';

  return (
    <div className="panel">
      <div className="abil-controls">
      <div className="abil-toolbar">
        <Field label="Suchen" className="notch-search" active={needle !== ''}>
          <input type="text" placeholder="Name, Effekt…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {magisch && elemente.length > 0 && (
          <Field label="Element" active={fEl !== ''}>
            <select value={fEl} onChange={(e) => setFEl(e.target.value)} title="Nach Element filtern">
              <option value="">alle Elemente</option>
              {elemente.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kategorien.length > 0 && (
          <Field label="Kategorie" active={fKat !== ''}>
            <select value={fKat} onChange={(e) => setFKat(e.target.value)} title="Nach Kategorie filtern">
              <option value="">Alle Kategorien</option>
              {kategorien.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Aktiv/Passiv" active={fPassiv !== ''}>
          <select value={fPassiv} onChange={(e) => setFPassiv(e.target.value as '' | 'passiv' | 'aktiv')} title="Passiv/aktiv">
            <option value="">Alle</option>
            <option value="aktiv">Nur aktive</option>
            <option value="passiv">Nur passive</option>
          </select>
        </Field>
        <Field label="Sortieren" className="notch-sort" active={sort !== ''}>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortBy)} title="Sortieren nach">
            {SORT_ORDER.map((s) => (
              <option key={s} value={s}>
                {s === '' ? listSortLabel : `Nach ${SORT_LABEL[s]}`}
              </option>
            ))}
          </select>
        </Field>
        {filtering && (
          <button
            className="small"
            title="Filter zurücksetzen"
            onClick={() => {
              setQ('');
              setFEl('');
              setFKat('');
              setFPassiv('');
            }}
          >
            ✕
          </button>
        )}
        <Link className="abil-werk-link" to={`/charakter/${charId}/zauber-faehigkeiten?from=${magisch ? 'Zauber' : 'Fähigkeiten'}`}>
          Liste bearbeiten →
        </Link>
      </div>

      <div className="abil-grouprow">
        <span className="muted">Gruppierung nach: </span>
        {groupOptions.map((g) => (
          <button
            key={g}
            className={`small${by === g ? ' active' : ''}`}
            title={by === g ? 'Gruppierung aufheben' : `Nach ${GROUP_LABEL[g]} gruppieren`}
            // Nochmal auf die aktive Gruppierung klicken hebt sie auf (flache Liste).
            onClick={() => setGroupBy(by === g ? 'none' : g)}
          >
            {GROUP_LABEL[g]}
          </button>
        ))}
      </div>
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
                <th className="num">Kosten</th>
                <th>Probe</th>
                <th className="num">Fortschritt</th>
                <th>Effekt</th>
              </tr>
            </thead>
            <tbody>
              {sig && (
                <AbilityRow key={sig.uid} a={sig} magisch={magisch} attrs={data.attributes} pinned onFort={(v) => setFort(sig.uid, v)} onFavorit={(v) => setFavorit(sig.uid, v)} />
              )}
              {by === 'none'
                ? [...rest].sort(sortFn).map((a) => (
                    <AbilityRow key={a.uid} a={a} magisch={magisch} attrs={data.attributes} onFort={(v) => setFort(a.uid, v)} onFavorit={(v) => setFavorit(a.uid, v)} />
                  ))
                : [...groups!.entries()].map(([key, rows]) => (
                    <Fragment key={key || '__none'}>
                      <tr className="subtle-head">
                        <td colSpan={cols}>
                          <span className="sticky-label">
                            {key || GROUP_NONE[by]} <span className="muted">· {rows.length}</span>
                          </span>
                        </td>
                      </tr>
                      {[...rows].sort(sortFn).map((a) => (
                        <AbilityRow key={a.uid} a={a} magisch={magisch} attrs={data.attributes} onFort={(v) => setFort(a.uid, v)} onFavorit={(v) => setFavorit(a.uid, v)} />
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

function AbilityRow({
  a,
  magisch,
  attrs,
  onFort,
  onFavorit,
  pinned,
}: {
  a: Ability;
  magisch: boolean;
  attrs: Attributes;
  onFort: (v: number) => void;
  onFavorit: (v: boolean) => void;
  pinned?: boolean;
}) {
  const pz = probeExprZahl(attrs, a.probe);
  const needsWeapon = probeExprHasWeaponTerm(a.probe);
  return (
    <tr className={pinned ? 'abil-pinned' : undefined}>
      <td>
        {a.signatur && <span className="abil-sig-star" title="Signatur-Zauber">★</span>}
        <span className="abil-name">{a.name || '—'}</span>
        {a.passiv && <span className="abil-badge">passiv</span>}
      </td>
      <td className="num">{a.stufe}</td>
      {magisch && <td className="num">{a.komplexitaet}</td>}
      <td className="num">{a.kosten}</td>
      <td className="abil-probe">
        {a.probe}
        {needsWeapon ? (
          <AbilityWeaponRollButton abilityId={a.id} title={a.name} />
        ) : (
          pz != null && (
            <>
              <span className="muted"> ({pz})</span>
              <ProbeRollButton source={{ kind: 'ability', abilityId: a.id }} title={a.name} />
            </>
          )
        )}
        <AlwaysEditable>
          <FavPin active={a.favorit} onClick={() => onFavorit(!a.favorit)} />
        </AlwaysEditable>
      </td>
      <td className="num">
        <AlwaysEditable>
          <NumInput value={a.fortschritt} min={0} onChange={onFort} />
        </AlwaysEditable>
      </td>
      <td className="abil-effekt">
        {a.effekt}
        <CollapsedText text={a.notiz} className="abil-note muted" />
      </td>
    </tr>
  );
}
