import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../api';

interface GroupData {
  group: { id: number; name: string };
  members: { id: number; username: string; displayName: string }[];
  characters: { id: number; name: string; ownerName: string; access: 'edit' | 'summary' | null }[];
}

export default function GroupPage() {
  const { id } = useParams();
  const [data, setData] = useState<GroupData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<GroupData>(`/api/groups/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <h1>Gruppe: {data.group.name}</h1>
      <p className="muted">Mitglieder: {data.members.map((m) => m.displayName).join(', ') || '—'}</p>
      <div className="cardlist">
        {data.characters.map((c) => (
          <div className="card" key={c.id}>
            <h3>
              <Link to={`/charakter/${c.id}`}>{c.name}</Link>
            </h3>
            <span className="muted">
              Spieler: {c.ownerName}
              {c.access === 'edit' ? ' · bearbeitbar' : ''}
            </span>
          </div>
        ))}
        {data.characters.length === 0 && <p className="muted">Keine Charaktere in dieser Gruppe.</p>}
      </div>
    </>
  );
}
