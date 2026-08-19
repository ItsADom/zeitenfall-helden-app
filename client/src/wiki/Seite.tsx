import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { inhaltsverzeichnis, parseWiki } from '@shared/wikiMarkup';
import { teileTitel } from '@shared/wikiNamensraum';
import { wikiTagKey } from '@shared/wikiTags';
import type { WikiSeiteVoll } from '@shared/wikiTypen';
import { ApiError } from '../api';
import { useAuth } from '../App';
import { useInhaltMelden } from './Inhalt';
import WikiMarkup from './Markup';
import WikiSeitenrechte from './Seitenrechte';
import WikiVerweise from './Verweise';
import { ladeSeite } from './api';

// Reading a page. Read and edit are two routes rather than one view with a
// toggle: they are genuinely different renderings (a formatted document vs. its
// source), and splitting them is what makes an unsaved-changes guard and a
// conflict banner natural instead of bolted on.

/**
 * Was geladen ist — und WOFÜR es geladen wurde.
 *
 * Der Schlüssel gehört zwingend mit ins selbe Zustandsobjekt. Lagen die Werte
 * einzeln daneben, beschrieben sie nach einem Klick auf einen [[Wikilink]] noch
 * die vorige Seite, während `slug` schon die neue war — und die
 * Weiterleitungsprüfung unten las diesen Unterschied als Umbenennung und schickte
 * dorthin zurück, wo man gerade weg wollte. Zurücksetzen im Effekt hilft dagegen
 * NICHT: der läuft erst nach dem Rendern, das den Schaden anrichtet.
 *
 * Mit dem Schlüssel im Objekt gibt es nichts mehr zurückzusetzen. Was nicht zur
 * aktuellen Adresse gehört, wird beim Ableiten verworfen, und ein vergessenes
 * `setX(null)` kann es gar nicht mehr geben.
 */
interface Geladen {
  schluessel: string;
  seite: WikiSeiteVoll | null;
  kanonisch: string;
  fehler: string;
}

export default function WikiSeite() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [geladen, setGeladen] = useState<Geladen | null>(null);

  // „?folgen=nein" — reached deliberately THROUGH the „weitergeleitet von"
  // note, to look at the signpost itself rather than where it points.
  const folgen = params.get('folgen') !== 'nein';
  // Beides bestimmt, WAS geladen wird, also gehört beides in den Schlüssel.
  const schluessel = `${slug}|${folgen ? 'folgen' : 'halt'}`;

  // Alles, was nicht zu dieser Adresse gehört, ist von der Seite davor.
  const daten = geladen?.schluessel === schluessel ? geladen : null;

  const laden = useCallback(() => {
    let aktuell = true;
    ladeSeite(slug, folgen)
      .then((d) => {
        // Antwort einer Seite, die man inzwischen verlassen hat: verwerfen.
        // Ohne das gewinnt die langsamste Anfrage statt der letzten.
        if (aktuell) setGeladen({ schluessel, seite: d.seite, kanonisch: d.kanonisch, fehler: '' });
      })
      .catch((e) => {
        if (!aktuell) return;
        const fehler = e instanceof ApiError && e.status === 404 ? 'nicht-gefunden' : 'Fehler beim Laden';
        setGeladen({ schluessel, seite: null, kanonisch: '', fehler });
      });
    return () => {
      aktuell = false;
    };
  }, [slug, folgen, schluessel]);

  // Der Rückgabewert von `laden` ist die Abmeldung — useEffect räumt damit beim
  // Wechsel die noch offene Anfrage ab.
  useEffect(laden, [laden]);

  // Parsed once per text: the rendering and the table of contents must agree
  // about the heading anchors, and they only do if they read the same tree.
  const doc = useMemo(() => parseWiki(daten?.seite?.text ?? ''), [daten?.seite?.text]);
  const toc = useMemo(() => inhaltsverzeichnis(doc), [doc]);

  // Das Inhaltsverzeichnis gehört in die linke Spalte, die das Layout besitzt —
  // gemeldet statt dort noch einmal geparst, sonst könnten die Anker der beiden
  // Parsedurchläufe irgendwann auseinanderlaufen. Beim Wechsel ist es leer,
  // statt weiter die Gliederung der vorigen Seite zu zeigen.
  useInhaltMelden(toc);

  if (daten?.fehler === 'nicht-gefunden') {
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
  if (daten?.fehler) return <p className="error">{daten.fehler}</p>;
  if (!daten?.seite) return <p className="muted">Lade…</p>;
  const seite = daten.seite;

  // Über eine alte Adresse gekommen (Umbenennung): die URL nachziehen, damit von
  // hier kopierte Verweise die aktuellen sind. Steht bewusst NACH dem Laden —
  // nur eine Antwort zu genau dieser Adresse darf eine Weiterleitung auslösen.
  // Einer gefolgten Weiterleitung folgt das NICHT: der Server lässt `kanonisch`
  // dort auf dem Wegweiser stehen, damit die Adresse bleibt, wo der Leser sie
  // eingetippt hat — so hält es Wikipedia auch.
  if (daten.kanonisch !== slug) return <Navigate to={`/wiki/${daten.kanonisch}`} replace />;

  // A category page belongs in the category view, which shows its description
  // AND what is in it. Reaching it under its own address is not wrong, just
  // half the picture.
  if (seite.namensraum === 'kategorie') {
    const key = wikiTagKey(teileTitel(seite.titel).name);
    if (key) return <Navigate to={`/wiki/kategorie/${encodeURIComponent(key)}`} replace />;
  }

  // Standing ON a signpost (reached with ?folgen=nein, or its target is gone).
  // Rendering the source would show a heading shouting „WEITERLEITUNG".
  const istWegweiser = !!seite.weiterleitung;
  const zielTitel = istWegweiser ? seite.linkZiele[seite.weiterleitung!] : null;

  return (
    <div className="wiki">
      {seite.tags.length > 0 && (
        <nav className="wiki-brotkrumen screen-only" aria-label="Pfad">
          <Link to="/wiki">Wiki</Link>
          <span aria-hidden>›</span>
          <Link to={`/wiki/kategorie/${encodeURIComponent(seite.tags[0])}`}>{seite.tags[0]}</Link>
          <span aria-hidden>›</span>
          <span>{seite.titel}</span>
        </nav>
      )}

      <div className="wiki-kopf">
        <div>
          <h1>{seite.titel}</h1>
          {seite.weitergeleitetVon && (
            <p className="muted wiki-weitergeleitet screen-only">
              (weitergeleitet von{' '}
              <Link to={`/wiki/${seite.weitergeleitetVon.slug}?folgen=nein`}>{seite.weitergeleitetVon.titel}</Link>)
            </p>
          )}
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

      {user.isGm && <WikiSeitenrechte seite={seite} onGeaendert={laden} />}

      {seite.tags.length > 0 && (
        <div className="wiki-tags screen-only">
          {seite.tags.map((t) => (
            <Link key={t} className="wiki-tag" to={`/wiki/kategorie/${encodeURIComponent(t)}`}>
              {t}
            </Link>
          ))}
        </div>
      )}

      {istWegweiser ? (
        <p className="wiki-wegweiser">
          <span aria-hidden>↳</span> Diese Seite ist eine Weiterleitung auf{' '}
          {zielTitel ? (
            <Link className="wiki-link" to={`/wiki/${seite.weiterleitung}`}>
              {zielTitel}
            </Link>
          ) : (
            <>
              <span className="wiki-rotlink">{seite.weiterleitung}</span> — dorthin führt zurzeit nichts, das Ziel gibt
              es nicht (mehr).
            </>
          )}
        </p>
      ) : (
        <WikiMarkup doc={doc} ziele={seite.linkZiele} />
      )}

      <WikiVerweise slug={seite.slug} />
    </div>
  );
}
