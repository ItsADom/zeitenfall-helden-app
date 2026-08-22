import { useCallback, useEffect, useRef, useState } from 'react';

// Press-and-hold confirmation. Releasing early aborts and resets; only holding
// for the full duration fires. Used where a click is too cheap a gesture for
// what follows — see the Wartung tab in the Verwaltung.

const TICK_MS = 50;

export function HoldButton({
  dauerMs,
  onComplete,
  disabled,
  label,
  laufendLabel,
  animiert = true,
}: {
  dauerMs: number;
  onComplete: () => void;
  disabled?: boolean;
  /**
   * Has to name the gesture itself ("… 10 Sekunden gedrückt halten"), because a
   * screen reader gets nothing else: there is no separate hint that could say
   * so, and a plain "Ausrollen" would read as an ordinary button.
   */
  label: string;
  /** Shown while the button is held down. */
  laufendLabel: string;
  /** False when the user has switched animations off — then a plain countdown replaces the ring. */
  animiert?: boolean;
}) {
  const [gehalten, setGehalten] = useState(false);
  const [anteil, setAnteil] = useState(0);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stoppen = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setGehalten(false);
    setAnteil(0);
  }, []);

  // A hold interrupted by unmounting (navigating away mid-press) must not leave
  // an interval running against a component that is gone.
  useEffect(() => stoppen, [stoppen]);

  const starten = useCallback(() => {
    if (disabled || timerRef.current) return;
    startRef.current = Date.now();
    setGehalten(true);
    setAnteil(0);
    timerRef.current = setInterval(() => {
      const fortschritt = Math.min(1, (Date.now() - startRef.current) / dauerMs);
      setAnteil(fortschritt);
      if (fortschritt >= 1) {
        stoppen();
        onComplete();
      }
    }, TICK_MS);
  }, [disabled, dauerMs, onComplete, stoppen]);

  const verbleibend = Math.ceil((dauerMs * (1 - anteil)) / 1000);

  return (
    <button
      type="button"
      className={`hold-button${gehalten ? ' haltend' : ''}`}
      disabled={disabled}
      // Without this a touch device scrolls the page out from under the finger
      // instead of registering a hold.
      style={{ touchAction: 'none', ['--hold-anteil' as string]: String(anteil) }}
      onPointerDown={starten}
      onPointerUp={stoppen}
      // Abort when the pointer leaves the button, not only when it is released:
      // sliding off and letting go elsewhere must not count as a full hold.
      onPointerLeave={stoppen}
      onPointerCancel={stoppen}
      // Keyboard equivalent — a hold is a pointer gesture, and without this
      // there would be no way to reach the action without a mouse or a finger.
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          starten();
        }
      }}
      onKeyUp={stoppen}
      onBlur={stoppen}
      // The visible label already names the gesture and the duration; repeating
      // it here made a screen reader say the whole sentence twice.
      aria-label={label}
    >
      {animiert && <span className="hold-fuellung" aria-hidden="true" />}
      <span className="hold-text">
        {gehalten ? `${laufendLabel} ${verbleibend} s` : label}
      </span>
    </button>
  );
}
