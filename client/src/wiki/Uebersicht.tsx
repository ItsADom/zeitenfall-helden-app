import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WikiSeiteInfo } from '@shared/wikiTypen';
import { useAuth } from '../App';
import { CollapsedText } from '../components/notes';
import { ladeListe, markiereAlleGelesen, neuIndizieren } from './api';
import { useWikiNews } from './news';

// The wiki's front door: every article, with a quick filter over the loaded
// list and the categories as chips.
//
// The filter here is NOT the search in the bar above, and both earn their
// place: this one narrows the list you are looking at as you type, the other
// searches the full text of every page. Category pages and redirects are not
// in this list — the first belong in the category directory, the second are
// signposts whose card would say nothing but the name of somewhere else.
//
// Hier steht auch die zweite Hälfte der Neuigkeiten-Anzeige: die Zahl neben
// „Wiki" ist schon weg, sobald man hier ankommt (siehe news.tsx), die Marken
// bleiben. Sie verschwinden beim Öffnen der jeweiligen Seite — oder alle auf
// einmal über „Alle gelesen".

export default function WikiUebersicht() {
  const { user } = useAuth();
  const { refresh: abzeichenNeuLaden } = useWikiNews();
  const [seiten, setSeiten] = useState<WikiSeiteInfo[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [filter, setFilter] = useState('');
  const [kategorie, setKategorie] = useState<string | null>(null);
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
      .then((d) => {
        setSeiten(d.seiten);
        // Auch im Erfolgsfall zurücksetzen — sonst bleibt ein Fehler von vorhin
        // für immer stehen, obwohl die Liste längst wieder da ist.
        setFehler('');
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : 'Fehler'));
  }, []);

  useEffect(laden, [laden]);

  // Marken erst hier wegnehmen, dann melden: der Knopf soll sofort reagieren.
  // `laden()` holt die Liste anschließend ohnehin frisch, und `refresh()` bringt
  // die Zahl in Einklang — sie kann in dem Moment nur noch 0 sein.
  const alleAlsGelesen = async () => {
    setSeiten((bisher) => bisher?.map((s) => (s.neu ? { ...s, neu: false } : s)) ?? bisher);
    try {
      await markiereAlleGelesen();
    } catch {
      // Fehlgeschlagen: das folgende Laden holt die Marken zurück.
    }
    laden();
    abzeichenNeuLaden();
  };

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

  // Nur wenn noch NICHTS geladen ist, tritt der Fehler an die Stelle der Seite.
  // Der Fokus-Wechsel lädt im Hintergrund nach; scheitert das einmal (kurzer
  // Netzaussetzer, Serverneustart), soll die vorhandene Liste stehen bleiben und
  // nicht durch eine nackte Fehlerzeile ersetzt werden — genauso hält es
  // requests.tsx mit seinem Abzeichen.
  if (fehler && seiten == null) return <p className="error">{fehler}</p>;

  const q = filter.trim().toLowerCase();
  const gefiltert = (seiten ?? []).filter(
    (s) =>
      (!kategorie || s.tags.includes(kategorie)) &&
      (!q || s.titel.toLowerCase().includes(q) || s.auszug.toLowerCase().includes(q)),
  );
  const kategorien = [...new Set((seiten ?? []).flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));
  // Bezieht sich bewusst auf die GANZE Liste, nicht auf `gefiltert`: der Knopf
  // räumt alles auf, auch was der Filter gerade ausblendet.
  const hatNeue = (seiten ?? []).some((s) => s.neu);

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Alle Seiten</h1>
          <p className="muted">Weltwissen und Spielregeln — zum Nachschlagen mitten im Spiel.</p>
        </div>
        {user.isGm && (
          <div className="wiki-kopf-aktionen screen-only">
            <button className="small" disabled={indexBusy} onClick={() => void indexNeuBauen()}>
              {indexStatus || 'Suchindex neu aufbauen'}
            </button>
          </div>
        )}
      </div>

      <div className="wiki-filter screen-only">
        <form className="talent-search" onSubmit={(e) => e.preventDefault()}>
          <input
            type="search"
            placeholder="Liste filtern…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button type="button" className="small" onClick={() => setFilter('')} title="Filter zurücksetzen">
              ✕
            </button>
          )}
        </form>
        {/* Nur da, wenn es etwas wegzuräumen gibt — ein Knopf ohne Wirkung ist
            nur Rauschen. */}
        {hatNeue && (
          <button className="small wiki-alles-gelesen" onClick={() => void alleAlsGelesen()} title={'Alle „neu"-Marken entfernen'}>
            Alle gelesen
          </button>
        )}
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
            <Link className="wiki-tag" to="/wiki/kategorien">
              alle Kategorien →
            </Link>
          </div>
        )}
      </div>

      {seiten == null ? (
        <p className="muted">Lade…</p>
      ) : gefiltert.length === 0 ? (
        <p className="muted">
          {seiten.length === 0 ? (
            <>
              Noch keine Seiten. <Link to="/wiki/neu">Lege die erste an.</Link>
            </>
          ) : (
            'Keine Seite gefunden.'
          )}
        </p>
      ) : (
        <div className="cardlist">
          {gefiltert.map((s) => (
            <Link
              className={`card wiki-karte${s.neu ? ' wiki-karte-neu' : ''}`}
              key={s.slug}
              to={`/wiki/${s.slug}`}
            >
              <h3>
                {s.titel}
                {/* Von jemand anderem geändert, seit du diese Seite zuletzt
                    aufgeschlagen hast. */}
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
    </div>
  );
}
