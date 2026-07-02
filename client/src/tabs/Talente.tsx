import { TALENT_KATEGORIE_LABELS } from '@shared/types';
import type { AttrCode, CharTalent, TalentKategorie } from '@shared/types';
import { erleichterung, talentProbeZahl } from '@shared/rules';
import { NumInput, TextInput } from '../components/inputs';
import { useChar } from '../pages/Character';
import type { TalentCatalogRow } from '../pages/Character';

const EMPTY: Omit<CharTalent, 'talentId'> = {
  taw: 0, at: 0, pa: 0, bl: 0, billiger: '', spezialisierung: '', waffenmeister: '', berufsbonus: '',
};

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

  return (
    <>
      {kategorien.map((kat) => {
        const entries = catalogs.talents.filter((t) => t.kategorie === kat);
        if (entries.length === 0) return null;
        return kat === 'kampf' ? (
          <KampfTable key={kat} entries={entries} values={values} setValue={setValue} />
        ) : (
          <NormalTable key={kat} kat={kat} entries={entries} values={values} setValue={setValue} />
        );
      })}
    </>
  );
}

function KampfTable({
  entries,
  values,
  setValue,
}: {
  entries: TalentCatalogRow[];
  values: Map<number, CharTalent>;
  setValue: (id: number, patch: Partial<CharTalent>) => void;
}) {
  const rows: React.ReactNode[] = [];
  let lastGruppe = '';
  for (const e of entries) {
    if (e.gruppe !== lastGruppe) {
      lastGruppe = e.gruppe;
      rows.push(
        <tr className="subtle-head" key={`g-${e.gruppe}`}>
          <td colSpan={9}>{e.gruppe}</td>
        </tr>,
      );
    }
    const v = values.get(e.id);
    rows.push(
      <tr key={e.id}>
        <td>
          {e.name}
          {e.klasse ? ` (${e.klasse})` : ''}
        </td>
        <td className="num" style={{ width: 65 }}>
          <NumInput value={v?.taw ?? 0} onChange={(x) => setValue(e.id, { taw: x })} />
        </td>
        <td className="num" style={{ width: 65 }}>
          <NumInput value={v?.at ?? 0} onChange={(x) => setValue(e.id, { at: x })} />
        </td>
        <td className="num" style={{ width: 65 }}>
          <NumInput value={v?.pa ?? 0} onChange={(x) => setValue(e.id, { pa: x })} />
        </td>
        <td className="num" style={{ width: 65 }}>
          <NumInput value={v?.bl ?? 0} onChange={(x) => setValue(e.id, { bl: x })} />
        </td>
        <td style={{ width: 90 }}>
          <TextInput value={v?.billiger ?? ''} onChange={(x) => setValue(e.id, { billiger: x })} />
        </td>
        <td style={{ width: 120 }}>
          <TextInput value={v?.spezialisierung ?? ''} onChange={(x) => setValue(e.id, { spezialisierung: x })} />
        </td>
        <td style={{ width: 120 }}>
          <TextInput value={v?.waffenmeister ?? ''} onChange={(x) => setValue(e.id, { waffenmeister: x })} />
        </td>
        <td className="muted">{e.ableiten}</td>
      </tr>,
    );
  }
  return (
    <div className="panel">
      <h3>Kampftalente (Spezialisierung: A: 20 AP, B: 40 AP, C: 60 AP, D: 80 AP, E: 100 AP, F: 150 AP)</h3>
      <table className="sheet">
        <thead>
          <tr>
            <th>Talent</th>
            <th>TaW</th>
            <th>AT</th>
            <th>PA</th>
            <th>BL</th>
            <th>Billiger</th>
            <th>Spezialisierung</th>
            <th>Waffenmeister</th>
            <th>Verwandte Fertigkeiten (+5)</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function NormalTable({
  kat,
  entries,
  values,
  setValue,
}: {
  kat: TalentKategorie;
  entries: TalentCatalogRow[];
  values: Map<number, CharTalent>;
  setValue: (id: number, patch: Partial<CharTalent>) => void;
}) {
  const { data } = useChar();
  return (
    <div className="panel">
      <h3>{TALENT_KATEGORIE_LABELS[kat]}</h3>
      <table className="sheet">
        <thead>
          <tr>
            <th>Talent</th>
            <th style={{ width: 90 }}>Probe</th>
            <th style={{ width: 90 }}>Probe (Zahl)</th>
            <th style={{ width: 65 }}>TaW</th>
            <th style={{ width: 90 }}>Erleichterung</th>
            <th style={{ width: 130 }}>Spezialisierung</th>
            <th style={{ width: 150 }}>Berufsbonus</th>
            <th>Ableiten (+10)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const v = values.get(e.id);
            const taw = v?.taw ?? 0;
            const probe = e.probe ? (e.probe.split('/') as [AttrCode, AttrCode, AttrCode]) : null;
            return (
              <tr key={e.id}>
                <td>
                  {e.gruppe ? `${e.gruppe}: ` : ''}
                  {e.name}
                  {e.klasse ? ` (${e.klasse})` : ''}
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
                <td className="muted">{e.ableiten}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
