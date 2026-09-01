import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DynTab } from '@shared/dynamicSections';
import { defaultTabKeys, dynTabId, orderTabKeys } from '@shared/tabOrder';
import { wikiSlug } from '@shared/wikiSlug';
import { apiGet, apiPut } from '../api';
import { useAuth } from '../App';
import CharacterSidebar from '../components/CharacterSidebar';
import { ladeZiele } from '../wiki/api';
import type { Catalogs, FullData, LanguageCatalogRow, RaceCatalogRow, TalentCatalogRow } from '../components/charSheet';
import { CharCtx, useCharSheet, useChar } from '../components/charSheet';
import { DisplayModeProvider } from '../components/displayMode';
import { useCharHeadHeight, useTabsHeight } from '../components/stickyChrome';
import { TableLayoutProvider } from '../components/tableLayout';
import ContentTabView from '../tabs/Sektionen';
import HeldenbriefTab from '../tabs/Heldenbrief';
import InventarTab from '../tabs/Inventar';
import AusruestungTab from '../tabs/Ausruestung';
import TalenteTab from '../tabs/Talente';
import WaffenNeuTab from '../tabs/WaffenNeu';
import ZauberTab from '../tabs/Zauber';
import FaehigkeitenTab from '../tabs/Faehigkeiten';
import SprachenTab from '../tabs/Sprachen';
import SummaryView from '../tabs/Summary';

// pages/Character.tsx bleibt die Seite: Reiterleiste/-reihenfolge, Druckmodus,
// „Ansehen als", Namensbearbeitung, Tabellenbreiten, Scroll-Erinnerung, die
// klebenden Höhenmessungen. Laden, Katalog, entprelltes Speichern und die
// Würfel-Kontexte sitzen in components/charSheet.tsx (useCharSheet) — extrahiert,
// damit die virtuelle Tischplatte dieselbe Seitenleiste einbinden kann, ohne
// die Pool-Rechnung und den Speicherpfad ein zweites Mal zu bauen.
//
// useChar()/CharCtx selbst bleiben unverändert re-exportiert, damit die gute
// Handvoll Reiter- und Seitenleisten-Dateien, die nur `useChar` importieren,
// keine Änderung brauchen.
export { useChar };
export type { Catalogs, FullData, LanguageCatalogRow, RaceCatalogRow, TalentCatalogRow };

// Eingebaute Reiter, deren Anzeigetext vom Schlüssel abweicht (siehe
// MOVABLE_BUILTIN_TAB_KEYS in tabOrder.ts).
const BUILTIN_TAB_LABELS: Record<string, string> = {
  WaffenNeu: 'Waffen',
};

export default function CharacterPage() {
  const { id } = useParams();
  const charId = Number(id);
  const { user } = useAuth();

  // Entwickler-Vorschau „Ansehen als": 0 = normal, sonst die Nutzer-ID. Steuert
  // welchen Blickwinkel useCharSheet lädt (?asUser=…) — deshalb hier oben, vor
  // dem Hook-Aufruf.
  const canViewAs = !!user.isGm && !!user.devViewAs;
  const [viewAs, setViewAs] = useState(0);
  const [viewUsers, setViewUsers] = useState<{ id: number; displayName: string }[]>([]);

  useEffect(() => {
    if (canViewAs) apiGet<{ id: number; displayName: string }[]>('/api/admin/users').then(setViewUsers).catch(() => {});
  }, [canViewAs]);

  const {
    info, setInfo, access, summary, data, setData, stats, catalogs, loading, error,
    update, flush, saveState, setSaveState, rollCtx, requestCtx, reloadTick, dynDirty,
  } = useCharSheet(charId, viewAs || undefined);

  // Aktiver Reiter: normalerweise der Heldenbrief, aber ein ?tab=-Parameter
  // (z. B. beim Zurückkommen aus der Zauber-Verwaltung) landet direkt dort.
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeKey, setActiveKey] = useState<string>(searchParams.get('tab') || 'Heldenbrief');
  // Gemerkte Scroll-Position je Reiter (nur in dieser Sitzung): beim Wechsel wird
  // die des verlassenen Reiters gesichert und die des neuen wiederhergestellt.
  const scrollByTab = useRef<Record<string, number>>({});
  // Reiter wechseln: aktuelle Scroll-Position sichern, Reiter setzen und in die
  // URL schreiben (replace — keine History-Flut), damit ein Neuladen/Deep-Link
  // beim richtigen Reiter bleibt.
  const selectTab = (key: string) => {
    if (key === activeKey) return;
    scrollByTab.current[activeKey] = window.scrollY;
    setActiveKey(key);
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };
  const [printing, setPrinting] = useState(false);
  // Nur-Lesen ist der Normalfall: das Blatt öffnet sich zum Ansehen, Bearbeiten
  // wird bewusst eingeschaltet. Absichtlich NICHT gemerkt — jedes Öffnen fängt
  // wieder geschützt an, sonst wäre der Schutz nach dem ersten Mal weg.
  const [editing, setEditing] = useState(false);

  // Namensänderung: null = Anzeige, sonst der Entwurf im Eingabefeld.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');

  // Die Reiterleiste klebt oben und bricht je nach Anzahl der Reiter um. Was
  // darunter ebenfalls kleben soll, muss ihre tatsächliche Höhe kennen.
  const tabsRef = useTabsHeight();

  // Die Kopfzeile des Bogens (Name/Spieler/Gruppe/Bearbeiten) klebt zwischen
  // Kopf- und Reiterleiste. Ihre Höhe wird gemessen, damit die darunter
  // klebenden Leisten (Reiter, Tabellenköpfe, Talentsuche) korrekt versetzt sind.
  const charHeadRef = useCharHeadHeight();

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

  // Spaltenbreiten einer eingebauten Tabelle sichern. Wie beim Namen bewusst
  // sofort statt über das entprellte Sammel-Speichern: es passiert genau einmal,
  // beim Klick auf „Fertig". Der Server normalisiert und antwortet mit dem
  // gespeicherten Satz — den übernehmen wir, damit Anzeige und Datenbank
  // garantiert dasselbe zeigen.
  const saveTableWidths = (key: string, widths: number[]) => {
    setData((prev) => (prev ? { ...prev, tableWidths: { ...prev.tableWidths, [key]: widths } } : prev));
    setSaveState('Speichere…');
    apiPut<{ widths: number[] }>(`/api/characters/${charId}/table-widths`, { key, widths })
      .then((res) => {
        setData((prev) => (prev ? { ...prev, tableWidths: { ...prev.tableWidths, [key]: res.widths } } : prev));
        setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
      })
      .catch((e) => setSaveState(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`));
  };

  // Reiter aus der URL übernehmen — für Zurück/Vorwärts und Deep-Links (z. B. der
  // „Einstellungen"-Zurücklink, der auf ?tab=… zeigt).
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== activeKey) setActiveKey(t);
  }, [searchParams]);

  // Beim Reiterwechsel die gemerkte Scroll-Position dieses Reiters wiederherstellen
  // (0 = oben, wenn nichts gemerkt ist). Als Layout-Effekt, damit es vor dem Zeichnen
  // greift — Kind-Layout-Effekte (mitwachsende Textfelder) sind da bereits gelaufen.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollByTab.current[activeKey] ?? 0);
  }, [activeKey]);

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

  // Link zur Wiki-Seite des Charakters: derselbe Titel wie der Bogen, geprüft
  // per Stapel-Abfrage (kein Seitenaufruf, also keine „gelesen"-Markierung).
  // undefined = noch nicht geprüft (Link wird erst gezeigt, wenn feststeht,
  // ob rot oder blau); string = existierender Titel; null = Seite fehlt.
  const wikiSlugFuerName = info ? wikiSlug(info.name) : null;
  const [wikiZielTitel, setWikiZielTitel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setWikiZielTitel(undefined);
    if (!wikiSlugFuerName) return;
    let aktuell = true;
    ladeZiele([wikiSlugFuerName])
      .then((res) => {
        if (aktuell) setWikiZielTitel(res.ziele[wikiSlugFuerName] ?? null);
      })
      .catch(() => {
        if (aktuell) setWikiZielTitel(null);
      });
    return () => {
      aktuell = false;
    };
  }, [wikiSlugFuerName]);

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
  if ((access !== 'edit' && access !== 'inspect') || !data) {
    return (
      <>
        {viewAsBar}
        <h1>{info.name}</h1>
        <p className="muted">Dieser Nutzer hätte keinen Zugriff auf diesen Charakter.</p>
      </>
    );
  }
  const inspecting = access === 'inspect';

  const tabs = data.tabs;
  const setTabs = (fn: (t: DynTab[]) => DynTab[]) => setData((prev) => (prev ? { ...prev, tabs: fn(prev.tabs) } : prev));

  // Eingebaute und selbst angelegte Reiter in einer Liste — nur so lassen sie
  // sich gemeinsam sortieren. Was der Charakter nicht (mehr) hat, fällt hier
  // heraus; was neu ist, hängt sich hinten an.
  const order = orderTabKeys(defaultTabKeys(tabs.map((t) => t.id)), data.tabOrder ?? []);
  const tabByKey = (key: string) => {
    const tid = dynTabId(key);
    return tid === null ? null : (tabs.find((t) => t.id === tid) ?? null);
  };
  const tabName = (key: string) => tabByKey(key)?.name ?? BUILTIN_TAB_LABELS[key] ?? key;
  const activeContentTab = tabByKey(activeKey);

  // Inhalt eines eingebauten Reiters. Selbst angelegte laufen über ContentTabView.
  // Die laufenden Werte (Energien, Psyche, Geld) liegen jetzt in der stets
  // sichtbaren Seitenleiste (CharacterSidebar) — die frühere „Übersicht" als
  // eigener Reiter ist damit überflüssig und entfallen.
  const builtinTab = (key: string) =>
    key === 'Heldenbrief' ? <HeldenbriefTab />
    : key === 'Talente' ? <TalenteTab />
    : key === 'WaffenNeu' ? <WaffenNeuTab />
    : key === 'Sprachen' ? <SprachenTab />
    : key === 'Zauber' ? <ZauberTab />
    : key === 'Fähigkeiten' ? <FaehigkeitenTab />
    : key === 'Inventar' ? <InventarTab />
    : key === 'Ausrüstung' ? <AusruestungTab />
    : null;

  // Reiter verwalten (umbenennen, umsortieren, hinzufügen, löschen, Sichtbarkeit)
  // läuft seit 2026-08-10 ausschließlich über die Einstellungen-Seite (Spieler);
  // die Charakterseite zeigt die Reiterleiste nur noch zum Umschalten. Der
  // Spielleiter hat bewusst keinen Zugriff darauf.

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
    <CharCtx.Provider value={{ charId, groupId: info?.groupId ?? null, data, stats, catalogs, update, rollCtx, requestCtx }}>
      <TableLayoutProvider widths={data.tableWidths ?? {}} save={saveTableWidths}>
      <DisplayModeProvider mode={inspecting ? 'inspect' : editing ? 'edit' : 'readonly'}>
      <div className="screen-only">
        {viewAsBar}
        {inspecting && (
          <div className="viewas-bar">
            <span className="viewas-tag">VERWALTUNG</span>
            <span className="muted">Einsicht — nur lesend, wie der Bogen für Besitzer/in aussieht.</span>
          </div>
        )}
        <div className="char-header" ref={charHeadRef}>
          {nameDraft === null ?
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <h1>{info.name}</h1>
              {/* Im Ansehen-als-Modus UND in der Verwaltungs-Einsicht bewusst
                  ausgeblendet: beides ist rein lesend. */}
              {!viewAs && !inspecting && editing && (
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
            {info.tempGroups.length > 0 && <> · Event: {info.tempGroups.map((g) => g.name).join(', ')}</>}
            {wikiZielTitel !== undefined && (
              <>
                {' · '}
                {wikiZielTitel != null ?
                  <Link className="wiki-link" to={`/wiki/${wikiSlugFuerName}`} title={wikiZielTitel}>
                    Wiki
                  </Link>
                : <Link
                    className="wiki-rotlink"
                    to={`/wiki/neu?titel=${encodeURIComponent(info.name)}&kategorie=${encodeURIComponent('Spielercharakter')}`}
                    title="Wiki-Seite anlegen"
                  >
                    Wiki
                  </Link>
                }
              </>
            )}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="savestate">{saveState}</span>
          {/* Im Ansehen-als-Modus UND in der Verwaltungs-Einsicht gibt es
              nichts zu bearbeiten — ein Bearbeiten-Knopf wäre dort eine Falle
              (die Verwaltung hat serverseitig ohnehin keine Schreibrechte). */}
          {!viewAs && !inspecting && (
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
                : 'Blatt bearbeiten. Die laufenden Werte in der Seitenleiste gehen auch ohne das.'
              }
            >
              {editing ? '🔓 Fertig' : '🔒 Bearbeiten'}
            </button>
          )}
          {/* Eigene Figur: direkter Sprung in die Einstellungen dieses Charakters
              (Reiter, Kategorien, Sichtbarkeit, Farbwelt) — spart den Umweg über
              die Kopfleiste. Der Spielleiter hat zwar überall "edit"-Zugriff,
              aber die Einstellungen-Seite nur für die EIGENEN Charaktere. */}
          {!viewAs && access === 'edit' && info.ownerUserId === user.id && (
            <Link className="small" to={`/einstellungen?char=${charId}&from=${encodeURIComponent(activeKey)}`} title="Einstellungen für diesen Charakter">
              Einstellungen
            </Link>
          )}
          <button className="small" onClick={() => setPrinting(true)} title="Alle Tabs drucken / als PDF speichern (je Tab eine Seite)">
            Drucken
          </button>
          <button className="small" onClick={exportChar} title="Charakter als JSON-Datei herunterladen">
            Export
          </button>
        </div>
        {/* Die Reiterleiste dient nur noch dem Umschalten. Umbenennen, Sortieren,
            Anlegen/Löschen und Sichtbarkeit sind auf die Einstellungen-Seite
            gewandert (Spieler); die Reihenfolge kommt weiterhin aus tabOrder. */}
        <div className="tabs" ref={tabsRef}>
          {order.map((key) => (
            <button key={key} className={key === activeKey ? 'active' : ''} onClick={() => selectTab(key)}>
              {tabName(key)}
            </button>
          ))}
        </div>
        {/* Ab hier zwei Spalten: der Reiterinhalt und die stets sichtbare
            Seitenleiste. Kopfzeile und Reiterleiste darüber bleiben volle
            Breite. Die Leiste klebt und lässt sich einklappen (holt so den
            Platz auf breiten Schirmen zurück); auf schmalen rutscht sie per
            CSS unter den Inhalt. */}
        <div className="char-body">
          <div className="char-main">
        {activeContentTab ? (
          <ContentTabView
            key={`${activeContentTab.id}:${reloadTick}`}
            basePath={`/api/characters/${charId}`}
            tab={activeContentTab}
            attributes={data.attributes}
            isFirst
            isLast
            showTabControls={false}
            onDirtyChange={(d) => {
              dynDirty.current = d;
            }}
            onSectionsChange={(secs) =>
              setTabs((t) => t.map((x) => (x.id === activeContentTab.id ? { ...x, sections: secs } : x)))
            }
          />
        ) : (
          builtinTab(activeKey)
        )}
          </div>
          <CharacterSidebar />
        </div>
      </div>
      </DisplayModeProvider>

      {printing && (
        <DisplayModeProvider mode="print">
        <div className="print-root">
          {/* Die Seiten folgen der gewählten Reiter-Reihenfolge. */}
          {order.map((key) => {
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
                    attributes={data.attributes}
                    isFirst
                    isLast
                    showVisibility={false}
                    showTabControls={false}
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
