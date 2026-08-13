import { CHANGELOG, COMING_SOON, KNOWN_BUGS } from '../changelog';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function ChangelogPage() {
  return (
    <>
      <h1>Versionshistorie</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 20 }}>
        Was sich in der Heldenverwaltung getan hat — kurz zusammengefasst.
      </p>

      {COMING_SOON.length > 0 && (
        <div className="panel coming-soon">
          <h3>Demnächst</h3>
          <ul className="changelog-list">
            {COMING_SOON.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {KNOWN_BUGS.length > 0 && (
        <div className="panel known-bugs">
          <h3>Bekannte Fehler</h3>
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
        </div>
      )}

      {CHANGELOG.length === 0 && <p className="muted">Noch keine Einträge.</p>}

      {CHANGELOG.map((entry) => (
        <div className="panel" key={`${entry.date}-${entry.title}`}>
          <h3>{entry.title}</h3>
          <div className="changelog-meta">
            {entry.version && <span className="changelog-version">Version {entry.version}</span>}
            <time dateTime={entry.date}>{fmtDate(entry.date)}</time>
          </div>
          <ul className="changelog-list">
            {entry.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
