import { useAuth } from '../App';
import ClickableCard from '../components/ClickableCard';
import { useOverview } from '../components/overview';

export default function GruppenPage() {
  const { user } = useAuth();
  const data = useOverview();

  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <h1>{user.isGm ? 'Alle Gruppen' : 'Meine Gruppen'}</h1>
      <div className="cardlist">
        {data.groups.map((g) => (
          <ClickableCard key={g.id} to={`/${g.isTemp ? 'event' : 'gruppe'}/${g.id}`}>
            <h3>{g.name}{g.isTemp && ' (Event)'}</h3>
          </ClickableCard>
        ))}
        {data.groups.length === 0 && <p className="muted">Keine Gruppen.</p>}
      </div>
    </>
  );
}
