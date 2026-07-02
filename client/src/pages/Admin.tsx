import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';

interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  isGm: boolean;
}
interface AdminGroup {
  id: number;
  name: string;
  memberIds: number[];
}
interface AdminChar {
  id: number;
  name: string;
  owner_user_id: number;
  group_id: number;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [chars, setChars] = useState<AdminChar[]>([]);
  const [error, setError] = useState('');

  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '' });
  const [newGroup, setNewGroup] = useState('');
  const [newChar, setNewChar] = useState({ name: '', ownerUserId: 0, groupId: 0 });

  const reload = () => {
    setError('');
    apiGet<AdminUser[]>('/api/admin/users').then(setUsers).catch((e) => setError(String(e.message)));
    apiGet<AdminGroup[]>('/api/admin/groups').then(setGroups);
    apiGet<{ characters: AdminChar[] }>('/api/overview').then((o) => setChars(o.characters));
  };
  useEffect(reload, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const toggleMember = (g: AdminGroup, userId: number) => {
    const memberIds = g.memberIds.includes(userId) ? g.memberIds.filter((id) => id !== userId) : [...g.memberIds, userId];
    run(() => apiPut(`/api/admin/groups/${g.id}`, { memberIds }));
  };

  return (
    <>
      <h1>Verwaltung</h1>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <h2>Benutzer</h2>
        <table className="sheet">
          <thead>
            <tr>
              <th>Benutzername</th>
              <th>Anzeigename</th>
              <th>Rolle</th>
              <th>Neues Passwort</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <input
                    defaultValue={u.displayName}
                    onBlur={(e) => e.target.value !== u.displayName && run(() => apiPut(`/api/admin/users/${u.id}`, { displayName: e.target.value }))}
                  />
                </td>
                <td>{u.isGm ? 'Spielleiter' : 'Spieler'}</td>
                <td>
                  <input
                    placeholder="setzen…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        if (v) run(() => apiPut(`/api/admin/users/${u.id}`, { password: v }));
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </td>
                <td>
                  {!u.isGm && (
                    <button className="small" onClick={() => confirm(`Benutzer ${u.username} löschen?`) && run(() => apiDelete(`/api/admin/users/${u.id}`))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Neuer Benutzer</h4>
        <div style={{ display: 'flex', gap: 8, maxWidth: 700 }}>
          <input placeholder="Benutzername" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
          <input placeholder="Anzeigename" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
          <input placeholder="Passwort" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          <button
            className="primary"
            disabled={!newUser.username || !newUser.password}
            onClick={() =>
              run(async () => {
                await apiPost('/api/admin/users', newUser);
                setNewUser({ username: '', password: '', displayName: '' });
              })
            }
          >
            Anlegen
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Gruppen</h2>
        <table className="sheet">
          <thead>
            <tr>
              <th>Gruppe</th>
              <th>Mitglieder</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td style={{ width: 200 }}>{g.name}</td>
                <td>
                  {users
                    .filter((u) => !u.isGm)
                    .map((u) => (
                      <label key={u.id} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={g.memberIds.includes(u.id)} onChange={() => toggleMember(g, u.id)} /> {u.displayName}
                      </label>
                    ))}
                </td>
                <td>
                  <button className="small" onClick={() => confirm(`Gruppe ${g.name} löschen?`) && run(() => apiDelete(`/api/admin/groups/${g.id}`))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Neue Gruppe</h4>
        <div style={{ display: 'flex', gap: 8, maxWidth: 400 }}>
          <input placeholder="Name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button
            className="primary"
            disabled={!newGroup}
            onClick={() =>
              run(async () => {
                await apiPost('/api/admin/groups', { name: newGroup });
                setNewGroup('');
              })
            }
          >
            Anlegen
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Charaktere</h2>
        <table className="sheet">
          <thead>
            <tr>
              <th>Charakter</th>
              <th>Besitzer</th>
              <th>Gruppe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {chars.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/charakter/${c.id}`}>{c.name}</Link>
                </td>
                <td>
                  <select value={c.owner_user_id} onChange={(e) => run(() => apiPut(`/api/characters/${c.id}`, { ownerUserId: Number(e.target.value) }))}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={c.group_id} onChange={(e) => run(() => apiPut(`/api/characters/${c.id}`, { groupId: Number(e.target.value) }))}>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="small" onClick={() => confirm(`Charakter ${c.name} unwiderruflich löschen?`) && run(() => apiDelete(`/api/characters/${c.id}`))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Neuer Charakter</h4>
        <div style={{ display: 'flex', gap: 8, maxWidth: 700 }}>
          <input placeholder="Name" value={newChar.name} onChange={(e) => setNewChar({ ...newChar, name: e.target.value })} />
          <select value={newChar.ownerUserId} onChange={(e) => setNewChar({ ...newChar, ownerUserId: Number(e.target.value) })}>
            <option value={0}>Besitzer…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <select value={newChar.groupId} onChange={(e) => setNewChar({ ...newChar, groupId: Number(e.target.value) })}>
            <option value={0}>Gruppe…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!newChar.name || !newChar.ownerUserId || !newChar.groupId}
            onClick={() =>
              run(async () => {
                await apiPost('/api/admin/characters', newChar);
                setNewChar({ name: '', ownerUserId: 0, groupId: 0 });
              })
            }
          >
            Anlegen
          </button>
        </div>
      </div>
    </>
  );
}
