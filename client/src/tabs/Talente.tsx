import { useState } from 'react';
import { TALENT_KATEGORIE_LABELS } from '@shared/types';
import type { AttrCode, CharTalent, TalentKategorie } from '@shared/types';
import { erleichterung, talentProbeZahl } from '@shared/rules';
import { NumInput, TextInput } from '../components/inputs';
import { ResizeHandle, useResizableColumns } from '../components/resize';
import { usePersistedState } from '../components/persist';
import { useChar } from '../pages/Character';
import type { TalentCatalogRow } from '../pages/Character';

const EMPTY: Omit<CharTalent, 'talentId'> = {
  taw: 0, at: 0, pa: 0, bl: 0, spezialisierung: '', waffenmeister: '', berufsbonus: '',
};

// Ab 100 TaW freigeschaltete Meisterschaft; Text erscheint beim Überfahren des Sterns
function Mastery({ taw, skill100 }: { taw: number; skill100: string }) {
  if (taw < 100) return null;
  return (
    <span
      className="mastery"
      title={skill100 || 'Meisterschaft ab 100 TaW freigeschaltet — noch kein Text hinterlegt.'}
    >
      ★
    </span>
  );
}

export default function TalenteTab() {
  const { data, catalogs, update } = useChar();
  const values = new Map(data.talents.map((t) => [t.talentId, t]));

  const setValue = (talentId: number, patch: Partial<CharTalent>) => {
    const existing = values.get(talentId);
    let next: CharTalent[];
    if (existing) {
      next = data.talents.map((t) => (t.talentId === talentId ? { ...t, ...patch } : t));
    } else {
      next = [...data.talents, { talentId, ...EMPTY, ...patch }];
    }
    update('talents', next);
  };

  const kategorien = Object.keys(TALENT_KATEGORIE_LABELS) as TalentKategorie[];

  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const entriesFor = (kat: TalentKategorie) =>
    catalogs.talents.filter(
      (t) => t.kategorie === kat && (!q || t.name.toLowerCase().includes(q) || t.gruppe.toLowerCase().includes(q)),
    );
  const nothing = q !== '' && kategorien.every((kat) => entriesFor(kat).length === 0);

  return (
    <>
      <div className="talent-search">
        <input type="text" placeholder="Talent suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && (
          <button className="small" onClick={() => setSearch('')} title="Suche zurücksetzen">
            ✕
          </button>
        )}
      </div>
      {kategorien.map((kat) => {
        const entries = entriesFor(kat);
        if (entries.length === 0) return null;
        return kat === 'kampf' ? (
          <KampfTable key={kat} entries={entries} values={values} setValue={setValue} searching={q !== ''} />
        ) : (
          <NormalTable key={kat} kat={kat} entries={entries} values={values} setValue={setValue} searching={q !== ''} />
        );
      })}
      {nothing && <p className="muted">Kein Talent gefunden.</p>}
    </>
  );
}

const KAMPF_HEADS = ['Talent', 'TaW', 'AT', 'PA', 'BL', 'Spezialisierung', 'Waffenmeister', 'Verwandte Fertigkeiten (+5)'];
const KAMPF_WIDTHS = [300, 70, 70, 70, 70, 220, 220, 340];

function KampfTable({
  entries,
  values,
  setValue,
  searching,
}: {
  entries: TalentCatalogRow[];
  values: Map<number, CharTalent>;
  setValue: (id: number, patch: Partial<CharTalent>) => void;
  searching: boolean;
}) {
  const { widths, startDrag } = useResizableColumns('talente-kampf', KAMPF_WIDTHS);
  // Einklappen je Waffengruppe (Hiebwaffen, Schwerter …), gemerkt; Suche zeigt alles
  const [collapsedList, setCollapsedList] = usePersistedState<string[]>('talc:kampf', []);
  const collapsed = new Set(collapsedList);
  const toggleGroup = (g: string) =>
    setCollapsedList((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  const rows: React.ReactNode[] = [];
  let lastGruppe = '';
  for (const e of entries) {
    const groupCollapsed = !searching && collapsed.has(e.gruppe);
    if (e.gruppe !== lastGruppe) {
      lastGruppe = e.gruppe;
      rows.push(
        <tr
          className="subtle-head clickable"
          key={`g-${e.gruppe}`}
          onClick={() => toggleGroup(e.gruppe)}
          title={groupCollapsed ? 'Waffengruppe ausklappen' : 'Waffengruppe einklappen'}
        >
          <td colSpan={9}>
            <span className="sticky-label">
              <span className="chev" aria-hidden>{groupCollapsed ? '▸' : '▾'}</span> {e.gruppe}
            </span>
          </td>
        </tr>,
      );
    }
    if (groupCollapsed) continue;
    const v = values.get(e.id);
    rows.push(
      <tr key={e.id}>
        <td title={e.name}>
          {e.name}
          <Mastery taw={v?.taw ?? 0} skill100={e.skill100} />
        </td>
        <td className="num">
          <NumInput value={v?.taw ?? 0} onChange={(x) => setValue(e.id, { taw: x })} />
        </td>
        <td className="num">
          <NumInput value={v?.at ?? 0} onChange={(x) => setValue(e.id, { at: x })} />
        </td>
        <td className="num">
          <NumInput value={v?.pa ?? 0} onChange={(x) => setValue(e.id, { pa: x })} />
        </td>
        <td className="num">
          <NumInput value={v?.bl ?? 0} onChange={(x) => setValue(e.id, { bl: x })} />
        </td>
        <td>
          <TextInput value={v?.spezialisierung ?? ''} onChange={(x) => setValue(e.id, { spezialisierung: x })} />
        </td>
        <td>
          <TextInput value={v?.waffenmeister ?? ''} onChange={(x) => setValue(e.id, { waffenmeister: x })} />
        </td>
        <td className="muted" title={e.ableiten}>
          {e.ableiten}
        </td>
      </tr>,
    );
  }
  return (
    <div className="panel">
      <h3>Kampftalente</h3>
      <div className="table-wrap">
        <table className="sheet" style={{ tableLayout: 'fixed', minWidth: widths.reduce((s, w) => s + w, 0) }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {KAMPF_HEADS.map((h, i) => (
                <th key={h} title={h}>
                  {h}
                  <ResizeHandle index={i} startDrag={startDrag} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}

function NormalTable({
  kat,
  entries,
  values,
  setValue,
  searching,
}: {
  kat: TalentKategorie;
  entries: TalentCatalogRow[];
  values: Map<number, CharTalent>;
  setValue: (id: number, patch: Partial<CharTalent>) => void;
  searching: boolean;
}) {
  const { data } = useChar();
  // Ganze Kategorie einklappen (gemerkt); während einer Suche immer offen
  const [collapsed, setCollapsed] = usePersistedState<boolean>(`talc:cat:${kat}`, false);
  const open = searching || !collapsed;
  const heads = ['Talent', 'Probe', 'Probe (Zahl)', 'TaW', 'Erleichterung', 'Spezialisierung', 'Berufsbonus', 'Ableiten (+10)'];
  const { widths, startDrag } = useResizableColumns(`talente-${kat}`, [220, 95, 95, 70, 100, 140, 170, 260]);
  return (
    <div className="panel">
      <h3
        className="collapsible"
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        title={open ? 'Kategorie einklappen' : 'Kategorie ausklappen'}
      >
        {TALENT_KATEGORIE_LABELS[kat]}
        <span className="head-rule" aria-hidden />
        <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
      </h3>
      {open && (
      <div className="table-wrap">
        <table className="sheet" style={{ tableLayout: 'fixed', minWidth: widths.reduce((s, w) => s + w, 0) }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={h} title={h}>
                  {h}
                  <ResizeHandle index={i} startDrag={startDrag} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const v = values.get(e.id);
              const taw = v?.taw ?? 0;
              const probe = e.probe ? (e.probe.split('/') as [AttrCode, AttrCode, AttrCode]) : null;
              const name = `${e.gruppe ? `${e.gruppe}: ` : ''}${e.name}`;
              return (
                <tr key={e.id}>
                  <td title={name}>
                    {name}
                    <Mastery taw={taw} skill100={e.skill100} />
                  </td>
                  <td className="muted">{e.probe || '—'}</td>
                  <td className="computed">{probe ? talentProbeZahl(data.attributes, probe, taw) : '—'}</td>
                  <td className="num">
                    <NumInput value={taw} onChange={(x) => setValue(e.id, { taw: x })} />
                  </td>
                  <td className="computed">{erleichterung(taw)}</td>
                  <td>
                    <TextInput value={v?.spezialisierung ?? ''} onChange={(x) => setValue(e.id, { spezialisierung: x })} />
                  </td>
                  <td>
                    <TextInput value={v?.berufsbonus ?? ''} onChange={(x) => setValue(e.id, { berufsbonus: x })} />
                  </td>
                  <td className="muted" title={e.ableiten}>
                    {e.ableiten}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
