import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Attributes, BaseValueInputs, CharLanguage, CharTalent, Resources } from '@shared/types';
import type { DynTab } from '@shared/dynamicSections';
import {
  SICHTBARKEIT_TAB_KEY,
  canStepTab,
  defaultTabKeys,
  dynTabId,
  dynTabKey,
  isFixedTab,
  moveTabKey,
  orderTabKeys,
  stepTabKey,
} from '@shared/tabOrder';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useAuth } from '../App';
import { AlwaysEditable, DisplayModeProvider } from '../components/displayMode';
import type { Row } from '../components/inputs';
import { useTabsHeight } from '../components/stickyChrome';
import { TableLayoutProvider } from '../components/tableLayout';
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
  // Selbst gewählte Reihenfolge der Reiter als Liste von Schlüsseln. Leer =
  // Voreinstellung; unbekannte Schlüssel werden beim Anzeigen aussortiert.
  tabOrder: string[];
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
  // Nur-Lesen ist der Normalfall: das Blatt öffnet sich zum Ansehen, Bearbeiten
  // wird bewusst eingeschaltet. Absichtlich NICHT gemerkt — jedes Öffnen fängt
  // wieder geschützt an, sonst wäre der Schutz nach dem ersten Mal weg.
  const [editing, setEditing] = useState(false);

  // Namensänderung: null = Anzeige, sonst der Entwurf im Eingabefeld.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');

  // Umsortieren der Reiter: welcher hängt am Mauszeiger, und wo würde er landen.
  // `over` ist der Reiter unter dem Zeiger, `key`/`place` die Stelle, an der die
  // Marke gezeichnet wird — das ist nicht immer dasselbe (siehe markerFor).
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ over: string; key: string; place: 'before' | 'after' } | null>(null);

  // Entwickler-Vorschau „Ansehen als": 0 = normal, sonst die Nutzer-ID.
  const canViewAs = !!user.isGm && !!user.devViewAs;
  const [viewAs, setViewAs] = useState(0);
  const [viewUsers, setViewUsers] = useState<{ id: number; displayName: string }[]>([]);

  useEffect(() => {
    if (canViewAs) apiGet<{ id: number; displayName: string }[]>('/api/admin/users').then(setViewUsers).catch(() => {});
  }, [canViewAs]);

  // Die Reiterleiste klebt oben und bricht je nach Anzahl der Reiter um. Was
  // darunter ebenfalls kleben soll, muss ihre tatsächliche Höhe kennen.
  const tabsRef = useTabsHeight();

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

  // Reihenfolge der Reiter sichern — wie die Spaltenbreiten sofort, nicht über
  // das entprellte Sammel-Speichern: das passiert einmal je Zug und soll auch
  // dann ankommen, wenn gleich danach die Seite verlassen wird.
  const saveTabOrder = useCallback(
    (order: string[]) => {
      setData((prev) => (prev ? { ...prev, tabOrder: order } : prev));
      setSaveState('Speichere…');
      apiPut<{ order: string[] }>(`/api/characters/${charId}/tab-order`, { order })
        .then((res) => {
          setData((prev) => (prev ? { ...prev, tabOrder: res.order } : prev));
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

  // Eingebaute und selbst angelegte Reiter in einer Liste — nur so lassen sie
  // sich gemeinsam sortieren. Was der Charakter nicht (mehr) hat, fällt hier
  // heraus; was neu ist, hängt sich hinten an.
  const order = orderTabKeys(defaultTabKeys(tabs.map((t) => t.id)), data!.tabOrder ?? []);
  const tabByKey = (key: string) => {
    const tid = dynTabId(key);
    return tid === null ? null : (tabs.find((t) => t.id === tid) ?? null);
  };
  const tabName = (key: string) => tabByKey(key)?.name ?? key;
  const activeContentTab = tabByKey(activeKey);

  // Inhalt eines eingebauten Reiters. Selbst angelegte laufen über ContentTabView.
  // Die Übersicht steht bewusst in einer Ausnahme-Insel: dort liegen die Werte,
  // die sich im Spiel dauernd ändern (Energien, Psyche, Geld) — die will man
  // nicht erst über „Bearbeiten" freischalten müssen.
  const builtinTab = (key: string) =>
    key === 'Übersicht' ? (
      <AlwaysEditable>
        <UebersichtTab />
      </AlwaysEditable>
    )
    : key === 'Heldenbrief' ? <HeldenbriefTab />
    : key === 'Talente' ? <TalenteTab />
    : key === 'Waffen' ? <WaffenTab />
    : key === 'Sprachen' ? <SprachenTab />
    : key === SICHTBARKEIT_TAB_KEY ? <SichtbarkeitTab />
    : null;

  const applyOrder = (next: string[]) => {
    if (next.length === order.length && next.every((k, i) => k === order[i])) return;
    saveTabOrder(next);
  };
  const stepTab = (key: string, dir: -1 | 1) => applyOrder(stepTabKey(order, key, dir));

  const addTab = async () => {
    const { id: newId } = await apiPost<{ id: number }>(`/api/characters/${charId}/tabs`, { name: 'Neuer Tab' });
    const key = dynTabKey(newId);
    setTabs((t) => [...t, { id: newId, name: 'Neuer Tab', locked: false, pos: t.length, sections: [] }]);
    setActiveKey(key);
    // Neue Reiter sollen wie bisher vor „Sichtbarkeit" stehen, nicht dahinter.
    applyOrder(moveTabKey([...order, key], key, SICHTBARKEIT_TAB_KEY, 'before'));
  };
  const renameTab = async (tid: number, name: string) => {
    setTabs((t) => t.map((x) => (x.id === tid ? { ...x, name } : x)));
    await apiPut(`/api/characters/${charId}/tabs/${tid}`, { name });
  };
  const deleteTab = async (tid: number) => {
    await apiDelete(`/api/characters/${charId}/tabs/${tid}`);
    setTabs((t) => t.filter((x) => x.id !== tid));
    setActiveKey('Heldenbrief');
    // Den Schlüssel gleich mit aus der Reihenfolge nehmen: SQLite vergibt
    // gelöschte Zeilennummern wieder, sonst erbte ein künftiger Reiter mit
    // derselben ID den Platz des gelöschten.
    applyOrder(order.filter((k) => k !== dynTabKey(tid)));
  };

  // --- Reiter umsortieren (Ziehen mit der Maus, Alt+Pfeil auf der Tastatur) ---

  const dropSide = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };

  // Wo die Markierung stehen soll. Auf einen festen Reiter darf nichts fallen —
  // ein Wurf dorthin bedeutet „ganz nach links", also hinter den festen Block.
  // Die Markierung sagt das auch, statt eine Lücke zu zeigen, die es nicht gibt.
  const markerFor = (over: string, place: 'before' | 'after') => {
    if (!isFixedTab(over)) return { over, key: over, place };
    const fixed = order.filter(isFixedTab);
    return { over, key: fixed[fixed.length - 1] ?? over, place: 'after' as const };
  };

  const dropOn = (targetKey: string, e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain') || dragKey;
    const place = dropSide(e);
    setDragKey(null);
    setDropAt(null);
    if (key) applyOrder(moveTabKey(order, key, targetKey, place));
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
      <DisplayModeProvider mode={editing ? 'edit' : 'readonly'}>
      <div className="screen-only">
        {viewAsBar}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          {nameDraft === null ?
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <h1>{info.name}</h1>
              {/* Im Ansehen-als-Modus bewusst ausgeblendet: die Vorschau ist rein lesend. */}
              {!viewAs && editing && (
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
          {/* Im Ansehen-als-Modus gibt es nichts zu bearbeiten — die Vorschau
              ist rein lesend, ein Bearbeiten-Knopf wäre dort eine Falle. */}
          {!viewAs && (
            <button
              className={editing ? 'btn-action' : 'primary'}
              onClick={() => {
                // Beim Verlassen sofort sichern statt auf die Entprellung zu
                // warten: wer „Fertig" drückt, ist unter Umständen gleich weg.
                if (editing) void flush();
                setEditing((v) => !v);
              }}
              title={
                editing ?
                  'Bearbeiten beenden — das Blatt ist danach wieder geschützt'
                : 'Blatt bearbeiten. Übersicht und laufende Werte gehen auch ohne das.'
              }
            >
              {editing ? '🔓 Fertig' : '🔒 Bearbeiten'}
            </button>
          )}
          <button className="small" onClick={() => setPrinting(true)} title="Alle Tabs drucken / als PDF speichern (je Tab eine Seite)">
            Drucken
          </button>
          <button className="small" onClick={exportChar} title="Charakter als JSON-Datei herunterladen">
            Export
          </button>
        </div>
        <div className="tabs" ref={tabsRef}>
          {order.map((key) => {
            // Die Reihenfolge der Reiter gehört zum Charakter und wird
            // gespeichert — ohne Bearbeiten bleibt sie, wie sie ist. „Fest" und
            // „gerade nicht verschiebbar" bleiben dabei getrennt: sonst hieße
            // im Nur-Lesen-Modus jeder Reiter „Fester Reiter", was schlicht
            // nicht stimmt.
            const fixed = isFixedTab(key);
            const movable = !fixed && editing;
            const marker = dropAt?.key === key ? ` drop-${dropAt.place}` : '';
            return (
              <button
                key={key}
                className={`${key === activeKey ? 'active' : ''}${movable ? ' movable' : ''}${dragKey === key ? ' dragging' : ''}${marker}`}
                draggable={movable}
                title={
                  movable ? 'Ziehen zum Umsortieren — oder Alt+← / Alt+→'
                  : fixed ? 'Fester Reiter'
                  : undefined
                }
                onClick={() => setActiveKey(key)}
                onDragStart={(e) => {
                  if (!movable) return;
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox startet einen Zug nur, wenn Daten hinterlegt sind.
                  e.dataTransfer.setData('text/plain', key);
                  setDragKey(key);
                }}
                onDragOver={(e) => {
                  if (!dragKey || dragKey === key) return;
                  e.preventDefault(); // ohne das gibt es kein Drop
                  e.dataTransfer.dropEffect = 'move';
                  const next = markerFor(key, dropSide(e));
                  setDropAt((d) => (d?.key === next.key && d.place === next.place ? d : next));
                }}
                onDragLeave={() => setDropAt((d) => (d?.over === key ? null : d))}
                onDrop={(e) => dropOn(key, e)}
                onDragEnd={() => {
                  setDragKey(null);
                  setDropAt(null);
                }}
                onKeyDown={(e) => {
                  if (!movable || !e.altKey) return;
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  stepTab(key, e.key === 'ArrowLeft' ? -1 : 1);
                }}
              >
                {tabName(key)}
              </button>
            );
          })}
          {editing && (
            <button className="small" onClick={addTab} title="Neuen Tab anlegen" style={{ alignSelf: 'center' }}>
              + Tab
            </button>
          )}
        </div>
        {activeContentTab ? (
          <ContentTabView
            key={`${activeContentTab.id}:${reloadTick}`}
            basePath={`/api/characters/${charId}`}
            tab={activeContentTab}
            attributes={data!.attributes}
            isFirst={!canStepTab(order, activeKey, -1)}
            isLast={!canStepTab(order, activeKey, 1)}
            onDirtyChange={(d) => {
              dynDirty.current = d;
            }}
            onSectionsChange={(secs) =>
              setTabs((t) => t.map((x) => (x.id === activeContentTab.id ? { ...x, sections: secs } : x)))
            }
            onRenameTab={(name) => renameTab(activeContentTab.id, name)}
            onDeleteTab={() => deleteTab(activeContentTab.id)}
            onMoveTab={(dir) => stepTab(activeKey, dir)}
          />
        ) : (
          <>
            {/* Die selbst angelegten Reiter tragen ihre Pfeile in der Kopfzeile
                von ContentTabView. Die eingebauten haben keine solche Zeile —
                also bekommen sie hier dieselben zwei Knöpfe. */}
            {!isFixedTab(activeKey) && editing && (
              <div className="tab-move">
                <button
                  className="small"
                  disabled={!canStepTab(order, activeKey, -1)}
                  onClick={() => stepTab(activeKey, -1)}
                  title="Tab nach links"
                >
                  ←
                </button>
                <button
                  className="small"
                  disabled={!canStepTab(order, activeKey, 1)}
                  onClick={() => stepTab(activeKey, 1)}
                  title="Tab nach rechts"
                >
                  →
                </button>
              </div>
            )}
            {builtinTab(activeKey)}
          </>
        )}
      </div>
      </DisplayModeProvider>

      {printing && (
        <DisplayModeProvider mode="print">
        <div className="print-root">
          {/* Die Seiten folgen der gewählten Reiter-Reihenfolge; „Sichtbarkeit"
              ist eine Einstellung und gehört nicht auf den Charakterbogen. */}
          {order
            .filter((key) => key !== SICHTBARKEIT_TAB_KEY)
            .map((key) => {
              const dyn = tabByKey(key);
              if (dynTabId(key) !== null && !dyn) return null;
              return (
                <section key={key} className="print-page">
                  <div className="print-page-head">
                    <span className="print-char">{info.name}</span>
                    <span className="print-tab">{tabName(key)}</span>
                  </div>
                  {dyn ? (
                    <ContentTabView
                      basePath={`/api/characters/${charId}`}
                      tab={dyn}
                      attributes={data!.attributes}
                      isFirst
                      isLast
                      showVisibility={false}
                      onRenameTab={() => {}}
                      onDeleteTab={() => {}}
                      onMoveTab={() => {}}
                    />
                  ) : (
                    builtinTab(key)
                  )}
                </section>
              );
            })}
        </div>
        </DisplayModeProvider>
      )}
      </TableLayoutProvider>
    </CharCtx.Provider>
  );
}
