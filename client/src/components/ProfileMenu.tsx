import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../App';

// Der Name in der Kopfleiste als Flyout: „Profil" und „Einstellungen". Ersetzt
// den früheren eigenständigen Einstellungen-Eintrag in der Leiste. Der
// Spielleiter hat keine Einstellungen-Seite — für ihn bleibt es ein schlichter
// Profil-Link ohne Klappmenü. Optik/Verhalten wie NavMenu.
export default function ProfileMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const openNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const closeNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const label = `${user.displayName}${user.isGm ? ' (Spielleiter)' : ''}`;

  if (user.isGm) {
    return <Link to="/profil">{label}</Link>;
  }

  return (
    <div
      className={`nav-menu profile-menu${open ? ' open' : ''}`}
      ref={wrapRef}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeSoon();
      }}
    >
      <Link className="nav-menu-label" to="/profil" aria-haspopup="true" aria-expanded={open} onClick={closeNow}>
        {label}
      </Link>
      {open && (
        <div className="nav-flyout" role="menu">
          <div className="nav-flyout-list">
            <Link className="nav-flyout-item" to="/profil" role="menuitem" onClick={closeNow}>
              Profil
            </Link>
            <Link className="nav-flyout-item" to="/einstellungen" role="menuitem" onClick={closeNow}>
              Einstellungen
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
