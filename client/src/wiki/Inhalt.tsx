import type { WikiInhaltsZeile } from '@shared/wikiMarkup';
import { CollapsiblePanel } from '../components/collapse';

// Table of contents, built from the page's own headings.
//
// Plain `#anker` links rather than a click handler: they survive being copied
// out of the address bar, which is the whole point of an anchor. The headings
// already carry `scroll-margin-top` so a jump does not land underneath the
// sticky top bar.
//
// Below three headings there is nothing to navigate — a two-line index above a
// two-section page is furniture, not help.
const MINDEST_UEBERSCHRIFTEN = 3;

export default function WikiInhalt({ zeilen }: { zeilen: WikiInhaltsZeile[] }) {
  if (zeilen.length < MINDEST_UEBERSCHRIFTEN) return null;
  return (
    <div className="wiki-toc screen-only">
      <CollapsiblePanel collapseKey="wiki-toc" title="Inhalt" rows={zeilen.length}>
        <ul className="wiki-toc-liste">
          {zeilen.map((z, i) => (
            <li key={i} className={`wiki-toc-e${z.ebene}`}>
              <a href={`#${z.anker}`}>{z.text}</a>
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </div>
  );
}
