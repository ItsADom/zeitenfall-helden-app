import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ClientToServerMessage, FeedEntry, ServerToClientMessage } from '@shared/diceProtocol';
import { apiGet } from '../../api';
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
  /** Explicit room switch (from the room selector) — the only thing that changes what's displayed and who you post as. */
  selectRoom: (groupId: number) => void;
  sendChat: (raw: string) => void;
  loadMore: () => void;
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
      selectRoom: () => {},
      sendChat: () => {},
      loadMore: () => {},
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
  const [collapsed, toggleCollapsed] = usePersistedState<boolean>('dice:collapsed', true);
  const [hidden, setHidden] = useState(false);
  const [persistedRoom, setPersistedRoom] = usePersistedState<number | null>('dice:room', null);

  const wsRef = useRef<WebSocket | null>(null);
  const groupIdRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const liveBufferRef = useRef<FeedEntry[]>([]);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

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
      if (msg.type !== 'feed.append') return;
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
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const isMe = raw.startsWith('/me ');
      const text = isMe ? raw.slice(4).trim() : raw.trim();
      if (!text) return;
      const msg: ClientToServerMessage = {
        type: 'chat.send',
        reqId: crypto.randomUUID(),
        text,
        isMe,
        charId,
      };
      ws.send(JSON.stringify(msg));
    },
    [charId],
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
        toggle: () => toggleCollapsed((v) => !v),
        hidden,
        setHidden,
        selectRoom,
        sendChat,
        loadMore,
      }}
    >
      {children}
    </DicePanelCtx.Provider>
  );
}
