import { createContext, useContext, useEffect } from 'react';
import type { WikiInhaltsZeile } from '@shared/wikiMarkup';

// Table of contents, built from the page's own headings — and the channel that
// gets it into the sidebar.
//
// The headings are only known where the page was parsed, but they belong in the
// left column, which the layout owns. A context carries them up rather than the
// layout parsing the text a second time: two parses would eventually disagree
// about the anchors, and then the index would jump to the wrong place.
//
// Plain `#anker` links rather than a click handler: they survive being copied
// out of the address bar, which is the whole point of an anchor. The headings
// already carry `scroll-margin-top` so a jump does not land underneath the
// sticky bars.

type Melder = (zeilen: WikiInhaltsZeile[]) => void;

const InhaltContext = createContext<Melder>(() => {});
export const WikiInhaltProvider = InhaltContext.Provider;

/**
 * Publishes this page's headings to the sidebar, and clears them again on the
 * way out — otherwise the index of the article you just left would sit next to
 * the next one.
 */
export function useInhaltMelden(zeilen: WikiInhaltsZeile[]): void {
  const melden = useContext(InhaltContext);
  useEffect(() => {
    melden(zeilen);
    return () => melden([]);
  }, [zeilen, melden]);
}

// Below three headings there is nothing to navigate — a two-line index above a
// two-section page is furniture, not help.
const MINDEST_UEBERSCHRIFTEN = 3;

export default function WikiInhalt({ zeilen }: { zeilen: WikiInhaltsZeile[] }) {
  if (zeilen.length < MINDEST_UEBERSCHRIFTEN) return null;
  return (
    <nav className="wiki-toc" aria-label="Inhalt dieser Seite">
      <div className="wiki-seitenleiste-titel">Inhalt</div>
      <ul className="wiki-toc-liste">
        {zeilen.map((z, i) => (
          <li key={i} className={`wiki-toc-e${z.ebene}`}>
            <a href={`#${z.anker}`}>{z.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
