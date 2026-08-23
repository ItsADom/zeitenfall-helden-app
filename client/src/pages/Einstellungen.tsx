import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { DynTab } from '@shared/dynamicSections';
import { parseDiceShortcuts } from '@shared/dice';
import type { ExternalAttrPoint } from '@shared/types';
import { MAX_EXTERNAL_ATTR_POINTS, MAX_EXTERNAL_ATTR_POINT_NAME, VISIBILITY_LABELS, VISIBILITY_SECTIONS } from '@shared/types';
import { canStepTab, defaultTabKeys, dynTabId, dynTabKey, isFixedTab, moveTabKey, orderTabKeys, stepTabKey } from '@shared/tabOrder';
import { CHIMES, MAX_CHIME_SEKUNDEN, type TonWahl } from '@shared/chimes';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { useDicePanel } from '../components/dice/DicePanelProvider';
import { chimesVorbereiten } from '../components/dice/chimes';
import { audioMoeglich, entsperreAudio } from '../components/dice/audioContext';
import { KlangFehler, kodiereKlang } from '../components/dice/wavEncode';
import { dauerAusBytes, eigenenKlangSetzen, eigenenKlangVergessen, vorhoeren } from '../components/dice/ton';
import { BackToSheet } from '../components/BackToSheet';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { ExitGuard } from '../components/exitGuard';
import { useEinstHeadHeight, useEinstNavHeight } from '../components/stickyChrome';
import { useAuth, useThemeControls } from '../App';
import ThemePicker from '../components/ThemePicker';
import { THEMES } from '../theme';

// Einstellungen: oben die persönliche Anzeige (sofort wirksam). Darunter je
// Charakter — Farbwelt, Reiter (umbenennen/sortieren/anlegen/löschen),
// Sichtbarkeit für Gruppenmitglieder und Inventar-Kategorien. Charakterbezogene
// Änderungen sind erst mit „Speichern" verbindlich (der Bogen selbst speichert
// dagegen laufend — deshalb ist Reiter-Verwaltung bewusst NICHT auf ihm).
//
// Gilt auch für den Spielleiter, aber nur für seine eigenen Charaktere: die
// Charakterliste kommt mit ?mine=1, damit /api/overview ihn nicht auf ALLE
// Charaktere schaltet (wie sonst für Spielleiter üblich).

interface CharLite {
  id: number;
  name: string;
}
interface CatRow {
  orig: string | null;
  name: string;
}
interface TabRow {
  key: string; // Anzeige-/Sortier-Schlüssel (bei neuen Reitern vorläufig)
  id: number | null; // DB-Id (nur selbst angelegte); null bei eingebauten/neuen
  name: string;
  locked: boolean;
  isDyn: boolean; // selbst angelegter Reiter (umbenennbar/löschbar)
  isNew: boolean; // in dieser Sitzung angelegt, noch nicht gespeichert
  origName: string;
}

let tmpCounter = 0;

export default function EinstellungenPage() {
  const tc = useThemeControls();
  const { user } = useAuth();
  const einstHeadRef = useEinstHeadHeight();
  const einstNavRef = useEinstNavHeight();
  // Ein Link „Kategorien bearbeiten" aus dem Inventar bringt ?char=<id> und
  // #kategorien mit: den Charakter vorwählen und nach unten zu den Kategorien
  // scrollen.
  const [params] = useSearchParams();
  const location = useLocation();
  const paramChar = Number(params.get('char')) || null;
  // Reiter, von dem man kam — der Zurück-Link kehrt dorthin zurück.
  const fromTab = params.get('from') || undefined;
  const [chars, setChars] = useState<CharLite[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Gespeicherter Stand (Vergleichsbasis für „dirty").
  const [savedTheme, setSavedTheme] = useState('');
  const [savedCats, setSavedCats] = useState<string[]>([]);
  const [savedVis, setSavedVis] = useState<Record<string, boolean>>({});
  const [savedTabKey, setSavedTabKey] = useState('');
  // Bearbeiteter Stand.
  const [charTheme, setCharTheme] = useState('');
  const [savedChatName, setSavedChatName] = useState('');
  const [chatName, setChatName] = useState('');
  const [savedShortcuts, setSavedShortcuts] = useState('');
  const [shortcuts, setShortcuts] = useState('');
  const [catRows, setCatRows] = useState<CatRow[]>([]);
  const [savedAttrExtern, setSavedAttrExtern] = useState<ExternalAttrPoint[]>([]);
  const [attrExternRows, setAttrExternRows] = useState<ExternalAttrPoint[]>([]);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [tabRows, setTabRows] = useState<TabRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  // Ziehen zum Umsortieren der Reiter — dragKey ist der gezogene, overKey der
  // gerade überflogene Schlüssel (für die Einfügemarke).
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Kontoweite Würfel-Favoriten der Spielleitung (siehe /me/dice-shortcuts) —
  // eigener, vom Charakter-Speichern-Fluss unabhängiger Lade-/Speicherstand,
  // da sie an keinen Charakter gebunden sind.
  const [savedSlShortcuts, setSavedSlShortcuts] = useState('');
  const [slShortcuts, setSlShortcuts] = useState('');
  const [slSaving, setSlSaving] = useState(false);
  const slDirty = slShortcuts !== savedSlShortcuts;

  useEffect(() => {
    if (!user.isGm) return;
    apiGet<{ diceShortcuts: string }>('/api/me/dice-shortcuts')
      .then((d) => {
        setSavedSlShortcuts(d.diceShortcuts);
        setSlShortcuts(d.diceShortcuts);
      })
      .catch(() => {});
  }, [user.isGm]);

  const saveSlShortcuts = () => {
    setSlSaving(true);
    apiPut<{ diceShortcuts: string }>('/api/me/dice-shortcuts', { text: slShortcuts })
      .then((d) => setSavedSlShortcuts(d.diceShortcuts))
      .finally(() => setSlSaving(false));
  };

  useEffect(() => {
    apiGet<{ characters: CharLite[] }>('/api/overview?mine=1')
      .then((d) => {
        setChars(d.characters);
        const wanted = paramChar && d.characters.some((c) => c.id === paramChar) ? paramChar : null;
        setSelId((prev) => prev ?? wanted ?? d.characters[0]?.id ?? null);
      })
      .catch(() => {});
  }, [paramChar]);

  const load = useCallback((id: number) => {
    setLoading(true);
    setMsg('');
    return apiGet<{
      character: { theme?: string; chatName?: string; diceShortcuts?: string };
      data?: { tabs?: DynTab[]; tabOrder?: string[]; visibility?: Record<string, boolean>; itemCategories?: string[]; attrExtern?: ExternalAttrPoint[] };
    }>(`/api/characters/${id}`)
      .then((res) => {
        const theme = res.character.theme ?? '';
        const chatNameVal = res.character.chatName ?? '';
        const shortcutsVal = res.character.diceShortcuts ?? '';
        const cats = res.data?.itemCategories ?? [];
        const attrExtern = res.data?.attrExtern ?? [];
        const tabs = res.data?.tabs ?? [];
        const tabOrder = res.data?.tabOrder ?? [];
        const visibility = res.data?.visibility ?? {};
        const order = orderTabKeys(defaultTabKeys(tabs.map((t) => t.id)), tabOrder);
        const rows: TabRow[] = order.map((key) => {
          const tid = dynTabId(key);
          if (tid !== null) {
            const t = tabs.find((x) => x.id === tid);
            return { key, id: tid, name: t?.name ?? key, locked: !!t?.locked, isDyn: true, isNew: false, origName: t?.name ?? '' };
          }
          return { key, id: null, name: key, locked: true, isDyn: false, isNew: false, origName: key };
        });
        setSavedTheme(theme);
        setCharTheme(theme);
        setSavedChatName(chatNameVal);
        setChatName(chatNameVal);
        setSavedShortcuts(shortcutsVal);
        setShortcuts(shortcutsVal);
        setSavedCats(cats);
        setCatRows(cats.map((c) => ({ orig: c, name: c })));
        setSavedAttrExtern(attrExtern);
        setAttrExternRows(attrExtern);
        setSavedVis(visibility);
        setVis(visibility);
        setTabRows(rows);
        setSavedTabKey(rows.map((r) => `${r.key}:${r.name}`).join('|'));
        setDeletedIds([]);
      })
      .catch(() => setMsg('Konnte den Charakter nicht laden.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selId != null) void load(selId);
  }, [selId, load]);

  // Nach dem Laden zu den Kategorien scrollen, wenn man mit #kategorien kam.
  useEffect(() => {
    if (loading || location.hash !== '#kategorien') return;
    document.getElementById('kategorien')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, location.hash, selId]);

  const cleanNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of catRows) {
      const n = r.name.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [catRows]);

  const tabSig = tabRows.map((r) => `${r.key}:${r.name}`).join('|');
  const catsChanged = savedCats.join(' ') !== cleanNames.join(' ');
  const tabsChanged = tabSig !== savedTabKey || deletedIds.length > 0 || tabRows.some((r) => r.isNew || (r.isDyn && r.name.trim() !== r.origName));
  const visChanged = VISIBILITY_SECTIONS.some((s) => !!vis[s] !== !!savedVis[s]);
  const cleanAttrExtern = useMemo(
    () => attrExternRows.filter((r) => r.quelle.trim() !== '').map((r) => ({ quelle: r.quelle.trim(), punkte: r.punkte })),
    [attrExternRows],
  );
  const attrExternChanged = JSON.stringify(cleanAttrExtern) !== JSON.stringify(savedAttrExtern);
  const chatNameChanged = chatName.trim() !== savedChatName;
  const shortcutsChanged = shortcuts !== savedShortcuts;
  const dirty =
    charTheme !== savedTheme || chatNameChanged || shortcutsChanged || catsChanged || tabsChanged || visChanged || attrExternChanged;

  // --- Reiter-Verwaltung ---
  // Reihenfolge und feste/verschiebbare Regeln kommen aus shared/src/tabOrder.ts
  // (dieselbe Logik, die auch die gespeicherte Reihenfolge normalisiert) — so
  // bleiben Pfeile und Ziehen zwangsläufig konsistent statt zwei getrennte
  // Implementierungen der „Heldenbrief bleibt vorn"-Regel zu pflegen.
  const tabOrderKeys = tabRows.map((r) => r.key);
  const applyTabOrder = (order: string[]) => {
    const byKey = new Map(tabRows.map((r) => [r.key, r]));
    setTabRows(order.map((k) => byKey.get(k) as TabRow));
  };
  const canUp = (i: number) => canStepTab(tabOrderKeys, tabRows[i].key, -1);
  const canDown = (i: number) => canStepTab(tabOrderKeys, tabRows[i].key, 1);
  const moveRow = (i: number, dir: -1 | 1) => applyTabOrder(stepTabKey(tabOrderKeys, tabRows[i].key, dir));
  const renameRow = (i: number, name: string) => setTabRows((rows) => rows.map((r, j) => (j === i ? { ...r, name } : r)));
  const deleteRow = (i: number) =>
    setTabRows((rows) => {
      const r = rows[i];
      if (r.isDyn && !r.isNew && r.id != null) setDeletedIds((d) => [...d, r.id as number]);
      return rows.filter((_, j) => j !== i);
    });
  const addTab = () =>
    setTabRows((rows) => [
      ...rows,
      { key: `new${tmpCounter++}`, id: null, name: 'Neuer Tab', locked: false, isDyn: true, isNew: true, origName: '' },
    ]);

  const save = async () => {
    if (selId == null) return;
    setSaving(true);
    setMsg('');
    try {
      if (charTheme !== savedTheme) {
        await apiPut(`/api/characters/${selId}/theme`, { theme: charTheme });
      }
      if (chatNameChanged) {
        await apiPut(`/api/characters/${selId}/chat-name`, { chatName: chatName.trim() });
      }
      if (shortcutsChanged) {
        await apiPut(`/api/characters/${selId}/dice-shortcuts`, { text: shortcuts });
      }
      // Reiter: erst anlegen (neue Ids), dann löschen, umbenennen, sortieren.
      const tmpToReal = new Map<string, number>();
      for (const r of tabRows) {
        if (r.isNew) {
          const { id } = await apiPost<{ id: number }>(`/api/characters/${selId}/tabs`, { name: r.name.trim() || 'Neuer Tab' });
          tmpToReal.set(r.key, id);
        }
      }
      for (const id of deletedIds) await apiDelete(`/api/characters/${selId}/tabs/${id}`);
      for (const r of tabRows) {
        if (r.isDyn && !r.isNew && r.id != null && r.name.trim() !== r.origName) {
          await apiPut(`/api/characters/${selId}/tabs/${r.id}`, { name: r.name.trim() });
        }
      }
      if (tabsChanged) {
        const order = tabRows.map((r) => (r.isNew ? dynTabKey(tmpToReal.get(r.key) as number) : r.key));
        await apiPut(`/api/characters/${selId}/tab-order`, { order });
      }
      if (visChanged) {
        await apiPut(`/api/characters/${selId}/visibility`, vis);
      }
      if (catsChanged) {
        const renames = catRows
          .filter((r) => r.orig && r.name.trim() && r.orig !== r.name.trim())
          .map((r) => ({ from: r.orig as string, to: r.name.trim() }));
        const removes = savedCats.filter((o) => !catRows.some((r) => r.orig === o));
        await apiPut(`/api/characters/${selId}/item-categories/manage`, { order: cleanNames, renames, removes });
      }
      if (attrExternChanged) {
        await apiPut(`/api/characters/${selId}/section/attrExtern`, cleanAttrExtern);
      }
      await load(selId); // frischen Stand holen (echte Ids etc.)
      setMsg(`Gespeichert (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      setMsg(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const themeSwatch = (id: string) => THEMES.find((t) => t.id === id)?.swatch ?? 'transparent';

  const navLinks: [string, string][] = [
    ['anzeige', 'Anzeige'],
    ['ton', 'Benachrichtigungston'],
    ...(user.isGm ? ([['wuerfel-sl', 'Würfel-Favoriten (SL)']] as [string, string][]) : []),
    ['charakter', 'Charakter'],
    ...(selId != null && !loading
      ? ([
          ['farbwelt', 'Farbwelt'],
          ['chatname', 'Chat-Anzeigename'],
          ['wuerfel', 'Würfel-Favoriten'],
          ['reiter', 'Reiter'],
          ['sichtbarkeit', 'Sichtbarkeit'],
          ['kategorien', 'Kategorien'],
          ['attrextern', 'Attributspunkte'],
        ] as [string, string][])
      : []),
  ];

  return (
    <>
      <ExitGuard dirty={dirty || slDirty} />
      <div className="einst-head" ref={einstHeadRef}>
        <h1>Einstellungen</h1>
        {selId != null && !loading && (
          <div className="head-save">
            <button className="primary" disabled={!dirty || saving} onClick={save}>
              {saving ? 'Speichere…' : 'Speichern'}
            </button>
            {dirty && !saving && <span className="muted">Ungespeicherte Änderungen</span>}
            <span className="savestate">{msg}</span>
          </div>
        )}
        {selId != null && <BackToSheet charId={selId} tab={fromTab} name={chars.find((c) => c.id === selId)?.name} />}
      </div>

      <nav className="einst-nav" ref={einstNavRef}>
        {navLinks.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <div className="panel" id="anzeige">
        <h3>Anzeige (dein Konto)</h3>
        <p className="muted">
          Deine Standard-Farbwelt und Ansicht. Ein Charakter mit eigener Farbwelt überschreibt sie, solange du ihn
          geöffnet hast. Sofort wirksam.
        </p>
        <div className="set-row">
          <span className="set-label">Farbwelt</span>
          <ThemePicker theme={tc.theme} onChange={tc.setTheme} animate={tc.anim} onAnimateChange={tc.setAnim} />
        </div>
        <div className="set-row">
          <span className="set-label">Würfelformen im Chat</span>
          <button
            type="button"
            className={`theme-switch${tc.diceIcons ? ' on' : ''}`}
            role="switch"
            aria-checked={tc.diceIcons}
            title={tc.diceIcons ? 'Würfelformen ausschalten' : 'Würfelformen einschalten'}
            onClick={() => tc.setDiceIcons(!tc.diceIcons)}
          >
            <span className="theme-switch-track" aria-hidden>
              <span className="theme-switch-knob" />
            </span>
            <span className="theme-switch-text">{tc.diceIcons ? 'An' : 'Aus'}</span>
          </button>
        </div>
        <p className="muted">
          Jeder geworfene Würfel erscheint in der Form seiner Sorte (W4 als Dreieck, W6 als Quadrat …) und in ihrem
          Farbton. Ausgeschaltet steht jeder Wurf wieder im schlichten Kästchen. Rote 20 und blaue 1 bleiben in
          beiden Fällen erhalten.
        </p>
      </div>

      <TonPanel />

      {user.isGm && (
        <div className="panel" id="wuerfel-sl">
          <h3>Würfel-Favoriten (Spielleitung)</h3>
          <p className="muted">
            Eigene Würfe für den Chat, unabhängig von Charakter und Raum — je Zeile <code>Bezeichnung: Ausdruck</code>,
            z. B. <code>Wildnisschaden: 2w6+5</code>. Eine Zeile aus Strichen (<code>---</code>) trennt Gruppen. Im
            Chat liegen sie hinter dem 🎲-Knopf, in jedem Raum gleich.
          </p>
          <textarea
            className="dice-shortcuts-input"
            rows={7}
            value={slShortcuts}
            onChange={(e) => setSlShortcuts(e.target.value)}
            placeholder={'Wildnisschaden: 2w6+5\n---\nInitiative NPC: 1w6+8'}
          />
          <ShortcutsPreview raw={slShortcuts} />
          <div className="set-row">
            <button className="primary" disabled={!slDirty || slSaving} onClick={saveSlShortcuts}>
              {slSaving ? 'Speichere…' : 'Speichern'}
            </button>
            {slDirty && !slSaving && <span className="muted">Ungespeicherte Änderungen</span>}
          </div>
        </div>
      )}

      <div className="panel" id="charakter">
        <h3>Charakter</h3>
        {chars.length === 0 ? (
          <p className="muted">Du hast keine Charaktere.</p>
        ) : (
          <div className="set-row">
            <span className="set-label">Einstellungen für</span>
            <select value={selId ?? ''} onChange={(e) => setSelId(Number(e.target.value))}>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selId != null && !loading && (
        <>
          <div className="panel" id="farbwelt">
            <h3>Farbwelt des Charakters</h3>
            <p className="muted">
              Gilt für <strong>alle</strong>, die diesen Charakter öffnen.<br/>
            </p>
            <div className="set-row">
              <span className="theme-dot" style={{ '--sw': themeSwatch(charTheme) } as CSSProperties} />
              <select value={charTheme} onChange={(e) => setCharTheme(e.target.value)}>
                <option value="">Nutzer-Standard</option>
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="panel" id="chatname">
            <h3>Chat-Anzeigename</h3>
            <p className="muted">
              Kurzer Name für den Gruppen-Chat und Würfelwürfe — praktisch bei langen Charakternamen. Leer lassen für
              den vollen Namen.
            </p>
            <div className="set-row">
              <input
                value={chatName}
                onChange={(e) => setChatName(e.target.value)}
                maxLength={24}
                placeholder={chars.find((c) => c.id === selId)?.name ?? ''}
              />
            </div>
          </div>

          <div className="panel" id="wuerfel">
            <h3>Würfel-Favoriten</h3>
            <p className="muted">
              Eigene Würfe für den Chat — je Zeile <code>Bezeichnung: Ausdruck</code>, z. B.{' '}
              <code>Dolch-Schaden: 2w6+5</code>. Eine Zeile aus Strichen (<code>---</code>) trennt Gruppen. Im Chat
              liegen sie hinter dem 🎲-Knopf; ein Klick würfelt sofort.
            </p>
            <textarea
              className="dice-shortcuts-input"
              rows={7}
              value={shortcuts}
              onChange={(e) => setShortcuts(e.target.value)}
              placeholder={'Dolch-Schaden: 2w6+5\n---\nInitiative: 1w6+8'}
            />
            <ShortcutsPreview raw={shortcuts} />
          </div>

          {/* Reiter-Verwaltung — läuft nur hier; auf der Charakterseite gibt es
              keine Reiter-Bearbeitung mehr. */}
          <div className="panel" id="reiter">
            <h3>Reiter</h3>
            <p className="muted">
              Reihenfolge, Namen und Anlegen/Löschen der Reiter. „Heldenbrief" bleibt vorn; Standard-Reiter lassen
              sich verschieben, aber nicht umbenennen oder löschen.
            </p>
            <div className="tab-manage">
              {tabRows.map((r, i) => (
                <div
                  className={`tabm-row${dragKey === r.key ? ' dragging' : ''}${overKey === r.key && dragKey && dragKey !== r.key ? ' drop-before' : ''}`}
                  key={r.key}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    if (overKey !== r.key) setOverKey(r.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData('text/plain') || dragKey;
                    if (from) applyTabOrder(moveTabKey(tabOrderKeys, from, r.key, 'before'));
                    setDragKey(null);
                    setOverKey(null);
                  }}
                >
                  {isFixedTab(r.key) ? (
                    <span className="tabm-grip disabled" title="Heldenbrief bleibt vorn">⠿</span>
                  ) : (
                    <span
                      className="tabm-grip"
                      draggable
                      title="Ziehen zum Umsortieren"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', r.key);
                        setDragKey(r.key);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setOverKey(null);
                      }}
                    >
                      ⠿
                    </span>
                  )}
                  <span className="tabm-arrows">
                    <button className="small" disabled={!canUp(i)} onClick={() => moveRow(i, -1)} title="nach oben">
                      ↑
                    </button>
                    <button className="small" disabled={!canDown(i)} onClick={() => moveRow(i, 1)} title="nach unten">
                      ↓
                    </button>
                  </span>
                  {r.isDyn ? (
                    <input value={r.name} onChange={(e) => renameRow(i, e.target.value)} placeholder="Reitername" />
                  ) : (
                    <span className="tabm-fixed">
                      {r.name} <span className="muted">· Standard-Reiter</span>
                    </span>
                  )}
                  {r.isDyn && (
                    <ConfirmDeleteButton title="Reiter löschen (mit allen Sektionen)" onConfirm={() => deleteRow(i)} />
                  )}
                </div>
              ))}
              <button className="small" onClick={addTab}>
                + Reiter
              </button>
            </div>
          </div>

          {/* Sichtbarkeit für Gruppenmitglieder (früher ein eigener Reiter) */}
          <div className="panel" id="sichtbarkeit">
            <h3>Sichtbarkeit für Gruppenmitglieder</h3>
            <p className="muted">
              Die Personenbeschreibung (Name, Alter, Größe …) ist immer sichtbar. Hier die festen Bereiche freigeben;
              eigene Sektionen schaltest du im jeweiligen Reiter frei.
            </p>
            <div className="vis-grid">
              {VISIBILITY_SECTIONS.map((s) => (
                <label key={s} className="vis-row">
                  <input type="checkbox" checked={!!vis[s]} onChange={() => setVis((v) => ({ ...v, [s]: !v[s] }))} />
                  {VISIBILITY_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="panel" id="kategorien">
            <h3>Inventar-Kategorien</h3>
            <p className="muted">
             Entfernen einer Kategorie setzt alle Gegenstände darin auf „ohne Kategorie".
            </p>
            <div className="cat-editor">
              {catRows.map((r, i) => (
                <div className="cat-row" key={i}>
                  <input
                    value={r.name}
                    placeholder="Kategoriename"
                    onChange={(e) => setCatRows((rows) => rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <ConfirmDeleteButton title="Kategorie entfernen" onConfirm={() => setCatRows((rows) => rows.filter((_, j) => j !== i))} />
                </div>
              ))}
              <button className="small" onClick={() => setCatRows((rows) => [...rows, { orig: null, name: '' }])}>
                + Kategorie
              </button>
            </div>
          </div>

          <div className="panel" id="attrextern">
            <h3>Externe Attributspunkte</h3>
            <p className="muted">
              Zusätzliche Attributspunkte außerhalb der Stufen-Vergabe.
            </p>
            <div className="cat-editor">
              {attrExternRows.map((r, i) => (
                <div className="cat-row" key={i}>
                  <input
                    value={r.quelle}
                    placeholder="Quelle"
                    maxLength={MAX_EXTERNAL_ATTR_POINT_NAME}
                    onChange={(e) => setAttrExternRows((rows) => rows.map((x, j) => (j === i ? { ...x, quelle: e.target.value } : x)))}
                  />
                  <input
                    type="number"
                    value={r.punkte}
                    onChange={(e) =>
                      setAttrExternRows((rows) => rows.map((x, j) => (j === i ? { ...x, punkte: Number(e.target.value) || 0 } : x)))
                    }
                  />
                  <ConfirmDeleteButton
                    title="Eintrag entfernen"
                    onConfirm={() => setAttrExternRows((rows) => rows.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              {attrExternRows.length < MAX_EXTERNAL_ATTR_POINTS && (
                <button className="small" onClick={() => setAttrExternRows((rows) => [...rows, { quelle: '', punkte: 0 }])}>
                  + Quelle
                </button>
              )}
            </div>
          </div>

        </>
      )}
      {loading && <p className="muted">Lade…</p>}
    </>
  );
}

// Benachrichtigungston: Auswahl, Lautstärke und der eigene Klang.
//
// Auswahl und Lautstärke liegen in localStorage (siehe DicePanelProvider) —
// welcher Klang und wie laut hängt am Ohr vor dem Gerät, nicht am Konto. Die
// hochgeladene DATEI dagegen liegt am Konto, damit niemand sie auf dem Handy
// noch einmal heraussuchen muss.
function TonPanel() {
  const { ton, setTon, lautstaerke, setLautstaerke } = useDicePanel();
  const [eigenBytes, setEigenBytes] = useState<number | null>(null);
  const [tonMsg, setTonMsg] = useState('');
  const [tonFehler, setTonFehler] = useState('');
  const [laedt, setLaedt] = useState(false);
  const dateiRef = useRef<HTMLInputElement>(null);
  const moeglich = audioMoeglich();

  useEffect(() => {
    if (!moeglich) return;
    // Die fünf im Hintergrund vorbauen, damit „Vorhören" sofort antwortet.
    chimesVorbereiten();
    apiGet<{ vorhanden: boolean; bytes: number }>('/api/me/chime/info')
      .then((d) => setEigenBytes(d.vorhanden ? d.bytes : null))
      .catch(() => setEigenBytes(null));
  }, [moeglich]);

  const hoeren = (wahl: TonWahl = ton) => {
    entsperreAudio(); // ein Klick ist der einzige verlässliche Moment dafür
    if (wahl !== 'aus') vorhoeren(wahl, lautstaerke);
  };

  const waehle = (wahl: TonWahl) => {
    setTon(wahl);
    setTonMsg('');
    setTonFehler('');
    hoeren(wahl);
  };

  const hochladen = async (datei: File) => {
    setLaedt(true);
    setTonMsg('');
    setTonFehler('');
    try {
      const { wav, sekunden, gekuerzt } = await kodiereKlang(datei);
      const res = await fetch('/api/me/chime', {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const koerper = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new KlangFehler(koerper?.error ?? 'Der Klang konnte nicht gespeichert werden.');
      }
      eigenenKlangSetzen(wav);
      setEigenBytes(wav.byteLength);
      setTon('eigen');
      // Ein stilles Kürzen wäre die unangenehme Überraschung: der Klang klingt
      // dann anders als die Vorlage, ohne dass jemand weiß, warum.
      setTonMsg(
        gekuerzt
          ? `Übernommen — auf die ersten ${MAX_CHIME_SEKUNDEN} Sekunden gekürzt.`
          : `Übernommen (${sekunden.toFixed(1).replace('.', ',')} s).`,
      );
    } catch (e) {
      setTonFehler(e instanceof KlangFehler ? e.message : 'Der Klang konnte nicht verarbeitet werden.');
    } finally {
      setLaedt(false);
    }
  };

  const loeschen = async () => {
    try {
      await apiDelete('/api/me/chime');
    } catch {
      // Weg ist weg — die Anzeige unten stimmt danach ohnehin wieder.
    }
    eigenenKlangVergessen();
    setEigenBytes(null);
    // Sonst bliebe „Eigener Klang" ausgewählt und der Chat wäre stumm, ohne
    // dass man es der Auswahl ansieht.
    if (ton === 'eigen') setTon(CHIMES[0].id);
    setTonMsg('Eigener Klang entfernt.');
    setTonFehler('');
  };

  if (!moeglich) {
    return (
      <div className="panel" id="ton">
        <h3>Benachrichtigungston</h3>
        <p className="muted">Dieser Browser kann keine Klänge abspielen.</p>
      </div>
    );
  }

  const prozent = Math.round(lautstaerke * 100);

  return (
    <div className="panel" id="ton">
      <h3>Benachrichtigungston</h3>
      <p className="muted">
        Klingt, wenn die Spielleitung eine Probe anfragt, eine Gruppenprobe stellt oder eine Kooperationsprobe
        vorschlägt — und nur dann, wenn du den Chat gerade nicht siehst. Eigene Würfe und gewöhnlicher Chat bleiben
        still und setzen bloß einen Punkt an den Chat-Reiter. Gilt für diesen Browser; im Chat schaltet{' '}
        <code>/mute</code> den Ton schnell aus und wieder an.
      </p>

      <div className="set-row">
        <span className="set-label">Klang</span>
        <select value={ton} onChange={(e) => waehle(e.target.value as TonWahl)}>
          <option value="aus">Aus</option>
          {CHIMES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {c.beschreibung}
            </option>
          ))}
          {eigenBytes !== null && <option value="eigen">Eigener Klang</option>}
        </select>
        <button type="button" className="small" disabled={ton === 'aus'} onClick={() => hoeren()}>
          ▶ Vorhören
        </button>
      </div>

      <div className="set-row">
        <span className="set-label">Lautstärke</span>
        <input
          type="range"
          className="ton-regler"
          min={0}
          max={100}
          step={5}
          value={prozent}
          disabled={ton === 'aus'}
          onChange={(e) => setLautstaerke(Number(e.target.value) / 100)}
          /* Erst beim Loslassen vorspielen — sonst läuten beim Ziehen zwanzig
             Glocken übereinander. */
          onPointerUp={() => hoeren()}
          onKeyUp={() => hoeren()}
        />
        <span className="muted">{prozent} %</span>
      </div>

      <div className="set-row">
        <span className="set-label">Eigener Klang</span>
        {eigenBytes !== null ? (
          <span className="muted">
            {dauerAusBytes(eigenBytes).toFixed(1).replace('.', ',')} s · {Math.round(eigenBytes / 1024)} KB
          </span>
        ) : (
          <span className="muted">keiner hinterlegt</span>
        )}
        <button type="button" className="small" disabled={laedt} onClick={() => dateiRef.current?.click()}>
          {laedt ? 'Verarbeite…' : eigenBytes !== null ? 'Ersetzen…' : 'Datei wählen…'}
        </button>
        {eigenBytes !== null && <ConfirmDeleteButton title="Eigenen Klang entfernen" onConfirm={loeschen} />}
        <input
          ref={dateiRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void hochladen(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="muted">
        MP3, OGG, WAV oder M4A. Die Datei wird im Browser auf höchstens {MAX_CHIME_SEKUNDEN} Sekunden gekürzt, auf
        Mono gerechnet und auf eine einheitliche Lautstärke gebracht — hochgeladen wird nur dieses Ergebnis, nie die
        Vorlage. Er hängt an deinem Konto und gilt damit auch auf anderen Geräten.
      </p>
      {tonMsg && <p className="savestate">{tonMsg}</p>}
      {tonFehler && <p className="error">{tonFehler}</p>}
    </div>
  );
}

// Zeigt sofort, was aus dem Klartext oben tatsächlich wird — fehlerhafte
// Zeilen werden hier benannt, statt im Chat stillschweigend zu fehlen.
function ShortcutsPreview({ raw }: { raw: string }) {
  const lines = parseDiceShortcuts(raw);
  if (lines.length === 0) return null;
  const broken = lines.filter((l) => l.kind === 'shortcut' && !l.valid);
  return (
    <div className="dice-shortcuts-preview">
      <span className="muted">Vorschau:</span>
      <div className="dice-shortcuts-chips">
        {lines.map((l, i) =>
          l.kind === 'separator' ? (
            <span key={i} className="dice-shortcuts-sep" aria-hidden />
          ) : (
            <span key={i} className={`dice-shortcuts-chip${l.valid ? '' : ' invalid'}`} title={l.valid ? l.expression : 'Ungültig'}>
              {l.label || '(ohne Bezeichnung)'}
              {l.valid && <span className="muted"> {l.expression}</span>}
            </span>
          ),
        )}
      </div>
      {broken.length > 0 && (
        <p className="muted dice-shortcuts-hint">
          {broken.length === 1 ? 'Eine Zeile wird' : `${broken.length} Zeilen werden`} nicht übernommen — erwartet wird
          <code> Bezeichnung: Ausdruck</code> mit einem Würfelausdruck wie <code>2w6+5</code>.
        </p>
      )}
    </div>
  );
}
