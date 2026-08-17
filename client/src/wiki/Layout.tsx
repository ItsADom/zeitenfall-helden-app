import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../App';
import { useWikiKopfHeight } from '../components/stickyChrome';
import NeueSeiteDialog from './NeueSeiteDialog';

// The wiki's own chrome, around every route under /wiki.
//
// Built because the wiki previously had none: each screen drew its own heading
// and the overview alone carried the links, so from an article the only way
// back was the browser's back button. A wiki always has this bar — it is how
// you get anywhere from anywhere.
//
// Sticky, and therefore measured into `--wikikopf-h` rather than given a fixed
// height: the entries wrap to a second line on narrow windows, and everything
// that sticks below it (the editor bar, table headers, heading anchors) adds
// that variable instead of guessing.

export default function WikiLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const kopfRef = useWikiKopfHeight();
  const [suche, setSuche] = useState('');
  const [dialogOffen, setDialogOffen] = useState(false);

  // Coming back to a result list should show what was searched for, and leaving
  // the search should empty the field rather than keep a stale word in it.
  useEffect(() => {
    setSuche(pathname === '/wiki/suche' ? (params.get('q') ?? '') : '');
  }, [pathname, params]);

  return (
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

        <nav className="wiki-leiste-nav">
          {/* `end`, sonst gilt die Übersicht auf jeder Unterseite als aktiv. */}
          <NavLink to="/wiki" end>
            Alle Seiten
          </NavLink>
          <NavLink to="/wiki/kategorien">Kategorien</NavLink>
          <NavLink to="/wiki/aenderungen">Letzte Änderungen</NavLink>
          {user.isGm && <NavLink to="/wiki/papierkorb">Papierkorb</NavLink>}
          <button className="primary small" onClick={() => setDialogOffen(true)}>
            + Neue Seite
          </button>
        </nav>
      </div>

      <Outlet />

      <NeueSeiteDialog
        open={dialogOffen}
        onClose={() => setDialogOffen(false)}
        onAngelegt={(slug) => navigate(`/wiki/${slug}/bearbeiten`)}
      />
    </div>
  );
}
