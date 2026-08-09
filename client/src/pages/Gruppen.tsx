import { Link } from 'react-router-dom';
import { useAuth } from '../App';
import { useOverview } from './useOverview';

export default function GruppenPage() {
  const { user } = useAuth();
  const data = useOverview();

  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <h1>{user.isGm ? 'Alle Gruppen' : 'Meine Gruppen'}</h1>
      <div className="cardlist">
        {data.groups.map((g) => (
          <div className="card" key={g.id}>
            <h3>
              <Link to={`/gruppe/${g.id}`}>{g.name}</Link>
            </h3>
          </div>
        ))}
        {data.groups.length === 0 && <p className="muted">Keine Gruppen.</p>}
      </div>
    </>
  );
}
