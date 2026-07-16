import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  RESOURCE_COLUMN_LABELS as RC,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from '@shared/types';
import type { ResourceKey } from '@shared/types';
import { computeBaseValues, computeResource, levelForAp, nextLevelAp, psycheProzent } from '@shared/rules';
import { depletionClass } from '../components/energie';
import { GeldPanel } from '../components/GeldPanel';
import { NumInput } from '../components/inputs';
import { useChar } from '../pages/Character';

// Alles Wichtige auf einen Blick, ohne Formeln und Zwischenwerte. Editierbar
// ist genau das, was sich im Spiel ständig bewegt: aktuelle Energien, Psyche
// und Geld. Der Rest wird im Heldenbrief gepflegt.

const de = (v: number) => v.toLocaleString('de-DE');

export default function UebersichtTab() {
  const { data, update } = useChar();
  const { attributes, baseValues, resources, meta } = data;

  const bv = computeBaseValues(attributes, baseValues);

  const ap = meta.ap ?? 0;
  const level = levelForAp(ap);
  const nextAp = nextLevelAp(ap);
  const psycheAkt = meta.psycheAkt ?? 0;
  const psycheMax = meta.psycheMax ?? 0;
  const psyche = psycheProzent(psycheAkt, psycheMax);

  const setAktuell = (key: ResourceKey, v: number) =>
    update('resources', { ...resources, [key]: { ...resources[key], aktuell: v } });
  const setMeta = (key: string, v: number) => update('meta', { ...meta, [key]: v });

  return (
    <>
      <div className="level-banner">
        <div className="level-badge">
          <span className="level-num">{level}</span>
        </div>
        <div className="level-next">
          <div>
            <strong>{de(ap)}</strong> Abenteuerpunkte
          </div>
          <div className="muted">
            {nextAp == null ? 'Maximale Stufe erreicht' : `noch ${de(nextAp - ap)} AP bis Stufe ${level + 1}`}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <div className="level-next" style={{ textAlign: 'right' }}>
          <div>
            Karma <strong>{de(meta.karma ?? 0)}</strong>
          </div>
          <div className="muted">Ruf {de(meta.ruf ?? 0)}</div>
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
                  <th style={{ width: 80 }}>Wert</th>
                </tr>
              </thead>
              <tbody>
                {ATTR_ROW_CODES.map((code) => (
                  <tr key={code}>
                    <td>{ATTR_LABELS[code]}</td>
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
                  <th style={{ width: 80 }}>Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {BASE_VALUE_KEYS.map((key) => (
                  <tr key={key}>
                    <td>{BASE_VALUE_LABELS[key].label}</td>
                    <td className="computed">{bv[key].ergebnis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Energien</h3>
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Energie</th>
                  <th style={{ width: 90 }}>{RC.aktuell}</th>
                  <th style={{ width: 90 }}>{RC.maximum}</th>
                </tr>
              </thead>
              <tbody>
                {RESOURCE_KEYS.map((key) => {
                  const r = computeResource(attributes, key, resources[key]);
                  const akt = resources[key].aktuell;
                  const depl = depletionClass(key, akt, r.ergebnis);
                  return (
                    <tr key={key}>
                      <td>{RESOURCE_LABELS[key].label}</td>
                      <td
                        className={depl || undefined}
                        title={depl ? `${Math.round((akt / r.ergebnis) * 100)} % — ${akt}/${r.ergebnis}` : undefined}
                      >
                        <NumInput value={akt} onChange={(v) => setAktuell(key, v)} />
                      </td>
                      <td className="computed">{de(r.ergebnis)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Psyche</td>
                  <td>
                    <NumInput value={psycheAkt} onChange={(v) => setMeta('psycheAkt', v)} />
                  </td>
                  <td className="computed">
                    {de(psycheMax)}
                    {psyche != null && <span className="muted"> · {Math.round(psyche)} %</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <GeldPanel meta={meta} setMeta={setMeta} />
      </div>
    </>
  );
}
