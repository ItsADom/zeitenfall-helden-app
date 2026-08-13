import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useAuth } from '../App';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';

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
  isAdmin: boolean;
}

// „Spielleiter", „Admin", beides oder schlicht „Spieler".
function roleLabel(u: { isGm: boolean; isAdmin: boolean }): string {
  const parts = [u.isGm && 'Spielleiter', u.isAdmin && 'Admin'].filter(Boolean) as string[];
  return parts.length ? parts.join(' + ') : 'Spieler';
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

// Mitglieder einer Gruppe: bestehende als entfernbare Chips, plus ein
// „Hinzufügen…"-Feld mit Vorschlägen aus der Spielerliste. Ausgewählte sammeln
// sich zunächst als vorgemerkte Chips; erst „Hinzufügen" schreibt sie in einem
// Rutsch in die Gruppe (ein PUT mit der neuen Mitgliederliste).
function GroupMembersEditor({
  memberIds,
  players,
  onCommit,
  onRemove,
}: {
  memberIds: number[];
  players: AdminUser[];
  onCommit: (ids: number[]) => Promise<unknown>;
  onRemove: (userId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [staged, setStaged] = useState<number[]>([]);
  const [open, setOpen] = useState(false);

  const byId = (id: number) => players.find((p) => p.id === id);
  const members = players.filter((u) => memberIds.includes(u.id));
  const q = query.trim().toLowerCase();
  const candidates = players.filter(
    (u) =>
      !memberIds.includes(u.id) &&
      !staged.includes(u.id) &&
      (q === '' || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
  );
  // Vorgemerkte, die noch nicht Mitglied sind (nach dem Nachladen fallen sie raus).
  const stagedVisible = staged.filter((id) => !memberIds.includes(id));

  const stage = (id: number) => {
    setStaged((s) => (s.includes(id) ? s : [...s, id]));
    setQuery('');
    setOpen(false);
  };
  const commit = async () => {
    if (stagedVisible.length === 0) return;
    await onCommit([...memberIds, ...stagedVisible]);
    setStaged([]);
  };

  return (
    <div className="grp-members">
      <div className="grp-chips">
        {members.length === 0 && <span className="muted">— keine —</span>}
        {members.map((u) => (
          <span className="grp-chip" key={u.id}>
            {u.displayName}
            <ConfirmDeleteButton className="grp-chip-x" title="Aus der Gruppe entfernen" onConfirm={() => onRemove(u.id)} />
          </span>
        ))}
      </div>
      <div className="grp-add">
        <div className="grp-add-field">
          <input
            placeholder="Hinzufügen…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && candidates.length) {
                e.preventDefault();
                stage(candidates[0].id);
              } else if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && candidates.length > 0 && (
            <div className="grp-suggest">
              {candidates.slice(0, 8).map((u) => (
                // onMouseDown statt onClick: feuert vor dem Blur des Feldes.
                <button key={u.id} className="grp-suggest-item" onMouseDown={(e) => {
                  e.preventDefault();
                  stage(u.id);
                }}>
                  {u.displayName} <span className="muted">{u.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {stagedVisible.map((id) => {
          const u = byId(id);
          return u ? (
            <span className="grp-chip grp-chip-staged" key={id}>
              {u.displayName}
              <button className="grp-chip-x" title="Vormerkung entfernen" onClick={() => setStaged((s) => s.filter((x) => x !== id))}>
                ✕
              </button>
            </span>
          ) : null;
        })}
        {stagedVisible.length > 0 && (
          <button className="primary small" onClick={commit}>
            Hinzufügen ({stagedVisible.length})
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [chars, setChars] = useState<AdminChar[]>([]);
  const [error, setError] = useState('');

  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', isGm: false, isAdmin: false });
  const [newGroup, setNewGroup] = useState('');
  const [newChar, setNewChar] = useState({ name: '', ownerUserId: 0, groupId: 0 });
  const [importTarget, setImportTarget] = useState({ ownerUserId: 0, groupId: 0 });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const reload = () => {
    setError('');
    apiGet<AdminUser[]>('/api/admin/users').then(setUsers).catch((e) => setError(String(e.message)));
    // Gruppen/Charaktere/Kataloge sind Spielleitungs-Daten — ein reiner Admin
    // fragt sie gar nicht erst ab (Endpunkte sind requireGm).
    if (me.isGm) {
      apiGet<AdminGroup[]>('/api/admin/groups').then(setGroups);
      apiGet<{ characters: AdminChar[] }>('/api/overview').then((o) => setChars(o.characters));
    }
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

  // Gruppenmitglieder sind Spieler (der einzelne Spielleiter sieht ohnehin alles).
  const players = users.filter((u) => !u.isGm);
  // Für die „letzter Admin"-Sperre in der Oberfläche (der Server sichert es zudem ab).
  const adminTotal = users.filter((u) => u.isAdmin).length;

  // Charaktere nach Gruppe, dann nach Name sortieren. Die Gruppennamen stehen
  // nur hier zur Verfügung (die API liefert lediglich group_id), darum im Client.
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? '';
  const sortedChars = [...chars].sort(
    (a, b) => groupName(a.group_id).localeCompare(groupName(b.group_id), 'de') || a.name.localeCompare(b.name, 'de'),
  );

  return (
    <>
      <h1>{me.isGm ? 'Kataloge & Nutzer' : 'Nutzerverwaltung'}</h1>
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
            {users.map((u) => {
              // Bearbeiten darf die Verwaltung immer; eine Spielleitung nur
              // einfache Spieler (nicht die Konten anderer Leitungen/Admins).
              const canEdit = me.isAdmin || (!u.isGm && !u.isAdmin);
              const lastAdmin = u.isAdmin && adminTotal <= 1;
              return (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    {canEdit ? (
                      <input
                        defaultValue={u.displayName}
                        onBlur={(e) => e.target.value !== u.displayName && run(() => apiPut(`/api/admin/users/${u.id}`, { displayName: e.target.value }))}
                      />
                    ) : (
                      u.displayName
                    )}
                  </td>
                  <td>
                    {me.isAdmin ? (
                      <div className="role-toggles">
                        <label>
                          <input
                            type="checkbox"
                            checked={u.isGm}
                            onChange={(e) => run(() => apiPut(`/api/admin/users/${u.id}`, { isGm: e.target.checked }))}
                          />{' '}
                          Spielleiter
                        </label>
                        <label title={lastAdmin ? 'Der letzte Admin kann seine Rolle nicht abgeben.' : undefined}>
                          <input
                            type="checkbox"
                            checked={u.isAdmin}
                            disabled={lastAdmin}
                            onChange={(e) => run(() => apiPut(`/api/admin/users/${u.id}`, { isAdmin: e.target.checked }))}
                          />{' '}
                          Admin
                        </label>
                      </div>
                    ) : (
                      roleLabel(u)
                    )}
                  </td>
                  <td>
                    {canEdit ? (
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
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {/* Löschen nur die Verwaltung, nie das eigene Konto oder den letzten Admin. */}
                    {me.isAdmin && u.id !== me.id && !lastAdmin && (
                      <ConfirmDeleteButton title={`Benutzer ${u.username} löschen`} onConfirm={() => run(() => apiDelete(`/api/admin/users/${u.id}`))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h4>Neuer Benutzer</h4>
        <div style={{ display: 'flex', gap: 8, maxWidth: 820, alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="Benutzername" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
          <input placeholder="Anzeigename" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
          <input placeholder="Passwort" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          {/* Rollen vergibt nur die Verwaltung; eine Spielleitung legt Spieler an. */}
          {me.isAdmin && (
            <div className="role-toggles">
              <label>
                <input type="checkbox" checked={newUser.isGm} onChange={(e) => setNewUser({ ...newUser, isGm: e.target.checked })} /> Spielleiter
              </label>
              <label>
                <input type="checkbox" checked={newUser.isAdmin} onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })} /> Admin
              </label>
            </div>
          )}
          <button
            className="primary"
            disabled={!newUser.username || !newUser.password}
            onClick={() =>
              run(async () => {
                await apiPost('/api/admin/users', newUser);
                setNewUser({ username: '', password: '', displayName: '', isGm: false, isAdmin: false });
              })
            }
          >
            Anlegen
          </button>
        </div>
      </div>

      {/* Gruppen, Charaktere und Kataloge sind Spielleitungs-Sache. Ein reiner
          Admin verwaltet nur Konten und sieht diese Bereiche nicht (Anti-Cheat). */}
      {me.isGm && (
      <>
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
                  <GroupMembersEditor
                    memberIds={g.memberIds}
                    players={players}
                    onCommit={(ids) => run(() => apiPut(`/api/admin/groups/${g.id}`, { memberIds: ids }))}
                    onRemove={(uid) => run(() => apiPut(`/api/admin/groups/${g.id}`, { memberIds: g.memberIds.filter((x) => x !== uid) }))}
                  />
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
      )}
    </>
  );
}
