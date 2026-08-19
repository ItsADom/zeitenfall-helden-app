import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CollapsiblePanel } from '../components/collapse';
import { ladeVerweise } from './api';

// „Verweise hierher" — which pages link to this one.
//
// The classic wiki answer to „where does this belong?": a page nobody links to
// is a page nobody finds. Loaded separately from the page itself so a slow or
// failing lookup never delays the text someone came to read.
//
// The list is filtered on the server, so a player never learns that a GM-only
// page links here.

export default function WikiVerweise({ slug }: { slug: string }) {
  const [verweise, setVerweise] = useState<{ slug: string; titel: string }[] | null>(null);

  useEffect(() => {
    let aktuell = true;
    setVerweise(null);
    ladeVerweise(slug)
      .then((d) => {
        if (aktuell) setVerweise(d.verweise);
      })
      .catch(() => {
        if (aktuell) setVerweise([]);
      });
    return () => {
      aktuell = false;
    };
  }, [slug]);

  if (verweise == null || verweise.length === 0) return null;

  return (
    <div className="wiki-verweise screen-only">
      <CollapsiblePanel collapseKey="wiki-verweise" title="Verweise hierher" rows={verweise.length}>
        <ul className="wiki-liste">
          {verweise.map((v) => (
            <li key={v.slug}>
              <Link to={`/wiki/${v.slug}`}>{v.titel}</Link>
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </div>
  );
}
