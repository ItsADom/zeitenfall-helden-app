import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { zeitText } from './log';
import type { WikiPapierkorbEintrag } from './api';
import { holeZurueck, ladePapierkorb, loescheEndgueltig } from './api';

// The trash. Spielleitung only.
//
// Deleting a wiki page is a soft delete: history, images and incoming links all
// stay, and a misclick costs a click to undo rather than an evening's writing.
// Emptying is the one irreversible act in the whole wiki, which is why each row
// says how many images go with it — „samt 3 Bildern" is a different decision
// from „samt 0 Bildern".

export default function WikiPapierkorb() {
  const [seiten, setSeiten] = useState<WikiPapierkorbEintrag[] | null>(null);
  const [fehler, setFehler] = useState('');

  const laden = useCallback(() => {
    ladePapierkorb()
      .then((d) => setSeiten(d.seiten))
      .catch(() => setFehler('Der Papierkorb konnte nicht geladen werden.'));
  }, []);

  useEffect(laden, [laden]);

  const zurueck = async (slug: string) => {
    setFehler('');
    try {
      await holeZurueck(slug);
      laden();
    } catch (e) {
      // Der Server sagt bei einer inzwischen neu beschriebenen Kategorie
      // genauer, warum es nicht geht — das ist kein „ging halt nicht".
      setFehler(e instanceof ApiError && e.status === 409 ? e.message : 'Die Seite konnte nicht zurückgeholt werden.');
    }
  };

  const endgueltig = async (slug: string) => {
    setFehler('');
    try {
      await loescheEndgueltig(slug);
      laden();
    } catch {
      setFehler('Die Seite konnte nicht gelöscht werden.');
    }
  };

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Papierkorb</h1>
          <p className="muted">
            Gelöschte Seiten samt Verlauf und Bildern. Endgültiges Löschen lässt sich nicht rückgängig machen.
          </p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki">
            Zur Übersicht
          </Link>
        </div>
      </div>

      {fehler && <p className="error">{fehler}</p>}

      {seiten == null ? (
        <p className="muted">Lade…</p>
      ) : seiten.length === 0 ? (
        <p className="muted">Der Papierkorb ist leer.</p>
      ) : (
        <ul className="wiki-log">
          {seiten.map((s) => (
            <li className="wiki-log-zeile" key={s.slug}>
              <div className="wiki-log-kopf">
                <strong>{s.titel}</strong>
                <span className="muted">
                  gelöscht am {zeitText(s.geloeschtAm)}
                  {s.bilder > 0 && ` · ${s.bilder} ${s.bilder === 1 ? 'Bild' : 'Bilder'}`}
                </span>
              </div>
              <div className="wiki-log-aktionen screen-only">
                <button className="small" onClick={() => void zurueck(s.slug)}>
                  Zurückholen
                </button>
                <ConfirmDeleteButton
                  className="small"
                  title={`„${s.titel}" endgültig löschen${s.bilder > 0 ? `, samt ${s.bilder} Bild(ern)` : ''}`}
                  onConfirm={() => void endgueltig(s.slug)}
                >
                  Endgültig löschen
                </ConfirmDeleteButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
