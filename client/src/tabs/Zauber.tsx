import { useState } from 'react';
import {
  MAGIER_ANFORDERUNGEN,
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
      <AbilityTable magisch persistKey="abil:zauber" groupOptions={['kategorie', 'element']} listSortLabel="Nach Zauberliste" />
    </>
  );
}

function MagierPanel() {
  const { data, update, catalogs } = useChar();
  const magierstufe = Math.max(0, Math.floor(Number(data.meta.magierstufe) || 0));
  // „Überschreiben" erlaubt Ausnahme-Erhöhungen ohne erfüllte Voraussetzungen
  // (z. B. ein Fluch, der die Stufe anhebt). Nur in der Sitzung, nichts gespeichert.
  const [override, setOverride] = useState(false);
  const [warn, setWarn] = useState('');

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

  // Erhöhung ist standardmäßig gesperrt, solange die Voraussetzungen des nächsten
  // Rangs nicht erfüllt sind — mit klarer Warnung. Senken geht immer. „Überschreiben"
  // hebt die Sperre für Ausnahmen auf.
  const setStufe = (raw: number) => {
    const v = Math.max(0, Math.min(MAGIER_MAX_STUFE, Math.round(raw)));
    const commit = () => {
      setWarn('');
      update('meta', { ...data.meta, magierstufe: v });
    };
    if (v <= magierstufe || override) return commit();
    // Ränge ohne Voraussetzungen sind frei (Rang 1 = „Magier werden").
    if (!MAGIER_ANFORDERUNGEN[v]) return commit();
    if (v === magierstufe + 1 && elig.erfuellt) return commit();
    setWarn(
      v === magierstufe + 1
        ? `Voraussetzungen für Magierstufe ${v} nicht erfüllt — Erhöhung abgelehnt. Für Ausnahmen (z. B. Fluch) „Überschreiben" aktivieren.`
        : 'Nur eine Stufe auf einmal erhöhen — oder „Überschreiben" für Ausnahmen.',
    );
    // kein commit → das gebundene Feld springt auf den alten Wert zurück
  };

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
        <label className="magier-override" title="Erlaubt Erhöhung ohne erfüllte Voraussetzungen (Ausnahmen wie Flüche).">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Überschreiben
        </label>
        {magierstufe >= 1 ? (
          <div className="magier-mp">
            Magiepunkte <strong>{mp.summe}</strong>
            {mp.trivialGesamt > 0 && (
              <span className="muted">
                {' '}
                · {mp.trivialGesamt} / {mp.trivialCap} Zauber sind trivial
                {mp.trivialGesamt > mp.trivialCap ? ' – Wertung begrenzt' : ''}
              </span>
            )}
          </div>
        ) : (
          <span className="muted">Kein Magier — Stufe auf 1+ setzen, um Magiepunkte und Voraussetzungen zu sehen.</span>
        )}
      </div>
      {warn && <div className="magier-warn">{warn}</div>}

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
