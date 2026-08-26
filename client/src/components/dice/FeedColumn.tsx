import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { computeCoopVerdict, parseDiceExpression } from '@shared/dice';
import type { FeedEntry, ProbeRollPayload, RollVisibility } from '@shared/diceProtocol';
import { CHIME_STANDARD, type TonWahl, tonName } from '@shared/chimes';
import { useAuth } from '../../App';
import { apiGet } from '../../api';
import { usePersistedState } from '../persist';
import { useHoverFlyout } from '../useHoverFlyout';
import CommandsDialog from './CommandsDialog';
import CoopPoolCard from './CoopPoolCard';
import { useDicePanel } from './DicePanelProvider';
import FeedEntryView from './FeedEntryView';
import ModifierPicker from './ModifierPicker';
import GroupRequestCard from './GroupRequestCard';
import PendingRequestCard from './PendingRequestCard';
import { COOP, WICHTIG } from './labels';
import { PROBE_KIND_LABEL, type RollableProbe } from './rollableProbes';
import SchicksalspunkteControl from './SchicksalspunkteControl';
import ShortcutsFlyout from './ShortcutsFlyout';
import VisibilityPicker from './VisibilityPicker';

// Extrahiert aus DicePanel.tsx (siehe dort für die Begründung): der
// Feed+Eingabe-Teil des Docks, jetzt eigenständig, damit ihn auch die virtuelle
// Tischplatte fest in ihre Spalte einbetten kann statt ihn floating zu
// duplizieren. Der Dock bleibt das schwebende Chrome (Kopfzeile, Ziehgriff,
// Ein-/Ausklappen) und rendert dies hier unverändert als seinen Körper — alle
// Klassen sind bewusst class-only (keine `.dice-dock …`-Verschachtelung in
// styles.css), also sieht das hier in beiden Hüllen identisch aus.

const MIN_SEARCH_LEN = 2;
const MAX_SUGGESTIONS = 30;
const HISTORY_SIZE = 5;

type FeedChunk = { kind: 'single'; entry: FeedEntry } | { kind: 'group'; groupRollId: string; entries: FeedEntry[] };

function chunkFeed(entries: FeedEntry[]): FeedChunk[] {
  const chunks: FeedChunk[] = [];
  for (const entry of entries) {
    const gid = entry.groupRollId;
    const last = chunks[chunks.length - 1];
    if (gid && last?.kind === 'group' && last.groupRollId === gid) last.entries.push(entry);
    else if (gid) chunks.push({ kind: 'group', groupRollId: gid, entries: [entry] });
    else chunks.push({ kind: 'single', entry });
  }
  return chunks;
}

function CoopVerdictLine({ entries }: { entries: FeedEntry[] }) {
  const rolls = entries
    .filter((e): e is FeedEntry & { kind: 'roll'; roll: ProbeRollPayload } => e.kind === 'roll' && e.roll.mode === 'probe')
    .map((e) => e.roll);
  if (rolls.length === 0) return null;
  const verdict = computeCoopVerdict(rolls);
  const text = verdict.provisional
    ? COOP.verdictProvisional
    : verdict.unrescuedFailures > 0
      ? COOP.verdictFailureRescueless
      : verdict.success
        ? COOP.verdictSuccess(verdict.rolledSum, verdict.targetSum)
        : COOP.verdictFailure(verdict.rolledSum, verdict.targetSum);
  return (
    <div className={`feed-coop-verdict${verdict.provisional ? ' feed-coop-verdict--provisional' : verdict.success ? ' feed-coop-verdict--success' : ' feed-coop-verdict--failure'}`}>
      {text}
    </div>
  );
}

function splitInlineTitle(rest: string): { expr: string; label: string } {
  const hashIdx = rest.indexOf('#');
  if (hashIdx === -1) return { expr: rest, label: '' };
  return { expr: rest.slice(0, hashIdx).trim(), label: rest.slice(hashIdx + 1).trim() };
}

export interface FeedColumnHandle {
  /** An den Bogenanfang scrollen — für Anlässe außerhalb dieser Komponente (Dock-Größenänderung). */
  scrollToBottom: () => void;
}

const FeedColumn = forwardRef<FeedColumnHandle>(function FeedColumn(_props, ref) {
  const {
    groupId,
    charId,
    myGroups,
    feed,
    hasMore,
    loadingMore,
    pendingRequests,
    groupRequests,
    coopPools,
    presenceNotes,
    ton,
    setTon,
    tonZuletzt,
    sendChat,
    rollExpr,
    rollWichtig,
    rollProbe,
    proposeCoopPool,
    refreshRooms,
    loadMore,
    modifier,
    setModifier,
    diceCode,
    setDiceCode,
    serverError,
  } = useDicePanel();
  const { user } = useAuth();
  const activeRoom = myGroups.find((g) => g.id === groupId);
  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = usePersistedState<RollVisibility>('dice:visibility', 'public');
  const [visibilityTarget, setVisibilityTarget] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [commandsOpen, setCommandsOpen] = useState(false);
  // The note that „/i" overrides the visibility picker is shown exactly once
  // per device. On every roll it would be noise.
  const [wichtigHinweisGesehen, setWichtigHinweisGesehen] = usePersistedState<boolean>('dice:i-hinweis', false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftBeforeHistoryRef = useRef('');
  const pushHistory = (text: string) => {
    setHistory((h) => [...h, text].slice(-HISTORY_SIZE));
    historyIndexRef.current = -1;
  };

  const [probes, setProbes] = useState<RollableProbe[] | null>(null);
  const probesCharRef = useRef<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const activeSuggestRef = useRef<HTMLButtonElement | null>(null);
  // Unterhalb einer bestimmten Eingabezeilen-Breite (siehe die @container-
  // Regel bei .dice-dock-tools in styles.css) passen Kurzbefehle/Sichtbarkeit/
  // Modifikator/Schicksalspunkte nicht mehr bequem neben das Eingabefeld —
  // besonders mit dem zusätzlichen Klee-Knopf eines Spielers. Ab dann klappt
  // dieselbe Werkzeuggruppe hinter EINEM Knopf auf, zweiachsig als Raster
  // statt einer weiteren Reihe einzelner Knöpfe.
  const toolsFlyout = useHoverFlyout<HTMLDivElement>();

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    },
  }));

  const rollMatch = /^\/(?:r|roll)\s+(.*)$/i.exec(draft);
  const rollRest = rollMatch ? rollMatch[1] : null;
  const isValidDice = rollRest !== null && parseDiceExpression(splitInlineTitle(rollRest).expr) !== null;
  const koopMatch = /^\/(?:koop|coop)\s+(.*)$/i.exec(draft);
  const koopMode = koopMatch !== null;
  const searchText = koopMode ? koopMatch[1].trim() : rollRest !== null && !isValidDice ? rollRest.trim() : '';
  const suggestCharId = koopMode ? (charId ?? activeRoom?.anyCharId ?? null) : charId;
  const showSuggestions = !suggestDismissed && suggestCharId !== null && searchText.length >= MIN_SEARCH_LEN;

  useEffect(() => {
    if (!showSuggestions || suggestCharId === null || probesCharRef.current === suggestCharId) return;
    probesCharRef.current = suggestCharId;
    setProbes(null);
    apiGet<RollableProbe[]>(`/api/characters/${suggestCharId}/probes`)
      .then(setProbes)
      .catch(() => setProbes([]));
  }, [showSuggestions, suggestCharId]);

  const q = searchText.toLowerCase();
  const matches =
    showSuggestions && probes
      ? probes
          .filter((p) => !koopMode || p.kind === 'attribute' || p.kind === 'talent' || p.kind === 'sprache')
          .filter((p) => p.label.toLowerCase().includes(q))
          .slice(0, MAX_SUGGESTIONS)
      : [];
  const activeHighlight = Math.min(highlight, Math.max(matches.length - 1, 0));

  useEffect(() => {
    activeSuggestRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeHighlight]);

  const pickProbe = (p: RollableProbe) => {
    if (groupId === null) return;
    if (!koopMode && charId === null) return;
    setError('');
    setDraft('');
    setSuggestDismissed(false);
    if (koopMode) proposeCoopPool(groupId, p.source);
    else if (charId !== null) rollProbe(groupId, charId, p.source, visibility);
  };

  useEffect(() => {
    setVisibilityTarget(null);
  }, [groupId]);

  useEffect(() => {
    const last = feed.length > 0 ? feed[feed.length - 1].id : null;
    const marker = `${last ?? ''}|${pendingRequests.map((r) => r.id).join(',')}|${groupRequests.map((r) => r.id).join(',')}|${presenceNotes.map((p) => p.key).join(',')}`;
    if (marker !== lastIdRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    lastIdRef.current = marker;
  }, [feed, pendingRequests, groupRequests, presenceNotes]);

  const send = () => {
    const text = draft.trim();
    if (!text || groupId === null) return;
    if (/^-{3,}$/.test(text) || /^\/line$/i.test(text)) {
      sendChat('---');
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
    if (/^\/commands$/i.test(text)) {
      setCommandsOpen(true);
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
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
    if (/^\/mute$/i.test(text)) {
      const zurueck: TonWahl = tonZuletzt === 'aus' ? CHIME_STANDARD : tonZuletzt;
      const neu: TonWahl = ton === 'aus' ? zurueck : 'aus';
      setTon(neu);
      setInfo(
        neu === 'aus'
          ? 'Benachrichtigungston aus. Der Chat-Reiter blinkt weiterhin.'
          : `Benachrichtigungston an: „${tonName(neu)}".`,
      );
      setError('');
      setDraft('');
      return;
    }
    if (/^\/master$/i.test(text) || /^\/wild$/i.test(text)) {
      const table = /^\/master$/i.test(text) ? 'master' : 'wild';
      rollExpr(table === 'master' ? '1w6' : '1w6+1w20', visibility, '', table, visibilityTarget ?? undefined);
      pushHistory(text);
      setError('');
      setInfo('');
      setDraft('');
      return;
    }
    const koop = /^\/(?:koop|coop)(?:\s+(.*))?$/i.exec(text);
    if (koop) {
      setError(`„${koop[1] ?? ''}" — noch keine Probe aus den Vorschlägen ausgewählt.`);
      return;
    }
    // „/i <Ausdruck>" (bzw. „/important"): wie „/r", aber der Wurf wird am
    // ganzen Tisch angesagt — Fanfare, Verdunklung, fallende Würfel, und erst
    // danach der Eintrag im Chat. Steht VOR dem „/r"-Zweig, weil „erster Treffer
    // gewinnt" der dokumentierte Vertrag dieser Funktion ist und ein Leser
    // Würfelbefehle hier beieinander erwartet.
    //
    // Die Prüfung auf isGm erspart nur den Weg zum Server; verbindlich ist die
    // dortige (siehe ws.ts). Bewusst KEIN stiller Rückfall auf „/r": das würfe
    // etwas, das niemand angefordert hat.
    const wichtig = /^\/(?:i|important)\s+(.+)$/i.exec(text);
    if (wichtig) {
      if (!user.isGm) {
        setError(WICHTIG.nurSl);
        return;
      }
      const { expr, label } = splitInlineTitle(wichtig[1]);
      if (!parseDiceExpression(expr)) {
        setError(WICHTIG.keinAusdruck(wichtig[1]));
        return;
      }
      rollWichtig(expr, label);
      pushHistory(text);
      setError('');
      setInfo(wichtigHinweisGesehen ? '' : WICHTIG.hinweisSichtbarkeit);
      setWichtigHinweisGesehen(true);
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
      pushHistory(text);
    } else {
      sendChat(text, visibility, visibilityTarget ?? undefined);
      pushHistory(text);
    }
    setError('');
    setInfo('');
    setDraft('');
  };

  // Einmal aufgebaut, zweimal verwendet (siehe .dice-dock-tools/-compact unten):
  // dieselben vier Steuerelemente, einmal als Inline-Reihe, einmal als Inhalt
  // des zweiachsigen Flyouts — welche Fassung sichtbar ist, entscheidet allein
  // die @container-Regel, nicht React. Eine unsichtbare zweite Instanz ist
  // unschädlich, jede Steuerung bringt ihr eigenes Auf-/Zuklapp-Verhalten mit.
  const tools = (
    <>
      <ShortcutsFlyout
        raw={activeRoom?.myDiceShortcuts ?? ''}
        charId={charId}
        editHref={charId != null ? `/einstellungen?char=${charId}#wuerfel` : user.isGm ? '/einstellungen#wuerfel-sl' : undefined}
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
        <SchicksalspunkteControl aktuell={activeRoom?.schicksalspunkteAktuell ?? 0} max={activeRoom?.schicksalspunkteMax ?? 0} />
      )}
    </>
  );

  return (
    <>
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
            {chunkFeed(feed).map((chunk) =>
              chunk.kind === 'group' ? (
                <div className="feed-group-block" key={`group-${chunk.groupRollId}`}>
                  {chunk.entries[0]?.coop === true && <CoopVerdictLine entries={chunk.entries} />}
                  {chunk.entries.map((entry) => (
                    <FeedEntryView key={entry.id} entry={entry} grouped />
                  ))}
                </div>
              ) : (
                <FeedEntryView key={chunk.entry.id} entry={chunk.entry} />
              ),
            )}
            {groupRequests.map((r) => (
              <GroupRequestCard key={r.id} request={r} />
            ))}
            {coopPools.map((p) => (
              <CoopPoolCard key={p.id} request={p} />
            ))}
            {pendingRequests.map((r) => (
              <PendingRequestCard key={r.id} request={r} />
            ))}
            {presenceNotes.map((p) => (
              <p className="muted dice-presence-note" key={p.key}>
                {p.text}
              </p>
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
                  ref={i === activeHighlight ? activeSuggestRef : null}
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
        <div className="dice-dock-tools--inline">{tools}</div>
        <div className="dice-dock-tools-compact" ref={toolsFlyout.wrapRef}>
          <button
            type="button"
            className="dice-icon-btn"
            title="Werkzeuge"
            aria-haspopup="true"
            aria-expanded={toolsFlyout.open}
            onClick={() => (toolsFlyout.open ? toolsFlyout.closeNow() : toolsFlyout.openNow())}
          >
            ⋯
          </button>
          {toolsFlyout.open && (
            <div className="dice-dock-tools-flyout" role="menu">
              {tools}
            </div>
          )}
        </div>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSuggestDismissed(false);
            setHighlight(0);
            historyIndexRef.current = -1;
          }}
          onKeyDown={(e) => {
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
            if (e.key === 'ArrowUp' && history.length > 0 && (draft === '' || historyIndexRef.current !== -1)) {
              e.preventDefault();
              if (historyIndexRef.current === -1) draftBeforeHistoryRef.current = draft;
              historyIndexRef.current = historyIndexRef.current === -1 ? history.length - 1 : Math.max(historyIndexRef.current - 1, 0);
              setDraft(history[historyIndexRef.current]);
              return;
            }
            if (e.key === 'ArrowDown' && historyIndexRef.current !== -1) {
              e.preventDefault();
              if (historyIndexRef.current < history.length - 1) {
                historyIndexRef.current += 1;
                setDraft(history[historyIndexRef.current]);
              } else {
                historyIndexRef.current = -1;
                setDraft(draftBeforeHistoryRef.current);
              }
              return;
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
          placeholder="/commands für Befehle"
        />
        <button className="small" onClick={send} disabled={!draft.trim() || groupId === null}>
          Senden
        </button>
      </div>
      <CommandsDialog open={commandsOpen} onClose={() => setCommandsOpen(false)} />
    </>
  );
});

export default FeedColumn;
