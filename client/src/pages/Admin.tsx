import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';

interface CatalogColumn {
  key: string;
  label: string;
  width?: number;
}

// Editierbarer Katalog (Talente / Sprachen) — speichert je Feld beim Verlassen
function CatalogPanel({ type, title, columns }: { type: 'talents' | 'languages'; title: string; columns: CatalogColumn[] }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [neu, setNeu] = useState<Record<string, string>>({});

  const reload = () => {
    apiGet<{ talents: Record<string, unknown>[]; languages: Record<string, unknown>[] }>('/api/catalogs').then((c) =>
      setRows(c[type]),
    );
  };
  useEffect(reload, [type]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {title} ({rows.length} Einträge)
      </summary>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap" style={{ marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
        <table className="sheet">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <input
                      defaultValue={String(r[c.key] ?? '')}
                      onBlur={(e) => {
                        if (e.target.value !== String(r[c.key] ?? '')) {
                          run(() => apiPut(`/api/admin/catalogs/${type}/${r.id}`, { [c.key]: e.target.value }));
                        }
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="small"
                    title="Eintrag löschen"
                    onClick={() => confirm(`"${r.name}" aus dem Katalog löschen?`) && run(() => apiDelete(`/api/admin/catalogs/${type}/${r.id}`))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Neuer Eintrag</h4>
      <div style={{ display: 'flex', gap: 8 }}>
        {columns
          .filter((c) => c.key !== 'sort')
          .map((c) => (
            <input
              key={c.key}
              placeholder={c.label}
              value={neu[c.key] ?? ''}
              onChange={(e) => setNeu({ ...neu, [c.key]: e.target.value })}
            />
          ))}
        <button
          className="primary"
          disabled={!neu.name}
          onClick={() =>
            run(async () => {
              await apiPost(`/api/admin/catalogs/${type}`, { ...neu, sort: 9999 });
              setNeu({});
            })
          }
        >
          Anlegen
        </button>
      </div>
    </details>
  );
}

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
  const [importTarget, setImportTarget] = useState({ ownerUserId: 0, groupId: 0 });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

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

  const doImport = () =>
    run(async () => {
      if (!importFile) return;
      const text = await importFile.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('Datei ist kein gültiges JSON');
      }
      await apiPost('/api/admin/characters/import', { ...importTarget, payload });
      setImportFile(null);
      setImportTarget({ ownerUserId: 0, groupId: 0 });
      setFileKey((k) => k + 1);
    });

  const toggleMember = (g: AdminGroup, userId: number) => {
    const memberIds = g.memberIds.includes(userId) ? g.memberIds.filter((id) => id !== userId) : [...g.memberIds, userId];
    run(() => apiPut(`/api/admin/groups/${g.id}`, { memberIds }));
  };

  // Charaktere nach Gruppe, dann nach Name sortieren. Die Gruppennamen stehen
  // nur hier zur Verfügung (die API liefert lediglich group_id), darum im Client.
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? '';
  const sortedChars = [...chars].sort(
    (a, b) => groupName(a.group_id).localeCompare(groupName(b.group_id), 'de') || a.name.localeCompare(b.name, 'de'),
  );

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
            {sortedChars.map((c) => (
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

        <h4>Charakter importieren</h4>
        <p className="muted" style={{ marginTop: 0 }}>
          Legt aus einer Backup-JSON-Datei einen neuen Charakter an.
        </p>
        <div style={{ display: 'flex', gap: 8, maxWidth: 700, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            key={fileKey}
            type="file"
            accept="application/json,.json"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
          <select value={importTarget.ownerUserId} onChange={(e) => setImportTarget({ ...importTarget, ownerUserId: Number(e.target.value) })}>
            <option value={0}>Besitzer…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <select value={importTarget.groupId} onChange={(e) => setImportTarget({ ...importTarget, groupId: Number(e.target.value) })}>
            <option value={0}>Gruppe…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!importFile || !importTarget.ownerUserId || !importTarget.groupId} onClick={doImport}>
            Importieren
          </button>
        </div>
      </div>

      <h2>Kataloge</h2>
      <p className="muted">
        Änderungen wirken für alle Charaktere. Einträge, die von Charakteren verwendet werden, lassen sich nicht löschen.
      </p>
      <CatalogPanel
        type="talents"
        title="Talent-Katalog"
        columns={[
          { key: 'kategorie', label: 'Kategorie', width: 110 },
          { key: 'gruppe', label: 'Gruppe', width: 150 },
          { key: 'name', label: 'Name' },
          { key: 'probe', label: 'Probe', width: 110 },
          { key: 'ableiten', label: 'Ableiten' },
          { key: 'skill100', label: 'Meisterschaft (100 TaW)' },
          { key: 'sort', label: 'Sortierung', width: 80 },
        ]}
      />
      <CatalogPanel
        type="languages"
        title="Sprachen-Katalog"
        columns={[
          { key: 'kind', label: 'Art', width: 100 },
          { key: 'familie', label: 'Familie', width: 200 },
          { key: 'name', label: 'Name' },
          { key: 'komplexitaet', label: 'Komplexität', width: 110 },
          { key: 'sort', label: 'Sortierung', width: 80 },
        ]}
      />
    </>
  );
}
