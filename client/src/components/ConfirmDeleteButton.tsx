import { useEffect, useRef, useState } from 'react';

// Löschknopf mit Sicherheitsstufe: der erste Klick „schärft" ihn (er wird rot),
// erst der zweite löscht wirklich. Ohne zweiten Klick entschärft er sich von
// selbst — nach ein paar Sekunden oder sobald er den Fokus verliert. So lässt
// sich in Tabellen nichts mehr aus Versehen mit einem Klick entfernen.
export function ConfirmDeleteButton({
  onConfirm,
  title = 'Entfernen',
  className = 'small',
  children = '✕',
}: {
  onConfirm: () => void;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);

  const disarm = () => {
    clear();
    setArmed(false);
  };

  const onClick = () => {
    if (armed) {
      disarm();
      onConfirm();
    } else {
      setArmed(true);
      clear();
      timer.current = window.setTimeout(() => setArmed(false), 3000);
    }
  };

  return (
    <button
      type="button"
      className={`${className}${armed ? ' confirm-armed' : ''}`}
      title={armed ? 'Erneut klicken zum Löschen' : title}
      aria-label={title}
      aria-pressed={armed}
      onClick={onClick}
      onBlur={disarm}
    >
      {children}
    </button>
  );
}
