import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useAuth } from '../App';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { usePersistedState } from '../components/persist';
import { WartungPanel } from '../components/WartungPanel';
import { usePendingRequests } from '../components/requests';
import { useTabsHeight } from '../components/stickyChrome';
import { computeGapSort } from '../components/catalogSort';

interface CatalogColumn {
  key: string;
  label: string;
  width?: number;
}

// Editierbarer Katalog (Talente / Sprachen / Rassen) — speichert je Feld beim Verlassen
function CatalogPanel({
  type,
  title,
  columns,
}: {
  type: 'talents' | 'languages' | 'tags' | 'races' | 'specialEnergies';
  title: string;
  columns: CatalogColumn[];
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [neu, setNeu] = useState<Record<string, string>>({});
  // Sortierung des Neuanlage-Formulars: normal 9999 (ans Ende anhängen), nach
  // "vor/nach diesem Eintrag einfügen" der berechnete Lückenwert.
  const [neuSort, setNeuSort] = useState(9999);

  const fetchRows = () =>
    apiGet<{
      talents: Record<string, unknown>[];
      languages: Record<string, unknown>[];
      tags: Record<string, unknown>[];
      races: Record<string, unknown>[];
      specialEnergies: Record<string, unknown>[];
    }>('/api/catalogs').then((c) => c[type]);
  const reload = () => {
    fetchRows().then(setRows);
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

  // Berechnet den Lückenwert für "vor/nach dieser Zeile einfügen" und trägt
  // ihn ins Neuanlage-Formular ein. Ist die Lücke erschöpft (computeGapSort
  // liefert null), erst serverseitig neu durchnummerieren und dann neu rechnen.
  const insertAt = async (position: 'before' | 'after', rowId: unknown) => {
    setError('');
    try {
      let current = rows;
      const sortedRows = current as unknown as { sort: number }[];
      let idx = current.findIndex((r) => r.id === rowId);
      let val = computeGapSort(sortedRows, idx, position);
      if (val == null) {
        await apiPost(`/api/admin/catalogs/${type}/renumber`, {});
        current = await fetchRows();
        setRows(current);
        idx = current.findIndex((r) => r.id === rowId);
        val = computeGapSort(current as unknown as { sort: number }[], idx, position) ?? 9999;
      }
      setNeuSort(val);
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
      <div className="table-wrap scroll-box" style={{ marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
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
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" title="Vor diesem Eintrag einfügen" onClick={() => insertAt('before', r.id)}>
                    +↑
                  </button>
                  <button className="small" title="Nach diesem Eintrag einfügen" onClick={() => insertAt('after', r.id)}>
                    +↓
                  </button>
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
        <input
          type="number"
          title="Sortierung — automatisch gesetzt durch +↑/+↓, sonst 9999 (ans Ende)"
          style={{ width: 80 }}
          value={neuSort}
          onChange={(e) => setNeuSort(Number(e.target.value) || 0)}
        />
        <button
          className="primary"
          disabled={!neu.name}
          onClick={() =>
            run(async () => {
              await apiPost(`/api/admin/catalogs/${type}`, { ...neu, sort: neuSort });
              setNeu({});
              setNeuSort(9999);
            })
          }
        >
          Anlegen
        </button>
      </div>
    </details>
  );
}

// Währungs-Katalog: zweistufig (System → Münzsorten), passt nicht in das
// generische CatalogPanel (eine Tabelle, flache Zeilen) — daher ein eigenes,
// bewusst kleines Formular statt einer weiteren Abstraktionsschicht.
interface DenominationRow {
  id: number;
  system_id: number;
  code: string;
  name: string;
  faktor: number;
  sort: number;
}
interface CurrencySystemRow {
  id: number;
  name: string;
  notiz: string;
  sort: number;
  denominations: DenominationRow[];
}

function CurrencyCatalogPanel() {
  const [systems, setSystems] = useState<CurrencySystemRow[]>([]);
  const [error, setError] = useState('');
  const [neuSystem, setNeuSystem] = useState('');
  const [neuSystemSort, setNeuSystemSort] = useState(9999);
  const [neuDenom, setNeuDenom] = useState<Record<number, { code: string; name: string; faktor: string; sort: number }>>({});

  const fetchSystems = () => apiGet<{ currencies: CurrencySystemRow[] }>('/api/catalogs').then((c) => c.currencies);
  const reload = () => {
    fetchSystems().then(setSystems);
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

  const denomDraft = (systemId: number) => neuDenom[systemId] ?? { code: '', name: '', faktor: '', sort: 9999 };

  // Gleiches Lücken-Prinzip wie CatalogPanel.insertAt, nur zweistufig: Systeme
  // sortieren global, Münzsorten je System (renumber-Fallback läuft dann auch
  // nur innerhalb des einen Systems, siehe Server-Route).
  const insertSystemAt = async (position: 'before' | 'after', systemId: number) => {
    setError('');
    try {
      let current = systems;
      let idx = current.findIndex((s) => s.id === systemId);
      let val = computeGapSort(current, idx, position);
      if (val == null) {
        await apiPost('/api/admin/currency-systems/renumber', {});
        current = await fetchSystems();
        setSystems(current);
        idx = current.findIndex((s) => s.id === systemId);
        val = computeGapSort(current, idx, position) ?? 9999;
      }
      setNeuSystemSort(val);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const insertDenomAt = async (position: 'before' | 'after', systemId: number, denomId: number) => {
    setError('');
    try {
      let current = systems;
      let sys = current.find((s) => s.id === systemId);
      if (!sys) return;
      let idx = sys.denominations.findIndex((d) => d.id === denomId);
      let val = computeGapSort(sys.denominations, idx, position);
      if (val == null) {
        await apiPost('/api/admin/currency-denominations/renumber', { systemId });
        current = await fetchSystems();
        setSystems(current);
        sys = current.find((s) => s.id === systemId);
        if (!sys) return;
        idx = sys.denominations.findIndex((d) => d.id === denomId);
        val = computeGapSort(sys.denominations, idx, position) ?? 9999;
      }
      setNeuDenom({ ...neuDenom, [systemId]: { ...denomDraft(systemId), sort: val } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Währungs-Katalog ({systems.length} System(e))</summary>
      {error && <p className="error">{error}</p>}
      {systems.map((s) => (
        <div key={s.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              defaultValue={s.name}
              style={{ fontWeight: 600, width: 160 }}
              onBlur={(e) => e.target.value !== s.name && run(() => apiPut(`/api/admin/currency-systems/${s.id}`, { name: e.target.value }))}
            />
            <input
              placeholder="Notiz"
              defaultValue={s.notiz}
              style={{ flex: 1 }}
              onBlur={(e) => e.target.value !== s.notiz && run(() => apiPut(`/api/admin/currency-systems/${s.id}`, { notiz: e.target.value }))}
            />
            <input
              type="number"
              title="Sortierung"
              style={{ width: 70 }}
              defaultValue={s.sort}
              onBlur={(e) => Number(e.target.value) !== s.sort && run(() => apiPut(`/api/admin/currency-systems/${s.id}`, { sort: e.target.value }))}
            />
            <button className="small" title="Vor diesem System einfügen" onClick={() => insertSystemAt('before', s.id)}>
              +↑
            </button>
            <button className="small" title="Nach diesem System einfügen" onClick={() => insertSystemAt('after', s.id)}>
              +↓
            </button>
            <button
              className="small"
              title="Währungssystem löschen"
              onClick={() => confirm(`"${s.name}" aus dem Katalog löschen?`) && run(() => apiDelete(`/api/admin/currency-systems/${s.id}`))}
            >
              ✕
            </button>
          </div>
          <table className="sheet" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Name</th>
                <th style={{ width: 100 }}>Faktor</th>
                <th style={{ width: 70 }}>Sortierung</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {s.denominations.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      defaultValue={d.code}
                      onBlur={(e) => e.target.value !== d.code && run(() => apiPut(`/api/admin/currency-denominations/${d.id}`, { code: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => e.target.value !== d.name && run(() => apiPut(`/api/admin/currency-denominations/${d.id}`, { name: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={String(d.faktor)}
                      onBlur={(e) =>
                        e.target.value !== String(d.faktor) &&
                        run(() => apiPut(`/api/admin/currency-denominations/${d.id}`, { faktor: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      defaultValue={d.sort}
                      onBlur={(e) =>
                        Number(e.target.value) !== d.sort &&
                        run(() => apiPut(`/api/admin/currency-denominations/${d.id}`, { sort: e.target.value }))
                      }
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" title="Vor dieser Münzsorte einfügen" onClick={() => insertDenomAt('before', s.id, d.id)}>
                      +↑
                    </button>
                    <button className="small" title="Nach dieser Münzsorte einfügen" onClick={() => insertDenomAt('after', s.id, d.id)}>
                      +↓
                    </button>
                    <button
                      className="small"
                      title="Münzsorte löschen"
                      onClick={() => confirm(`"${d.name}" löschen?`) && run(() => apiDelete(`/api/admin/currency-denominations/${d.id}`))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    placeholder="Code"
                    value={denomDraft(s.id).code}
                    onChange={(e) => setNeuDenom({ ...neuDenom, [s.id]: { ...denomDraft(s.id), code: e.target.value } })}
                  />
                </td>
                <td>
                  <input
                    placeholder="Name"
                    value={denomDraft(s.id).name}
                    onChange={(e) => setNeuDenom({ ...neuDenom, [s.id]: { ...denomDraft(s.id), name: e.target.value } })}
                  />
                </td>
                <td>
                  <input
                    placeholder="Faktor"
                    value={denomDraft(s.id).faktor}
                    onChange={(e) => setNeuDenom({ ...neuDenom, [s.id]: { ...denomDraft(s.id), faktor: e.target.value } })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    title="Sortierung — automatisch gesetzt durch +↑/+↓, sonst 9999 (ans Ende)"
                    style={{ width: 70 }}
                    value={denomDraft(s.id).sort}
                    onChange={(e) => setNeuDenom({ ...neuDenom, [s.id]: { ...denomDraft(s.id), sort: Number(e.target.value) || 0 } })}
                  />
                </td>
                <td>
                  <button
                    className="small primary"
                    disabled={!denomDraft(s.id).code || !denomDraft(s.id).name}
                    onClick={() =>
                      run(async () => {
                        await apiPost('/api/admin/currency-denominations', { systemId: s.id, ...denomDraft(s.id) });
                        setNeuDenom({ ...neuDenom, [s.id]: { code: '', name: '', faktor: '', sort: 9999 } });
                      })
                    }
                  >
                    +
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <h4>Neues Währungssystem</h4>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="Name (z. B. Aventurisch, Myranor, Titania)" value={neuSystem} onChange={(e) => setNeuSystem(e.target.value)} />
        <input
          type="number"
          title="Sortierung — automatisch gesetzt durch +↑/+↓, sonst 9999 (ans Ende)"
          style={{ width: 80 }}
          value={neuSystemSort}
          onChange={(e) => setNeuSystemSort(Number(e.target.value) || 0)}
        />
        <button
          className="primary"
          disabled={!neuSystem}
          onClick={() =>
            run(async () => {
              await apiPost('/api/admin/currency-systems', { name: neuSystem, sort: neuSystemSort });
              setNeuSystem('');
              setNeuSystemSort(9999);
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
}
interface AdminTempGroup {
  id: number;
  name: string;
  memberCharacterIds: number[];
}
interface AdminChar {
  id: number;
  name: string;
  owner_user_id: number;
  // NULL, solange der Charakter keiner Gruppe angehört (Selbst-Anlage vor der
  // Freigabe oder eine abgelehnte Anfrage).
  group_id: number | null;
}

// Umschaltung der Charakterliste in der Verwaltung: nach Gruppe, nach Besitzer
// (Spieler) oder flach.
type CharGroupBy = 'gruppe' | 'spieler' | 'none';
const CHAR_GROUP_LABEL: Record<Exclude<CharGroupBy, 'none'>, string> = { gruppe: 'Gruppe', spieler: 'Spieler' };

// Reiter der Verwaltungsseite — hält die Seite kurz, egal wie viele Kataloge
// oder Verwaltungsbereiche dazukommen. Offene Anfragen stecken thematisch bei
// Gruppen (sie münden in eine Gruppenzuordnung) und zeigen sich dort nur als
// Abzeichen an der Reiter-Beschriftung, statt einen eigenen Reiter zu belegen.
// „Wartung" ist der einzige Reiter, der an der Rolle hängt: Verwaltung ja,
// Spielleitung nein (siehe requireAdmin an /api/admin/deploy) — daher das
// Kennzeichen `nurAdmin`, nach dem beim Rendern gefiltert wird.
type AdminTab = 'benutzer' | 'gruppen' | 'charaktere' | 'kataloge' | 'wartung';
const ADMIN_TABS: { key: AdminTab; label: string; nurAdmin?: boolean }[] = [
  { key: 'benutzer', label: 'Benutzer' },
  { key: 'gruppen', label: 'Gruppen' },
  { key: 'charaktere', label: 'Charaktere' },
  { key: 'kataloge', label: 'Kataloge' },
  { key: 'wartung', label: 'Wartung', nurAdmin: true },
];

// Charaktere einer Event-Gruppe: gleiches Muster wie früher GroupMembersEditor
// (feste Gruppen haben seit dem Wegfall von group_members keinen eigenen
// Mitgliederdialog mehr — wer dazugehört, ergibt sich aus den Charakteren, die
// auf dem Charaktere-Reiter dieser Gruppe zugeordnet sind), aber gegen
// Charaktere statt Nutzer (Event-Mitgliedschaft ist additiv über
// character_id, siehe temp_group_members).
function CharacterMembersEditor({
  memberIds,
  chars,
  onCommit,
  onRemove,
}: {
  memberIds: number[];
  chars: AdminChar[];
  onCommit: (ids: number[]) => Promise<unknown>;
  onRemove: (characterId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [staged, setStaged] = useState<number[]>([]);
  const [open, setOpen] = useState(false);

  const byId = (id: number) => chars.find((c) => c.id === id);
  const members = chars.filter((c) => memberIds.includes(c.id));
  const q = query.trim().toLowerCase();
  const candidates = chars.filter(
    (c) => !memberIds.includes(c.id) && !staged.includes(c.id) && (q === '' || c.name.toLowerCase().includes(q)),
  );
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
        {members.map((c) => (
          <span className="grp-chip" key={c.id}>
            {c.name}
            <ConfirmDeleteButton className="grp-chip-x" title="Aus der Event-Gruppe entfernen" onConfirm={() => onRemove(c.id)} />
          </span>
        ))}
      </div>
      <div className="grp-add">
        <div className="grp-add-field">
          <input
            placeholder="Charakter hinzufügen…"
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
              {candidates.slice(0, 8).map((c) => (
                <button key={c.id} className="grp-suggest-item" onMouseDown={(e) => {
                  e.preventDefault();
                  stage(c.id);
                }}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {stagedVisible.map((id) => {
          const c = byId(id);
          return c ? (
            <span className="grp-chip grp-chip-staged" key={id}>
              {c.name}
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
  const { requests, refresh: refreshRequests } = usePendingRequests();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [tempGroups, setTempGroups] = useState<AdminTempGroup[]>([]);
  const [chars, setChars] = useState<AdminChar[]>([]);
  const [error, setError] = useState('');
  const [tab, setTab] = usePersistedState<AdminTab>('admin:tab', 'benutzer');
  const tabsRef = useTabsHeight();

  // Ein Spielleiter ohne Verwaltungsrolle darf „Wartung" nicht sehen. Der Reiter
  // steckt aber in localStorage, sobald er einmal gewählt wurde — verliert
  // jemand die Rolle (oder teilt sich ein Gerät), stünde die Seite sonst leer.
  const sichtbareTabs = ADMIN_TABS.filter((t) => !t.nurAdmin || me?.isAdmin);
  const aktiverTab: AdminTab = sichtbareTabs.some((t) => t.key === tab) ? tab : 'benutzer';

  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', isGm: false, isAdmin: false });
  const [newGroup, setNewGroup] = useState('');
  const [newTempGroup, setNewTempGroup] = useState('');
  const [newChar, setNewChar] = useState({ name: '', ownerUserId: 0, groupId: 0 });
  const [importTarget, setImportTarget] = useState({ ownerUserId: 0, groupId: 0 });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const reload = () => {
    setError('');
    apiGet<AdminUser[]>('/api/admin/users').then(setUsers).catch((e) => setError(String(e.message)));
    // Verwaltung und Spielleitung pflegen dieselben Bereiche. Die Charakterliste
    // kommt aus dem Verwaltungs-Endpunkt (nur Metadaten), NICHT aus /overview.
    if (me.isGm || me.isAdmin) {
      apiGet<AdminGroup[]>('/api/admin/groups').then(setGroups);
      apiGet<AdminChar[]>('/api/admin/characters').then(setChars);
    }
    // Event-Gruppen bleiben Sache der Spielleitung (GM-only, siehe Server-Route).
    if (me.isGm) {
      apiGet<AdminTempGroup[]>('/api/admin/temp-groups').then(setTempGroups);
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

  // Gruppen-Anfrage annehmen/ablehnen. run() lädt danach Charaktere/Gruppen neu
  // (der Charakter steckt nun in seiner Gruppe); refreshRequests aktualisiert die
  // Liste hier UND das Abzeichen in der Kopfleiste (gemeinsame Quelle).
  const actOnRequest = (characterId: number, action: 'approve' | 'reject') =>
    run(async () => {
      await apiPost(`/api/admin/requests/${characterId}/${action}`, {});
      refreshRequests();
    });

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

  // Für die „letzter Admin"-Sperre in der Oberfläche (der Server sichert es zudem ab).
  const adminTotal = users.filter((u) => u.isAdmin).length;

  // Charakterliste gruppieren — wie auf den Zauber-/Fähigkeiten-Tabs: eine
  // Umschaltleiste plus Zwischenüberschriften (subtle-head) je Abschnitt. Gruppen-
  // und Spielernamen stehen nur hier bereit (die API liefert nur die IDs).
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? '';
  const userName = (id: number) => users.find((u) => u.id === id)?.displayName ?? '';
  const [charGroupBy, setCharGroupBy] = usePersistedState<CharGroupBy>('admin:charGroup', 'gruppe');
  const byName = (a: AdminChar, b: AdminChar) => a.name.localeCompare(b.name, 'de');
  const charSections =
    charGroupBy === 'none'
      ? [{ key: 'all', label: '', rows: [...chars].sort(byName) }]
      : (() => {
          // Gruppenlose Charaktere (group_id NULL) landen unter dem Schlüssel 0
          // → labelOf(0) ergibt „— ohne Gruppe —".
          const keyOf = (c: AdminChar) => (charGroupBy === 'gruppe' ? c.group_id ?? 0 : c.owner_user_id);
          const labelOf = (id: number) =>
            charGroupBy === 'gruppe' ? groupName(id) || '— ohne Gruppe —' : userName(id) || '— ohne Besitzer —';
          const byKey = new Map<number, AdminChar[]>();
          for (const c of chars) {
            const list = byKey.get(keyOf(c)) ?? [];
            if (list.length === 0) byKey.set(keyOf(c), list);
            list.push(c);
          }
          return [...byKey.entries()]
            .map(([k, rows]) => ({ key: String(k), label: labelOf(k), rows: rows.sort(byName) }))
            .sort((a, b) => a.label.localeCompare(b.label, 'de'));
        })();

  return (
    <>
      <h1>Kataloge &amp; Nutzer</h1>
      {error && <p className="error">{error}</p>}

      <div className="tabs" ref={tabsRef}>
        {sichtbareTabs.map((t) => (
          <button key={t.key} className={aktiverTab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'gruppen' && requests.length > 0 && <span className="tab-badge">{requests.length}</span>}
          </button>
        ))}
      </div>

      {aktiverTab === 'benutzer' && (
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
      )}

      {aktiverTab === 'gruppen' && (
      <>
      {/* Offene Gruppen-Anfragen selbst angelegter Charaktere. Nur sichtbar,
          solange welche offen sind. Annehmen ordnet den Charakter der erbetenen
          Gruppe zu und macht den Besitzer zum Gruppenmitglied; Ablehnen setzt nur
          die Anfrage zurück (der Charakter bleibt gruppenlos erhalten). */}
      {requests.length > 0 && (
        <div className="panel">
          <h2>
            Offene Anfragen <span className="muted">· {requests.length}</span>
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Selbst angelegte Charaktere, die um Aufnahme in eine Gruppe bitten. Beim Annehmen wird der Besitzer zugleich Mitglied der Gruppe.
          </p>
          <table className="sheet">
            <thead>
              <tr>
                <th>Charakter</th>
                <th>Spieler</th>
                <th>Erbetene Gruppe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.characterId}>
                  <td>{me.isGm ? <Link to={`/charakter/${r.characterId}`}>{r.name}</Link> : r.name}</td>
                  <td>{r.ownerName}</td>
                  <td>{r.requestedGroupName}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="primary small" onClick={() => actOnRequest(r.characterId, 'approve')}>
                        Annehmen
                      </button>
                      <button className="small" onClick={() => actOnRequest(r.characterId, 'reject')}>
                        Ablehnen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Gruppen, Charaktere und Kataloge pflegen Verwaltung UND Spielleitung.
          Der Bogen selbst bleibt der Verwaltung dennoch verschlossen: Charakter-
          namen sind für reine Admins kein Link (siehe unten), und die GM-Übersicht
          bleibt der Spielleitung vorbehalten (Anti-Cheat). */}
      <div className="panel">
        <h2>Gruppen</h2>
        <table className="sheet">
          <thead>
            <tr>
              <th>Gruppe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td style={{ width: 200 }}>
                  <input
                    defaultValue={g.name}
                    title="Gruppe umbenennen"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== g.name) run(() => apiPut(`/api/admin/groups/${g.id}`, { name: v }));
                      else e.target.value = g.name;
                    }}
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

      {/* Event-Gruppen: rein additiv zur festen Gruppe eines Charakters, GM-only
          (siehe TODO.md „Temporary/event groups"). Mitgliedschaft läuft über
          Charakter-IDs, nicht Nutzer — ein Charakter kann in seiner festen Gruppe
          UND beliebig vielen Event-Gruppen zugleich stecken. */}
      {me.isGm && (
        <div className="panel">
          <h2>Event-Gruppen</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Für einzelne Event-Sessions abseits der festen Gruppenzugehörigkeit — die feste Gruppe eines Charakters bleibt dabei unangetastet.
          </p>
          <table className="sheet">
            <thead>
              <tr>
                <th>Event</th>
                <th>Charaktere</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tempGroups.map((g) => (
                <tr key={g.id}>
                  <td style={{ width: 200 }}>
                    <input
                      defaultValue={g.name}
                      title="Event-Gruppe umbenennen"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== g.name) run(() => apiPut(`/api/admin/temp-groups/${g.id}`, { name: v }));
                        else e.target.value = g.name;
                      }}
                    />
                    <div>
                      <Link to={`/event/${g.id}/uebersicht`}>Übersicht →</Link> · <Link to={`/event/${g.id}/tisch`}>Tisch →</Link>
                    </div>
                  </td>
                  <td>
                    <CharacterMembersEditor
                      memberIds={g.memberCharacterIds}
                      chars={chars}
                      onCommit={(ids) => run(() => apiPut(`/api/admin/temp-groups/${g.id}`, { memberCharacterIds: ids }))}
                      onRemove={(cid) =>
                        run(() => apiPut(`/api/admin/temp-groups/${g.id}`, { memberCharacterIds: g.memberCharacterIds.filter((x) => x !== cid) }))
                      }
                    />
                  </td>
                  <td>
                    <button className="small" onClick={() => confirm(`Event-Gruppe ${g.name} löschen?`) && run(() => apiDelete(`/api/admin/temp-groups/${g.id}`))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Neue Event-Gruppe</h4>
          <div style={{ display: 'flex', gap: 8, maxWidth: 400 }}>
            <input placeholder="Name" value={newTempGroup} onChange={(e) => setNewTempGroup(e.target.value)} />
            <button
              className="primary"
              disabled={!newTempGroup}
              onClick={() =>
                run(async () => {
                  await apiPost('/api/admin/temp-groups', { name: newTempGroup });
                  setNewTempGroup('');
                })
              }
            >
              Anlegen
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {aktiverTab === 'charaktere' && (
      <div className="panel">
        <h2>Charaktere</h2>
        <div className="abil-grouprow">
          <span className="muted">Gruppierung nach: </span>
          {(['gruppe', 'spieler'] as const).map((g) => (
            <button
              key={g}
              className={`small${charGroupBy === g ? ' active' : ''}`}
              title={charGroupBy === g ? 'Gruppierung aufheben' : `Nach ${CHAR_GROUP_LABEL[g]} gruppieren`}
              // Nochmal auf die aktive Gruppierung klicken hebt sie auf (flache Liste).
              onClick={() => setCharGroupBy(charGroupBy === g ? 'none' : g)}
            >
              {CHAR_GROUP_LABEL[g]}
            </button>
          ))}
        </div>
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
            {charSections.map((sec) => (
              <Fragment key={sec.key}>
                {charGroupBy !== 'none' && (
                  <tr className="subtle-head">
                    <td colSpan={4}>
                      <span className="sticky-label">
                        {sec.label} <span className="muted">· {sec.rows.length}</span>
                      </span>
                    </td>
                  </tr>
                )}
                {sec.rows.map((c) => (
              <tr key={c.id}>
                <td>
                  {/* Spielleitung UND Verwaltung dürfen den Bogen öffnen — die
                      Verwaltung landet dort read-only in der Einsicht-Sicht
                      (access: 'inspect', ohne SL-Notizen), nie in „Bearbeiten". */}
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
                  {/* group_id kann NULL sein (gruppenlos/ausstehend). Ein
                      Platzhalter hält das <select> kontrolliert; eine echte
                      Auswahl weist die Gruppe zu (und beendet serverseitig eine
                      etwaige offene Anfrage). */}
                  <select
                    value={c.group_id ?? 0}
                    onChange={(e) => {
                      const gid = Number(e.target.value);
                      if (gid) run(() => apiPut(`/api/characters/${c.id}`, { groupId: gid }));
                    }}
                  >
                    <option value={0} disabled>
                      — ohne Gruppe —
                    </option>
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
              </Fragment>
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
      )}

      {aktiverTab === 'kataloge' && (
      <>
      <p className="muted">
        Änderungen wirken für alle Charaktere. Einträge, die von Charakteren verwendet werden, lassen sich nicht löschen.
      </p>
      <div className="kat-grid">
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
      <CatalogPanel
        type="tags"
        title="Merkmale-Katalog"
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'sort', label: 'Sortierung', width: 80 },
        ]}
      />
      <CatalogPanel
        type="races"
        title="Rassen-Katalog"
        columns={[
          { key: 'gruppe', label: 'Gruppe', width: 130 },
          { key: 'name', label: 'Name', width: 130 },
          { key: 'beschreibung', label: 'Beschreibung' },
          { key: 'spezialisierung', label: 'Spezialisierung', width: 150 },
          { key: 'talente', label: 'Talente', width: 200 },
          { key: 'le', label: 'LE', width: 50 },
          { key: 'au', label: 'AU', width: 50 },
          { key: 'ae', label: 'AsE', width: 50 },
          { key: 'mr', label: 'MR', width: 50 },
          { key: 'ak', label: 'AK', width: 50 },
          { key: 'gs', label: 'GS', width: 50 },
          { key: 'psyche', label: 'Psyche', width: 60 },
          { key: 'resilienz', label: 'Resilienz', width: 70 },
          { key: 'notiz', label: 'Notiz', width: 200 },
          { key: 'sort', label: 'Sortierung', width: 80 },
        ]}
      />
      <CatalogPanel
        type="specialEnergies"
        title="Spezialenergien-Katalog"
        columns={[
          { key: 'name', label: 'Name', width: 180 },
          { key: 'formula', label: 'Formel (leer = manuell)', width: 160 },
          { key: 'beschreibung', label: 'Beschreibung' },
          { key: 'regeneration', label: 'Regeneration' },
          { key: 'umrechnung', label: 'Umrechnung in normale Energien' },
          { key: 'sort', label: 'Sortierung', width: 80 },
        ]}
      />
      <CurrencyCatalogPanel />
      </div>
      </>
      )}

      {aktiverTab === 'wartung' && <WartungPanel />}
    </>
  );
}
