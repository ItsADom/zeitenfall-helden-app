import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { parseWiki } from '@shared/wikiMarkup';
import type { WikiSeiteVoll } from '@shared/wikiTypen';
import { ApiError } from '../api';
import WikiMarkup from './Markup';
import { ladeSeite } from './api';

// Reading a page. Read and edit are two routes rather than one view with a
// toggle: they are genuinely different renderings (a formatted document vs. its
// source), and splitting them is what makes an unsaved-changes guard and a
// conflict banner natural instead of bolted on.

export default function WikiSeite() {
  const { slug = '' } = useParams();
  const [seite, setSeite] = useState<WikiSeiteVoll | null>(null);
  const [kanonisch, setKanonisch] = useState<string | null>(null);
  const [fehler, setFehler] = useState('');

  const laden = useCallback(() => {
    setFehler('');
    setSeite(null);
    ladeSeite(slug)
      .then((d) => {
        setSeite(d.seite);
        setKanonisch(d.kanonisch);
      })
      .catch((e) => setFehler(e instanceof ApiError && e.status === 404 ? 'nicht-gefunden' : 'Fehler beim Laden'));
  }, [slug]);

  useEffect(laden, [laden]);

  // Reached through an old address after a rename: move the URL over so links
  // copied from here are the current ones.
  if (kanonisch && kanonisch !== slug) return <Navigate to={`/wiki/${kanonisch}`} replace />;

  if (fehler === 'nicht-gefunden') {
    return (
      <div className="wiki">
        <h1>Seite nicht gefunden</h1>
        <p className="muted">
          Diese Seite gibt es (noch) nicht.{' '}
          <Link to={`/wiki/neu?titel=${encodeURIComponent(slug)}`}>Jetzt anlegen</Link> oder{' '}
          <Link to="/wiki">zur Übersicht</Link>.
        </p>
      </div>
    );
  }
  if (fehler) return <p className="error">{fehler}</p>;
  if (!seite) return <p className="muted">Lade…</p>;

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>{seite.titel}</h1>
          <p className="muted wiki-meta">
            {seite.nr > 0 ? `Fassung ${seite.nr}` : 'Neu angelegt'}
            {seite.autorName && ` · zuletzt von ${seite.autorName}`}
            {seite.gmOnly && ' · nur Spielleiter'}
            {seite.geschuetzt && ' · geschützt'}
          </p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to={`/wiki/${seite.slug}/verlauf`}>
            Verlauf
          </Link>
          {seite.darfBearbeiten && (
            <Link className="primary" to={`/wiki/${seite.slug}/bearbeiten`}>
              Bearbeiten
            </Link>
          )}
        </div>
      </div>

      {seite.tags.length > 0 && (
        <div className="wiki-tags screen-only">
          {seite.tags.map((t) => (
            <Link key={t} className="wiki-tag" to={`/wiki/kategorie/${encodeURIComponent(t)}`}>
              {t}
            </Link>
          ))}
        </div>
      )}

      <WikiMarkup doc={parseWiki(seite.text)} ziele={seite.linkZiele} />
    </div>
  );
}
