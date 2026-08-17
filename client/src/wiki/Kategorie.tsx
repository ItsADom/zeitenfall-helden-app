import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CollapsedText } from '../components/notes';
import { ladeKategorie } from './api';

// One category's pages.
//
// Categories are tags, not a tree: „Gareth" is a Stadt AND an Ort in Garetien
// AND a Schauplatz, and a tree would force somebody to pick one true home for
// it. Matching runs on the folded key, so „NPCs" and „npcs" are one category
// however people happen to type it.

export default function WikiKategorie() {
  const { tag = '' } = useParams();
  const [seiten, setSeiten] = useState<{ slug: string; titel: string; auszug: string }[] | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    setSeiten(null);
    ladeKategorie(tag)
      .then((d) => setSeiten(d.seiten))
      .catch(() => setFehler('Die Kategorie konnte nicht geladen werden.'));
  }, [tag]);

  if (fehler) return <p className="error">{fehler}</p>;

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>{tag}</h1>
          <p className="muted">
            {seiten == null ? 'Lade…' : `${seiten.length} ${seiten.length === 1 ? 'Seite' : 'Seiten'}`}
          </p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki">
            Zur Übersicht
          </Link>
        </div>
      </div>

      {seiten == null ? null : seiten.length === 0 ? (
        <p className="muted">Keine Seite in dieser Kategorie.</p>
      ) : (
        <div className="cardlist">
          {seiten.map((s) => (
            <Link className="card wiki-karte" key={s.slug} to={`/wiki/${s.slug}`}>
              <h3>{s.titel}</h3>
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
