import { useEffect } from 'react';
import { DEPLOY_PHASEN_TEXT } from 'shared';
import { useWartung } from './wartung';

// The router-style waiting screen: what everyone sees while the instance
// restarts under them, and what the triggering admin sees instead of a blank
// page. Mounted in App.tsx above the routes so it covers the dice dock too.
//
// Two audiences, one component. Whoever pressed the button gets named phases
// from the moment they press it. Everyone else gets a discreet banner as long
// as the server still answers, and only the full screen once it stops — during
// most of a deploy the old process is still serving perfectly well, and
// blanking the page for four minutes would be a lie about what is happening.

function LangsamHinweis() {
  return (
    <p className="wartung-langsam">
      Das dauert länger als gewöhnlich — der Vorgang läuft aber weiter.{' '}
      <button type="button" className="link" onClick={() => window.location.reload()}>
        Seite jetzt neu laden
      </button>
    </p>
  );
}

export function NeustartOverlay() {
  const { lauf, ansicht, erreichbar, schliessen } = useWartung();

  // A run that turned out to have nothing to do concerns nobody but the person
  // who asked; for everyone else it disappears without ever having shown.
  const stillAufraeumen = lauf?.rolle === 'mitbetroffen' && ansicht.zustand === 'aktuell';
  useEffect(() => {
    if (stillAufraeumen) schliessen();
  }, [stillAufraeumen, schliessen]);

  if (!lauf || stillAufraeumen) return null;

  // Still reachable and we are only a bystander: a banner is enough.
  if (lauf.rolle === 'mitbetroffen' && erreichbar) {
    return (
      <div className="wartung-banner" role="status">
        <strong>{lauf.durch || 'Die Verwaltung'}</strong> rollt gerade eine neue Version aus. Die Seite
        startet gleich kurz neu — bitte offene Eingaben speichern.
      </div>
    );
  }

  const langsam = (ansicht.zustand === 'laeuft' || ansicht.zustand === 'wartetAufNeustart') && ansicht.langsam;

  return (
    <div className="wartung-schirm" role="alertdialog" aria-live="polite" aria-label="Neustart">
      <div className="wartung-karte">
        {ansicht.zustand === 'fehlgeschlagen' ? (
          <>
            <h2>Ausrollen fehlgeschlagen</h2>
            <pre className="wartung-fehler">{ansicht.fehler}</pre>
            <p>Der bisherige Stand läuft unverändert weiter — es ist nichts kaputtgegangen.</p>
            <button type="button" className="primary" onClick={schliessen}>
              Schließen
            </button>
          </>
        ) : ansicht.zustand === 'aktuell' ? (
          <>
            <h2>Nichts auszurollen</h2>
            <p>Diese Instanz läuft bereits auf dem neuesten Stand des Branches. Es wurde nichts verändert und nichts neu gestartet.</p>
            <button type="button" className="primary" onClick={schliessen}>
              Schließen
            </button>
          </>
        ) : (
          <>
            <div className="wartung-spinner" aria-hidden="true" />
            <h2>
              {ansicht.zustand === 'zurueck'
                ? 'Wieder da'
                : ansicht.zustand === 'wartetAufNeustart'
                  ? 'Die Anwendung wird neu gestartet'
                  : 'Neue Version wird ausgerollt'}
            </h2>
            <p>
              {ansicht.zustand === 'zurueck'
                ? 'Die Seite wird jetzt neu geladen …'
                : ansicht.zustand === 'wartetAufNeustart'
                  ? 'Die Verbindung stellt sich von selbst wieder her. Bitte das Fenster offen lassen.'
                  : DEPLOY_PHASEN_TEXT[ansicht.phase]}
            </p>
            {langsam && <LangsamHinweis />}
          </>
        )}
      </div>
    </div>
  );
}
