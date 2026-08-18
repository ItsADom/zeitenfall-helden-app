// WebSocket infra for the group feed (chat + dice rolls). Scoped to this
// feature only — Group.tsx/GroupOverview.tsx stay on their existing polling,
// see docs/concepts/dice-rolls-and-chat.md for why.
import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ClientToServerMessage, FeedEntry, ServerToClientMessage } from 'shared';
import { getSessionToken, userForToken } from './auth.js';
import { db } from './db.js';
import { isGroupMember } from './routes.js';
import { canSeeFeedEntry, insertFeedMessage } from './feed.js';

interface SocketMeta {
  userId: number;
  isGm: boolean;
  displayName: string;
  groupId: number;
}

const rooms = new Map<number, Set<WebSocket>>();
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

function send(ws: WebSocket, msg: ServerToClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function broadcastToGroup(groupId: number, entry: FeedEntry): void {
  const room = rooms.get(groupId);
  if (!room) return;
  for (const ws of room) {
    const meta = socketMeta.get(ws);
    if (!meta) continue;
    if (!canSeeFeedEntry(entry, { userId: meta.userId })) continue;
    send(ws, { type: 'feed.append', entry });
  }
}

function handleMessage(ws: WebSocket, raw: RawData): void {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  let msg: ClientToServerMessage;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.reqId !== 'string') return;

  switch (msg.type) {
    case 'chat.send': {
      const text = String(msg.text ?? '').slice(0, 2000).trim();
      if (!text) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Leere Nachricht' });
        return;
      }
      const charId = msg.charId != null ? Number(msg.charId) : null;
      // Posting as a character shows ITS name (e.g. "/me baut eine Sandburg"
      // -> "Raskir baut eine Sandburg"), not the account's display name. Only
      // trusts a charId the sender actually owns.
      let authorName = meta.displayName;
      if (charId != null) {
        const char = db
          .prepare('SELECT name, chat_name FROM characters WHERE id = ? AND owner_user_id = ?')
          .get(charId, meta.userId) as { name: string; chat_name: string } | undefined;
        if (char) authorName = char.chat_name || char.name;
      }
      insertFeedMessage(meta.groupId, { userId: meta.userId, charId, name: authorName }, text, !!msg.isMe);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    // roll.expr / roll.probe / roll.pending.* land here in later build-plan phases.
    default:
      send(ws, { type: 'error', reqId: msg.reqId, message: 'Noch nicht implementiert' });
  }
}

export function attachWsServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = /^\/ws\/groups\/(\d+)$/.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const groupId = Number(match[1]);

    // getSessionToken only reads req.headers.cookie — an upgrade request has
    // the same shape as an Express Request there, just not the same TS type.
    const token = getSessionToken(req as unknown as Parameters<typeof getSessionToken>[0]);
    const user = token ? userForToken(token) : null;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const groupExists = !!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId);
    if (!groupExists || (!user.isGm && !isGroupMember(user.id, groupId))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      socketMeta.set(ws, { userId: user.id, isGm: user.isGm, displayName: user.displayName, groupId });
      let room = rooms.get(groupId);
      if (!room) {
        room = new Set();
        rooms.set(groupId, room);
      }
      room.add(ws);

      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30_000);

      ws.on('close', () => {
        clearInterval(heartbeat);
        room?.delete(ws);
        if (room && room.size === 0) rooms.delete(groupId);
        socketMeta.delete(ws);
      });
      ws.on('message', (data) => handleMessage(ws, data));
    });
  });
}
