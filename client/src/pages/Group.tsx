import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Attributes } from '@shared/types';
import type { DynTab } from '@shared/dynamicSections';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useAuth } from '../App';
import CharacterCard from '../components/CharacterCard';
import { Portrait } from '../components/Portrait';
import { useTabsHeight } from '../components/stickyChrome';
import ContentTabView from '../tabs/Sektionen';

interface GroupData {
  group: { id: number; name: string; portrait: boolean };
  members: { id: number; username: string; displayName: string }[];
  characters: { id: number; name: string; ownerName: string; access: 'edit' | 'summary' | null; portrait: boolean }[];
  tabs: DynTab[];
}

// Gruppeninhalte haben keine Attribute — Probe-Spalten gibt es hier nicht,
// der Wert wird nur gebraucht, weil die Sektions-Ansicht ihn erwartet.
const NO_ATTRIBUTES = {} as Attributes;

export default function GroupPage() {
  const { user } = useAuth();
  const { id } = useParams();
  // Die Reiterleiste klebt oben — was darunter ebenfalls klebt (die
  // Tabellenköpfe in den Sektionen), braucht ihre GEMESSENE Höhe. Ohne diese
  // Referenz blieb `--tabs-h` hier ungesetzt, und die Tabellenköpfe rechneten
  // mit dem Ersatzwert 45px: richtig bei einer Reihe Reiter, um eine ganze
  // Zeile daneben, sobald sie umbrechen.
  const tabsRef = useTabsHeight();
  const groupId = Number(id);
  const [data, setData] = useState<GroupData | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<number | null>(null);
  // Geht in den React-Key des aktiven Tabs ein; bei stiller Aktualisierung
  // hochgezählt, damit ContentTabView (hält Zeilen in eigenem State) die
  // frischen Serverdaten übernimmt.
  const [reloadTick, setReloadTick] = useState(0);
  const dynDirty = useRef(false); // aktiver Tab hat ungespeicherte Zeilen?

  // Lädt die Gruppe. quiet=true: stille Hintergrund-Aktualisierung ohne
  // Lade-Anzeige — der bisherige Stand bleibt stehen, bis neue Daten da sind.
  const loadGroup = useCallback(
    (quiet = false) => {
      if (!quiet) setData(null);
      return apiGet<GroupData>(`/api/groups/${groupId}`)
        .then((d) => {
          setData(d);
          // Aktiven Tab behalten, falls es ihn noch gibt — sonst ersten wählen.
          setActiveTab((prev) => (prev && d.tabs.some((t) => t.id === prev) ? prev : d.tabs[0]?.id ?? null));
          if (quiet) setReloadTick((t) => t + 1);
        })
        .catch((e) => {
          if (!quiet) setError(e instanceof Error ? e.message : 'Fehler');
        });
    },
    [groupId],
  );

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  // Bei Rückkehr auf den Tab/ins Fenster still nachladen — so sehen
  // Gruppenmitglieder Änderungen der anderen an den gemeinsamen Inhalten, ohne
  // neu zu laden. Nicht während eigener ungespeicherter Zeilen (dynDirty).
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState !== 'visible') return;
      if (dynDirty.current) return;
      void loadGroup(true);
    };
    window.addEventListener('focus', maybeReload);
    document.addEventListener('visibilitychange', maybeReload);
    return () => {
      window.removeEventListener('focus', maybeReload);
      document.removeEventListener('visibilitychange', maybeReload);
    };
  }, [loadGroup]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Lade…</p>;

  const basePath = `/api/groups/${groupId}`;
  const tabs = data.tabs;
  const setTabs = (fn: (t: DynTab[]) => DynTab[]) => setData((prev) => (prev ? { ...prev, tabs: fn(prev.tabs) } : prev));
  const current = tabs.find((t) => t.id === activeTab) ?? null;

  const addTab = async () => {
    const { id: newId } = await apiPost<{ id: number }>(`${basePath}/tabs`, { name: 'Neuer Tab' });
    setTabs((t) => [...t, { id: newId, name: 'Neuer Tab', locked: false, pos: t.length, sections: [] }]);
    setActiveTab(newId);
  };
  const renameTab = async (tid: number, name: string) => {
    setTabs((t) => t.map((x) => (x.id === tid ? { ...x, name } : x)));
    await apiPut(`${basePath}/tabs/${tid}`, { name });
  };
  const deleteTab = async (tid: number) => {
    await apiDelete(`${basePath}/tabs/${tid}`);
    setTabs((t) => t.filter((x) => x.id !== tid));
    setActiveTab(tabs.find((t) => t.id !== tid)?.id ?? null);
  };
  const moveTab = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= tabs.length) return;
    const next = tabs.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setTabs(() => next);
    await apiPut(`${basePath}/tabs/reorder`, { order: next.map((t) => t.id) });
  };

  return (
    <>
      <div className="group-head">
        <Portrait kind="group" id={groupId} initialHasImage={data.group.portrait} />
        <div>
          <h1>Gruppe: {data.group.name}</h1>
          <p className="muted">Mitglieder: {data.members.map((m) => m.displayName).join(', ') || '—'}</p>
          {user.isGm && (
            <p>
              <Link to={`/gruppe/${groupId}/uebersicht`}>Spielleiter-Übersicht →</Link>
            </p>
          )}
        </div>
      </div>

      <div className="cardlist">
        {data.characters.map((c) => (
          <CharacterCard
            key={c.id}
            id={c.id}
            name={c.name}
            portrait={c.portrait}
            subtitle={
              <>
                Spieler: {c.ownerName}
                {c.access === 'edit' ? ' · bearbeitbar' : ''}
              </>
            }
          />
        ))}
        {data.characters.length === 0 && <p className="muted">Keine Charaktere in dieser Gruppe.</p>}
      </div>

      <h2>Gemeinsames</h2>
      <div className="tabs" ref={tabsRef}>
        {tabs.map((t) => (
          <button key={t.id} className={t.id === activeTab ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
            {t.name}
          </button>
        ))}
        <button className="small" onClick={addTab} title="Neuen Tab anlegen" style={{ alignSelf: 'center' }}>
          + Tab
        </button>
      </div>

      {current ? (
        <ContentTabView
          key={`${current.id}:${reloadTick}`}
          basePath={basePath}
          tab={current}
          attributes={NO_ATTRIBUTES}
          isFirst={tabs.indexOf(current) === 0}
          isLast={tabs.indexOf(current) === tabs.length - 1}
          showVisibility={false}
          allowProbe={false}
          onDirtyChange={(d) => {
            dynDirty.current = d;
          }}
          onSectionsChange={(secs) =>
            setTabs((t) => t.map((x) => (x.id === current.id ? { ...x, sections: secs } : x)))
          }
          onRenameTab={(name) => renameTab(current.id, name)}
          onDeleteTab={() => deleteTab(current.id)}
          onMoveTab={(dir) => moveTab(tabs.indexOf(current), dir)}
        />
      ) : (
        <p className="muted">Noch keine Tabs. Lege einen an, um gemeinsame Inhalte zu sammeln.</p>
      )}
    </>
  );
}
