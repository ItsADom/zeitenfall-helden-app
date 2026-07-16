import { CHANGELOG } from '../changelog';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function ChangelogPage() {
  return (
    <>
      <h1>Änderungen</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 20 }}>
        Was sich in der Heldenverwaltung getan hat — kurz zusammengefasst.
      </p>

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
