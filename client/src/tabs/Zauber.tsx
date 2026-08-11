import {
  MAGIER_MAX_STUFE,
  MAGIER_STUFEN_REFERENZ,
  MAGIER_TALENT_NAMES,
  magiepunkte,
  magierEligibility,
} from '@shared/abilities';
import { psycheProzent } from '@shared/rules';
import { AlwaysEditable } from '../components/displayMode';
import { NumInput } from '../components/inputs';
import { useChar } from '../pages/Character';
import { AbilityTable } from './AbilityTable';

// Reiter „Zauber" (Cluster 6): die magische Sicht auf die Werkstatt-Liste, oben
// das Magier-Panel (6a) — Magierstufe (der einzige vom Menschen gepflegte Wert),
// Magiepunkte und der Fortschritt zur nächsten Stufe. Alles rein abgeleitet.

export default function ZauberTab() {
  return (
    <>
      <MagierPanel />
      <AbilityTable magisch persistKey="abil:zauber" groupOptions={['kategorie', 'element']} />
    </>
  );
}

function MagierPanel() {
  const { data, update, catalogs } = useChar();
  const magierstufe = Math.max(0, Math.floor(Number(data.meta.magierstufe) || 0));
  const setStufe = (v: number) =>
    update('meta', { ...data.meta, magierstufe: Math.max(0, Math.min(MAGIER_MAX_STUFE, Math.round(v))) });

  const mp = magiepunkte(data.abilities, magierstufe);
  const tawByName = (name: string): number => {
    const cat = catalogs.talents.find((t) => t.name === name);
    if (!cat) return 0;
    return data.talents.find((t) => t.talentId === cat.id)?.taw ?? 0;
  };
  const psyche = psycheProzent(Number(data.meta.psycheAkt) || 0, Number(data.meta.psycheMax) || 0) ?? 0;
  const elig = magierEligibility(magierstufe, {
    koerper: tawByName(MAGIER_TALENT_NAMES.koerper),
    selbst: tawByName(MAGIER_TALENT_NAMES.selbst),
    magiekunde: tawByName(MAGIER_TALENT_NAMES.magiekunde),
    krypto: tawByName(MAGIER_TALENT_NAMES.krypto),
    psyche,
    magiepunkte: mp.summe,
  });
  const ref = MAGIER_STUFEN_REFERENZ[magierstufe];

  return (
    <div className="panel magier-panel">
      <h3>Magier</h3>
      <div className="magier-top">
        <label className="magier-stufe" title="Manuell gepflegt: 0 = kein Magier, 1–5 = Rang.">
          Magierstufe
          <AlwaysEditable>
            <NumInput value={magierstufe} min={0} max={MAGIER_MAX_STUFE} onChange={setStufe} />
          </AlwaysEditable>
        </label>
        {magierstufe >= 1 ? (
          <div className="magier-mp">
            Magiepunkte <strong>{mp.summe}</strong>
            {mp.trivialGesamt > 0 && (
              <span className="muted">
                {' '}
                · {mp.trivialGezaehlt}/{mp.trivialGesamt} triviale gezählt (Deckel {mp.trivialCap})
              </span>
            )}
          </div>
        ) : (
          <span className="muted">Kein Magier — Stufe auf 1+ setzen, um Magiepunkte und Voraussetzungen zu sehen.</span>
        )}
      </div>

      {magierstufe >= 1 && ref && (
        <div className="magier-ref muted">
          Rang {magierstufe}: {ref.aspProRunde} AsP/Runde · Erschöpfung ab {ref.erschoepfungAb} · Überladung tödlich ab +
          {ref.ueberladenToedlichAb} · Zauberstufe ≤ {ref.zauberStufenGrenze}
        </div>
      )}

      {elig.naechsteStufe && (
        <div className="magier-elig">
          <div className="magier-elig-head">
            Voraussetzungen für Magierstufe {elig.naechsteStufe}
            {elig.erfuellt && <span className="magier-ok"> — erfüllt ✓</span>}
          </div>
          <div className="magier-conds">
            {elig.bedingungen.map((b) => (
              <span key={b.key} className={`magier-cond${b.erfuellt ? ' ok' : ''}`} title={b.label}>
                {b.label} {b.ist}
                {b.einheit ?? ''}/{b.soll}
                {b.einheit ?? ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
