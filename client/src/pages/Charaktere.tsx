import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { apiGet, apiPost, apiPut } from '../api';
import { useOverview, useOverviewRefresh, type Overview } from '../components/overview';

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
  const [newIsShapeshifter, setNewIsShapeshifter] = useState(false);
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
        isShapeshifter: newIsShapeshifter,
      });
      setNewName('');
      setNewGroupId('');
      setNewIsShapeshifter(false);
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

  // Formwandler: eine neue, ruhende Form dieses Charakters anlegen (Server
  // vergibt einen Namensvorschlag) und direkt zum Bearbeiten öffnen.
  const [formBusy, setFormBusy] = useState<number | null>(null);
  const addForm = async (charId: number) => {
    setError('');
    setFormBusy(charId);
    try {
      const { id } = await apiPost<{ id: number }>(`/api/characters/${charId}/forms`, {});
      refresh();
      navigate(`/charakter/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Anlegen der Form');
    } finally {
      setFormBusy(null);
    }
  };
  // Eine andere Form desselben Formwandlers aktiv schalten (übernimmt ggf. die
  // Gruppenzugehörigkeit der bisher aktiven Form) und direkt dorthin wechseln.
  const switchForm = async (charId: number, targetId: number) => {
    setError('');
    setFormBusy(targetId);
    try {
      await apiPost(`/api/characters/${charId}/switch-form`, { targetId });
      refresh();
      navigate(`/charakter/${targetId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Formwechsel');
    } finally {
      setFormBusy(null);
    }
  };

  if (!data) return <p className="muted">Lade…</p>;

  // Formwandler-Familien bilden: alle Charaktere, die dieselbe Basis-Form
  // teilen (shapeshift_of, oder die Basis selbst), gehören in eine Gruppe.
  // Reihenfolge bleibt die der Serverliste (nach Name sortiert) — nur die
  // Karte der ersten angetroffenen Form einer Familie zeigt sie vollständig.
  type CharOv = Overview['characters'][number];
  const familyOf = new Map<number, CharOv[]>();
  for (const c of data.characters) {
    const baseId = c.shapeshift_of ?? c.id;
    const list = familyOf.get(baseId);
    if (list) list.push(c);
    else familyOf.set(baseId, [c]);
  }
  const rendered = new Set<number>();

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
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Kann mehrere vollständige Formen (Bögen) haben, zwischen denen man umschaltet — z. B. eine Werwölfin.">
              <input type="checkbox" checked={newIsShapeshifter} onChange={(e) => setNewIsShapeshifter(e.target.checked)} />
              Formwandler
            </label>
            <button className="primary" disabled={!newName.trim() || busy} onClick={() => void createCharacter()}>
              Anlegen
            </button>
          </div>
        </div>
      )}

      <div className="cardlist" style={{ marginTop: 16 }}>
        {data.characters.map((c) => {
          if (rendered.has(c.id)) return null;
          const family = familyOf.get(c.shapeshift_of ?? c.id) ?? [c];
          for (const m of family) rendered.add(m.id);
          const base = family.find((m) => m.shapeshift_of == null) ?? family[0];
          const activeId = base.active_form_id ?? base.id;
          const active = family.find((m) => m.id === activeId) ?? base;
          const hasForms = family.length > 1;
          // „Neue Form" bleibt auch nutzbar, wenn is_shapeshifter zurückgesetzt
          // wurde — nur das ANLEGEN weiterer Formen ist daran gebunden (siehe
          // db.ts-Kommentar am Feld), das Umschalten zwischen bereits
          // vorhandenen Formen nicht (sonst wären sie unerreichbar).
          const canAddForm = !!base.is_shapeshifter;

          const grouped = active.group_id != null;
          const pending = !grouped && active.requested_group_id != null;
          return (
            <div className="card" key={base.id}>
              <h3>
                <Link to={`/charakter/${active.id}`}>{active.name}</Link>
              </h3>
              {grouped ? (
                <span className="muted">{data.groups.find((g) => g.id === active.group_id)?.name ?? ''}</span>
              ) : (
                <span className="muted">
                  {pending ? `Wartet auf Freigabe: ${groupNameOf(active.requested_group_id)}` : 'Ohne Gruppe'}
                </span>
              )}
              {/* Gruppenlose Charaktere (auch abgelehnte): der Besitzer darf eine
                  Gruppe erbitten oder die Anfrage zurückziehen. Die eigene Liste
                  (nicht-Spielleiter) enthält ohnehin nur eigene Charaktere. */}
              {canCreate && !grouped && (
                <div style={{ marginTop: 8 }}>
                  <select
                    value={active.requested_group_id ?? ''}
                    onChange={(e) => void changeRequest(active.id, e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{pending ? 'Anfrage zurückziehen' : 'Gruppe erbitten…'}</option>
                    {groupNames.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* Formen: die aktive ruht nicht (steht ggf. in der Gruppe), alle
                  anderen sind gruppenlos, bis sie hier ausgewählt werden. */}
              {canCreate && hasForms && (
                <div style={{ marginTop: 8 }}>
                  <select value={active.id} disabled={formBusy != null} onChange={(e) => void switchForm(base.id, Number(e.target.value))}>
                    {family.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {canCreate && canAddForm && (
                <button className="small" style={{ marginTop: 8 }} disabled={formBusy != null} onClick={() => void addForm(base.id)}>
                  + Neue Form
                </button>
              )}
            </div>
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
