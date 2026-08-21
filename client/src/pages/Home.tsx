import { Link } from 'react-router-dom';
import { useAuth } from '../App';
import { useOverview } from '../components/overview';
import { CHANGELOG, changelogGroups } from '../changelog';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Kompassrose hinter der Wortmarke — das Signaturbild der Startseite: der
// „Zeitenkompass", der die aus ihrer Zeit gefallenen Helden orientiert. Rein
// dekorativ (aria-hidden), färbt sich über currentColor in --on-accent ein.
function CompassRose() {
  return (
    <svg className="hero-compass" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="0.4" />
      {/* Nebenstrahlen (diagonal), schlank */}
      <path d="M50 6 L56 50 L50 94 L44 50 Z" fill="currentColor" opacity="0.5" transform="rotate(45 50 50)" />
      <path d="M6 50 L50 56 L94 50 L50 44 Z" fill="currentColor" opacity="0.5" transform="rotate(45 50 50)" />
      {/* Hauptstrahlen (N/O/S/W), kräftiger */}
      <path d="M50 4 L57 50 L50 96 L43 50 Z" fill="currentColor" />
      <path d="M4 50 L50 57 L96 50 L50 43 Z" fill="currentColor" />
      <circle cx="50" cy="50" r="4" fill="currentColor" />
    </svg>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const data = useOverview();
  const isGm = user.isGm || user.isAdmin;

  // Neuester veröffentlichter Eintrag (Entwürfe ohne Version bleiben außen vor,
  // gleiche Regel wie auf der Changelog-Seite und im Discord-Spiegel).
  const latest = CHANGELOG.find((e) => e.version);
  const groupNameOf = (id: number | null) =>
    id == null ? null : data?.groups.find((g) => g.id === id)?.name ?? null;

  return (
    <div className="home">
      <section className="hero">
        <CompassRose />
        <div className="hero-body">
          <h1 className="hero-wordmark">Zeitenkompass</h1>
          <p className="hero-tagline">
            Orientierung für Helden,<br />
            die aus der Zeit gefallen sind.
          </p>
          <p className="hero-welcome">Willkommen zurück, {user.displayName}.</p>
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>Deine Charaktere</h2>
          <Link to="/charaktere">{isGm ? 'Alle Charaktere' : 'Zur Übersicht'} →</Link>
        </div>

        {isGm ? (
          // Der Spielleiter „besitzt" alles — eine Charakterflut hätte hier keinen
          // Wert. Stattdessen die zwei Einstiege, die er wirklich braucht.
          <div className="cardlist">
            <Link className="card home-tile" to="/charaktere">
              <h3>Charakterliste</h3>
              <span className="muted">Alle Charaktere ansehen und öffnen.</span>
            </Link>
            <Link className="card home-tile" to="/verwaltung">
              <h3>Verwaltung</h3>
              <span className="muted">Kataloge, Nutzer, Gruppen und Anfragen.</span>
            </Link>
          </div>
        ) : !data ? (
          <p className="muted">Lade…</p>
        ) : data.characters.length === 0 ? (
          <p className="muted">
            Noch keine Charaktere. <Link to="/charaktere">Lege deinen ersten an.</Link>
          </p>
        ) : (
          <div className="cardlist">
            {data.characters.map((c) => {
              const grouped = c.group_id != null;
              const pending = !grouped && c.requested_group_id != null;
              return (
                <Link className="card home-tile" key={c.id} to={`/charakter/${c.id}`}>
                  <h3>{c.name}</h3>
                  <span className="muted">
                    {grouped
                      ? groupNameOf(c.group_id) ?? ''
                      : pending
                        ? `Wartet auf Freigabe: ${groupNameOf(c.requested_group_id) ?? ''}`
                        : 'Ohne Gruppe'}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>Nachschlagen</h2>
        </div>
        <div className="cardlist">
          {/* Wie in der Kopfleiste in einem neuen Tab: Nachschlagen mitten im
              Spiel soll den Bogen nicht wegnehmen, auf dem man gerade war. */}
          <a className="card home-tile" href="/wiki" target="_blank" rel="noopener noreferrer">
            <h3>Wiki ↗</h3>
            <span className="muted">Weltwissen und Spielregeln — öffnet in einem neuen Tab.</span>
          </a>
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>Neuste Änderungen</h2>
          <Link to="/changelog">Ganze Historie →</Link>
        </div>

        {latest ? (
          <div className="panel">
            <h3>{latest.title}</h3>
            <div className="changelog-meta">
              {latest.version && <span className="changelog-version">Version {latest.version}</span>}
              <time dateTime={latest.date}>{fmtDate(latest.date)}</time>
            </div>
            {latest.features
              ? // Wie auf der Changelog-Seite: mehrere gebündelte Funktionen
                // brauchen eigene Überschriften, sonst verschwinden ihre Punkte
                // (changelogGroups(latest) liefert für einen features-Eintrag
                // sonst nichts, weil added/changed/fixed auf Eintrags-Ebene leer sind).
                latest.features.map((feature) => (
                  <div className="changelog-feature" key={feature.title}>
                    <h4 className="changelog-feature-title">{feature.title}</h4>
                    {changelogGroups(feature).map((group, gi) => (
                      <div className="changelog-group" key={gi}>
                        {group.label && <h5 className="changelog-group-title">{group.label}</h5>}
                        <ul className="changelog-list">
                          {group.items.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))
              : changelogGroups(latest).map((group, gi) => (
                  <div className="changelog-group" key={gi}>
                    {group.label && <h4 className="changelog-group-title">{group.label}</h4>}
                    <ul className="changelog-list">
                      {group.items.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ))}
          </div>
        ) : (
          <p className="muted">Noch keine Einträge.</p>
        )}
      </section>
    </div>
  );
}
