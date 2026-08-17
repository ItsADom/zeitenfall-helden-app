import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WikiLogEintrag } from '@shared/wikiTypen';
import { LogZeile } from './log';
import { ladeAenderungen, ladeAenderungsFilter } from './api';

// „Letzte Änderungen" — the wiki-wide change log.
//
// This is the oversight surface, and the reason nothing waits for approval: an
// edit is live immediately, and the GM sees what happened here rather than
// having to gate it in advance. Every entry links to its page and to the
// comparison that produced it.
//
// Filtering happens on the SERVER. A filter applied in the browser would mean
// the rows it hides had already been sent, which for a GM-only page is exactly
// the leak the whole visibility layer exists to prevent.

const SEITE = 50;

interface Filter {
  autor: string;
  seite: string;
  von: string;
  bis: string;
}

const LEER: Filter = { autor: '', seite: '', von: '', bis: '' };

export default function WikiAenderungen() {
  const [filter, setFilter] = useState<Filter>(LEER);
  const [eintraege, setEintraege] = useState<WikiLogEintrag[] | null>(null);
  const [mehr, setMehr] = useState(false);
  const [fehler, setFehler] = useState('');
  const [auswahl, setAuswahl] = useState<{ autoren: string[]; seiten: { slug: string; titel: string }[] }>({
    autoren: [],
    seiten: [],
  });

  useEffect(() => {
    ladeAenderungsFilter()
      .then(setAuswahl)
      .catch(() => {
        // Ohne die Auswahllisten bleiben die Felder leer — die Liste selbst
        // funktioniert weiter, und das ist der Teil, der zählt.
      });
  }, []);

  const laden = useCallback(
    (vor?: string) => {
      setFehler('');
      ladeAenderungen({ ...filter, limit: SEITE, ...(vor ? { vor } : {}) })
        .then((d) => {
          setEintraege((bisher) => (vor && bisher ? [...bisher, ...d.eintraege] : d.eintraege));
          setMehr(d.eintraege.length === SEITE);
        })
        .catch(() => setFehler('Die Änderungen konnten nicht geladen werden.'));
    },
    [filter],
  );

  useEffect(() => {
    setEintraege(null);
    laden();
  }, [laden]);

  // Someone else may have written while this tab sat open — the wiki lives in
  // its own tab, so returning to it is the natural moment to refresh.
  useEffect(() => {
    const vielleicht = () => {
      if (document.visibilityState === 'visible') laden();
    };
    window.addEventListener('focus', vielleicht);
    document.addEventListener('visibilitychange', vielleicht);
    return () => {
      window.removeEventListener('focus', vielleicht);
      document.removeEventListener('visibilitychange', vielleicht);
    };
  }, [laden]);

  const setzen = (teil: Partial<Filter>) => setFilter((f) => ({ ...f, ...teil }));
  const gefiltert = filter.autor || filter.seite || filter.von || filter.bis;

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Letzte Änderungen</h1>
          <p className="muted">Wer hat wann was geändert — vollständig und dauerhaft.</p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki">
            Zur Übersicht
          </Link>
        </div>
      </div>

      <div className="wiki-logfilter screen-only">
        <label className="field">
          <span>Wer</span>
          <select value={filter.autor} onChange={(e) => setzen({ autor: e.target.value })}>
            <option value="">Alle</option>
            {auswahl.autoren.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Seite</span>
          <select value={filter.seite} onChange={(e) => setzen({ seite: e.target.value })}>
            <option value="">Alle</option>
            {auswahl.seiten.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.titel}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Von</span>
          <input type="date" value={filter.von} onChange={(e) => setzen({ von: e.target.value })} />
        </label>
        <label className="field">
          <span>Bis</span>
          <input type="date" value={filter.bis} onChange={(e) => setzen({ bis: e.target.value })} />
        </label>
        {gefiltert && (
          <button className="small" onClick={() => setFilter(LEER)}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      {fehler && <p className="error">{fehler}</p>}

      {eintraege == null ? (
        <p className="muted">Lade…</p>
      ) : eintraege.length === 0 ? (
        <p className="muted">
          {gefiltert ? 'Keine Änderungen in diesem Ausschnitt.' : 'Noch nichts geändert.'}
        </p>
      ) : (
        <>
          <ul className="wiki-log">
            {eintraege.map((e) => (
              <LogZeile key={e.id} eintrag={e} />
            ))}
          </ul>
          {mehr && (
            <button className="small screen-only" onClick={() => laden(eintraege[eintraege.length - 1].erstelltAm)}>
              Ältere laden
            </button>
          )}
        </>
      )}
    </div>
  );
}
