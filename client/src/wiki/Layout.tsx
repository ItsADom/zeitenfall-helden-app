import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { WikiInhaltsZeile } from '@shared/wikiMarkup';
import { useAuth } from '../App';
import { useWikiKopfHeight } from '../components/stickyChrome';
import NeueSeiteDialog from './NeueSeiteDialog';
import WikiInhalt, { WikiInhaltProvider } from './Inhalt';

// The wiki's own chrome, around every route under /wiki.
//
// Two pieces, split the way every wiki splits them: a bar across the top for
// the things you DO (search, write a page) and a column down the left for the
// places you GO. Putting navigation in both would only make the same four links
// appear twice.
//
// The bar is sticky and therefore measured into `--wikikopf-h` rather than
// given a fixed height: its entries wrap to a second line on narrow windows,
// and everything that sticks below it — the sidebar included — adds that
// variable instead of guessing.

export default function WikiLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const kopfRef = useWikiKopfHeight();
  const [suche, setSuche] = useState('');
  const [dialogOffen, setDialogOffen] = useState(false);
  // Gemeldet von der Seite, die gerade gelesen wird — siehe Inhalt.tsx.
  const [inhalt, setInhalt] = useState<WikiInhaltsZeile[]>([]);

  // Coming back to a result list should show what was searched for, and leaving
  // the search should empty the field rather than keep a stale word in it.
  useEffect(() => {
    setSuche(pathname === '/wiki/suche' ? (params.get('q') ?? '') : '');
  }, [pathname, params]);

  return (
    <WikiInhaltProvider value={setInhalt}>
      <div className="wiki-schale">
        <div className="wiki-leiste screen-only" ref={kopfRef}>
          <Link className="wiki-wortmarke" to="/wiki">
            Zeitenkompass-Wiki
          </Link>

          <form
            className="wiki-leiste-suche"
            onSubmit={(e) => {
              e.preventDefault();
              if (suche.trim()) navigate(`/wiki/suche?q=${encodeURIComponent(suche.trim())}`);
            }}
          >
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Im Wiki suchen…"
              aria-label="Im Wiki suchen"
            />
          </form>

          <button className="primary small" onClick={() => setDialogOffen(true)}>
            + Neue Seite
          </button>
        </div>

        <div className="wiki-koerper">
          <aside className="wiki-seitenleiste screen-only">
            <nav className="wiki-seitenleiste-nav" aria-label="Wiki-Navigation">
              <div className="wiki-seitenleiste-titel">Navigation</div>
              {/* `end`, sonst gilt die Übersicht auf jeder Unterseite als aktiv. */}
              <NavLink to="/wiki" end>
                Alle Seiten
              </NavLink>
              <NavLink to="/wiki/kategorien">Kategorien</NavLink>
              <NavLink to="/wiki/aenderungen">Letzte Änderungen</NavLink>
              {user.isGm && <NavLink to="/wiki/papierkorb">Papierkorb</NavLink>}
            </nav>

            <WikiInhalt zeilen={inhalt} />
          </aside>

          <div className="wiki-spalte">
            <Outlet />
          </div>
        </div>

        <NeueSeiteDialog
          open={dialogOffen}
          onClose={() => setDialogOffen(false)}
          onAngelegt={(slug) => navigate(`/wiki/${slug}/bearbeiten`)}
        />
      </div>
    </WikiInhaltProvider>
  );
}
