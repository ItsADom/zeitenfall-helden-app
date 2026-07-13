import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from '@shared/types';
import type { AttrRowCode, BaseValueKey, ResourceKey } from '@shared/types';
import { computeBaseValues, computeResource, mrErgebnis, psycheProzent } from '@shared/rules';
import { listSectionById } from '@shared/sections';
import { ListEditor, NumInput, TextInput } from '../components/inputs';
import { useChar } from '../pages/Character';

const BIO_FIELDS: [string, string][] = [
  ['alterGeburtstag', 'Alter/Geburtstag'],
  ['geschlecht', 'Geschlecht'],
  ['groesse', 'Größe'],
  ['gewicht', 'Gewicht'],
  ['augenfarbe', 'Augenfarbe'],
  ['haarfarbe', 'Haarfarbe'],
  ['hautfarbe', 'Hautfarbe'],
  ['familienstand', 'Familienstand'],
  ['anrede', 'Anrede'],
  ['rasse', 'Rasse'],
  ['rasseMod', 'Modifikationen (Rasse)'],
  ['kultur', 'Kultur'],
  ['kulturMod', 'Modifikationen (Kultur)'],
  ['profession', 'Profession'],
  ['zweitprofession', 'Zweitprofession'],
  ['gottheit', 'Gottheit'],
  ['goettergeschenke', 'Göttergeschenke'],
];

const META_FIELDS: [string, string][] = [
  ['stufe', 'Stufe'],
  ['ap', 'Abenteuerpunkte'],
  ['apNextLevel', 'Next Level'],
  ['apGuthaben', 'AP-Guthaben'],
  ['karma', 'Karma'],
  ['karmaGuthaben', 'Karma-Guthaben'],
  ['ruf', 'Ruf'],
];

export default function HeldenbriefTab() {
  const { data, update } = useChar();
  const { attributes, baseValues, resources, bio, meta } = data;

  const mr = mrErgebnis(attributes, resources);
  const bv = computeBaseValues(attributes, baseValues, mr);
  const psyche = psycheProzent(meta.psycheAkt, meta.psycheMax);

  const setAttr = (code: AttrRowCode, field: 'akt' | 'mod', v: number) =>
    update('attributes', { ...attributes, [code]: { ...attributes[code], [field]: v } });
  const setBvMod = (key: BaseValueKey, v: number) => update('baseValues', { ...baseValues, mods: { ...baseValues.mods, [key]: v } });
  const setResource = (key: ResourceKey, field: string, v: unknown) =>
    update('resources', { ...resources, [key]: { ...resources[key], [field]: v } });
  const setBio = (key: string, v: string) => update('bio', { ...bio, [key]: v });
  const setMeta = (key: string, v: number) => update('meta', { ...meta, [key]: v });

  return (
    <>
      <div className="panel">
        <h3>Person</h3>
        <div className="grid3">
          {BIO_FIELDS.map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <TextInput value={bio[key] ?? ''} onChange={(v) => setBio(key, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Attribute</h3>
          <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>Attribut</th>
                <th style={{ width: 70 }}>Akt.</th>
                <th style={{ width: 70 }}>Mod.</th>
                <th style={{ width: 70 }}>Max</th>
              </tr>
            </thead>
            <tbody>
              {ATTR_ROW_CODES.map((code) => (
                <tr key={code}>
                  <td>{ATTR_LABELS[code]}</td>
                  <td>
                    <NumInput value={attributes[code].akt} onChange={(v) => setAttr(code, 'akt', v)} />
                  </td>
                  <td>
                    <NumInput value={attributes[code].mod} onChange={(v) => setAttr(code, 'mod', v)} />
                  </td>
                  <td className="computed">{attributes[code].akt + attributes[code].mod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        <div className="panel">
          <h3>Basiswerte</h3>
          <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>Wert</th>
                <th>Formel</th>
                <th style={{ width: 60 }}>Basis</th>
                <th style={{ width: 70 }}>Mod.</th>
                <th style={{ width: 70 }}>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {BASE_VALUE_KEYS.map((key) => (
                <tr key={key}>
                  <td>{BASE_VALUE_LABELS[key].label}</td>
                  <td className="formel">{BASE_VALUE_LABELS[key].formel}</td>
                  <td className={key === 'gs' ? 'num' : 'computed'}>
                    {key === 'gs' ? (
                      <NumInput value={baseValues.gsBase} onChange={(v) => update('baseValues', { ...baseValues, gsBase: v })} />
                    ) : (
                      bv[key].base
                    )}
                  </td>
                  <td>
                    <NumInput value={baseValues.mods[key]} onChange={(v) => setBvMod(key, v)} />
                  </td>
                  <td className="computed">{bv[key].ergebnis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Energien</h3>
        <div className="table-wrap">
        <table className="sheet" style={{ minWidth: 1050 }}>
          <thead>
            <tr>
              <th>Energie</th>
              <th>Formel</th>
              <th style={{ width: 80 }}>Vorergebnis</th>
              <th style={{ width: 80 }}>Permanent</th>
              <th style={{ width: 80 }}>Kauf</th>
              <th style={{ width: 80 }}>Kauf-Max</th>
              <th style={{ width: 80 }}>Max+</th>
              <th style={{ width: 80 }}>Ergebnis</th>
              <th style={{ width: 80 }}>Aktuell</th>
              <th style={{ width: 80 }}>Max</th>
              <th>Besonderes</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((key) => {
              const r = computeResource(attributes, key, resources[key]);
              return (
                <tr key={key}>
                  <td>{RESOURCE_LABELS[key].label}</td>
                  <td className="formel">{RESOURCE_LABELS[key].formel}</td>
                  <td className="computed">{r.vorergebnis}</td>
                  <td>
                    <NumInput value={resources[key].permanent} onChange={(v) => setResource(key, 'permanent', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kauf} onChange={(v) => setResource(key, 'kauf', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kaufMax} onChange={(v) => setResource(key, 'kaufMax', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].maxPlus} onChange={(v) => setResource(key, 'maxPlus', v)} />
                  </td>
                  <td className="computed">{r.ergebnis}</td>
                  <td>
                    <NumInput value={resources[key].aktuell} onChange={(v) => setResource(key, 'aktuell', v)} />
                  </td>
                  <td className="computed">{r.max ?? '—'}</td>
                  <td>
                    <TextInput value={resources[key].besonderes} onChange={(v) => setResource(key, 'besonderes', v)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Stufe &amp; Punkte</h3>
          {META_FIELDS.map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <NumInput value={meta[key] ?? 0} onChange={(v) => setMeta(key, v)} width={120} />
            </div>
          ))}
          <div className="field">
            <label>Psyche (akt/max)</label>
            <NumInput value={meta.psycheAkt ?? 0} onChange={(v) => setMeta('psycheAkt', v)} width={80} />
            <NumInput value={meta.psycheMax ?? 0} onChange={(v) => setMeta('psycheMax', v)} width={80} />
            <span className="computed" style={{ padding: '2px 8px' }}>
              {psyche == null ? '—' : `${Math.round(psyche)}%`}
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>Geld</h3>
          <div className="field">
            <label>Dukaten</label>
            <NumInput value={meta.geldD ?? 0} onChange={(v) => setMeta('geldD', v)} width={100} />
          </div>
          <div className="field">
            <label>Silbertaler</label>
            <NumInput value={meta.geldS ?? 0} onChange={(v) => setMeta('geldS', v)} width={100} />
          </div>
          <div className="field">
            <label>Heller</label>
            <NumInput value={meta.geldH ?? 0} onChange={(v) => setMeta('geldH', v)} width={100} />
          </div>
          <div className="field">
            <label>Kreuzer</label>
            <NumInput value={meta.geldK ?? 0} onChange={(v) => setMeta('geldK', v)} width={100} />
          </div>
          <div className="field">
            <label>Bank</label>
            <NumInput value={meta.bank ?? 0} onChange={(v) => setMeta('bank', v)} width={100} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Vorteile</h3>
        <ListEditor def={listSectionById('vorteile')!} rows={data.lists.vorteile} onChange={(rows) => update('vorteile', rows)} />
        <h3>Nachteile</h3>
        <ListEditor def={listSectionById('nachteile')!} rows={data.lists.nachteile} onChange={(rows) => update('nachteile', rows)} />
        <h3>Titel / Orden</h3>
        <ListEditor def={listSectionById('titel')!} rows={data.lists.titel} onChange={(rows) => update('titel', rows)} />
      </div>

      <div className="panel">
        <h3>20+ Perks</h3>
        <ListEditor def={listSectionById('perks')!} rows={data.lists.perks} onChange={(rows) => update('perks', rows)} />
      </div>

      <div className="panel">
        <h3>Professionsboni</h3>
        <ListEditor def={listSectionById('professionBoni')!} rows={data.lists.professionBoni} onChange={(rows) => update('professionBoni', rows)} />
      </div>
    </>
  );
}
