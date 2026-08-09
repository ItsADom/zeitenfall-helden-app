import { useState } from 'react';
import { useReadOnly } from './displayMode';
import { NumInput } from './inputs';

// Aktueller Energiewert mit Schnell-Schaden/-Heilung: der Wert bleibt direkt
// editierbar, daneben ein Betrag und −/+ zum Verrechnen. − zieht ab (Schaden,
// darf unter null fallen), + heilt (bis maximal max). Enter im Betragsfeld
// wirkt wie −, weil Schaden im Spiel der häufigste Fall ist.
//
// Genutzt in der Übersicht UND in der Seitenleiste — beide zeigen dieselben
// laufenden Pools (Energien, Psyche). Deshalb liegt der Baustein hier zentral.
export function AktuellFeld({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  // Die laufenden Pools bleiben auch im Nur-Lesen-Modus bearbeitbar
  // (AlwaysEditable), im DRUCK aber nicht — dort gehören die Schaden-/Heilung-
  // Knöpfe nicht hin.
  const readOnly = useReadOnly();
  const [amount, setAmount] = useState(0);
  const apply = (sign: 1 | -1) => {
    if (!amount) return;
    let next = value + sign * amount;
    if (max !== undefined) next = Math.min(next, max);
    onChange(next);
    // Danach zurück auf 0: ein versehentlicher Doppelklick verrechnet dann nichts.
    setAmount(0);
  };
  return (
    <div className="akt-stepper">
      <NumInput value={value} max={max} onChange={onChange} />
      {!readOnly && (
        <div className="akt-delta">
          <button className="small" title="Schaden abziehen" onClick={() => apply(-1)}>
            −
          </button>
          <input
            className="akt-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply(-1);
              }
            }}
          />
          <button className="small" title="Heilung addieren" onClick={() => apply(1)}>
            +
          </button>
        </div>
      )}
    </div>
  );
}
