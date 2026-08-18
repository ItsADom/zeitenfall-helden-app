import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ClientToServerMessage,
  FeedEntry,
  PendingRollRequest,
  ProbeSource,
  RollVisibility,
  ServerToClientMessage,
} from '@shared/diceProtocol';
import { apiGet, apiPut } from '../../api';
import { usePersistedState } from '../persist';

const PAGE_SIZE = 30;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function wsUrl(groupId: number): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/groups/${groupId}`;
}

function mergeFeed(existing: FeedEntry[], incoming: FeedEntry[]): FeedEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
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
  /** Rohtext der Würfel-Favoriten dieses Charakters (siehe parseDiceShortcuts). */
  myDiceShortcuts: string;
  /** 0/0 für die Spielleitung (kontolos) oder ein gruppenloser Raum ohne eigenen Charakter. */
  schicksalspunkteAktuell: number;
  schicksalspunkteMax: number;
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
  hidden: boolean;
  setHidden: (h: boolean) => void;
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
  /** Explicit room switch (from the room selector) — the only thing that changes what's displayed and who you post as. */
  selectRoom: (groupId: number) => void;
  sendChat: (raw: string) => void;
  rollExpr: (expression: string, visibility: RollVisibility, label?: string) => void;
  /**
   * Probe vom Charakterbogen. Wechselt bei Bedarf in den Raum dieser Gruppe
   * (ein Wurf ist eine bewusste Handlung — anders als bloßes Blättern) und
   * klappt den Dock auf, damit Ergebnis und Reaktion sichtbar sind.
   */
  rollProbe: (groupId: number, charId: number, source: ProbeSource, visibility: RollVisibility) => void;
  /** Offenen Bestätigungswurf erledigen — werfen, oder mit skip verwerfen. */
  confirmDie: (entryId: number, dieIndex: number, skip?: boolean) => void;
  /** Offene „SL + Spieler"-Anfragen, die diesen Nutzer betreffen. */
  pendingRequests: PendingRollRequest[];
  /** Spielleitung fordert eine bestimmte Probe von einem Spieler an. */
  requestProbe: (groupId: number, targetUserId: number, targetCharId: number, source: ProbeSource) => void;
  acceptRequest: (requestId: string) => void;
  declineRequest: (requestId: string) => void;
  /** Reload the room list (names, posting-as character, dice shortcuts) after an edit elsewhere. */
  refreshRooms: () => void;
  loadMore: () => void;
  /**
   * Schicksalspunkte des aktuell postenden Charakters ändern (nicht Teil des
   * Wurf-Protokolls — reine Charakterdaten, siehe PUT .../schicksalspunkte).
   * `max` weglassen, um nur `aktuell` zu setzen.
   */
  setSchicksalspunkte: (aktuell: number, max?: number) => void;
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
      hidden: false,
      setHidden: () => {},
      modifier: 0,
      setModifier: () => {},
      selectRoom: () => {},
      sendChat: () => {},
      rollExpr: () => {},
      rollProbe: () => {},
      confirmDie: () => {},
      pendingRequests: [],
      requestProbe: () => {},
      acceptRequest: () => {},
      declineRequest: () => {},
      refreshRooms: () => {},
      loadMore: () => {},
      setSchicksalspunkte: () => {},
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
  const [hidden, setHidden] = useState(false);
  const [modifier, setModifier] = usePersistedState<number>('dice:modifier', 0);
  const [pendingRequests, setPendingRequests] = useState<PendingRollRequest[]>([]);
  const [persistedRoom, setPersistedRoom] = usePersistedState<number | null>('dice:room', null);

  const wsRef = useRef<WebSocket | null>(null);
  const groupIdRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const liveBufferRef = useRef<FeedEntry[]>([]);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  // Nachrichten, die abgeschickt wurden, während die Verbindung (noch) nicht
  // stand — vor allem beim Würfeln vom Bogen, das erst den Raum wechselt.
  const outboxRef = useRef<ClientToServerMessage[]>([]);

  const sendMsg = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else outboxRef.current.push(msg);
  }, []);

  const connect = useCallback((gid: number) => {
    bufferingRef.current = true;
    liveBufferRef.current = [];
    intentionalCloseRef.current = false;
    const ws = new WebSocket(wsUrl(gid));
    wsRef.current = ws;

    ws.onopen = () => {
      apiGet<{ entries: FeedEntry[]; hasMore: boolean }>(`/api/groups/${gid}/feed?limit=${PAGE_SIZE}`)
        .then((page) => {
          if (wsRef.current !== ws) return; // superseded by a newer connection
          setFeed((prev) => mergeFeed(prev, mergeFeed(page.entries, liveBufferRef.current)));
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
        // Eine Anfrage will gesehen werden — Dock aufklappen.
        setPendingRequests((prev) => [...prev.filter((r) => r.id !== msg.request.id), msg.request]);
        setCollapsed(false);
        return;
      }
      if (msg.type === 'roll.pending.expired' || msg.type === 'roll.pending.declined') {
        setPendingRequests((prev) => prev.filter((r) => r.id !== msg.requestId));
        return;
      }
      // append und update laufen beide durch mergeFeed (dedupliziert nach id),
      // ein Update ersetzt den vorhandenen Eintrag also einfach.
      if (msg.type !== 'feed.append' && msg.type !== 'feed.update') return;
      // Ein angenommener Wurf erledigt seine Anfrage — die Karte kann weg.
      if (msg.type === 'feed.append' && msg.entry.kind === 'roll' && msg.entry.visibility === 'gm_player') {
        setPendingRequests((prev) => prev.filter((r) => r.targetCharId !== msg.entry.authorCharId));
      }
      if (bufferingRef.current) {
        liveBufferRef.current.push(msg.entry);
      } else {
        setFeed((prev) => mergeFeed(prev, [msg.entry]));
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current !== ws) return; // already superseded
      if (intentionalCloseRef.current) return;
      const delay = reconnectDelayRef.current * (0.8 + Math.random() * 0.4);
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, RECONNECT_MAX_MS);
      reconnectTimerRef.current = setTimeout(() => connect(gid), delay);
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
      reconnectDelayRef.current = RECONNECT_BASE_MS;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
      connect(option.id);
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
    (expression: string, visibility: RollVisibility, label = '') => {
      sendMsg({ type: 'roll.expr', reqId: crypto.randomUUID(), label, expression, visibility, charId });
    },
    [charId, sendMsg],
  );

  const rollProbe = useCallback(
    (forGroupId: number, forCharId: number, source: ProbeSource, visibility: RollVisibility) => {
      // Ein Wurf vom Bogen gehört in den Raum DIESER Gruppe, als DIESER
      // Charakter — notfalls wird dorthin gewechselt (die Nachricht wartet
      // dann in der Outbox auf die neue Verbindung).
      if (groupIdRef.current !== forGroupId) {
        const option = myGroups.find((g) => g.id === forGroupId);
        if (option) applyRoom(option);
      }
      setCollapsed(false); // Ergebnis soll man auch sehen
      sendMsg({
        type: 'roll.probe',
        reqId: crypto.randomUUID(),
        source,
        charId: forCharId,
        visibility: visibility === 'hidden' ? 'hidden' : 'public',
        modifier,
      });
      // Gilt nur für DIESEN einen Wurf — mehrere modifizierte Würfe hinter-
      // einander sind selten, ein vergessener Modifikator, der beim nächsten
      // Klick unbemerkt weiterwirkt, wäre schlimmer als ihn neu einzutippen.
      if (modifier !== 0) setModifier(0);
    },
    [myGroups, applyRoom, sendMsg, modifier, setModifier],
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
      setCollapsed(false);
      sendMsg({ type: 'roll.pending.request', reqId: crypto.randomUUID(), source, targetUserId, targetCharId });
    },
    [myGroups, applyRoom, sendMsg, setCollapsed],
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

  const loadMore = useCallback(() => {
    if (groupId === null || loadingMore || !hasMore || feed.length === 0) return;
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
        toggle: () => setCollapsed((v) => !v),
        hidden,
        setHidden,
        modifier,
        setModifier,
        selectRoom,
        sendChat,
        rollExpr,
        rollProbe,
        confirmDie,
        pendingRequests,
        requestProbe,
        acceptRequest,
        declineRequest,
        refreshRooms,
        loadMore,
        setSchicksalspunkte,
      }}
    >
      {children}
    </DicePanelCtx.Provider>
  );
}
