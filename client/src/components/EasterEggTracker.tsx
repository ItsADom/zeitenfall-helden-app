import { useEffect, useState } from 'react';
import { apiGet } from '../api';

interface FoundEgg {
  key: string;
  name: string;
  medallion: string;
  description: string;
  finderDisplayName: string;
  foundAt: number;
}

const fmtGefundenAm = (ms: number) =>
  new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

// Ganz am Ende der Changelog-Seite (TODO.md „Easter egg tracker") — bewusst
// OHNE eigenen Nav-Eintrag oder eigene Route: wer bis hierher scrollt, findet
// sie; niemand wird von irgendwo sonst in der App dorthin verlinkt. Zeigt nur
// bereits gefundene Eier (Name/Beschreibung/Symbol kommen für ein
// unentdecktes NIE über die Leitung, siehe routes.ts) plus einer "???"-Zeile,
// solange mindestens eines noch fehlt.
export default function EasterEggTracker() {
  const [found, setFound] = useState<FoundEgg[] | null>(null);
  const [moreToFind, setMoreToFind] = useState(false);

  useEffect(() => {
    let aktuell = true;
    apiGet<{ found: FoundEgg[]; moreToFind: boolean }>('/api/easter-eggs')
      .then((data) => {
        if (!aktuell) return;
        setFound(data.found);
        setMoreToFind(data.moreToFind);
      })
      .catch(() => {
        // Keine Liste ist auch eine Antwort — kein Absturz, einfach still.
      });
    return () => {
      aktuell = false;
    };
  }, []);

  if (found === null) return null;

  return (
    <div className="egg-tracker">
      <h2 className="egg-tracker-head">Easter Eggs</h2>
      <p className="egg-tracker-intro">
        Wer als Erstes ein Ei fand, steht hier für alle sichtbar. Was noch niemand gefunden hat, bleibt verborgen.
      </p>
      <ul className="egg-tracker-list">
        {found.length === 0 && moreToFind && (
          <li className="egg-tracker-item egg-tracker-item--teaser">
            <span className="egg-tracker-medallion">?</span>
            <span className="egg-tracker-name">???</span>
          </li>
        )}
        {found.map((e) => (
          <li className="egg-tracker-item" key={e.key}>
            <span className="egg-tracker-medallion">{e.medallion}</span>
            <div className="egg-tracker-body">
              <p className="egg-tracker-name">{e.name}</p>
              <p className="egg-tracker-desc">{e.description}</p>
              <p className="egg-tracker-meta">
                <span className="egg-tracker-finder">{e.finderDisplayName}</span>
                <span className="egg-tracker-sep">·</span>
                <span>zuerst gefunden am {fmtGefundenAm(e.foundAt)}</span>
              </p>
            </div>
          </li>
        ))}
        {found.length > 0 && moreToFind && (
          <li className="egg-tracker-item egg-tracker-item--teaser">
            <span className="egg-tracker-medallion">?</span>
            <span className="egg-tracker-name">???</span>
          </li>
        )}
      </ul>
    </div>
  );
}
