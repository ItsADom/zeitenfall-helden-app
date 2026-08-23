import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parseWiki } from '@shared/wikiMarkup';
import { kategorieTitel } from '@shared/wikiNamensraum';
import type { WikiKategorieAnsicht } from '@shared/wikiTypen';
import { CollapsedText } from '../components/notes';
import WikiMarkup from './Markup';
import { ladeKategorie } from './api';

// One category.
//
// Categories are tags, not a tree that anyone has to design: „Gareth" is a
// Stadt AND an Ort in Garetien AND a Schauplatz, and a real hierarchy would
// force somebody to pick one true home for it. Matching runs on the folded key,
// so „NPCs" and „npcs" are one category however people happen to type it.
//
// What DOES make a tree is that a category may itself be a page („Kategorie:
// Städte") carrying categories of its own. Structure grows out of the same
// mechanism instead of a second one, and a category with no description page
// still works — the red link asking for one is the invitation to write it.

export default function WikiKategorie() {
  const { tag = '' } = useParams();
  const [daten, setDaten] = useState<WikiKategorieAnsicht | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    // Verworfen, sobald man weiterklickt: sonst gewinnt die langsamste Antwort
    // statt der letzten, und man liest eine Kategorie unter der Überschrift
    // einer anderen.
    let aktuell = true;
    setDaten(null);
    setFehler('');
    ladeKategorie(tag)
      .then((d) => {
        if (aktuell) setDaten(d);
      })
      .catch(() => {
        if (aktuell) setFehler('Die Kategorie konnte nicht geladen werden.');
      });
    return () => {
      aktuell = false;
    };
  }, [tag]);

  const doc = useMemo(() => parseWiki(daten?.seite?.text ?? ''), [daten?.seite?.text]);

  if (fehler) return <p className="error">{fehler}</p>;
  if (!daten) return <p className="muted">Lade…</p>;

  const { seite } = daten;
  const leer = daten.seiten.length === 0 && daten.unterkategorien.length === 0;

  return (
    <div className="wiki">
      <nav className="wiki-brotkrumen screen-only" aria-label="Pfad">
        <Link to="/wiki">Wiki</Link>
        <span aria-hidden>›</span>
        <Link to="/wiki/kategorien">Kategorien</Link>
        <span aria-hidden>›</span>
        <span>{daten.tag}</span>
      </nav>

      <div className="wiki-kopf">
        <div>
          <h1>
            <span className="wiki-namensraum">Kategorie:</span> {daten.tag}
          </h1>
          <p className="muted wiki-meta">
            {daten.seiten.length} {daten.seiten.length === 1 ? 'Seite' : 'Seiten'}
            {daten.unterkategorien.length > 0 &&
              ` · ${daten.unterkategorien.length} ${
                daten.unterkategorien.length === 1 ? 'Unterkategorie' : 'Unterkategorien'
              }`}
          </p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          {seite ? (
            <>
              <Link className="small" to={`/wiki/${seite.slug}/verlauf`}>
                Verlauf
              </Link>
              {seite.darfBearbeiten && (
                <Link className="small" to={`/wiki/${seite.slug}/bearbeiten`}>
                  Beschreibung bearbeiten
                </Link>
              )}
            </>
          ) : (
            <Link className="small" to={`/wiki/neu?titel=${encodeURIComponent(kategorieTitel(daten.tag))}`}>
              Beschreibung anlegen
            </Link>
          )}
        </div>
      </div>

      {/* Die Kategorien der Beschreibungsseite selbst — der Weg nach oben. */}
      {daten.eltern.length > 0 && (
        <div className="wiki-tags screen-only">
          {daten.eltern.map((e) => (
            <Link key={e} className="wiki-tag" to={`/wiki/kategorie/${encodeURIComponent(e)}`}>
              {e}
            </Link>
          ))}
        </div>
      )}

      {seite ? (
        <WikiMarkup doc={doc} ziele={seite.linkZiele} />
      ) : (
        <p className="muted">
          Diese Kategorie hat noch keine Beschreibung.{' '}
          <Link to={`/wiki/neu?titel=${encodeURIComponent(kategorieTitel(daten.tag))}`}>Jetzt schreiben</Link> — die
          Seite trägt dann selbst Kategorien und ordnet sich damit ein.
        </p>
      )}

      {daten.unterkategorien.length > 0 && (
        <>
          <h2>Unterkategorien</h2>
          <div className="wiki-tags">
            {daten.unterkategorien.map((k) => (
              <Link key={k.key} className="wiki-tag" to={`/wiki/kategorie/${encodeURIComponent(k.key)}`}>
                {k.tag} ({k.anzahl})
              </Link>
            ))}
          </div>
        </>
      )}

      {daten.seiten.length > 0 && (
        <>
          <h2>Seiten</h2>
          <div className="cardlist">
            {daten.seiten.map((s) => (
              <Link
                className={`card wiki-karte${s.neu ? ' wiki-karte-neu' : ''}`}
                key={s.slug}
                to={`/wiki/${s.slug}`}
              >
                <h3>
                  {s.titel}
                  {/* Dieselbe Marke wie auf der Übersicht — es ist dieselbe
                      Kartenliste, nur nach Kategorie geschnitten. */}
                  {s.neu && <span className="wiki-marke wiki-marke-neu">neu</span>}
                </h3>
                {s.auszug ? (
                  <CollapsedText className="muted" text={s.auszug} />
                ) : (
                  <span className="muted">Noch ohne Inhalt.</span>
                )}
              </Link>
            ))}
          </div>
        </>
      )}

      {leer && <p className="muted">Noch keine Seite in dieser Kategorie.</p>}
    </div>
  );
}
