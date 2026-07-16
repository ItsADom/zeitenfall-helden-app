import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from '@shared/types';
import { computeBaseValues, computeResource, levelForAp, mrErgebnis, nextLevelAp, psycheProzent } from '@shared/rules';
import { depletionClass } from '../components/energie';
import { useChar } from '../pages/Character';
import { COIN_FIELDS } from './Heldenbrief';

// Reine Lese-Ansicht: alles Wichtige auf einen Blick, ohne Formeln und
// Zwischenwerte. Gepflegt wird weiterhin im Heldenbrief.

const de = (v: number) => v.toLocaleString('de-DE');

export default function UebersichtTab() {
  const { data } = useChar();
  const { attributes, baseValues, resources, meta } = data;

  const mr = mrErgebnis(attributes, resources);
  const bv = computeBaseValues(attributes, baseValues, mr);

  const ap = meta.ap ?? 0;
  const level = levelForAp(ap);
  const nextAp = nextLevelAp(ap);
  const psycheAkt = meta.psycheAkt ?? 0;
  const psycheMax = meta.psycheMax ?? 0;
  const psyche = psycheProzent(psycheAkt, psycheMax);

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
                  <th style={{ width: 90 }}>Aktuell</th>
                  <th style={{ width: 90 }}>Ergebnis</th>
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
                      {/* Magieresistenz ist ein Widerstand, kein Vorrat — kein Aktuell-Wert */}
                      <td
                        className={`num ${depl}`.trim()}
                        title={depl ? `${Math.round((akt / r.ergebnis) * 100)} % — ${akt}/${r.ergebnis}` : undefined}
                      >
                        {key === 'mr' ? '—' : de(akt)}
                      </td>
                      <td className="computed">{de(r.ergebnis)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Psyche</td>
                  <td className="num">{de(psycheAkt)}</td>
                  <td className="computed">
                    {de(psycheMax)}
                    {psyche != null && <span className="muted"> · {Math.round(psyche)} %</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Geld</h3>
          <div className="coins">
            {COIN_FIELDS.map(([key, label, tone]) => (
              <div className={`coin coin-${tone}`} key={key}>
                <span className="coin-disc" aria-hidden />
                <label>{label}</label>
                <span className="coin-value">{de(meta[key] ?? 0)}</span>
              </div>
            ))}
          </div>
          <div className="coin coin-bank">
            <span className="coin-disc" aria-hidden />
            <label>Bank</label>
            <span className="coin-value">{de(meta.bank ?? 0)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
