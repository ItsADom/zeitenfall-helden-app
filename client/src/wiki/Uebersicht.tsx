import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WikiSeiteInfo } from '@shared/wikiTypen';
import { useAuth } from '../App';
import { CollapsedText } from '../components/notes';
import NeueSeiteDialog from './NeueSeiteDialog';
import { ladeListe, neuIndizieren } from './api';

// The wiki's front door: every page, plus a category filter and the entry point
// for creating one. Search arrives in its own phase; until then the filter is a
// plain substring match over what is already loaded, which is the same thing
// the talent tab does and is plenty for a few dozen pages.

export default function WikiUebersicht() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [seiten, setSeiten] = useState<WikiSeiteInfo[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [suche, setSuche] = useState('');
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [dialogOffen, setDialogOffen] = useState(false);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexStatus, setIndexStatus] = useState('');

  // Repariert von Hand, was indexNachziehen() beim Start automatisch erledigt —
  // gebraucht, wenn jemand die Datenbank von außen angefasst hat.
  const indexNeuBauen = async () => {
    setIndexBusy(true);
    try {
      const d = await neuIndizieren();
      setIndexStatus(`${d.seiten} Seiten indiziert`);
    } catch {
      setIndexStatus('Fehlgeschlagen');
    } finally {
      setIndexBusy(false);
    }
  };

  const laden = useCallback(() => {
    ladeListe()
      .then((d) => setSeiten(d.seiten))
      .catch((e) => setFehler(e instanceof Error ? e.message : 'Fehler'));
  }, []);

  useEffect(laden, [laden]);

  // Someone else may have written a page while this tab sat open — the wiki
  // lives in its own tab, so coming back to it is the natural refresh moment.
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

  if (fehler) return <p className="error">{fehler}</p>;

  const q = suche.trim().toLowerCase();
  const gefiltert = (seiten ?? []).filter(
    (s) =>
      (!kategorie || s.tags.includes(kategorie)) &&
      (!q || s.titel.toLowerCase().includes(q) || s.auszug.toLowerCase().includes(q)),
  );
  const kategorien = [...new Set((seiten ?? []).flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Wiki</h1>
          <p className="muted">Weltwissen und Spielregeln — zum Nachschlagen mitten im Spiel.</p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki/aenderungen">
            Letzte Änderungen
          </Link>
          {user.isGm && (
            <>
              <Link className="small" to="/wiki/papierkorb">
                Papierkorb
              </Link>
              <button className="small" disabled={indexBusy} onClick={() => void indexNeuBauen()}>
                {indexStatus || 'Suchindex neu aufbauen'}
              </button>
            </>
          )}
          <button className="primary" onClick={() => setDialogOffen(true)}>
            + Neue Seite
          </button>
        </div>
      </div>

      <div className="wiki-filter screen-only">
        {/* Tippen filtert sofort über Titel und Anriss der geladenen Liste —
            das ist bei ein paar Dutzend Seiten das Schnellste. Enter geht in
            die Volltextsuche, die auch im Text der Seiten sucht. */}
        <form
          className="talent-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (suche.trim()) navigate(`/wiki/suche?q=${encodeURIComponent(suche.trim())}`);
          }}
        >
          <input
            type="search"
            placeholder="Seite suchen… (Enter durchsucht auch den Text)"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          {suche && (
            <button type="button" className="small" onClick={() => setSuche('')} title="Suche zurücksetzen">
              ✕
            </button>
          )}
        </form>
        {kategorien.length > 0 && (
          <div className="wiki-tags">
            <button className={`wiki-tag${kategorie === null ? ' active' : ''}`} onClick={() => setKategorie(null)}>
              Alle
            </button>
            {kategorien.map((t) => (
              <button
                key={t}
                className={`wiki-tag${kategorie === t ? ' active' : ''}`}
                onClick={() => setKategorie(kategorie === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {seiten == null ? (
        <p className="muted">Lade…</p>
      ) : gefiltert.length === 0 ? (
        <p className="muted">
          {seiten.length === 0 ? 'Noch keine Seiten. Lege die erste an.' : 'Keine Seite gefunden.'}
        </p>
      ) : (
        <div className="cardlist">
          {gefiltert.map((s) => (
            <Link className="card wiki-karte" key={s.slug} to={`/wiki/${s.slug}`}>
              <h3>
                {s.titel}
                {/* Von jemand anderem geändert, seit du zuletzt in die
                    Änderungen geschaut hast. */}
                {s.neu && <span className="wiki-marke wiki-marke-neu">neu</span>}
                {s.gmOnly && <span className="wiki-marke">nur SL</span>}
                {s.geschuetzt && <span className="wiki-marke">geschützt</span>}
              </h3>
              {s.auszug ? (
                <CollapsedText className="muted" text={s.auszug} />
              ) : (
                <span className="muted">Noch ohne Inhalt.</span>
              )}
            </Link>
          ))}
        </div>
      )}

      <NeueSeiteDialog
        open={dialogOffen}
        onClose={() => setDialogOffen(false)}
        onAngelegt={(slug) => navigate(`/wiki/${slug}/bearbeiten`)}
      />
    </div>
  );
}
