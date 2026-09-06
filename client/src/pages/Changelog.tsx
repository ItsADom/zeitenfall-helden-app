import { CHANGELOG, COMING_SOON, KNOWN_BUGS, changelogGroups } from '../changelog';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function ChangelogPage() {
  // Nur veröffentlichte Einträge zeigen: ein Eintrag ohne `version` ist ein
  // Entwurf und bleibt für Spieler unsichtbar, bis er beim Release seine Nummer
  // bekommt (gleiche Regel wie beim Discord-Spiegel, siehe server/discord.ts).
  const released = CHANGELOG.filter((entry) => entry.version);
  return (
    <>
      <h1>Versionshistorie</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 20 }}>
        Was sich in der Heldenverwaltung getan hat — kurz zusammengefasst.
      </p>

      <div className="panel outlook">
        <section className="outlook-section coming-soon">
          <h3>Demnächst</h3>
          {COMING_SOON.length > 0 ? (
            <ul className="changelog-list">
              {COMING_SOON.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="muted outlook-empty">Derzeit ist nichts angekündigt.</p>
          )}
        </section>

        <hr className="outlook-divider" />

        <section className="outlook-section known-bugs">
          <h3>Bekannte Fehler</h3>
          {KNOWN_BUGS.length > 0 ? (
            <ul className="changelog-list">
              {KNOWN_BUGS.map((b, i) => (
                <li key={i}>
                  <strong>{b.title}</strong>
                  {b.status && <span className="known-bugs-status">{b.status}</span>}
                  {b.description && <div className="known-bugs-desc">{b.description}</div>}
                  {b.workaround && (
                    <div className="known-bugs-workaround">
                      <em>Vorerst:</em> {b.workaround}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted outlook-empty">Derzeit sind keine Fehler bekannt.</p>
          )}
        </section>
      </div>

      {released.length === 0 && <p className="muted">Noch keine Einträge.</p>}

      {released.map((entry) => (
        <div className="panel" id={`v${entry.version}`} key={`${entry.date}-${entry.title}`}>
          <h3>{entry.title}</h3>
          <div className="changelog-meta">
            {entry.version && <span className="changelog-version">Version {entry.version}</span>}
            <time dateTime={entry.date}>{fmtDate(entry.date)}</time>
          </div>
          {entry.features ? (
            // Mehrere große, unabhängig entstandene Funktionen im selben
            // Release — jede eigene, deutlich abgesetzte Überschrift, damit
            // ihre Punkte nicht in einer gemeinsamen Liste verschwimmen.
            entry.features.map((feature) => (
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
          ) : (
            changelogGroups(entry).map((group, gi) => (
              <div className="changelog-group" key={gi}>
                {group.label && <h4 className="changelog-group-title">{group.label}</h4>}
                <ul className="changelog-list">
                  {group.items.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ))}

      <p className="muted" style={{ marginTop: 20 }}>
        Diese App läuft auf privat finanzierten Servern. Wer die Serverkosten
        unterstützen möchte, findet im Profil-Menü oben rechts eine Kaffeekasse.
      </p>
    </>
  );
}
