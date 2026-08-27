import { useState } from 'react';
import { useReadOnly } from './displayMode';
import { NumInput } from './inputs';

// Aktueller Energiewert mit Schnell-Schaden/-Heilung: der Wert bleibt direkt
// editierbar, daneben ein Betrag und −/+ zum Verrechnen. − zieht ab (Schaden,
// darf unter null UND unter das Maximum fallen, ohne zu kappen), + heilt (bis
// maximal max). Enter im Betragsfeld wirkt wie −, weil Schaden im Spiel der
// häufigste Fall ist.
//
// Überladung: Direkttippen kappt NICHT (deshalb kein `max` am NumInput) — ein
// Wert darf bewusst über dem Maximum stehen und bleibt dort, bis er verbraucht
// ist. Nur „+“ kappt am Maximum, senkt aber nie einen bereits überladenen Wert
// (Heilung darf nicht schaden). „−“ kappt gar nicht und trägt die Überladung ab.
//
// Genutzt in der Seitenleiste (CharacterSidebar) für die laufenden Pools
// (Energien, Psyche). Liegt zentral, damit weitere Stellen ihn teilen können.
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
    if (sign === 1) {
      // Heilung: bis zum Maximum — aber die Decke steigt auf den aktuellen Wert,
      // wenn der bereits überladen ist, damit „+“ eine Überladung nie senkt.
      const ceiling = max === undefined ? Infinity : Math.max(value, max);
      onChange(Math.min(value + amount, ceiling));
    } else {
      // Schaden: zieht frei ab (auch unter das Maximum/unter null) — kein Kappen.
      onChange(value - amount);
    }
    // Danach zurück auf 0: ein versehentlicher Doppelklick verrechnet dann nichts.
    setAmount(0);
  };
  return (
    <div className="akt-stepper">
      <NumInput value={value} onChange={onChange} />
      {!readOnly && (
        <div className="akt-delta">
          <button className="small" title="Schaden abziehen" onClick={() => apply(-1)}>
            −
          </button>
          <NumInput className="akt-amount" min={0} value={amount} onChange={setAmount} onEnter={() => apply(-1)} />
          <button className="small" title="Heilung addieren" onClick={() => apply(1)}>
            +
          </button>
        </div>
      )}
    </div>
  );
}
