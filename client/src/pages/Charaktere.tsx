import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { apiGet, apiPost, apiPut } from '../api';
import CharacterCard from '../components/CharacterCard';
import { useOverview, useOverviewRefresh } from '../components/overview';

interface GroupName {
  id: number;
  name: string;
}

export default function CharaktereePage() {
  const { user } = useAuth();
  const data = useOverview();
  const refresh = useOverviewRefresh();
  const navigate = useNavigate();

  // Alle Gruppennamen (für Anlage-Auswahl und das Auflösen einer erbetenen
  // Gruppe, die nicht in den eigenen Gruppen des Spielers steht). Nur Spieler
  // brauchen sie — der Spielleiter legt Charaktere in der Verwaltung an.
  const canCreate = !user.isGm;
  const [groupNames, setGroupNames] = useState<GroupName[]>([]);
  useEffect(() => {
    if (!canCreate) return;
    apiGet<GroupName[]>('/api/groups/names')
      .then(setGroupNames)
      .catch(() => setGroupNames([]));
  }, [canCreate]);
  // Namen einer erbetenen Gruppe auflösen: erst aus den (allen) Gruppen der
  // Übersicht — der Spielleiter hat sie dort —, sonst aus der Namensliste, die
  // sich der Spieler zieht.
  const groupNameOf = (id: number | null) =>
    id == null ? '' : data?.groups.find((g) => g.id === id)?.name ?? groupNames.find((g) => g.id === id)?.name ?? '';

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createCharacter = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const { id } = await apiPost<{ id: number }>('/api/characters', {
        name,
        requestedGroupId: newGroupId === '' ? null : Number(newGroupId),
      });
      setNewName('');
      setNewGroupId('');
      setShowForm(false);
      refresh();
      navigate(`/charakter/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Anlegen');
    } finally {
      setBusy(false);
    }
  };

  // Gruppen-Anfrage eines gruppenlosen Charakters ändern/zurückziehen.
  const changeRequest = async (characterId: number, requestedGroupId: number | null) => {
    setError('');
    try {
      await apiPut(`/api/characters/${characterId}/request`, { requestedGroupId });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{user.isGm ? 'Alle Charaktere' : 'Meine Charaktere'}</h1>
        {canCreate && (
          <button className="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Abbrechen' : '＋ Neuen Charakter anlegen'}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {canCreate && showForm && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 640 }}>
          <h4 style={{ marginTop: 0 }}>Neuen Charakter anlegen</h4>
          <p className="muted" style={{ marginTop: 0 }}>
            Du kannst eine Gruppe erbitten — sie wird erst nach Freigabe durch die
            Spielleitung oder Verwaltung wirksam. „Ohne Gruppe" legt den Charakter
            zunächst gruppenlos an; eine Gruppe kannst du später erbitten. Bearbeitbar ist der Charakter zu jeder Zeit.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              placeholder="Name"
              value={newName}
              autoFocus
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createCharacter();
              }}
            />
            <select value={newGroupId} onChange={(e) => setNewGroupId(e.target.value)}>
              <option value="">Ohne Gruppe</option>
              {groupNames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button className="primary" disabled={!newName.trim() || busy} onClick={() => void createCharacter()}>
              Anlegen
            </button>
          </div>
        </div>
      )}

      <div className="cardlist" style={{ marginTop: 16 }}>
        {data.characters.map((c) => {
          const grouped = c.group_id != null;
          const pending = !grouped && c.requested_group_id != null;
          return (
            <CharacterCard
              key={c.id}
              id={c.id}
              name={c.name}
              subtitle={
                grouped
                  ? data.groups.find((g) => g.id === c.group_id)?.name ?? ''
                  : pending
                    ? `Wartet auf Freigabe: ${groupNameOf(c.requested_group_id)}`
                    : 'Ohne Gruppe'
              }
              // Gruppenlose Charaktere (auch abgelehnte): der Besitzer darf eine
              // Gruppe erbitten oder die Anfrage zurückziehen. Die eigene Liste
              // (nicht-Spielleiter) enthält ohnehin nur eigene Charaktere.
              extra={
                canCreate && !grouped ? (
                  <select
                    value={c.requested_group_id ?? ''}
                    onChange={(e) => void changeRequest(c.id, e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{pending ? 'Anfrage zurückziehen' : 'Gruppe erbitten…'}</option>
                    {groupNames.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : undefined
              }
            />
          );
        })}
        {data.characters.length === 0 && (
          <p className="muted">
            Noch keine Charaktere.{' '}
            {user.isGm ? 'Lege welche unter „Kataloge & Nutzer" an.' : 'Lege dir oben deinen ersten Charakter an.'}
          </p>
        )}
      </div>
    </>
  );
}
