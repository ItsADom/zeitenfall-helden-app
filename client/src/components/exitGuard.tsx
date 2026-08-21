import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Dialog } from './Dialog';

// Verlassensschutz für Seiten mit „Speichern"-Knopf statt laufendem Autosave
// (Einstellungen, Zauber & Fähigkeiten verwalten, das Wiki). Zwei Ebenen, weil
// keine der beiden allein reicht:
//  - `beforeunload` fängt nur eine ECHTE Navigation weg (Tab schließen, neu
//    laden, URL eintippen) — React Routers eigene Navigation (Link-Klick,
//    Zurück/Vor im Browser) löst dabei nie ein echtes Unload aus.
//  - `useBlocker` fängt genau das Gegenstück ab (In-App-Navigation inkl.
//    Zurück/Vor), braucht dafür aber zwingend einen Data Router (main.tsx).
export function ExitGuard({ dirty }: { dirty: boolean }) {
  useEffect(() => {
    if (!dirty) return;
    const warnen = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  if (blocker.state !== 'blocked') return null;
  return (
    <Dialog
      open
      onClose={() => blocker.reset()}
      title="Ungespeicherte Änderungen"
      footer={
        <>
          <button type="button" className="small" onClick={() => blocker.reset()}>
            Bleiben
          </button>
          <button type="button" className="danger" onClick={() => blocker.proceed()}>
            Ohne Speichern verlassen
          </button>
        </>
      }
    >
      <p>Diese Seite hat ungespeicherte Änderungen. Wenn du jetzt verlässt, gehen sie verloren.</p>
    </Dialog>
  );
}
