import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from '@shared/types';
import type { AttrRowCode, BaseValueKey, ResourceKey } from '@shared/types';
import { Fragment, useState } from 'react';
import { computeBaseValues, computeResource, levelForAp, mrErgebnis, nextLevelAp, psycheProzent } from '@shared/rules';
import { NumInput, TextInput } from '../components/inputs';
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

// Münzen mit Metall-Farbwelt: Dukaten (Gold), Silbertaler (Silber),
// Heller (Bronze), Kreuzer (Eisen)
const COIN_FIELDS: [string, string, string][] = [
  ['geldD', 'Dukaten', 'gold'],
  ['geldS', 'Silbertaler', 'silver'],
  ['geldH', 'Heller', 'bronze'],
  ['geldK', 'Kreuzer', 'iron'],
];

const META_FIELDS: [string, string][] = [
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

  // Stufe wird aus den Abenteuerpunkten abgeleitet
  const ap = meta.ap ?? 0;
  const guthaben = meta.apGuthaben ?? 0;
  const level = levelForAp(ap);
  const nextAp = nextLevelAp(ap);

  const [apDelta, setApDelta] = useState('');
  const [guthabenDelta, setGuthabenDelta] = useState('');

  // Erfahrungsgewinn: erhöht Abenteuerpunkte UND Guthaben (nur positiv)
  const addAp = () => {
    const x = Math.floor(Number(apDelta) || 0);
    if (x <= 0) return;
    update('meta', { ...meta, ap: ap + x, apGuthaben: guthaben + x });
    setApDelta('');
  };
  // Guthaben ausgeben/anpassen: verändert nur das Guthaben (auch negativ)
  const adjustGuthaben = () => {
    const x = Math.floor(Number(guthabenDelta) || 0);
    if (x === 0) return;
    update('meta', { ...meta, apGuthaben: guthaben + x });
    setGuthabenDelta('');
  };

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
        <table className="sheet" style={{ minWidth: 900 }}>
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
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((key) => {
              const r = computeResource(attributes, key, resources[key]);
              // Zehrung nur für die vitalen Pools (LE/AU); AsP-Ruhezustand 0
              // wäre bei Nicht-Zauberern nur Dauer-Rot, MR ist kein Pool
              const akt = resources[key].aktuell;
              const tracksDepletion = key === 'le' || key === 'aus';
              const ratio = tracksDepletion && r.ergebnis > 0 ? akt / r.ergebnis : 1;
              const depl = ratio <= 0.25 ? 'res-crit' : ratio <= 0.5 ? 'res-low' : '';
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
                  <td className={depl || undefined} title={depl ? `${Math.round(ratio * 100)} % — ${akt}/${r.ergebnis}` : undefined}>
                    <NumInput value={akt} onChange={(v) => setResource(key, 'aktuell', v)} />
                  </td>
                  <td className="computed">{r.max ?? '—'}</td>
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
          <div className="level-banner">
            <div className="level-badge">
              <span className="level-num">{level}</span>
            </div>
            <div className="level-next">
              {nextAp == null ? (
                <div>Maximale Stufe erreicht</div>
              ) : (
                <>
                  <div>
                    Nächste Stufe bei <strong>{nextAp.toLocaleString('de-DE')}</strong> AP
                  </div>
                  <div className="muted">noch {(nextAp - ap).toLocaleString('de-DE')} AP</div>
                </>
              )}
            </div>
          </div>
          <div className="points-grid">
            <label>Abenteuerpunkte</label>
            <input
              type="number"
              value={apDelta}
              placeholder="+ Menge"
              onChange={(e) => setApDelta(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAp()}
            />
            <div className="pctrl">
              <button className="btn-action" disabled={!apDelta} onClick={addAp} title="Erfahrung gewinnen: erhöht Abenteuerpunkte und Guthaben">
                Hinzufügen
              </button>
              <span className="muted">Stand:</span>
              <span className="pnum">{ap.toLocaleString('de-DE')}</span>
            </div>

            <label>AP-Guthaben</label>
            <input
              type="number"
              value={guthabenDelta}
              placeholder="± Menge"
              onChange={(e) => setGuthabenDelta(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adjustGuthaben()}
            />
            <div className="pctrl">
              <button className="btn-action" disabled={!guthabenDelta} onClick={adjustGuthaben} title="Guthaben ausgeben oder anpassen (auch negativ)">
                Anpassen
              </button>
              <span className="muted">Stand:</span>
              <span className="pnum">{guthaben.toLocaleString('de-DE')}</span>
            </div>

            {META_FIELDS.map(([key, label]) => (
              <Fragment key={key}>
                <label>{label}</label>
                <NumInput value={meta[key] ?? 0} onChange={(v) => setMeta(key, v)} />
                <span />
              </Fragment>
            ))}

            <label>Psyche (akt/max)</label>
            <NumInput value={meta.psycheAkt ?? 0} onChange={(v) => setMeta('psycheAkt', v)} />
            <div className="pctrl">
              <span>/</span>
              <NumInput value={meta.psycheMax ?? 0} onChange={(v) => setMeta('psycheMax', v)} width={120} />
              <span className="computed" style={{ padding: '2px 10px' }}>
                {psyche == null ? '—' : `${Math.round(psyche)}%`}
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Geld</h3>
          <div className="coins">
            {COIN_FIELDS.map(([key, label, tone]) => (
              <div className={`coin coin-${tone}`} key={key}>
                <span className="coin-disc" aria-hidden />
                <label>{label}</label>
                <NumInput value={meta[key] ?? 0} onChange={(v) => setMeta(key, v)} />
              </div>
            ))}
          </div>
          <div className="coin coin-bank">
            <span className="coin-disc" aria-hidden />
            <label>Bank</label>
            <NumInput value={meta.bank ?? 0} onChange={(v) => setMeta('bank', v)} />
          </div>
        </div>
      </div>
    </>
  );
}
