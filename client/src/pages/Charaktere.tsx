import { Link } from 'react-router-dom';
import { useAuth } from '../App';
import { useOverview } from './useOverview';

export default function CharaktereePage() {
  const { user } = useAuth();
  const data = useOverview();

  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <h1>{user.isGm ? 'Alle Charaktere' : 'Meine Charaktere'}</h1>
      <div className="cardlist">
        {data.characters.map((c) => (
          <div className="card" key={c.id}>
            <h3>
              <Link to={`/charakter/${c.id}`}>{c.name}</Link>
            </h3>
            <span className="muted">{data.groups.find((g) => g.id === c.group_id)?.name ?? ''}</span>
          </div>
        ))}
        {data.characters.length === 0 && (
          <p className="muted">
            Noch keine Charaktere.{' '}
            {user.isGm ? 'Lege welche unter „Kataloge & Nutzer" an.' : 'Der Spielleiter legt Charaktere für dich an.'}
          </p>
        )}
      </div>
    </>
  );
}
