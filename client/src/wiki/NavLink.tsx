import { Link } from 'react-router-dom';

// The wiki's entry in the top bar.
//
// Opens in a NEW TAB on purpose: looking something up mid-session must not cost
// you the character sheet you were on. react-router's Link passes `target`
// through and lets the browser handle it natively, so no extra handler.
//
// Only this entry (and the home tile) do that — links INSIDE the wiki stay
// ordinary same-tab navigation, otherwise reading three linked pages would
// leave three tabs behind.

export default function WikiNavLink() {
  return (
    <Link to="/wiki" target="_blank" rel="noopener noreferrer" aria-label="Wiki — öffnet in neuem Tab">
      Wiki
      <span className="wiki-neuertab" aria-hidden>
        ↗
      </span>
    </Link>
  );
}
