import { useState } from 'react';
import { TALENT_KATEGORIE_LABELS } from '@shared/types';
import type { AttrCode, CharTalent, TalentKategorie } from '@shared/types';
import { erleichterung, talentProbeZahl } from '@shared/rules';
import { attrsMitBoni, talentBonusKey, talentMitBoni, talentProbeBonus } from '@shared/items';
import { CollapsiblePanel } from '../components/collapse';
import { BonusWert } from '../components/BonusWert';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import { Field, NumInput, TextInput } from '../components/inputs';
import { NoteField } from '../components/notes';
import { ColumnDivider, TableTools, useTableLayout } from '../components/tableLayout';
import { usePersistedState } from '../components/persist';
import { useSearchHeight } from '../components/stickyChrome';
import { useChar } from '../pages/Character';
import type { TalentCatalogRow } from '../pages/Character';

const EMPTY: Omit<CharTalent, 'talentId'> = {
  taw: 0, at: 0, pa: 0, bl: 0, spezialisierung: '', waffenmeister: '', berufsbonus: '', notiz: '',
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
  // Die Suchleiste klebt selbst oben — die Tabellenköpfe müssen sich darunter
  // einreihen, also ihre Höhe messen.
  const searchRef = useSearchHeight();
  const q = search.trim().toLowerCase();
  const entriesFor = (kat: TalentKategorie) =>
    catalogs.talents.filter(
      (t) => t.kategorie === kat && (!q || t.name.toLowerCase().includes(q) || t.gruppe.toLowerCase().includes(q)),
    );
  const nothing = q !== '' && kategorien.every((kat) => entriesFor(kat).length === 0);

  return (
    <>
      <div className="talent-search" ref={searchRef}>
        <Field label="Talent suchen" className="notch-search" active={search !== ''}>
          <input type="text" placeholder="Name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
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

const KAMPF_HEADS = ['Talent', 'TaW', 'AT', 'PA', 'BL', 'Spezialisierung', 'Waffenmeister', 'Verwandte Fertigkeiten (+5)', 'Notiz'];
const KAMPF_WIDTHS = [300, 70, 70, 70, 70, 220, 220, 340, 200];

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
  const { stats } = useChar();
  const layout = useTableLayout('talente:kampf', KAMPF_HEADS.length, { defaults: KAMPF_WIDTHS });
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
          <td colSpan={10}>
            <span className="sticky-label">
              <span className="chev" aria-hidden>{groupCollapsed ? '▸' : '▾'}</span> {e.gruppe}
            </span>
          </td>
        </tr>,
      );
    }
    if (groupCollapsed) continue;
    const v = values.get(e.id);
    // Nur fürs Meisterschafts-Schwellwert-Symbol — die Eingaben binden weiter
    // an v (roh), siehe talentMitBoni-Vertrag in shared/src/items.ts.
    const effTaw = talentMitBoni(v ?? { talentId: e.id, ...EMPTY }, stats).taw;
    rows.push(
      <tr key={e.id}>
        <td title={e.name}>
          {e.name}
          <Mastery taw={effTaw} skill100={e.skill100} />
        </td>
        <td className="num">
          <NumInput value={v?.taw ?? 0} max={100} onChange={(x) => setValue(e.id, { taw: x })} />
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
        <td>
          <NoteField value={v?.notiz ?? ''} onChange={(x) => setValue(e.id, { notiz: x })} />
        </td>
      </tr>,
    );
  }
  return (
    <CollapsiblePanel collapseKey="talente:kampf" title="Kampftalente" rows={entries.length}>
      <>
        <TableTools layout={layout} label="Kampftalente" />
        <div className="table-wrap">
            <table
              ref={layout.tableRef}
              className="sheet"
              style={{ tableLayout: 'fixed', width: '100%', minWidth: KAMPF_HEADS.length * 64 }}
            >
              <colgroup>
                {KAMPF_HEADS.map((h, i) => (
                  <col key={h} style={{ width: layout.colWidth(i) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {KAMPF_HEADS.map((h, i) => (
                    <th key={h} title={h}>
                      {h}
                      {i < KAMPF_HEADS.length - 1 && <ColumnDivider layout={layout} index={i} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
        </div>
      </>
    </CollapsiblePanel>
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
  const { data, stats } = useChar();
  const attributesEff = attrsMitBoni(data.attributes, stats);
  const heads = ['Talent', 'Probe', 'Probe (Zahl)', 'TaW', 'Erleichterung', 'Spezialisierung', 'Berufsbonus', 'Ableiten (+10)', 'Notiz'];
  const layout = useTableLayout(`talente:${kat}`, heads.length, { defaults: [220, 95, 95, 70, 100, 140, 170, 260, 200] });
  return (
    <CollapsiblePanel
      collapseKey={`talente:${kat}`}
      title={TALENT_KATEGORIE_LABELS[kat]}
      rows={entries.length}
      forceOpen={searching}
    >
      <>
      <TableTools layout={layout} label={TALENT_KATEGORIE_LABELS[kat]} />
      <div className="table-wrap">
        <table ref={layout.tableRef} className="sheet" style={{ tableLayout: 'fixed', width: '100%', minWidth: heads.length * 64 }}>
          <colgroup>
            {heads.map((h, i) => (
              <col key={h} style={{ width: layout.colWidth(i) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={h} title={h}>
                  {h}
                  {i < heads.length - 1 && <ColumnDivider layout={layout} index={i} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const v = values.get(e.id);
              const taw = v?.taw ?? 0;
              // effTaw fließt NUR in die Anzeige (Meisterschaft, Probe-Zahl,
              // Erleichterung) — die NumInput unten bindet weiter an taw (roh).
              const effTaw = talentMitBoni(v ?? { talentId: e.id, ...EMPTY }, stats).taw;
              const probe = e.probe ? (e.probe.split('/') as [AttrCode, AttrCode, AttrCode]) : null;
              const name = `${e.gruppe ? `${e.gruppe}: ` : ''}${e.name}`;
              return (
                <tr key={e.id}>
                  <td title={name}>
                    {name}
                    <Mastery taw={effTaw} skill100={e.skill100} />
                  </td>
                  <td className="muted">{e.probe || '—'}</td>
                  <td className="computed">
                    {probe ? (
                      <>
                        <BonusWert
                          quellen={[
                            ...new Set([
                              ...(stats.quellen[talentBonusKey(e.id, 'taw')] ?? []),
                              ...(stats.quellen[talentBonusKey(e.id, 'probe')] ?? []),
                            ]),
                          ]}
                        >
                          {talentProbeZahl(attributesEff, probe, effTaw) + talentProbeBonus(e.id, stats)}
                        </BonusWert>
                        {/* Kampftalente haben keine Formel und damit keine Probe —
                            sie werden über den Waffen-Reiter gewürfelt. */}
                        <ProbeRollButton source={{ kind: 'talent', talentId: e.id }} title={e.name} />
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">
                    <NumInput value={taw} max={100} onChange={(x) => setValue(e.id, { taw: x })} />
                  </td>
                  <td className="computed">{erleichterung(effTaw)}</td>
                  <td>
                    <TextInput value={v?.spezialisierung ?? ''} onChange={(x) => setValue(e.id, { spezialisierung: x })} />
                  </td>
                  <td>
                    <TextInput value={v?.berufsbonus ?? ''} onChange={(x) => setValue(e.id, { berufsbonus: x })} />
                  </td>
                  <td className="muted" title={e.ableiten}>
                    {e.ableiten}
                  </td>
                  <td>
                    <NoteField value={v?.notiz ?? ''} onChange={(x) => setValue(e.id, { notiz: x })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
    </CollapsiblePanel>
  );
}
