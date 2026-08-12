import { useState } from 'react';
import {
  MAGIER_ANFORDERUNGEN,
  MAGIER_MAX_STUFE,
  MAGIER_STUFEN_REFERENZ,
  MAGIER_TALENT_NAMES,
  magiepunkte,
  magierEligibility,
} from '@shared/abilities';
import { psycheMax, psycheProzent } from '@shared/rules';
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
  // Das Zahlenfeld hält beim Tippen einen Entwurf; wird eine Eingabe abgelehnt
  // oder von außen zurückgesetzt, erzwingt ein Schlüsselwechsel die Neuanzeige
  // des tatsächlich gespeicherten Werts.
  const [fieldKey, setFieldKey] = useState(0);
  const resyncField = () => setFieldKey((k) => k + 1);

  const mp = magiepunkte(data.abilities, magierstufe);
  const tawByName = (name: string): number => {
    const cat = catalogs.talents.find((t) => t.name === name);
    if (!cat) return 0;
    return data.talents.find((t) => t.talentId === cat.id)?.taw ?? 0;
  };
  const psyche =
    psycheProzent(
      Number(data.meta.psycheAkt) || 0,
      psycheMax(data.attributes, Number(data.meta.psycheBase) || 0, Number(data.meta.psycheBonus) || 0),
    ) ?? 0;
  const istBase = {
    koerper: tawByName(MAGIER_TALENT_NAMES.koerper),
    selbst: tawByName(MAGIER_TALENT_NAMES.selbst),
    magiekunde: tawByName(MAGIER_TALENT_NAMES.magiekunde),
    krypto: tawByName(MAGIER_TALENT_NAMES.krypto),
    psyche,
  };
  const elig = magierEligibility(magierstufe, { ...istBase, magiepunkte: mp.summe });
  const ref = MAGIER_STUFEN_REFERENZ[magierstufe];

  // Hält der Charakter Rang R? (Ränge ≤1 haben keine Voraussetzungen.)
  // Bewusst OHNE Psyche: die Psyche ist ein schwankender Momentwert und zählt
  // nur beim AUFSTIEG (siehe `elig`). Einmal erreicht, darf ein späteres Absacken
  // der Psyche die Stufe nicht wieder senken — anders als Talentwerte und
  // Magiepunkte, die nur wachsen. Die Magiepunkte hängen vom geprüften Rang ab
  // (Trivial-Deckel), der Rest nicht.
  const meetsRank = (R: number): boolean => {
    const reqs = MAGIER_ANFORDERUNGEN[R];
    if (!reqs) return true;
    return (
      istBase.koerper >= reqs.koerper &&
      istBase.selbst >= reqs.selbst &&
      istBase.magiekunde >= reqs.magiekunde &&
      istBase.krypto >= reqs.krypto &&
      magiepunkte(data.abilities, R).summe >= reqs.magiepunkte
    );
  };
  // Höchster legitim erreichbarer Rang ≤ aktueller Stufe (für den Reset beim
  // Ausschalten von „Überschreiben").
  const legitMaxStufe = (): number => {
    for (let R = magierstufe; R >= 1; R--) if (meetsRank(R)) return R;
    return 0;
  };
  // Ob gerade eine Ausnahme wirkt, steht in den Daten selbst: eine Stufe ÜBER
  // dem legitim erreichbaren Maximum ist nur per „Überschreiben" möglich. Der
  // Schalter liest diesen Zustand ab (bleibt also nach dem Neuladen gesetzt),
  // nicht nur die flüchtige Sitzungsvariable.
  const legitMax = legitMaxStufe();
  const overrideOn = override || magierstufe > legitMax;

  // Erhöhung ist standardmäßig gesperrt, solange die Voraussetzungen des nächsten
  // Rangs nicht erfüllt sind — mit klarer Warnung. Senken geht immer. „Überschreiben"
  // hebt die Sperre für Ausnahmen auf.
  const setStufe = (raw: number) => {
    const v = Math.max(0, Math.min(MAGIER_MAX_STUFE, Math.round(raw)));
    const commit = () => {
      setWarn('');
      update('meta', { ...data.meta, magierstufe: v });
    };
    if (v <= magierstufe || overrideOn) return commit();
    // Ränge ohne Voraussetzungen sind frei (Rang 1 = „Magier werden").
    if (!MAGIER_ANFORDERUNGEN[v]) return commit();
    if (v === magierstufe + 1 && elig.erfuellt) return commit();
    setWarn(
      v === magierstufe + 1
        ? `Voraussetzungen für Magierstufe ${v} nicht erfüllt — Erhöhung abgelehnt. Für Ausnahmen „Überschreiben" aktivieren.`
        : 'Nur eine Stufe auf einmal erhöhen — oder „Überschreiben" für Ausnahmen.',
    );
    resyncField(); // kein commit → Feld zurück auf den alten Wert
  };

  return (
    <div className="panel magier-panel">
      <h3>Magier</h3>
      <div className="magier-top">
        <label className="magier-stufe" title="Manuell gepflegt: 0 = kein Magier, 1–5 = Rang.">
          Magierstufe
          <AlwaysEditable>
            <NumInput key={fieldKey} value={magierstufe} min={0} max={MAGIER_MAX_STUFE} onChange={setStufe} />
          </AlwaysEditable>
        </label>
        <label className="magier-override" title="Erlaubt Erhöhung ohne erfüllte Voraussetzungen. Ausschalten setzt die Stufe auf das legitim erreichbare Maximum zurück.">
          <input
            type="checkbox"
            checked={overrideOn}
            onChange={(e) => {
              const on = e.target.checked;
              setOverride(on);
              // Ausschalten hebt eine Ausnahme (z. B. Fluch) auf: die Stufe fällt
              // auf das zurück, was der Charakter regulär erreicht.
              if (!on && magierstufe > legitMax) {
                setWarn('');
                update('meta', { ...data.meta, magierstufe: legitMax });
                resyncField();
              }
            }}
          />
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
