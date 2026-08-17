import { useMemo } from 'react';
import { diffAbschnitte, zeilenDiff } from '@shared/wikiDiff';

// Line diff between two revisions.
//
// Computed in the browser from two fetched texts — the server stores only the
// +n/−m summary, because that is all a list needs and diffing every page to
// render one would be absurd.
//
// Only changed regions are shown, with three lines of context around them: a
// one-word fix in a 400-line page should be one small block, not 400 lines to
// scroll past. A gap between regions gets a marker so nobody mistakes the jump
// for a deletion.

export default function WikiDiff({ alt, neu }: { alt: string; neu: string }) {
  const abschnitte = useMemo(() => diffAbschnitte(zeilenDiff(alt, neu)), [alt, neu]);

  if (abschnitte.length === 0) {
    return <p className="muted">Kein Unterschied im Text.</p>;
  }

  return (
    <div className="wiki-diff">
      {abschnitte.map((abschnitt, ai) => (
        <div className="wiki-diff-block" key={ai}>
          {ai > 0 && <div className="wiki-diff-luecke">⋯</div>}
          {abschnitt.map((z, zi) => (
            <div className={`wiki-diff-zeile wiki-diff-${z.art}`} key={zi}>
              <span className="wiki-diff-nr" aria-hidden>
                {z.nrAlt ?? ''}
              </span>
              <span className="wiki-diff-nr" aria-hidden>
                {z.nrNeu ?? ''}
              </span>
              <span className="wiki-diff-zeichen" aria-hidden>
                {z.art === 'plus' ? '+' : z.art === 'minus' ? '−' : ' '}
              </span>
              {/* Leere Zeilen sollen ihre Höhe behalten. */}
              <span className="wiki-diff-text">{z.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
