import { useEffect, useState } from 'react';
import { useHoverFlyout } from '../useHoverFlyout';

// Situative Erleichterung(-)/Erschwernis(+), von der Spielleitung am Tisch
// angesagt — NICHT die TaW-Erleichterung, die schon in jeder Probe-Zahl
// steckt (siehe shared/src/rules.ts). Wirkt auf die geworfene Summe, nicht
// auf die Probe-Zahl (man unterwürfelt den Zielwert, ein positiver Wert
// erschwert also). Gilt nur für den NÄCHSTEN Wurf, Bogen wie Chat, und wird
// danach automatisch auf 0 zurückgesetzt (siehe DicePanelProvider's
// rollProbe/rollExpr/acceptRequest) — anders als VisibilityPicker, der sticky
// bleibt. Tabellenwürfe (/master, /wild) sind davon ausgenommen (Lookup, kein
// Ergebnis mit Summe).
// Serverseitig wird der Wert auf ±30 geklemmt (server/src/ws.ts) — reiner
// Schutz gegen Zahlendreher, kein Anti-Cheat.
export default function ModifierPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!open) setDraft(String(value));
  }, [open, value]);

  // Save on every keystroke, mirroring NumInput's `type()` pattern — `draft`
  // only holds the in-progress text so an intermediate state like "-" doesn't
  // get parsed to 0 mid-typing.
  const type = (raw: string) => {
    setDraft(raw);
    if (raw === '' || raw === '-') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.trunc(n));
  };

  const commit = () => {
    const n = Math.trunc(Number(draft)) || 0;
    onChange(n);
    setDraft(String(n));
  };

  const label = value === 0 ? '±0' : value > 0 ? `+${value}` : String(value);

  return (
    <div className={`dice-flyout-wrap${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
      <button
        className={`dice-icon-btn mod-btn${value !== 0 ? ' mod-btn--active' : ''}`}
        title={`Erleichterung/Erschwernis: ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        🎯 {label}
      </button>
      {open && (
        <div className="dice-flyout mod-flyout" role="menu">
          <label className="mod-flyout-row">
            <input
              type="number"
              value={draft}
              autoFocus
              onChange={(e) => type(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  closeNow();
                }
              }}
            />
          </label>
          <p className="mod-flyout-hint muted">
            Erleichterung (−) oder Erschwernis (+) der Spielleitung, auf die geworfene Summe — gilt nur für den nächsten Wurf.
          </p>
          {value !== 0 && (
            <button
              className="dice-flyout-item"
              role="menuitem"
              onClick={() => {
                onChange(0);
                setDraft('0');
                closeNow();
              }}
            >
              Zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
