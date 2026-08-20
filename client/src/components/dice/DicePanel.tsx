import { useEffect, useRef, useState } from 'react';
import { parseDiceExpression } from '@shared/dice';
import type { RollVisibility } from '@shared/diceProtocol';
import { apiGet } from '../../api';
import { usePersistedState } from '../persist';
import CommandsDialog from './CommandsDialog';
import { useDicePanel } from './DicePanelProvider';
import FeedEntryView from './FeedEntryView';
import ModifierPicker from './ModifierPicker';
import PendingRequestCard from './PendingRequestCard';
import { PROBE_KIND_LABEL, type RollableProbe } from './rollableProbes';
import RoomPicker from './RoomPicker';
import SchicksalspunkteControl from './SchicksalspunkteControl';
import ShortcutsFlyout from './ShortcutsFlyout';
import VisibilityPicker from './VisibilityPicker';

// Ab wie vielen Zeichen nach "/r "/"/roll " gesucht wird — kurz genug, um
// schnell Vorschläge zu sehen, lang genug, um nicht bei jedem Tastendruck
// eine Liste aufzuklappen, die eh nur "a" oder "ab" enthält.
const MIN_SEARCH_LEN = 2;
const MAX_SUGGESTIONS = 8;

// Größe frei ziehbar (Ecke oben links, siehe startResize) und je Gerät
// gemerkt — wie CharacterSidebar's Breiten-Ziehgriff, nur an zwei Achsen.
const MIN_W = 280;
const MAX_W = 640;
const DEFAULT_W = 340;
const MIN_H = 240;
const MAX_H = 800;
const DEFAULT_H = 420;
const clampW = (n: number): number => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
const clampH = (n: number): number => Math.min(MAX_H, Math.max(MIN_H, Math.round(n)));

// "#Titel" hinten an einem Würfelausdruck setzt dessen Anzeigenamen inline,
// wie ein Würfel-Favorit einen mitbringt — z. B. "5w10+6#Glück". Das "#"
// gehört nicht zum Ausdruck, muss also vor dem Parsen abgetrennt werden.
function splitInlineTitle(rest: string): { expr: string; label: string } {
  const hashIdx = rest.indexOf('#');
  if (hashIdx === -1) return { expr: rest, label: '' };
  return { expr: rest.slice(0, hashIdx).trim(), label: rest.slice(hashIdx + 1).trim() };
}

// Fixed-position dock, mounted once at the App level (see App.tsx). Always
// visible unless a page explicitly suppresses it (DicePanelProvider's
// `hidden`) — which room is open no longer follows page navigation, see the
// room selector below.
export default function DicePanel() {
  const {
    groupId,
    charId,
    myGroups,
    feed,
    connected,
    hasMore,
    loadingMore,
    pendingRequests,
    collapsed,
    toggle,
    sendChat,
    rollExpr,
    rollProbe,
    refreshRooms,
    loadMore,
    modifier,
    setModifier,
    diceCode,
    setDiceCode,
    serverError,
  } = useDicePanel();
  const activeRoom = myGroups.find((g) => g.id === groupId);
  const [draft, setDraft] = useState('');
  // Gilt für den nächsten Wurf (Favorit wie Freihand) — nicht für den Chat,
  // Nachrichten sind immer öffentlich.
  const [visibility, setVisibility] = usePersistedState<RollVisibility>('dice:visibility', 'public');
  // Nur bei visibility 'gm_player' UND Spielleitung relevant — das per Klick
  // gewählte Gruppenmitglied (siehe VisibilityPicker). Bewusst NICHT
  // persistiert: an einem Ziel aus der letzten Sitzung festzuhalten wäre der
  // teurere Fehler als es bei Bedarf neu zu wählen.
  const [visibilityTarget, setVisibilityTarget] = useState<number | null>(null);
  const [error, setError] = useState('');
  // Rückmeldung rein clientseitiger Befehle wie „/dicecode" — kein Fehler,
  // also eigene, neutral eingefärbte Zeile statt der Fehlerbox.
  const [info, setInfo] = useState('');
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [width, setWidth] = usePersistedState<number>('dice:w', DEFAULT_W);
  const [height, setHeight] = usePersistedState<number>('dice:h', DEFAULT_H);
  const w = clampW(width);
  const h = clampH(height);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  // Letzter per „/r"/„/roll" abgeschickter Befehl dieser Sitzung — Pfeil-hoch
  // bei leerem Eingabefeld holt ihn zurück, wie eine Shell-Historie (nur den
  // letzten, keine ganze Liste; das deckt den eigentlichen Wunsch „nochmal
  // würfeln, aber mit anderer Sichtbarkeit/Zahl" ab, ohne eigene UI dafür).
  const lastRollCmdRef = useRef<string | null>(null);

  // Proben-Vorschläge für "/r <Suchtext>": eigene Liste je Charakter, erst
  // beim ersten Bedarf geladen (wie RequestProbePicker) und danach gecacht.
  const [probes, setProbes] = useState<RollableProbe[] | null>(null);
  const probesCharRef = useRef<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Escape blendet die Vorschläge aus, ohne den Text zu löschen — man tippt
  // ja womöglich einfach einen längeren Suchtext weiter. Jede echte Änderung
  // am Text hebt die Ausblendung wieder auf.
  const [suggestDismissed, setSuggestDismissed] = useState(false);

  const rollMatch = /^\/(?:r|roll)\s+(.*)$/i.exec(draft);
  const rollRest = rollMatch ? rollMatch[1] : null;
  const isValidDice = rollRest !== null && parseDiceExpression(splitInlineTitle(rollRest).expr) !== null;
  const searchText = rollRest !== null && !isValidDice ? rollRest.trim() : '';
  const showSuggestions = !suggestDismissed && charId !== null && searchText.length >= MIN_SEARCH_LEN;

  useEffect(() => {
    if (!showSuggestions || charId === null || probesCharRef.current === charId) return;
    probesCharRef.current = charId;
    setProbes(null);
    apiGet<RollableProbe[]>(`/api/characters/${charId}/probes`)
      .then(setProbes)
      .catch(() => setProbes([]));
  }, [showSuggestions, charId]);

  const q = searchText.toLowerCase();
  const matches = showSuggestions && probes ? probes.filter((p) => p.label.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS) : [];
  const activeHighlight = Math.min(highlight, Math.max(matches.length - 1, 0));

  const pickProbe = (p: RollableProbe) => {
    if (groupId === null || charId === null) return;
    setError('');
    setDraft('');
    setSuggestDismissed(false);
    rollProbe(groupId, charId, p.source, visibility);
  };

  // Ein „SL-Wurf"-Ziel gehört zum vorherigen Raum — dessen Mitglieder gelten
  // im neuen Raum nicht mehr, also nicht stillschweigend übernehmen.
  useEffect(() => {
    setVisibilityTarget(null);
  }, [groupId]);

  // Ans Ende scrollen, wenn unten etwas Neues steht — ein neuer Eintrag oder
  // eine Anfrage, die ja gerade gesehen werden will.
  useEffect(() => {
    const last = feed.length > 0 ? feed[feed.length - 1].id : null;
    const marker = `${last ?? ''}|${pendingRequests.map((r) => r.id).join(',')}`;
    if (marker !== lastIdRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    lastIdRef.current = marker;
  }, [feed, pendingRequests]);

  // Verkleinern zieht die Ecke oben links — der Dock bleibt unten/rechts
  // verankert, also wächst der alte scrollTop plötzlich über den neuen
  // sichtbaren Bereich hinaus und der jüngste Eintrag rutscht aus dem Feld.
  // Bei jeder Höhenänderung wieder ans Ende, genau wie bei neuem Inhalt oben.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [h]);

  if (collapsed) {
    return (
      <button className="dice-dock-tab screen-only" onClick={toggle} title="Chat & Würfel öffnen">
        🎲 Chat
        {groupId !== null && !connected && <span className="dice-dock-offline" title="Verbindung wird aufgebaut…" aria-hidden />}
      </button>
    );
  }

  // Eine Eingabezeile für alles — wie „/me" ist auch der Wurf ein Befehl:
  // „/r 2w6+5" bzw. „/roll 2w6+5". Ein Suchtext statt eines Würfelausdrucks
  // zeigt stattdessen Proben-Vorschläge (siehe showSuggestions/matches oben) —
  // ein Treffer wird nie hierüber gesendet, dafür ist Enter/Klick auf den
  // Vorschlag selbst da. Alles andere ist eine normale Nachricht.
  const send = () => {
    const text = draft.trim();
    if (!text || groupId === null) return;
    // Trennlinie: mindestens 3 Bindestriche oder „/line" — Anzahl der
    // Bindestriche ist egal, gespeichert wird immer derselbe kanonische Text,
    // damit FeedEntryView ihn zuverlässig erkennt (siehe dort).
    if (/^-{3,}$/.test(text) || /^\/line$/i.test(text)) {
      sendChat('---');
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
    // „/commands": zeigt die Befehlsübersicht — rein clientseitig, wie „/dicecode".
    if (/^\/commands$/i.test(text)) {
      setCommandsOpen(true);
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
    // „/dicecode": rein persönliche Anzeige-Vorliebe (w/d), betrifft nur, wie
    // Würfelausdrücke im Feed dargestellt werden — als Eingabe bleiben beide
    // Buchstaben immer gültig. Schreibt nur die persistierte Präferenz,
    // schickt nie etwas über die Verbindung.
    const dicecode = /^\/dicecode(?:\s+(\S+))?$/i.exec(text);
    if (dicecode) {
      const arg = dicecode[1]?.toLowerCase();
      if (arg === undefined) {
        setInfo(`Aktuelle Würfel-Schreibweise: „${diceCode}" (z. B. 2${diceCode}6).`);
      } else if (arg === 'w' || arg === 'd') {
        setDiceCode(arg);
        setInfo(`Würfel-Schreibweise auf „${arg}" gesetzt (z. B. 2${arg}6).`);
      } else {
        setError(`„/dicecode" erwartet „w" oder „d", nicht „${dicecode[1]}".`);
        setInfo('');
        setDraft('');
        return;
      }
      setError('');
      setDraft('');
      return;
    }
    // „/master"/„/wild": fester Würfel-Ausdruck, Ergebnistext kommt vom
    // Server (siehe ws.ts) — hier nur der Befehl, kein Würfelausdruck nötig.
    if (/^\/master$/i.test(text) || /^\/wild$/i.test(text)) {
      const table = /^\/master$/i.test(text) ? 'master' : 'wild';
      rollExpr(table === 'master' ? '1w6' : '1w6+1w20', visibility, '', table, visibilityTarget ?? undefined);
      lastRollCmdRef.current = text;
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
    const roll = /^\/(?:r|roll)\s+(.+)$/i.exec(text);
    if (roll) {
      const { expr, label } = splitInlineTitle(roll[1]);
      if (!parseDiceExpression(expr)) {
        setError(
          charId !== null
            ? `„${roll[1]}" ist weder ein gültiger Würfelausdruck (z. B. 2w6+5) noch eine gefundene Probe — weitertippen für Vorschläge.`
            : `„${roll[1]}" ist kein gültiger Würfelausdruck (z. B. 2w6+5).`,
        );
        return;
      }
      rollExpr(expr, visibility, label, undefined, visibilityTarget ?? undefined);
      lastRollCmdRef.current = text;
    } else {
      sendChat(text);
    }
    setError('');
    setInfo('');
    setDraft('');
  };

  // Ecke oben links ziehen vergrößert nach links UND oben, weil der Dock am
  // rechten/unteren Fensterrand verankert bleibt (fixed right/bottom).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = w;
    const startH = h;
    const onMove = (ev: PointerEvent) => {
      setWidth(clampW(startW + (startX - ev.clientX)));
      setHeight(clampH(startH + (startY - ev.clientY)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-dice');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('resizing-dice');
  };

  return (
    <div className="dice-dock screen-only" style={{ width: w, height: h }}>
      <div className="dice-resize" onPointerDown={startResize} role="separator" title="Größe ziehen" />
      {/* Die ganze Kopfzeile klappt ein — nur der Raum-Wähler ist ausgenommen
          (siehe stopPropagation), damit eine Raumwahl nicht nebenbei zuklappt.
          Gleiches Muster wie CollapsiblePanel's Überschrift. */}
      <div
        className="dice-dock-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title="Einklappen"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <RoomPicker />
        {groupId !== null && !connected && <span className="muted dice-dock-status">verbinde…</span>}
        {/* Füllt den Rest der Zeile — gehört mit zur Klappfläche. */}
        <span className="dice-dock-head-fill" aria-hidden />
        <span className="chev" aria-hidden>
          ▾
        </span>
      </div>
      <div className="dice-dock-feed" ref={scrollRef}>
        {groupId === null ? (
          <p className="muted dice-dock-empty">
            {myGroups.length === 0 ? 'Noch in keiner Gruppe.' : 'Wähle oben einen Chatraum.'}
          </p>
        ) : (
          <>
            {hasMore && (
              <button className="small dice-dock-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Lädt…' : 'Ältere Nachrichten laden'}
              </button>
            )}
            {feed.length === 0 && <p className="muted dice-dock-empty">Noch nichts los hier.</p>}
            {feed.map((entry) => (
              <FeedEntryView key={entry.id} entry={entry} />
            ))}
            {/* Offene Anfragen unten, direkt über der Eingabe — dort schaut
                man hin, und sie sind das, was gerade zu tun ist. */}
            {pendingRequests.map((r) => (
              <PendingRequestCard key={r.id} request={r} />
            ))}
          </>
        )}
      </div>
      {(error || serverError) && <p className="dice-dock-error">{error || serverError}</p>}
      {!error && !serverError && info && <p className="dice-dock-info">{info}</p>}
      <div className="dice-dock-input">
        {showSuggestions && (
          <div className="dice-suggest" role="listbox">
            {!probes ? (
              <p className="dice-flyout-empty muted">Lädt…</p>
            ) : matches.length === 0 ? (
              <p className="dice-flyout-empty muted">Nichts gefunden.</p>
            ) : (
              matches.map((p, i) => (
                <button
                  key={`${p.kind}-${p.label}`}
                  className={`dice-flyout-item${i === activeHighlight ? ' active' : ''}`}
                  role="option"
                  aria-selected={i === activeHighlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pickProbe(p)}
                >
                  <span className="dice-shortcut-label">{p.label}</span>
                  <span className="muted dice-shortcut-expr">
                    {PROBE_KIND_LABEL[p.kind]} · {p.probeZahl}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        <ShortcutsFlyout
          raw={activeRoom?.myDiceShortcuts ?? ''}
          charId={charId}
          onOpen={refreshRooms}
          onPick={(label, expression) => {
            if (groupId === null) return;
            setError('');
            rollExpr(expression, visibility, label, undefined, visibilityTarget ?? undefined);
          }}
        />
        <VisibilityPicker
          value={visibility}
          targetUserId={visibilityTarget}
          onChange={(v, targetUserId) => {
            setVisibility(v);
            setVisibilityTarget(v === 'gm_player' ? (targetUserId ?? null) : null);
          }}
        />
        <ModifierPicker value={modifier} onChange={setModifier} />
        {charId !== null && (
          <SchicksalspunkteControl
            aktuell={activeRoom?.schicksalspunkteAktuell ?? 0}
            max={activeRoom?.schicksalspunkteMax ?? 0}
          />
        )}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSuggestDismissed(false);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            // Nur bei leerem Feld — sonst würde Pfeil-hoch mitten im Tippen
            // den Text unter der Hand austauschen.
            if (e.key === 'ArrowUp' && draft === '' && lastRollCmdRef.current) {
              e.preventDefault();
              setDraft(lastRollCmdRef.current);
              return;
            }
            if (showSuggestions && matches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, matches.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                pickProbe(matches[activeHighlight]);
                return;
              }
            }
            if (e.key === 'Escape' && showSuggestions) {
              e.preventDefault();
              setSuggestDismissed(true);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={groupId === null}
          placeholder={activeRoom?.myCharacterName ? `Als ${activeRoom.myCharacterName}… (/r 2w6)` : 'Nachricht… (/r 2w6)'}
        />
        <button className="small" onClick={send} disabled={!draft.trim() || groupId === null}>
          Senden
        </button>
      </div>
      <CommandsDialog open={commandsOpen} onClose={() => setCommandsOpen(false)} />
    </div>
  );
}
