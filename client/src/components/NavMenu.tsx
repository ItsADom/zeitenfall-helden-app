import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { useOverview, useOverviewRefresh } from './overview';

// Schnellzugriff-Menü in der Kopfleiste: die Beschriftung („Charaktere" /
// „Gruppen") verlinkt weiter auf die volle Listenseite; beim Überfahren (oder
// per Tastaturfokus) klappt darunter eine Liste auf, aus der man direkt zu
// einem Eintrag springt.
//
// Charaktere: Spieler sehen eine flache Liste, der Spielleiter dieselbe nach
// Gruppen gegliedert (er sieht alle). Gruppen sind für alle flach.

interface CharItem {
  id: number;
  name: string;
  group_id: number | null;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'de');

export default function NavMenu({ kind }: { kind: 'charaktere' | 'gruppen' }) {
  const { user } = useAuth();
  const overview = useOverview();
  const refresh = useOverviewRefresh();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const openNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
    refresh(); // stale-while-revalidate: sichtbar bleibt der zwischengespeicherte Stand
  };
  // Kleiner Verzug beim Schließen, damit der Weg von der Beschriftung ins Menü
  // nicht abreißt.
  const closeSoon = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const closeNow = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  };

  // Bei offenem Menü: Klick außerhalb und Escape schließen (wie beim Farbmenü).
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

  const listPath = kind === 'charaktere' ? '/charaktere' : '/gruppen';
  const label = kind === 'charaktere' ? 'Charaktere' : 'Gruppen';

  // Aktuell geöffneter Eintrag (zum Hervorheben).
  const activeCharId = matchId(location.pathname, 'charakter');
  const activeGroupId = matchId(location.pathname, 'gruppe');

  return (
    <div
      className={`nav-menu${open ? ' open' : ''}`}
      ref={wrapRef}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        // Verlässt der Fokus die ganze Gruppe, schließen.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeSoon();
      }}
    >
      <Link className="nav-menu-label" to={listPath} aria-haspopup="true" aria-expanded={open} onClick={closeNow}>
        {label}
      </Link>

      {open && (
        <div className="nav-flyout" role="menu">
          {overview == null ? (
            <p className="nav-flyout-empty muted">Lade…</p>
          ) : kind === 'charaktere' ? (
            <CharacterList overview={overview} isGm={!!user.isGm} activeId={activeCharId} onPick={closeNow} />
          ) : (
            <GroupList groups={overview.groups} activeId={activeGroupId} onPick={closeNow} />
          )}

          <Link className="nav-flyout-all" to={listPath} onClick={closeNow}>
            Alle anzeigen →
          </Link>
        </div>
      )}
    </div>
  );
}

function CharacterList({
  overview,
  isGm,
  activeId,
  onPick,
}: {
  overview: { characters: CharItem[]; groups: { id: number; name: string }[] };
  isGm: boolean;
  activeId: number | null;
  onPick: () => void;
}) {
  const chars = overview.characters;
  if (chars.length === 0) return <p className="nav-flyout-empty muted">Keine Charaktere</p>;

  // Spieler: flache, alphabetische Liste.
  if (!isGm) {
    return (
      <div className="nav-flyout-list">
        {[...chars].sort(byName).map((c) => (
          <CharLink key={c.id} c={c} active={c.id === activeId} onPick={onPick} />
        ))}
      </div>
    );
  }

  // Spielleiter: nach Gruppen gegliedert, gruppenlose Charaktere zuletzt.
  const groups = [...overview.groups].sort(byName);
  const groupless = [...chars].filter((c) => !groups.some((g) => g.id === c.group_id)).sort(byName);

  return (
    <div className="nav-flyout-list">
      {groups.map((g) => {
        const members = [...chars].filter((c) => c.group_id === g.id).sort(byName);
        if (members.length === 0) return null;
        return (
          <div className="nav-flyout-group" key={g.id}>
            <div className="nav-flyout-head">{g.name}</div>
            {members.map((c) => (
              <CharLink key={c.id} c={c} active={c.id === activeId} onPick={onPick} />
            ))}
          </div>
        );
      })}
      {groupless.length > 0 && (
        <div className="nav-flyout-group">
          <div className="nav-flyout-head">Ohne Gruppe</div>
          {groupless.map((c) => (
            <CharLink key={c.id} c={c} active={c.id === activeId} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupList({
  groups,
  activeId,
  onPick,
}: {
  groups: { id: number; name: string }[];
  activeId: number | null;
  onPick: () => void;
}) {
  if (groups.length === 0) return <p className="nav-flyout-empty muted">Keine Gruppen</p>;
  return (
    <div className="nav-flyout-list">
      {[...groups].sort(byName).map((g) => (
        <Link
          key={g.id}
          className={`nav-flyout-item${g.id === activeId ? ' active' : ''}`}
          to={`/gruppe/${g.id}`}
          role="menuitem"
          onClick={onPick}
        >
          {g.name}
        </Link>
      ))}
    </div>
  );
}

function CharLink({ c, active, onPick }: { c: CharItem; active: boolean; onPick: () => void }) {
  return (
    <Link className={`nav-flyout-item${active ? ' active' : ''}`} to={`/charakter/${c.id}`} role="menuitem" onClick={onPick}>
      {c.name}
    </Link>
  );
}

// Zieht die Zahl aus /charakter/<id> bzw. /gruppe/<id>; null, wenn nicht passend.
function matchId(pathname: string, segment: 'charakter' | 'gruppe'): number | null {
  const m = new RegExp(`^/${segment}/(\\d+)`).exec(pathname);
  return m ? Number(m[1]) : null;
}
