import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ClientToServerMessage,
  CoopPoolRequest,
  FeedEntry,
  GroupRollRequest,
  PendingRollRequest,
  ProbeSource,
  RollVisibility,
  ServerToClientMessage,
} from '@shared/diceProtocol';
import type { BoardOverlay, BoardSettings, BoardToken } from '@shared/boardProtocol';
import { CHIME_STANDARD, type TonWahl, alsTonWahl } from '@shared/chimes';
import { apiGet, apiPut } from '../../api';
import { useAuth } from '../../App';
import { usePersistedState } from '../persist';
import { useWartung } from '../wartung';
import { spieleTon } from './ton';

const PAGE_SIZE = 30;
// Wie viele Einträge ein echter Neuverbindungsaufbau initial lädt — bewusst
// knapp, der Rest läuft über „Ältere Nachrichten laden" nach. Ein bloßer
// Reconnect nach einem Netz-Aussetzer lädt stattdessen PAGE_SIZE nach (siehe
// connect()), damit ein kurzer Verbindungsabbruch nicht sichtbar Einträge
// aus dem Feed reißt.
const INITIAL_LOAD_SIZE = 10;
// Deckel für die im Client gehaltene Live-Liste — ältere Einträge werden
// beim Eintreffen neuer stillschweigend vorne abgeschnitten (Server bleibt
// über loadMore() jederzeit erreichbar, das ist reine Anzeige-Hygiene). Ein
// Klick auf „Ältere Nachrichten laden" hebt den Deckel auf, bis der nächste
// ECHTE Neuverbindungsaufbau (Raumwechsel/Laden) ihn zurücksetzt — ein
// bloßer Reconnect nach Netz-Aussetzer tut das nicht (siehe connect()).
const MAX_LIVE_FEED = 100;
// Wie lange der Chat-Reiter nach einer Anfrage pulsiert. Danach bleibt der
// stille Punkt stehen: „hier ist etwas" muss bleiben, „schau JETZT hin" nicht —
// ein Reiter, der nach zwanzig Minuten immer noch zuckt, ist genau der Grund,
// aus dem Leute Benachrichtigungen dauerhaft abschalten.
const PULS_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
// Wie lange eine „wer ist da"-Notiz stehen bleibt, bevor sie von selbst
// verschwindet — sonst häufen sie sich über eine lange Sitzung im Dock an
// und drücken den eigentlichen Chat immer weiter nach oben aus dem Blick.
const PRESENCE_NOTE_TTL_MS = 8000;

function wsUrl(groupId: number): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/groups/${groupId}`;
}

function mergeFeed(existing: FeedEntry[], incoming: FeedEntry[]): FeedEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// `allow`=true (nach loadMore()) lässt den Deckel weg, bis der nächste echte
// Neuverbindungsaufbau ihn wieder scharf schaltet (siehe MAX_LIVE_FEED).
function trimFeed(entries: FeedEntry[], allow: boolean): FeedEntry[] {
  if (allow || entries.length <= MAX_LIVE_FEED) return entries;
  return entries.slice(entries.length - MAX_LIVE_FEED);
}

/**
 * Rein lokale Notiz „wer ist gerade da" — kommt aus presence.snapshot/
 * presence.joined, ist nie Teil des Feeds (kein `id` aus der DB, keine
 * Sichtbarkeitsregeln, niemand sonst sieht sie). `key` ist ein Client-Zufall,
 * nur für React's Listen-Rendering.
 */
export interface PresenceNote {
  key: string;
  text: string;
}

export interface DiceGroupOption {
  id: number;
  name: string;
  // Who this user posts as in this room — always the group's own character
  // (GM: always null, chats under their account). Never mixed with other
  // pages/rooms: the room you have open decides who you are, not the page
  // you happen to be looking at.
  myCharacterId: number | null;
  myCharacterName: string | null;
  /**
   * Irgendein Charakter dieser Gruppe — bei der Spielleitung (die selbst
   * keinen hat) ein beliebiger, bei einem Spieler der eigene. Nur zum Laden
   * der „/koop"-Probenvorschläge (Katalog-Einträge sind gruppenweit gleich,
   * siehe RequestGroupProbePicker.tsx's anyCharId), NICHT zum Würfeln.
   */
  anyCharId: number | null;
  /**
   * Rohtext der Würfel-Favoriten (siehe parseDiceShortcuts) — bei einem
   * Spieler die des Charakters dieser Gruppe, bei der Spielleitung ihre
   * eigenen kontoweiten Favoriten (gleich in jedem Raum, siehe
   * /me/dice-shortcuts).
   */
  myDiceShortcuts: string;
  /** 0/0 für die Spielleitung (kontolos) oder ein gruppenloser Raum ohne eigenen Charakter. */
  schicksalspunkteAktuell: number;
  schicksalspunkteMax: number;
  /** Nur für die Spielleitung befüllt — Gegenüber-Auswahl für „SL-Wurf" (siehe VisibilityPicker). */
  members: { userId: number; name: string }[];
}

interface DicePanelCtxValue {
  groupId: number | null;
  charId: number | null;
  myGroups: DiceGroupOption[];
  feed: FeedEntry[];
  connected: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  collapsed: boolean;
  toggle: () => void;
  /** Ungesehenes im Chat, seit der Dock zuletzt offen war — der Punkt am eingeklappten Reiter. */
  ungelesen: boolean;
  /** Zusätzlich zum Punkt: eine Anfrage will beantwortet werden. Verfällt nach PULS_MS von selbst. */
  pulsiert: boolean;
  /** Benachrichtigungsklang (`/mute`, Einstellungen) — rein client-seitig, wie diceCode. */
  ton: TonWahl;
  setTon: (t: TonWahl) => void;
  /** Zuletzt gewählter Klang ungleich „aus" — damit `/mute` zurückschalten kann. */
  tonZuletzt: TonWahl;
  lautstaerke: number;
  setLautstaerke: (v: number) => void;
  hidden: boolean;
  setHidden: (h: boolean) => void;
  /** Letzte Ablehnung vom Server (Ratenlimit, falsche Gruppe, abgelaufene Anfrage, …) — verschwindet von selbst. */
  serverError: string | null;
  /**
   * Situative Erleichterung(-)/Erschwernis(+), von der Spielleitung am Tisch
   * angesagt — wirkt auf die geworfene Summe, nicht auf die Probe-Zahl (man
   * unterwürfelt den Zielwert, ein positiver Wert erschwert also). Gilt für
   * GENAU DIE NÄCHSTE Probe — Bogen wie Chat — und springt danach von selbst
   * auf 0 zurück (siehe rollProbe/acceptRequest): mehrere modifizierte Würfe
   * hintereinander sind selten, ein übersehener Rest-Modifikator wäre der
   * teurere Fehler.
   */
  modifier: number;
  setModifier: (m: number) => void;
  /** Anzeige-Vorliebe „w" vs. „d" für Würfelausdrücke (`/dicecode`) — rein client-seitig, betrifft nur die Darstellung, nie die Eingabe (beide bleiben als Eingabe-Alias gültig). */
  diceCode: 'w' | 'd';
  setDiceCode: (c: 'w' | 'd') => void;
  /** Explicit room switch (from the room selector) — the only thing that changes what's displayed and who you post as. */
  selectRoom: (groupId: number) => void;
  sendChat: (raw: string) => void;
  /** targetUserId: nur bei visibility 'gm_player' UND von der Spielleitung gewählt — siehe roll.expr im Protokoll. */
  rollExpr: (
    expression: string,
    visibility: RollVisibility,
    label?: string,
    table?: 'master' | 'wild',
    targetUserId?: number,
  ) => void;
  /**
   * Probe vom Charakterbogen. Wechselt bei Bedarf in den Raum dieser Gruppe
   * (ein Wurf ist eine bewusste Handlung — anders als bloßes Blättern) und
   * klappt den Dock auf, damit Ergebnis und Reaktion sichtbar sind.
   */
  /** targetUserId: nur bei visibility 'gm_player' UND von der Spielleitung gewählt — wie bei rollExpr. */
  rollProbe: (groupId: number, charId: number, source: ProbeSource, visibility: RollVisibility, targetUserId?: number) => void;
  /** Offenen Bestätigungswurf erledigen — werfen, oder mit skip verwerfen. */
  confirmDie: (entryId: number, dieIndex: number, skip?: boolean) => void;
  /** Offene „SL + Spieler"-Anfragen, die diesen Nutzer betreffen. */
  pendingRequests: PendingRollRequest[];
  /**
   * Eigene, noch offene Gruppen-Sammelanfragen — nur bei der anfragenden
   * Spielleitung befüllt (siehe roll.group.created). Eine Karte je Anfrage,
   * mit Live-Status je Mitglied (GroupRollMember.status) statt N Karten, die
   * beim Antworten verschwinden.
   */
  groupRequests: GroupRollRequest[];
  /**
   * Offene Kooperationsprobe-Pools dieser Gruppe — anders als groupRequests
   * für JEDEN gefüllt, nicht nur die vorschlagende Person (siehe
   * server/src/coopPools.ts): selbstbedientes Beitreten statt SL-Broadcast.
   */
  coopPools: CoopPoolRequest[];
  /**
   * Rein lokale „wer ist da"-Notizen für den aktuellen Raum — eine
   * Momentaufnahme beim Verbinden, danach „X ist beigetreten" bei einer
   * echten Rückkehr (siehe presence.snapshot/presence.joined im Protokoll).
   * Leert sich bei jedem Raumwechsel/Reconnect neu.
   */
  presenceNotes: PresenceNote[];
  /** Spielleitung fordert eine bestimmte Probe von einem Spieler an. */
  requestProbe: (groupId: number, targetUserId: number, targetCharId: number, source: ProbeSource) => void;
  acceptRequest: (requestId: string) => void;
  declineRequest: (requestId: string) => void;
  /** Spielleitung zieht eine eigene, noch offene Anfrage zurück. */
  cancelRequest: (requestId: string) => void;
  /**
   * Spielleitung fordert dieselbe Probe von JEDEM gerade verbundenen
   * Gruppenmitglied an — ein normales `roll.pending.request` je Mitglied
   * unter gemeinsamer groupRequestId, Ergebnisse erscheinen erst gemeinsam
   * im Feed, sobald alle geantwortet haben (siehe server/src/groupRolls.ts).
   */
  requestGroupProbe: (groupId: number, source: ProbeSource) => void;
  /** Deckt eine Sammelanfrage vorzeitig auf — offene Zweige werden verworfen. */
  revealGroupRequest: (groupRequestId: string) => void;
  /** Verwirft eine Sammelanfrage komplett, auch bereits zurückgehaltene Ergebnisse. */
  cancelGroupRequest: (groupRequestId: string) => void;
  /** Schlägt einen offenen Kooperationsprobe-Pool vor — jeder darf, nicht nur die Spielleitung. */
  proposeCoopPool: (groupId: number, source: ProbeSource) => void;
  /** Tritt einem offenen Pool mit dem eigenen Charakter bei / verlässt ihn wieder. */
  joinCoopPool: (poolId: string) => void;
  leaveCoopPool: (poolId: string) => void;
  /** Schließt den Pool — alle Beigetretenen würfeln jetzt gemeinsam. Nur Vorschlagende/Spielleitung. */
  startCoopPool: (poolId: string) => void;
  /** Verwirft den Pool ohne zu würfeln. Nur Vorschlagende/Spielleitung. */
  cancelCoopPool: (poolId: string) => void;
  /** Reload the room list (names, posting-as character, dice shortcuts) after an edit elsewhere. */
  refreshRooms: () => void;
  loadMore: () => void;
  /**
   * Schicksalspunkte des aktuell postenden Charakters ändern (nicht Teil des
   * Wurf-Protokolls — reine Charakterdaten, siehe PUT .../schicksalspunkte).
   * `max` weglassen, um nur `aktuell` zu setzen.
   */
  setSchicksalspunkte: (aktuell: number, max?: number) => void;

  // --- Virtueller Tisch (docs/concepts/virtual-table.md) ---
  // Reitet denselben Socket wie Chat/Würfel statt eines zweiten (siehe
  // "Realtime design" im Plan). Anders als der Feed oben gibt es hierfür
  // keine REST-Historie über diesen Kontext — die Seite selbst holt den
  // vollständigen Schnappschuss (GET .../board) und übergibt ihn per
  // hydrateBoard(); von da an halten die WS-Deltas unten ihn aktuell.
  boardTokens: BoardToken[];
  boardSettings: BoardSettings | null;
  /** cellKey (shared/src/board.ts) -> tagged tile value (parseTileValue) — sparse, unpainted cells simply absent. */
  boardTiles: Record<string, string>;
  /** cellKey -> #rrggbb(aa) tint, GM-only layer ABOVE boardTiles — see paintHighlights below. */
  boardHighlights: Record<string, string>;
  /** Persistent, movable labels (board_overlays, kind 'label') — perm_labels-gated, see canLabel below. */
  boardOverlays: BoardOverlay[];
  /** Nach dem eigenen REST-Fetch der Seite aufrufen — füllt boardTokens/boardSettings/boardTiles/boardHighlights/boardOverlays einmalig. */
  hydrateBoard: (
    board: BoardSettings,
    tokens: BoardToken[],
    tiles: Record<string, string>,
    highlights: Record<string, string>,
    overlays: BoardOverlay[],
  ) => void;
  createToken: (input: {
    kind: 'character' | 'marker';
    characterId?: number;
    name?: string;
    color?: string;
    icon?: string;
    x: number;
    y: number;
    size?: number;
  }) => void;
  updateToken: (
    tokenId: number,
    patch: Partial<Pick<BoardToken, 'name' | 'color' | 'icon' | 'hidden' | 'statuses' | 'cover' | 'size' | 'radius'>>,
  ) => void;
  /** One message on drop — the caller renders the whole drag locally, see VirtualTable.tsx's MapCanvas. */
  moveToken: (tokenId: number, x: number, y: number, final?: boolean) => void;
  deleteToken: (tokenId: number) => void;
  updateBoardSettings: (patch: Partial<Pick<BoardSettings, 'permTiles' | 'permLabels' | 'permTokens' | 'permImages' | 'permMove'>>) => void;
  /** value '' erases that cell. Sent once per stroke/fill, same "render locally, sync on release" shape as a token drag. */
  paintTiles: (cells: Record<string, string>) => void;
  /** Same shape as paintTiles, but for the GM-only highlight/tint layer — never touches boardTiles. */
  paintHighlights: (cells: Record<string, string>) => void;
  createOverlay: (kind: 'label', data: BoardOverlay['data']) => void;
  /** One message carries both a drag's dropped position and a text edit — see the protocol comment. */
  updateOverlay: (overlayId: number, patch: Partial<BoardOverlay['data']>) => void;
  deleteOverlay: (overlayId: number) => void;
}

const DicePanelCtx = createContext<DicePanelCtxValue | null>(null);

export function useDicePanel(): DicePanelCtxValue {
  return (
    useContext(DicePanelCtx) ?? {
      groupId: null,
      charId: null,
      myGroups: [],
      feed: [],
      connected: false,
      hasMore: false,
      loadingMore: false,
      collapsed: true,
      toggle: () => {},
      ungelesen: false,
      pulsiert: false,
      ton: CHIME_STANDARD,
      setTon: () => {},
      tonZuletzt: CHIME_STANDARD,
      lautstaerke: 0.6,
      setLautstaerke: () => {},
      hidden: false,
      setHidden: () => {},
      serverError: null,
      modifier: 0,
      setModifier: () => {},
      diceCode: 'w',
      setDiceCode: () => {},
      selectRoom: () => {},
      sendChat: () => {},
      rollExpr: () => {},
      rollProbe: () => {},
      confirmDie: () => {},
      pendingRequests: [],
      groupRequests: [],
      coopPools: [],
      presenceNotes: [],
      requestProbe: () => {},
      acceptRequest: () => {},
      declineRequest: () => {},
      cancelRequest: () => {},
      requestGroupProbe: () => {},
      revealGroupRequest: () => {},
      cancelGroupRequest: () => {},
      proposeCoopPool: () => {},
      joinCoopPool: () => {},
      leaveCoopPool: () => {},
      startCoopPool: () => {},
      cancelCoopPool: () => {},
      refreshRooms: () => {},
      loadMore: () => {},
      setSchicksalspunkte: () => {},
      boardTokens: [],
      boardSettings: null,
      boardTiles: {},
      boardHighlights: {},
      boardOverlays: [],
      hydrateBoard: () => {},
      createToken: () => {},
      updateToken: () => {},
      moveToken: () => {},
      deleteToken: () => {},
      updateBoardSettings: () => {},
      paintTiles: () => {},
      paintHighlights: () => {},
      createOverlay: () => {},
      updateOverlay: () => {},
      deleteOverlay: () => {},
    }
  );
}

export function DicePanelProvider({ children }: { children: React.ReactNode }) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [charId, setCharId] = useState<number | null>(null);
  const [myGroups, setMyGroups] = useState<DiceGroupOption[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [collapsed, setCollapsed] = usePersistedState<boolean>('dice:collapsed', true);
  // Bewusst NICHT persistiert: es gibt kein „zuletzt gesehen"-Datum, gegen das
  // sich ein nach dem Neuladen wieder auftauchender Punkt begründen ließe. Ein
  // frischer Start beginnt sauber.
  const [ungelesen, setUngelesen] = useState(false);
  const [pulsiert, setPulsiert] = useState(false);
  const pulsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [modifier, setModifier] = usePersistedState<number>('dice:modifier', 0);
  const [diceCode, setDiceCode] = usePersistedState<'w' | 'd'>('dice:code', 'w');
  // Wie diceCode eine reine Anzeige-/Geräte-Vorliebe: WELCHER Klang und wie laut
  // hängt am Ohr vor dem Rechner (Kopfhörer am Tisch vs. Handy quer im Raum),
  // nicht am Konto. Die hochgeladene DATEI liegt dagegen am Konto, damit sie
  // niemand zweimal hochladen muss.
  const [tonRoh, setTonRoh] = usePersistedState<TonWahl>('chat:ton', CHIME_STANDARD);
  const [tonZuletzt, setTonZuletzt] = usePersistedState<TonWahl>('chat:ton-zuletzt', CHIME_STANDARD);
  const [lautstaerke, setLautstaerke] = usePersistedState<number>('chat:ton-vol', 0.6);
  const [pendingRequests, setPendingRequests] = useState<PendingRollRequest[]>([]);
  const [groupRequests, setGroupRequests] = useState<GroupRollRequest[]>([]);
  const [coopPools, setCoopPools] = useState<CoopPoolRequest[]>([]);
  const [presenceNotes, setPresenceNotes] = useState<PresenceNote[]>([]);
  const [persistedRoom, setPersistedRoom] = usePersistedState<number | null>('dice:room', null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [boardTokens, setBoardTokens] = useState<BoardToken[]>([]);
  const [boardSettings, setBoardSettings] = useState<BoardSettings | null>(null);
  const [boardTiles, setBoardTiles] = useState<Record<string, string>>({});
  const [boardHighlights, setBoardHighlights] = useState<Record<string, string>>({});
  const [boardOverlays, setBoardOverlays] = useState<BoardOverlay[]>([]);
  const serverErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { ankuendigungEmpfangen } = useWartung();
  const { user } = useAuth();

  const wsRef = useRef<WebSocket | null>(null);
  const groupIdRef = useRef<number | null>(null);
  // WARUM Refs: connect() ist useCallback(…, []), seine ws.onmessage-Closure
  // entsteht also GENAU EINMAL und sähe sonst für immer die Werte des ersten
  // Renders. Ohne das wäre `collapsed` dort dauerhaft true und der Klang
  // erklänge auch bei weit offenem Dock. groupIdRef daneben gibt es aus
  // demselben Grund.
  const collapsedRef = useRef(collapsed);
  const tonRef = useRef<TonWahl>(alsTonWahl(tonRoh, true));
  const lautstaerkeRef = useRef(lautstaerke);
  const meineUserIdRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const liveBufferRef = useRef<FeedEntry[]>([]);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  // Siehe MAX_LIVE_FEED — true nach loadMore(), zurückgesetzt bei jedem
  // echten Neuverbindungsaufbau (applyRoom), NICHT bei einem bloßen Reconnect.
  const trimOverrideRef = useRef(false);
  // Nachrichten, die abgeschickt wurden, während die Verbindung (noch) nicht
  // stand — vor allem beim Würfeln vom Bogen, das erst den Raum wechselt.
  const outboxRef = useRef<ClientToServerMessage[]>([]);

  // Gegen Müll in localStorage. „eigen" bleibt hier absichtlich gültig: ob die
  // Datei wirklich existiert, weiß nur die Einstellungen-Seite, und die setzt
  // die Auswahl beim Löschen selbst zurück.
  const ton = alsTonWahl(tonRoh, true);

  // Im Effekt statt beim Rendern: ein Ref während des Renderns zu beschreiben
  // ist genau das, was React abrät, und der Gewinn wäre hier ohnehin keiner.
  useEffect(() => {
    collapsedRef.current = collapsed;
    tonRef.current = ton;
    lautstaerkeRef.current = lautstaerke;
    meineUserIdRef.current = user?.id ?? null;
  }, [collapsed, ton, lautstaerke, user?.id]);

  useEffect(() => {
    return () => {
      if (pulsTimerRef.current) clearTimeout(pulsTimerRef.current);
    };
  }, []);

  /**
   * Der Punkt am eingeklappten Reiter. Nichts weiter — kein Ton, kein Puls.
   * Für alles, was man später nachlesen kann: eigene Würfe, fremder Chat.
   */
  const melde = useCallback(() => {
    if (!collapsedRef.current) return;
    setUngelesen(true);
  }, []);

  /**
   * Zusätzlich Puls und Klang: etwas WILL beantwortet werden (Proben-, Gruppen-
   * oder Kooperationsanfrage).
   *
   * Der Ton kommt auch, wenn der Dock offen, das Fenster aber nicht im Blick
   * ist — ein offener Dock im Hintergrund-Tab wird genauso übersehen wie ein
   * eingeklappter. Der Punkt dagegen ergibt nur am eingeklappten Reiter Sinn.
   */
  const meldeDringend = useCallback(() => {
    melde();
    const unsichtbar = collapsedRef.current || document.hidden || !document.hasFocus();
    if (!unsichtbar) return;
    if (collapsedRef.current) {
      setPulsiert(true);
      if (pulsTimerRef.current) clearTimeout(pulsTimerRef.current);
      pulsTimerRef.current = setTimeout(() => setPulsiert(false), PULS_MS);
    }
    spieleTon(tonRef.current, lautstaerkeRef.current);
  }, [melde]);

  /**
   * Auf- und Zuklappen — und der einzige Weg, auf dem der Dock noch aufgeht
   * (die sieben `setCollapsed(false)`-Stellen sind ersatzlos entfallen).
   *
   * Das Aufräumen steht deshalb hier und nicht in einem Effekt: es gibt nichts
   * abzugleichen, nur ein „gesehen". Und ausdrücklich NICHT im State-Updater —
   * React ruft den im StrictMode doppelt auf, Seiteneffekte gehören da nicht hin.
   */
  const toggle = useCallback(() => {
    if (collapsed) {
      setUngelesen(false);
      setPulsiert(false);
      if (pulsTimerRef.current) clearTimeout(pulsTimerRef.current);
    }
    setCollapsed((v) => !v);
  }, [collapsed, setCollapsed]);

  /**
   * Auswahl des Benachrichtigungsklangs. Merkt sich jede Wahl außer „aus"
   * getrennt mit, damit `/mute` weiß, wohin es zurückschalten soll.
   */
  const setTon = useCallback(
    (t: TonWahl) => {
      if (t !== 'aus') setTonZuletzt(t);
      setTonRoh(t);
    },
    [setTonRoh, setTonZuletzt],
  );

  const sendMsg = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else outboxRef.current.push(msg);
  }, []);

  // Verschwindet nach PRESENCE_NOTE_TTL_MS von selbst wieder (siehe dort) —
  // ein Timeout je Notiz statt eines Intervalls, das läuft auch bei einem
  // Raumwechsel einfach leer (die Notiz ist dann schon aus presenceNotes
  // verschwunden, das Filtern ist ein No-op).
  const addPresenceNote = useCallback((text: string) => {
    const key = crypto.randomUUID();
    setPresenceNotes((prev) => [...prev, { key, text }]);
    setTimeout(() => setPresenceNotes((prev) => prev.filter((p) => p.key !== key)), PRESENCE_NOTE_TTL_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (serverErrorTimerRef.current) clearTimeout(serverErrorTimerRef.current);
    };
  }, []);

  // `fresh`=true nur beim echten Neuverbindungsaufbau (applyRoom) — ein
  // automatischer Reconnect nach Netz-Aussetzer (onclose unten) ruft mit
  // false, damit weder der 10er-Anfangsdeckel noch der loadMore()-Override
  // dabei zurückgesetzt werden.
  const connect = useCallback((gid: number, fresh: boolean) => {
    bufferingRef.current = true;
    liveBufferRef.current = [];
    intentionalCloseRef.current = false;
    // Neuer Raum, neue Momentaufnahme — die alte gehörte zum vorherigen Raum.
    setPresenceNotes([]);
    const ws = new WebSocket(wsUrl(gid));
    wsRef.current = ws;

    ws.onopen = () => {
      const limit = fresh ? INITIAL_LOAD_SIZE : PAGE_SIZE;
      apiGet<{ entries: FeedEntry[]; hasMore: boolean }>(`/api/groups/${gid}/feed?limit=${limit}`)
        .then((page) => {
          if (wsRef.current !== ws) return; // superseded by a newer connection
          setFeed((prev) => trimFeed(mergeFeed(prev, mergeFeed(page.entries, liveBufferRef.current)), trimOverrideRef.current));
          setHasMore(page.hasMore);
          bufferingRef.current = false;
          liveBufferRef.current = [];
          setConnected(true);
          reconnectDelayRef.current = RECONNECT_BASE_MS;
          // Was während des Verbindungsaufbaus aufgelaufen ist, jetzt abschicken.
          const queued = outboxRef.current;
          outboxRef.current = [];
          for (const m of queued) ws.send(JSON.stringify(m));
        })
        .catch(() => {
          // History fetch failed — live pushes still buffer until the socket
          // itself gives up (onclose) and a reconnect retries the whole thing.
        });
    };
    ws.onmessage = (ev) => {
      let msg: ServerToClientMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'roll.pending.created') {
        // Eine Anfrage will beantwortet werden — aber NICHT, indem der Dock
        // sich über den Bogen schiebt, in dem gerade jemand liest.
        setPendingRequests((prev) => [...prev.filter((r) => r.id !== msg.request.id), msg.request]);
        meldeDringend();
        return;
      }
      if (
        msg.type === 'roll.pending.expired' ||
        msg.type === 'roll.pending.declined' ||
        msg.type === 'roll.pending.accepted' ||
        msg.type === 'roll.pending.cancelled'
      ) {
        // Per id, nicht per Charakter — sonst würde eine von mehreren offenen
        // Anfragen an denselben Charakter auch die anderen wegwischen.
        setPendingRequests((prev) => prev.filter((r) => r.id !== msg.requestId));
        return;
      }
      if (msg.type === 'roll.group.created') {
        setGroupRequests((prev) => [...prev.filter((r) => r.id !== msg.request.id), msg.request]);
        meldeDringend();
        return;
      }
      if (msg.type === 'roll.group.member') {
        // Karte bleibt stehen — nur der Status DIESES Mitglieds ändert sich,
        // der Rest der Liste bleibt unangetastet (siehe GroupRollMember.status).
        setGroupRequests((prev) =>
          prev.map((r) =>
            r.id === msg.requestId
              ? { ...r, members: r.members.map((m) => (m.charId === msg.charId ? { ...m, status: msg.status } : m)) }
              : r,
          ),
        );
        return;
      }
      if (msg.type === 'roll.group.revealed' || msg.type === 'roll.group.cancelled') {
        setGroupRequests((prev) => prev.filter((r) => r.id !== msg.requestId));
        return;
      }
      if (msg.type === 'roll.coop.created') {
        // An ALLE in der Gruppe (nicht nur die vorschlagende Person) — damit ein
        // neuer Pool nicht unbemerkt bleibt.
        setCoopPools((prev) => [...prev.filter((p) => p.id !== msg.pool.id), msg.pool]);
        meldeDringend();
        return;
      }
      if (msg.type === 'roll.coop.updated') {
        // Nur der Mitgliederstand ändert sich — kein Grund, einen bewusst
        // eingeklappten Dock wieder aufzuklappen.
        setCoopPools((prev) => prev.map((p) => (p.id === msg.pool.id ? msg.pool : p)));
        return;
      }
      if (msg.type === 'roll.coop.closed' || msg.type === 'roll.coop.cancelled') {
        setCoopPools((prev) => prev.filter((p) => p.id !== msg.poolId));
        return;
      }
      if (msg.type === 'schicksalspunkte.update') {
        // GM-Reset über die GM-Übersicht (REST, andere Session) — ohne
        // diesen Push bliebe der Klee-Zähler hier stumpf bis zum nächsten
        // Laden der Räume.
        setMyGroups((prev) =>
          prev.map((g) =>
            g.myCharacterId === msg.charId
              ? { ...g, schicksalspunkteAktuell: msg.aktuell, schicksalspunkteMax: msg.max }
              : g,
          ),
        );
        return;
      }
      if (msg.type === 'presence.snapshot') {
        const text = msg.names.length === 0 ? 'Gerade niemand sonst hier.' : `Verbunden: ${msg.names.join(', ')}`;
        addPresenceNote(text);
        return;
      }
      if (msg.type === 'presence.joined') {
        addPresenceNote(`${msg.name} ist beigetreten.`);
        return;
      }
      if (msg.type === 'board.token.created') {
        setBoardTokens((prev) => [...prev.filter((t) => t.id !== msg.token.id), msg.token]);
        return;
      }
      if (msg.type === 'board.token.updated') {
        // Auch die Live-Position während eines Ziehens läuft hier durch —
        // der ziehende Client selbst rendert währenddessen aus seinem eigenen
        // Drag-Zustand, nicht aus boardTokens (siehe VirtualTable.tsx).
        setBoardTokens((prev) => prev.map((t) => (t.id === msg.token.id ? msg.token : t)));
        return;
      }
      if (msg.type === 'board.token.deleted') {
        setBoardTokens((prev) => prev.filter((t) => t.id !== msg.tokenId));
        return;
      }
      if (msg.type === 'board.settings.updated') {
        setBoardSettings(msg.board);
        return;
      }
      if (msg.type === 'board.tiles.painted') {
        setBoardTiles((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(msg.cells)) {
            if (value === '') delete next[key];
            else next[key] = value;
          }
          return next;
        });
        return;
      }
      if (msg.type === 'board.highlights.painted') {
        setBoardHighlights((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(msg.cells)) {
            if (value === '') delete next[key];
            else next[key] = value;
          }
          return next;
        });
        return;
      }
      if (msg.type === 'board.overlay.created') {
        setBoardOverlays((prev) => [...prev, msg.overlay]);
        return;
      }
      if (msg.type === 'board.overlay.updated') {
        setBoardOverlays((prev) => prev.map((o) => (o.id === msg.overlay.id ? msg.overlay : o)));
        return;
      }
      if (msg.type === 'board.overlay.deleted') {
        setBoardOverlays((prev) => prev.filter((o) => o.id !== msg.overlayId));
        return;
      }
      if (msg.type === 'wartung.angekuendigt') {
        // Nur weiterreichen — der Wartebildschirm gehört nicht zum Würfel-Dock.
        // Der Socket ist bloß der Kanal, der ohnehin schon steht.
        ankuendigungEmpfangen(msg.durch);
        return;
      }
      if (msg.type === 'error') {
        // Abgelehnte Aktion (Ratenlimit, falsche Gruppe, veraltete Anfrage, …)
        // — sonst bliebe eine Ablehnung unsichtbar, der Klick sähe nach
        // nichts aus. Verschwindet von selbst statt einer weiteren Klick-
        // fläche zum Wegklicken.
        if (serverErrorTimerRef.current) clearTimeout(serverErrorTimerRef.current);
        setServerError(msg.message);
        serverErrorTimerRef.current = setTimeout(() => setServerError(null), 6000);
        return;
      }
      // append und update laufen beide durch mergeFeed (dedupliziert nach id),
      // ein Update ersetzt den vorhandenen Eintrag also einfach.
      if (msg.type !== 'feed.append' && msg.type !== 'feed.update') return;
      // Nur bei NEUEN Einträgen und nur von anderen: ein Update ist die
      // Änderung an etwas, das schon dasteht, und der eigene Beitrag ist keine
      // Neuigkeit. Rein der Punkt — Chat allein soll nie läuten.
      //
      // Gemessen an authorUserId, nicht an `isMe`: das Feld trägt nur
      // ChatFeedEntry, ein RollFeedEntry hat es nicht (siehe diceProtocol.ts).
      if (msg.type === 'feed.append' && msg.entry.authorUserId !== meineUserIdRef.current) melde();
      if (bufferingRef.current) {
        liveBufferRef.current.push(msg.entry);
      } else {
        setFeed((prev) => trimFeed(mergeFeed(prev, [msg.entry]), trimOverrideRef.current));
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current !== ws) return; // already superseded
      if (intentionalCloseRef.current) return;
      const delay = reconnectDelayRef.current * (0.8 + Math.random() * 0.4);
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, RECONNECT_MAX_MS);
      reconnectTimerRef.current = setTimeout(() => connect(gid, false), delay);
    };
    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const applyRoom = useCallback(
    (option: DiceGroupOption) => {
      if (groupIdRef.current === option.id) return; // already the open room
      groupIdRef.current = option.id;
      setGroupId(option.id);
      setCharId(option.myCharacterId);
      setPersistedRoom(option.id);
      setFeed([]);
      setHasMore(false);
      setConnected(false);
      // Anfragen aus dem alten Raum haben hier nichts verloren — der neue
      // Raum reicht seine eigenen offenen Anfragen gleich nach dem Verbinden
      // nach (siehe server/src/ws.ts, pendingRequestsFor beim Upgrade).
      setPendingRequests([]);
      setGroupRequests([]);
      setCoopPools([]);
      // Gehört zum vorherigen Raum — die Seite ruft nach dem Wechsel ihr
      // eigenes GET .../board neu auf und hydriert erneut (siehe hydrateBoard).
      setBoardTokens([]);
      setBoardSettings(null);
      setBoardTiles({});
      setBoardHighlights({});
      setBoardOverlays([]);
      trimOverrideRef.current = false;
      reconnectDelayRef.current = RECONNECT_BASE_MS;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
      connect(option.id, true);
    },
    [connect, setPersistedRoom],
  );

  const selectRoom = useCallback(
    (newGroupId: number) => {
      const option = myGroups.find((g) => g.id === newGroupId);
      if (option) applyRoom(option);
    },
    [myGroups, applyRoom],
  );

  // Nachladen nach Änderungen anderswo (z. B. Chat-Anzeigename oder
  // Würfel-Favoriten in den Einstellungen) — applyRoom greift dabei nicht,
  // der offene Raum bleibt offen.
  const refreshRooms = useCallback(() => {
    apiGet<DiceGroupOption[]>('/api/groups/mine').then(setMyGroups).catch(() => {});
  }, []);

  // Restores the last-picked room (localStorage) on load, or — if nothing's
  // picked yet and there's no ambiguity — auto-opens a player's one and only
  // group. 2+ groups with nothing persisted stays unselected: the room
  // selector is how you choose, not a guess.
  useEffect(() => {
    apiGet<DiceGroupOption[]>('/api/groups/mine')
      .then((groups) => {
        setMyGroups(groups);
        const persisted = persistedRoom !== null ? groups.find((g) => g.id === persistedRoom) : undefined;
        if (persisted) applyRoom(persisted);
        else if (groups.length === 1) applyRoom(groups[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendChat = useCallback(
    (raw: string) => {
      const isMe = raw.startsWith('/me ');
      const text = isMe ? raw.slice(4).trim() : raw.trim();
      if (!text) return;
      sendMsg({ type: 'chat.send', reqId: crypto.randomUUID(), text, isMe, charId });
    },
    [charId, sendMsg],
  );

  const rollExpr = useCallback(
    (expression: string, visibility: RollVisibility, label = '', table?: 'master' | 'wild', targetUserId?: number) => {
      sendMsg({ type: 'roll.expr', reqId: crypto.randomUUID(), label, expression, visibility, charId, table, targetUserId });
    },
    [charId, sendMsg],
  );

  const rollProbe = useCallback(
    (forGroupId: number, forCharId: number, source: ProbeSource, visibility: RollVisibility, targetUserId?: number) => {
      // Ein Wurf vom Bogen gehört in den Raum DIESER Gruppe, als DIESER
      // Charakter — notfalls wird dorthin gewechselt (die Nachricht wartet
      // dann in der Outbox auf die neue Verbindung).
      if (groupIdRef.current !== forGroupId) {
        const option = myGroups.find((g) => g.id === forGroupId);
        if (option) applyRoom(option);
      }
      melde(); // das Ergebnis soll man finden — aber selbst hinsehen dürfen
      sendMsg({
        type: 'roll.probe',
        reqId: crypto.randomUUID(),
        source,
        charId: forCharId,
        visibility,
        modifier,
        targetUserId,
      });
      // Gilt nur für DIESEN einen Wurf — mehrere modifizierte Würfe hinter-
      // einander sind selten, ein vergessener Modifikator, der beim nächsten
      // Klick unbemerkt weiterwirkt, wäre schlimmer als ihn neu einzutippen.
      if (modifier !== 0) setModifier(0);
    },
    [myGroups, applyRoom, sendMsg, modifier, setModifier, melde],
  );

  const confirmDie = useCallback(
    (entryId: number, dieIndex: number, skip = false) => {
      sendMsg({ type: 'roll.confirm', reqId: crypto.randomUUID(), entryId, dieIndex, skip });
    },
    [sendMsg],
  );

  const requestProbe = useCallback(
    (forGroupId: number, targetUserId: number, targetCharId: number, source: ProbeSource) => {
      // Wie beim Würfeln vom Bogen: erst in den Raum dieser Gruppe, dann
      // senden (die Nachricht wartet notfalls in der Outbox).
      if (groupIdRef.current !== forGroupId) {
        const option = myGroups.find((g) => g.id === forGroupId);
        if (option) applyRoom(option);
      }
      melde();
      sendMsg({ type: 'roll.pending.request', reqId: crypto.randomUUID(), source, targetUserId, targetCharId });
    },
    [myGroups, applyRoom, sendMsg, melde],
  );

  const acceptRequest = useCallback(
    (requestId: string) => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      sendMsg({ type: 'roll.pending.accept', reqId: crypto.randomUUID(), requestId, modifier });
      if (modifier !== 0) setModifier(0);
    },
    [sendMsg, modifier, setModifier],
  );

  const declineRequest = useCallback(
    (requestId: string) => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      sendMsg({ type: 'roll.pending.decline', reqId: crypto.randomUUID(), requestId });
    },
    [sendMsg],
  );

  const cancelRequest = useCallback(
    (requestId: string) => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      sendMsg({ type: 'roll.pending.cancel', reqId: crypto.randomUUID(), requestId });
    },
    [sendMsg],
  );

  const requestGroupProbe = useCallback(
    (forGroupId: number, source: ProbeSource) => {
      if (groupIdRef.current !== forGroupId) {
        const option = myGroups.find((g) => g.id === forGroupId);
        if (option) applyRoom(option);
      }
      melde();
      sendMsg({ type: 'roll.group.request', reqId: crypto.randomUUID(), source });
    },
    [myGroups, applyRoom, sendMsg, melde],
  );

  const revealGroupRequest = useCallback(
    (groupRequestId: string) => {
      setGroupRequests((prev) => prev.filter((r) => r.id !== groupRequestId));
      sendMsg({ type: 'roll.group.reveal', reqId: crypto.randomUUID(), groupRequestId });
    },
    [sendMsg],
  );

  const cancelGroupRequest = useCallback(
    (groupRequestId: string) => {
      setGroupRequests((prev) => prev.filter((r) => r.id !== groupRequestId));
      sendMsg({ type: 'roll.group.cancel', reqId: crypto.randomUUID(), groupRequestId });
    },
    [sendMsg],
  );

  const proposeCoopPool = useCallback(
    (forGroupId: number, source: ProbeSource) => {
      // Kein eigener Charakter nötig — die Spielleitung hat nie einen, und
      // Vorschlagen tritt nicht automatisch bei (siehe roll.coop.propose im
      // Protokoll).
      if (groupIdRef.current !== forGroupId) {
        const option = myGroups.find((g) => g.id === forGroupId);
        if (option) applyRoom(option);
      }
      melde();
      sendMsg({ type: 'roll.coop.propose', reqId: crypto.randomUUID(), source });
    },
    [myGroups, applyRoom, sendMsg, melde],
  );

  const joinCoopPoolAction = useCallback(
    (poolId: string) => {
      if (charId === null) return;
      sendMsg({ type: 'roll.coop.join', reqId: crypto.randomUUID(), poolId, charId });
    },
    [sendMsg, charId],
  );

  const leaveCoopPoolAction = useCallback(
    (poolId: string) => {
      sendMsg({ type: 'roll.coop.leave', reqId: crypto.randomUUID(), poolId });
    },
    [sendMsg],
  );

  const startCoopPool = useCallback(
    (poolId: string) => {
      sendMsg({ type: 'roll.coop.start', reqId: crypto.randomUUID(), poolId });
    },
    [sendMsg],
  );

  const cancelCoopPool = useCallback(
    (poolId: string) => {
      setCoopPools((prev) => prev.filter((p) => p.id !== poolId));
      sendMsg({ type: 'roll.coop.cancel', reqId: crypto.randomUUID(), poolId });
    },
    [sendMsg],
  );

  const loadMore = useCallback(() => {
    if (groupId === null || loadingMore || !hasMore || feed.length === 0) return;
    // Bewusst angefordert — der 100er-Deckel gilt ab jetzt nicht mehr, bis
    // der nächste echte Neuverbindungsaufbau ihn zurücksetzt (siehe applyRoom).
    trimOverrideRef.current = true;
    setLoadingMore(true);
    const before = feed[0].id;
    apiGet<{ entries: FeedEntry[]; hasMore: boolean }>(`/api/groups/${groupId}/feed?before=${before}&limit=${PAGE_SIZE}`)
      .then((page) => {
        setFeed((prev) => mergeFeed(prev, page.entries));
        setHasMore(page.hasMore);
      })
      .finally(() => setLoadingMore(false));
  }, [groupId, hasMore, loadingMore, feed]);

  const setSchicksalspunkte = useCallback(
    (aktuell: number, max?: number) => {
      if (charId === null) return;
      // Optimistisch in myGroups spiegeln (das ist die einzige Quelle, die die
      // Anzeige liest) — der Server-Wert (geklemmt) kommt gleich danach nach.
      setMyGroups((prev) =>
        prev.map((g) =>
          g.myCharacterId === charId
            ? { ...g, schicksalspunkteAktuell: aktuell, schicksalspunkteMax: max ?? g.schicksalspunkteMax }
            : g,
        ),
      );
      apiPut<{ aktuell: number; max: number }>(`/api/characters/${charId}/schicksalspunkte`, max !== undefined ? { aktuell, max } : { aktuell })
        .then((res) => {
          setMyGroups((prev) =>
            prev.map((g) =>
              g.myCharacterId === charId
                ? { ...g, schicksalspunkteAktuell: res.aktuell, schicksalspunkteMax: res.max }
                : g,
            ),
          );
        })
        .catch(() => {});
    },
    [charId],
  );

  const hydrateBoard = useCallback(
    (board: BoardSettings, tokens: BoardToken[], tiles: Record<string, string>, highlights: Record<string, string>, overlays: BoardOverlay[]) => {
      setBoardSettings(board);
      setBoardTokens(tokens);
      setBoardTiles(tiles);
      setBoardHighlights(highlights);
      setBoardOverlays(overlays);
    },
    [],
  );

  const createToken = useCallback(
    (input: {
      kind: 'character' | 'marker';
      characterId?: number;
      name?: string;
      color?: string;
      icon?: string;
      x: number;
      y: number;
      size?: number;
    }) => {
      sendMsg({ type: 'board.token.create', reqId: crypto.randomUUID(), ...input });
    },
    [sendMsg],
  );

  const updateTokenAction = useCallback(
    (tokenId: number, patch: Partial<Pick<BoardToken, 'name' | 'color' | 'icon' | 'hidden' | 'statuses' | 'cover' | 'size' | 'radius'>>) => {
      sendMsg({ type: 'board.token.update', reqId: crypto.randomUUID(), tokenId, patch });
    },
    [sendMsg],
  );

  const moveTokenAction = useCallback(
    (tokenId: number, x: number, y: number, final?: boolean) => {
      sendMsg({ type: 'board.token.move', reqId: crypto.randomUUID(), tokenId, x, y, final });
    },
    [sendMsg],
  );

  const deleteTokenAction = useCallback(
    (tokenId: number) => {
      sendMsg({ type: 'board.token.delete', reqId: crypto.randomUUID(), tokenId });
    },
    [sendMsg],
  );

  const updateBoardSettingsAction = useCallback(
    (patch: Partial<Pick<BoardSettings, 'permTiles' | 'permLabels' | 'permTokens' | 'permImages' | 'permMove'>>) => {
      sendMsg({ type: 'board.settings.update', reqId: crypto.randomUUID(), patch });
    },
    [sendMsg],
  );

  const paintTilesAction = useCallback(
    (cells: Record<string, string>) => {
      sendMsg({ type: 'board.tiles.paint', reqId: crypto.randomUUID(), cells });
    },
    [sendMsg],
  );

  const paintHighlightsAction = useCallback(
    (cells: Record<string, string>) => {
      sendMsg({ type: 'board.highlights.paint', reqId: crypto.randomUUID(), cells });
    },
    [sendMsg],
  );

  const createOverlayAction = useCallback(
    (kind: 'label', data: BoardOverlay['data']) => {
      sendMsg({ type: 'board.overlay.create', reqId: crypto.randomUUID(), kind, data });
    },
    [sendMsg],
  );

  const updateOverlayAction = useCallback(
    (overlayId: number, patch: Partial<BoardOverlay['data']>) => {
      sendMsg({ type: 'board.overlay.update', reqId: crypto.randomUUID(), overlayId, patch });
    },
    [sendMsg],
  );

  const deleteOverlayAction = useCallback(
    (overlayId: number) => {
      sendMsg({ type: 'board.overlay.delete', reqId: crypto.randomUUID(), overlayId });
    },
    [sendMsg],
  );

  return (
    <DicePanelCtx.Provider
      value={{
        groupId,
        charId,
        myGroups,
        feed,
        connected,
        hasMore,
        loadingMore,
        collapsed,
        toggle,
        ungelesen,
        pulsiert,
        ton,
        setTon,
        tonZuletzt,
        lautstaerke,
        setLautstaerke,
        hidden,
        setHidden,
        serverError,
        modifier,
        setModifier,
        diceCode,
        setDiceCode,
        selectRoom,
        sendChat,
        rollExpr,
        rollProbe,
        confirmDie,
        pendingRequests,
        groupRequests,
        coopPools,
        presenceNotes,
        requestProbe,
        acceptRequest,
        declineRequest,
        cancelRequest,
        requestGroupProbe,
        revealGroupRequest,
        cancelGroupRequest,
        proposeCoopPool,
        joinCoopPool: joinCoopPoolAction,
        leaveCoopPool: leaveCoopPoolAction,
        startCoopPool,
        cancelCoopPool,
        refreshRooms,
        loadMore,
        setSchicksalspunkte,
        boardTokens,
        boardSettings,
        boardTiles,
        boardHighlights,
        boardOverlays,
        hydrateBoard,
        createToken,
        updateToken: updateTokenAction,
        moveToken: moveTokenAction,
        deleteToken: deleteTokenAction,
        updateBoardSettings: updateBoardSettingsAction,
        paintTiles: paintTilesAction,
        paintHighlights: paintHighlightsAction,
        createOverlay: createOverlayAction,
        updateOverlay: updateOverlayAction,
        deleteOverlay: deleteOverlayAction,
      }}
    >
      {children}
    </DicePanelCtx.Provider>
  );
}
