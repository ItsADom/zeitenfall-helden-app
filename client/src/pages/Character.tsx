import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Attributes, BaseValueInputs, CharLanguage, CharTalent, Resources } from '@shared/types';
import type { DynTab } from '@shared/dynamicSections';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useAuth } from '../App';
import type { Row } from '../components/inputs';
import { PrintScope, TableLayoutProvider } from '../components/tableLayout';
import ContentTabView from '../tabs/Sektionen';
import UebersichtTab from '../tabs/Uebersicht';
import HeldenbriefTab from '../tabs/Heldenbrief';
import TalenteTab from '../tabs/Talente';
import WaffenTab from '../tabs/Waffen';
import SprachenTab from '../tabs/Sprachen';
import SichtbarkeitTab from '../tabs/Sichtbarkeit';
import SummaryView from '../tabs/Summary';

export interface FullData {
  bio: Record<string, string>;
  meta: Record<string, number>;
  attributes: Attributes;
  baseValues: BaseValueInputs;
  resources: Resources;
  talents: CharTalent[];
  languages: CharLanguage[];
  lists: Record<string, Row[]>;
  tabs: DynTab[];
  visibility: Record<string, boolean>;
  // Spaltenbreiten der fest eingebauten Tabellen, je Tabellen-Schlüssel in
  // Prozent. Die selbst angelegten Tabellen führen ihre Breiten dagegen in der
  // Spaltendefinition mit (DynColumn.width).
  tableWidths: Record<string, number[]>;
  portrait: boolean;
}

export interface TalentCatalogRow {
  id: number;
  kategorie: string;
  gruppe: string;
  name: string;
  probe: string;
  ableiten: string;
  skill100: string;
  sort: number;
}
export interface LanguageCatalogRow {
  id: number;
  kind: string;
  familie: string;
  name: string;
  komplexitaet: string;
  sort: number;
}
export interface Catalogs {
  talents: TalentCatalogRow[];
  languages: LanguageCatalogRow[];
}

interface CharacterInfo {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  groupId: number;
  groupName: string;
}

interface CharCtxValue {
  charId: number;
  data: FullData;
  catalogs: Catalogs;
  update: (section: string, value: unknown) => void;
}
const CharCtx = createContext<CharCtxValue | null>(null);
export const useChar = () => useContext(CharCtx)!;

const BUILTIN_TABS = ['Übersicht', 'Heldenbrief', 'Talente', 'Waffen', 'Sprachen'] as const;

export default function CharacterPage() {
  const { id } = useParams();
  const charId = Number(id);
  const { user } = useAuth();
  const [info, setInfo] = useState<CharacterInfo | null>(null);
  const [access, setAccess] = useState<'edit' | 'summary' | null>(null);
  const [data, setData] = useState<FullData | null>(null);
  const [summary, setSummary] = useState<unknown>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [activeKey, setActiveKey] = useState<string>('Übersicht');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('');
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Namensänderung: null = Anzeige, sonst der Entwurf im Eingabefeld.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');

  // Entwickler-Vorschau „Ansehen als": 0 = normal, sonst die Nutzer-ID.
  const canViewAs = !!user.isGm && !!user.devViewAs;
  const [viewAs, setViewAs] = useState(0);
  const [viewUsers, setViewUsers] = useState<{ id: number; displayName: string }[]>([]);

  useEffect(() => {
    if (canViewAs) apiGet<{ id: number; displayName: string }[]>('/api/admin/users').then(setViewUsers).catch(() => {});
  }, [canViewAs]);

  // Wird bei einer stillen Aktualisierung hochgezählt und geht in den React-Key
  // des aktiven Inhalts-Tabs ein — so übernimmt ContentTabView (hält Zeilen in
  // eigenem State) die frischen Serverdaten. Die berechneten Tabs lesen ohnehin
  // aus dem Kontext und aktualisieren sich von selbst.
  const [reloadTick, setReloadTick] = useState(0);

  // Lädt den Charakter. quiet=true: stille Hintergrund-Aktualisierung ohne
  // Lade-Spinner — die bisherige Anzeige bleibt stehen, bis neue Daten da sind.
  const loadCharacter = useCallback(
    (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setData(null);
        setSummary(null);
      }
      setError('');
      const q = viewAs ? `?asUser=${viewAs}` : '';
      return apiGet<{ character: CharacterInfo; access: 'edit' | 'summary' | null; data?: FullData; summary?: unknown }>(
        `/api/characters/${charId}${q}`,
      )
        .then((res) => {
          setInfo(res.character);
          setAccess(res.access);
          setData(res.data ?? null);
          setSummary(res.summary ?? null);
          if (quiet) setReloadTick((t) => t + 1);
        })
        .catch((e) => {
          // Fehler einer stillen Aktualisierung nicht anzeigen — der alte Stand
          // bleibt stehen, es wird beim nächsten Fokus erneut versucht.
          if (!quiet) setError(e instanceof Error ? e.message : 'Fehler');
        })
        .finally(() => {
          if (!quiet) setLoading(false);
        });
    },
    [charId, viewAs],
  );

  useEffect(() => {
    void loadCharacter();
    apiGet<Catalogs>('/api/catalogs').then(setCatalogs);
  }, [loadCharacter]);

  const viewAsBar = canViewAs ? (
    <div className="viewas-bar">
      <span className="viewas-tag">DEV</span>
      <label>Ansehen als</label>
      <select value={viewAs} onChange={(e) => setViewAs(Number(e.target.value))}>
        <option value={0}>— normal ({user.displayName})</option>
        {viewUsers
          .filter((u) => u.id !== user.id)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
      </select>
      {viewAs !== 0 && <span className="muted">Sicht: {access ?? 'kein Zugriff'}</span>}
    </div>
  ) : null;

  // Automatisches Speichern geänderter Sektionen (entprellt)
  const dirty = useRef(new Set<string>());
  const saving = useRef(false); // läuft gerade ein Speichern der festen Sektionen?
  const dynDirty = useRef(false); // hat der aktive Inhalts-Tab ungespeicherte Zeilen?
  const timer = useRef<number | undefined>(undefined);
  const dataRef = useRef<FullData | null>(null);
  dataRef.current = data;

  const flush = useCallback(async () => {
    const sections = [...dirty.current];
    dirty.current.clear();
    const d = dataRef.current;
    if (!d || sections.length === 0) return;
    saving.current = true;
    setSaveState('Speichere…');
    try {
      for (const s of sections) {
        if (s === 'visibility') await apiPut(`/api/characters/${charId}/visibility`, d.visibility);
        else {
          const value =
            s === 'bio' ? d.bio
            : s === 'meta' ? d.meta
            : s === 'attributes' ? d.attributes
            : s === 'baseValues' ? d.baseValues
            : s === 'resources' ? d.resources
            : s === 'talents' ? d.talents
            : s === 'languages' ? d.languages
            : d.lists[s];
          await apiPut(`/api/characters/${charId}/section/${s}`, value);
        }
      }
      setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      dirty.current = new Set([...dirty.current, ...sections]);
      setSaveState(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving.current = false;
    }
  }, [charId]);

  const update = useCallback(
    (section: string, value: unknown) => {
      setData((prev) => {
        if (!prev) return prev;
        if (section === 'bio') return { ...prev, bio: value as FullData['bio'] };
        if (section === 'meta') return { ...prev, meta: value as FullData['meta'] };
        if (section === 'attributes') return { ...prev, attributes: value as Attributes };
        if (section === 'baseValues') return { ...prev, baseValues: value as BaseValueInputs };
        if (section === 'resources') return { ...prev, resources: value as Resources };
        if (section === 'talents') return { ...prev, talents: value as CharTalent[] };
        if (section === 'languages') return { ...prev, languages: value as CharLanguage[] };
        if (section === 'visibility') return { ...prev, visibility: value as FullData['visibility'] };
        return { ...prev, lists: { ...prev.lists, [section]: value as Row[] } };
      });
      dirty.current.add(section);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 1500);
    },
    [flush],
  );

  // Spaltenbreiten einer eingebauten Tabelle sichern. Wie beim Namen bewusst
  // sofort statt über das entprellte Sammel-Speichern: es passiert genau einmal,
  // beim Klick auf „Fertig". Der Server normalisiert und antwortet mit dem
  // gespeicherten Satz — den übernehmen wir, damit Anzeige und Datenbank
  // garantiert dasselbe zeigen.
  const saveTableWidths = useCallback(
    (key: string, widths: number[]) => {
      setData((prev) => (prev ? { ...prev, tableWidths: { ...prev.tableWidths, [key]: widths } } : prev));
      setSaveState('Speichere…');
      apiPut<{ widths: number[] }>(`/api/characters/${charId}/table-widths`, { key, widths })
        .then((res) => {
          setData((prev) => (prev ? { ...prev, tableWidths: { ...prev.tableWidths, [key]: res.widths } } : prev));
          setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
        })
        .catch((e) => setSaveState(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`));
    },
    [charId],
  );

  // Kehrt der Tab/das Fenster in den Vordergrund zurück, still nachladen — so
  // sieht man Änderungen anderer (Spielleiter ⇄ Spieler), ohne neu zu laden.
  // Bewusst NICHT während eigener ungespeicherter Änderungen (feste Sektionen:
  // dirty/saving; aktiver Inhalts-Tab: dynDirty) — sonst würde der eigene Stand
  // vom Serverstand überschrieben.
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState !== 'visible') return;
      if (dirty.current.size > 0 || saving.current || dynDirty.current) return;
      void loadCharacter(true);
    };
    window.addEventListener('focus', maybeReload);
    document.addEventListener('visibilitychange', maybeReload);
    return () => {
      window.removeEventListener('focus', maybeReload);
      document.removeEventListener('visibilitychange', maybeReload);
    };
  }, [loadCharacter]);

  // Druck-/PDF-Ansicht: sobald `printing` steht, sind alle Tabs im DOM (je Tab
  // eine Seite, per CSS `break-before`). Nach dem Rendern den Druckdialog öffnen
  // und danach (auch bei Abbruch feuert 'afterprint') wieder aufräumen.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // Kurzer Timeout, damit die Druckansicht sicher im Layout steht, bevor der
    // Dialog öffnet. Das Aufräumen bricht den ersten Lauf des StrictMode-
    // Doppelaufrufs ab, sodass der Dialog genau einmal erscheint.
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.removeEventListener('afterprint', done);
      window.clearTimeout(t);
    };
  }, [printing]);

  if (error) return <p className="error">{error}</p>;
  // Während eines Wechsels (auch „Ansehen als") sind data/summary kurz null,
  // access hält aber noch die alte Sicht — erst rendern, wenn die passende
  // Nutzlast wirklich da ist, sonst kracht z. B. die Zusammenfassung auf null.
  if (loading || !info || !catalogs) {
    return (
      <>
        {viewAsBar}
        <p className="muted">Lade…</p>
      </>
    );
  }

  if (access === 'summary') {
    return (
      <>
        {viewAsBar}
        <SummaryView info={info} summary={summary as never} />
      </>
    );
  }

  // Kein Zugriff — nur im Ansehen-als-Modus erreichbar (sonst liefert der Server 404).
  if (access !== 'edit') {
    return (
      <>
        {viewAsBar}
        <h1>{info.name}</h1>
        <p className="muted">Dieser Nutzer hätte keinen Zugriff auf diesen Charakter.</p>
      </>
    );
  }

  const tabs = data!.tabs;
  const setTabs = (fn: (t: DynTab[]) => DynTab[]) => setData((prev) => (prev ? { ...prev, tabs: fn(prev.tabs) } : prev));
  const activeContentTab = tabs.find((t) => `c${t.id}` === activeKey) ?? null;

  const addTab = async () => {
    const { id: newId } = await apiPost<{ id: number }>(`/api/characters/${charId}/tabs`, { name: 'Neuer Tab' });
    setTabs((t) => [...t, { id: newId, name: 'Neuer Tab', locked: false, pos: t.length, sections: [] }]);
    setActiveKey(`c${newId}`);
  };
  const renameTab = async (tid: number, name: string) => {
    setTabs((t) => t.map((x) => (x.id === tid ? { ...x, name } : x)));
    await apiPut(`/api/characters/${charId}/tabs/${tid}`, { name });
  };
  const deleteTab = async (tid: number) => {
    await apiDelete(`/api/characters/${charId}/tabs/${tid}`);
    setTabs((t) => t.filter((x) => x.id !== tid));
    setActiveKey('Heldenbrief');
  };
  const moveTab = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= tabs.length) return;
    const next = tabs.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setTabs(() => next);
    await apiPut(`/api/characters/${charId}/tabs/reorder`, { order: next.map((t) => t.id) });
  };

  const cancelName = () => {
    setNameDraft(null);
    setNameError('');
  };

  // Der Name hängt nicht an FullData, sondern am Charakter-Datensatz selbst —
  // deshalb nicht über das entprellte Sammel-Speichern, sondern direkt und
  // sofort. Danach steht er in der Datenbank und alle anderen (Spielleiter,
  // Gruppenübersicht) sehen ihn beim nächsten Laden.
  const saveName = async () => {
    const next = (nameDraft ?? '').trim();
    if (!next || next === info.name) {
      cancelName();
      return;
    }
    try {
      const res = await apiPut<{ name: string }>(`/api/characters/${charId}/name`, { name: next });
      setInfo((prev) => (prev ? { ...prev, name: res.name } : prev));
      setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
      cancelName();
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Fehler beim Speichern');
    }
  };

  // Vollständigen Charakter als JSON-Datei herunterladen. Der Client hält die
  // Daten ohnehin schon (FullData) — kein Server-Aufruf nötig. Das Format ist
  // dasselbe, das der Import auf der Verwaltungsseite wieder einliest.
  const exportChar = () => {
    const payload = { schema: 'helden-character', version: 1, exportedAt: new Date().toISOString(), name: info.name, data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = info.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
    a.download = `${safe || 'charakter'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <CharCtx.Provider value={{ charId, data: data!, catalogs, update }}>
      <TableLayoutProvider widths={data!.tableWidths ?? {}} save={saveTableWidths}>
      <div className="screen-only">
        {viewAsBar}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          {nameDraft === null ?
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <h1>{info.name}</h1>
              {/* Im Ansehen-als-Modus bewusst ausgeblendet: die Vorschau ist rein lesend. */}
              {!viewAs && (
                <button className="small" onClick={() => setNameDraft(info.name)} title="Namen ändern" aria-label="Namen ändern">
                  ✏️
                </button>
              )}
            </div>
          : <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <input
                className="char-title"
                autoFocus
                maxLength={60}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName();
                  if (e.key === 'Escape') cancelName();
                }}
              />
              <button className="small" onClick={() => void saveName()} title="Namen speichern (Enter)">
                ✓
              </button>
              <button className="small" onClick={cancelName} title="Abbrechen (Esc)">
                ✕
              </button>
              {nameError && <span className="error">{nameError}</span>}
            </div>
          }
          <span className="muted">
            Spieler: {info.ownerName} · Gruppe:{' '}
            {info.groupId ? <Link to={`/gruppe/${info.groupId}`}>{info.groupName}</Link> : info.groupName}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="savestate">{saveState}</span>
          <button className="small" onClick={() => setPrinting(true)} title="Alle Tabs drucken / als PDF speichern (je Tab eine Seite)">
            Drucken
          </button>
          <button className="small" onClick={exportChar} title="Charakter als JSON-Datei herunterladen">
            Export
          </button>
        </div>
        <div className="tabs">
          {BUILTIN_TABS.map((t) => (
            <button key={t} className={t === activeKey ? 'active' : ''} onClick={() => setActiveKey(t)}>
              {t}
            </button>
          ))}
          {tabs.map((t) => (
            <button key={t.id} className={`c${t.id}` === activeKey ? 'active' : ''} onClick={() => setActiveKey(`c${t.id}`)}>
              {t.name}
            </button>
          ))}
          <button className="small" onClick={addTab} title="Neuen Tab anlegen" style={{ alignSelf: 'center' }}>
            + Tab
          </button>
          <button className={activeKey === 'Sichtbarkeit' ? 'active' : ''} onClick={() => setActiveKey('Sichtbarkeit')}>
            Sichtbarkeit
          </button>
        </div>
        {activeKey === 'Übersicht' && <UebersichtTab />}
        {activeKey === 'Heldenbrief' && <HeldenbriefTab />}
        {activeKey === 'Talente' && <TalenteTab />}
        {activeKey === 'Waffen' && <WaffenTab />}
        {activeKey === 'Sprachen' && <SprachenTab />}
        {activeKey === 'Sichtbarkeit' && <SichtbarkeitTab />}
        {activeContentTab && (
          <ContentTabView
            key={`${activeContentTab.id}:${reloadTick}`}
            basePath={`/api/characters/${charId}`}
            tab={activeContentTab}
            attributes={data!.attributes}
            isFirst={tabs.indexOf(activeContentTab) === 0}
            isLast={tabs.indexOf(activeContentTab) === tabs.length - 1}
            onDirtyChange={(d) => {
              dynDirty.current = d;
            }}
            onSectionsChange={(secs) =>
              setTabs((t) => t.map((x) => (x.id === activeContentTab.id ? { ...x, sections: secs } : x)))
            }
            onRenameTab={(name) => renameTab(activeContentTab.id, name)}
            onDeleteTab={() => deleteTab(activeContentTab.id)}
            onMoveTab={(dir) => moveTab(tabs.indexOf(activeContentTab), dir)}
          />
        )}
      </div>

      {printing && (
        <PrintScope>
        <div className="print-root">
          {[
            { key: 'Übersicht', node: <UebersichtTab /> },
            { key: 'Heldenbrief', node: <HeldenbriefTab /> },
            { key: 'Talente', node: <TalenteTab /> },
            { key: 'Waffen', node: <WaffenTab /> },
            { key: 'Sprachen', node: <SprachenTab /> },
          ].map((t) => (
            <section key={t.key} className="print-page">
              <div className="print-page-head">
                <span className="print-char">{info.name}</span>
                <span className="print-tab">{t.key}</span>
              </div>
              {t.node}
            </section>
          ))}
          {tabs.map((t) => (
            <section key={`c${t.id}`} className="print-page">
              <div className="print-page-head">
                <span className="print-char">{info.name}</span>
                <span className="print-tab">{t.name}</span>
              </div>
              <ContentTabView
                basePath={`/api/characters/${charId}`}
                tab={t}
                attributes={data!.attributes}
                isFirst
                isLast
                showVisibility={false}
                onRenameTab={() => {}}
                onDeleteTab={() => {}}
                onMoveTab={() => {}}
              />
            </section>
          ))}
        </div>
        </PrintScope>
      )}
      </TableLayoutProvider>
    </CharCtx.Provider>
  );
}
