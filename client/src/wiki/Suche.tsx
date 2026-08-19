import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { schnipselTeile } from '@shared/wikiSuche';
import type { WikiTreffer } from '@shared/wikiTypen';
import { sucheSeiten } from './api';

// Search results.
//
// The snippet arrives with matches wrapped in « », not in HTML tags: nothing in
// this app renders markup from data, and a snippet is data. Splitting on the
// guillemets and emitting <mark> keeps that true — the highlight is built by
// the renderer, never sent by the server.

function Schnipsel({ text }: { text: string }) {
  return (
    <>
      {schnipselTeile(text).map((t, i) => (t.mark ? <mark key={i}>{t.text}</mark> : <span key={i}>{t.text}</span>))}
    </>
  );
}

export default function WikiSuche() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [feld, setFeld] = useState(q);
  const [treffer, setTreffer] = useState<WikiTreffer[] | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => setFeld(q), [q]);

  useEffect(() => {
    if (!q.trim()) {
      setTreffer([]);
      return;
    }
    // Beim Tippen laufen mehrere Anfragen gleichzeitig; ohne Abmeldung zeigt
    // am Ende die langsamste ihre Treffer zu einem Suchwort, das nicht mehr
    // im Feld steht.
    let aktuell = true;
    setTreffer(null);
    setFehler('');
    sucheSeiten(q)
      .then((d) => {
        if (aktuell) setTreffer(d.treffer);
      })
      .catch(() => {
        if (aktuell) setFehler('Die Suche ist fehlgeschlagen.');
      });
    return () => {
      aktuell = false;
    };
  }, [q]);

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Suche</h1>
          <p className="muted">Durchsucht Titel und Text aller Seiten, die du sehen darfst.</p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki">
            Zur Übersicht
          </Link>
        </div>
      </div>

      <form
        className="wiki-filter screen-only"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(feld.trim() ? { q: feld.trim() } : {});
        }}
      >
        <div className="talent-search">
          <input
            type="search"
            value={feld}
            onChange={(e) => setFeld(e.target.value)}
            placeholder="Suchbegriff…"
            autoFocus
          />
        </div>
        <button className="primary" type="submit">
          Suchen
        </button>
      </form>

      {fehler && <p className="error">{fehler}</p>}

      {!q.trim() ? (
        <p className="muted">Gib oben ein, wonach du suchst.</p>
      ) : treffer == null ? (
        <p className="muted">Suche…</p>
      ) : treffer.length === 0 ? (
        <p className="muted">
          Nichts gefunden. <Link to={`/wiki/neu?titel=${encodeURIComponent(q)}`}>Seite „{q}" anlegen?</Link>
        </p>
      ) : (
        <ul className="wiki-treffer">
          {treffer.map((t) => (
            <li key={t.slug}>
              <Link to={`/wiki/${t.slug}`}>{t.titel}</Link>
              <p className="muted">
                <Schnipsel text={t.schnipsel} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
