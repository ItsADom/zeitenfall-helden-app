import { Link } from 'react-router-dom';
import { useAuth } from '../App';
import { useHoverFlyout } from './useHoverFlyout';

// Der Name in der Kopfleiste als Flyout: „Profil" und „Einstellungen". Ersetzt
// den früheren eigenständigen Einstellungen-Eintrag in der Leiste. Gilt für
// alle Rollen, auch den Spielleiter (dort auf seine eigenen Charaktere
// beschränkt). Optik/Verhalten wie NavMenu.
export default function ProfileMenu() {
  const { user } = useAuth();
  const { open, wrapRef, closeNow, hoverProps } = useHoverFlyout<HTMLDivElement>();

  const label = `${user.displayName}${user.isGm ? ' (Spielleiter)' : ''}`;

  return (
    <div className={`nav-menu profile-menu${open ? ' open' : ''}`} ref={wrapRef} {...hoverProps}>
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
            <a
              className="nav-flyout-item"
              href="https://paypal.me/ItsADom"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={closeNow}
            >
              Kaffeekasse
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
