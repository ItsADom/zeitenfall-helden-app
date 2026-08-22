import { useEffect, useState } from 'react';
import { ApiError, apiPost } from '../api';
import { useThemeControls } from '../App';
import { Dialog } from './Dialog';
import { HoldButton } from './HoldButton';
import { useWartung } from './wartung';

// The "Wartung" tab of the Verwaltung: the one place from which an admin can
// put a pushed commit onto this instance without an SSH session.
//
// Three gates on the way there, in this order: a notice saying what will
// happen, a short follow-up question, and a ten-second hold. The hold is last
// on purpose — it is the point of no return, so nothing is asked after it.

const HALTEDAUER_MS = 10_000;

type Schritt = 'aus' | 'hinweis' | 'rueckfrage' | 'halten';

export function WartungPanel() {
  const { starteAlsAusloeser } = useWartung();
  const { anim } = useThemeControls();
  const [verfuegbar, setVerfuegbar] = useState<boolean | null>(null);
  const [schritt, setSchritt] = useState<Schritt>('aus');
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    let aktuell = true;
    fetch('/api/admin/deploy/status', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { verfuegbar?: boolean }) => {
        if (aktuell) setVerfuegbar(d.verfuegbar === true);
      })
      .catch(() => {
        if (aktuell) setVerfuegbar(false);
      });
    return () => {
      aktuell = false;
    };
  }, []);

  const ausloesen = async () => {
    setSchritt('aus');
    setFehler('');
    try {
      // The boot id comes straight out of this response on purpose. Fetched
      // separately it could race the restart and already be the NEW one, and
      // the waiting screen would then wait forever for a change that had
      // already happened.
      const antwort = await apiPost<{ boot: string }>('/api/admin/deploy');
      starteAlsAusloeser(antwort.boot);
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Der Anstoß ist nicht durchgekommen.');
    }
  };

  if (verfuegbar === null) return <p>Wird geprüft …</p>;

  if (!verfuegbar) {
    return (
      <>
        <h2>Wartung</h2>
        <p>
          Auf dieser Instanz ist das Ausrollen aus der Oberfläche nicht eingerichtet. Das ist der
          Normalfall auf einem Entwicklungsrechner — auf dem Server fehlt dann die Einstellung
          <code> HELDEN_DEPLOY_DIR</code>.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Wartung</h2>
      <p>
        Holt den neuesten Stand des Branches, der <strong>{window.location.host}</strong> zugeordnet
        ist, baut ihn und startet die Anwendung damit neu. Welcher Branch das ist, steht auf dem
        Server fest und lässt sich von hier aus nicht wählen.
      </p>
      <p>
        Der Vorgang dauert je nach Umfang drei bis fünf Minuten. Die Anwendung bleibt fast die ganze
        Zeit erreichbar — wirklich weg ist sie nur für ein paar Sekunden am Ende. Alle gerade
        angemeldeten Spieler bekommen eine Ansage und danach denselben Wartebildschirm.
      </p>
      <p>Gibt es nichts Neues auszurollen, passiert nichts und es wird auch nicht neu gestartet.</p>

      {fehler && <p className="error">{fehler}</p>}

      {schritt === 'halten' ? (
        <div className="wartung-halten">
          <HoldButton
            dauerMs={HALTEDAUER_MS}
            animiert={anim}
            label="Zum Ausrollen 10 Sekunden gedrückt halten"
            laufendLabel="Loslassen bricht ab —"
            onComplete={() => void ausloesen()}
          />
          <button type="button" onClick={() => setSchritt('aus')}>
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" className="primary" onClick={() => setSchritt('hinweis')}>
          Neue Version ausrollen …
        </button>
      )}

      <Dialog
        open={schritt === 'hinweis'}
        onClose={() => setSchritt('aus')}
        title="Neue Version ausrollen"
        footer={
          <>
            <button type="button" onClick={() => setSchritt('aus')}>
              Abbrechen
            </button>
            <button type="button" className="primary" onClick={() => setSchritt('rueckfrage')}>
              Weiter
            </button>
          </>
        }
      >
        <p>Beim Ausrollen passiert Folgendes:</p>
        <ul>
          <li>Der neueste Stand des zugeordneten Branches wird von GitHub geholt und gebaut.</li>
          <li>Danach startet die Anwendung neu — alle Verbindungen reißen für ein paar Sekunden ab.</li>
          <li>Alle angemeldeten Spieler sehen währenddessen einen Wartebildschirm.</li>
          <li>Scheitert der Bau, bleibt der bisherige Stand unangetastet in Betrieb.</li>
        </ul>
      </Dialog>

      <Dialog
        open={schritt === 'rueckfrage'}
        onClose={() => setSchritt('aus')}
        title="Wirklich jetzt?"
        footer={
          <>
            <button type="button" onClick={() => setSchritt('aus')}>
              Nein, abbrechen
            </button>
            <button type="button" className="primary" onClick={() => setSchritt('halten')}>
              Ja, ausrollen
            </button>
          </>
        }
      >
        <p>
          Läuft gerade eine Spielrunde, ist jetzt vermutlich der falsche Moment — der Neustart
          unterbricht sie kurz und alle offenen, ungespeicherten Eingaben gehen verloren.
        </p>
      </Dialog>
    </>
  );
}
