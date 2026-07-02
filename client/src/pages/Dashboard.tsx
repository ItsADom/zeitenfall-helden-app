import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut } from '../api';
import { useAuth } from '../App';

interface Overview {
  characters: { id: number; name: string; group_id: number }[];
  groups: { id: number; name: string }[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [pw, setPw] = useState('');
  const [pwInfo, setPwInfo] = useState('');

  useEffect(() => {
    apiGet<Overview>('/api/overview').then(setData);
  }, []);

  const changePassword = async () => {
    setPwInfo('');
    try {
      await apiPut('/api/me/password', { password: pw });
      setPw('');
      setPwInfo('Passwort geändert.');
    } catch (err) {
      setPwInfo(err instanceof Error ? err.message : 'Fehler');
    }
  };

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
        {data.characters.length === 0 && <p className="muted">Noch keine Charaktere. {user.isGm ? 'Lege welche in der Verwaltung an.' : 'Der Spielleiter legt Charaktere für dich an.'}</p>}
      </div>

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

      <div className="panel" style={{ maxWidth: 420, marginTop: 24 }}>
        <h3>Passwort ändern</h3>
        <div className="field">
          <label>Neues Passwort</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="primary" onClick={changePassword} disabled={pw.length < 6}>
            Ändern
          </button>
        </div>
        {pwInfo && <p className="muted">{pwInfo}</p>}
      </div>
    </>
  );
}
