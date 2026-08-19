import { Link, useLocation } from 'react-router-dom';
import { WikiBadge } from './news';

// The wiki's entry in the top bar.
//
// Opens in a NEW TAB from anywhere else in the app: looking something up
// mid-session must not cost you the character sheet you were on. react-router's
// Link passes `target` through and lets the browser handle it natively, so no
// extra handler.
//
// But NOT when you are already in the wiki. There the same click used to open a
// third tab, which made this entry useless as the way home — and the wiki has
// no other, since it is reached in its own tab in the first place. Inside
// /wiki it is an ordinary same-tab link to the overview.
//
// Links INSIDE the wiki stay same-tab for the same reason: reading three linked
// pages would otherwise leave three tabs behind.

export default function WikiNavLink() {
  const imWiki = useLocation().pathname.startsWith('/wiki');

  if (imWiki) {
    return (
      <Link to="/wiki">
        Wiki
        <WikiBadge />
      </Link>
    );
  }

  return (
    <Link to="/wiki" target="_blank" rel="noopener noreferrer" aria-label="Wiki — öffnet in neuem Tab">
      Wiki
      <WikiBadge />
      <span className="wiki-neuertab" aria-hidden>
        ↗
      </span>
    </Link>
  );
}
