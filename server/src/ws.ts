// WebSocket infra for the group feed (chat + dice rolls). Scoped to this
// feature only — Group.tsx/GroupOverview.tsx stay on their existing polling,
// see docs/concepts/dice-rolls-and-chat.md for why.
import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ClientToServerMessage, ExpressionRollPayload, FeedEntry, ProbeRollPayload, ServerToClientMessage } from 'shared';
import type { RolledConfirmation } from 'shared';
import { parseDiceExpression, resolveExpressionRoll, resolveProbeRoll } from 'shared';
import { getSessionToken, userForToken } from './auth.js';
import { db } from './db.js';
import { performExpressionRoll, performProbeRoll, rollD20 } from './dice.js';
import { computeProbeForCharacter, parseProbeSource } from './diceSource.js';
import { isGroupMember } from './routes.js';
import { canSeeFeedEntry, insertFeedMessage, insertFeedRoll, loadFeedEntry, updateFeedRoll, type FeedAuthor } from './feed.js';

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

function broadcast(groupId: number, entry: FeedEntry, type: 'feed.append' | 'feed.update'): void {
  const room = rooms.get(groupId);
  if (!room) return;
  for (const ws of room) {
    const meta = socketMeta.get(ws);
    if (!meta) continue;
    if (!canSeeFeedEntry(entry, { userId: meta.userId })) continue;
    send(ws, { type, entry } as ServerToClientMessage);
  }
}

export function broadcastToGroup(groupId: number, entry: FeedEntry): void {
  broadcast(groupId, entry, 'feed.append');
}

/** Geänderter Bestandseintrag (nachgereichte Bestätigung) statt neuer Zeile. */
export function broadcastUpdateToGroup(groupId: number, entry: FeedEntry): void {
  broadcast(groupId, entry, 'feed.update');
}

// Wer postet: der Charakter, wenn einer mitgeschickt wurde UND er dem Absender
// gehört (sonst könnte man unter fremdem Namen posten) — sonst das Konto. Der
// kurze Chat-Anzeigename hat Vorrang vor dem vollen Charakternamen.
function resolveAuthor(meta: SocketMeta, rawCharId: unknown): FeedAuthor {
  const charId = rawCharId != null ? Number(rawCharId) : null;
  if (charId != null) {
    const char = db
      .prepare('SELECT name, chat_name FROM characters WHERE id = ? AND owner_user_id = ?')
      .get(charId, meta.userId) as { name: string; chat_name: string } | undefined;
    if (char) return { userId: meta.userId, charId, name: char.chat_name || char.name };
  }
  return { userId: meta.userId, charId: null, name: meta.displayName };
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
      // Posting as a character shows ITS name (e.g. "/me baut eine Sandburg"
      // -> "Raskir baut eine Sandburg"), not the account's display name.
      insertFeedMessage(meta.groupId, resolveAuthor(meta, msg.charId), text, !!msg.isMe);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.expr': {
      const expression = parseDiceExpression(String(msg.expression ?? ''));
      if (!expression) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültiger Würfelausdruck' });
        return;
      }
      // 'gm_player' braucht ein Gegenüber und eine Anfrage — freie Würfe
      // kennen beides nicht (kommt mit dem GM+Spieler-Fluss in Phase 6).
      const visibility = msg.visibility === 'hidden' ? 'hidden' : 'public';
      const result = performExpressionRoll(expression);
      const roll: ExpressionRollPayload = {
        mode: 'expr',
        label: String(msg.label ?? '').slice(0, 60).trim(),
        expression: result.expression,
        dice: result.dice,
        confirmations: result.confirmations,
        pending: result.pending,
        resolved: result.resolved,
        rawSum: result.rawSum,
        adjustedSum: result.adjustedSum,
        flagged: result.flagged,
      };
      insertFeedRoll(meta.groupId, resolveAuthor(meta, msg.charId), null, visibility, roll);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.probe': {
      const source = parseProbeSource(msg.source);
      if (!source) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Unbekannte Probe' });
        return;
      }
      // Nur eigene Charaktere, und nur in der Gruppe dieses Feeds — sonst
      // könnte man über eine fremde Gruppe hinweg würfeln lassen.
      const charId = Number(msg.charId);
      const char = db
        .prepare('SELECT id, name, chat_name, group_id FROM characters WHERE id = ? AND owner_user_id = ?')
        .get(charId, meta.userId) as { id: number; name: string; chat_name: string; group_id: number | null } | undefined;
      if (!char || char.group_id !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Charakter gehört nicht zu dieser Gruppe' });
        return;
      }
      // Die Probe-Zahl wird IMMER hier neu berechnet, nie vom Client
      // übernommen — sonst ließe sich gegen eine erfundene Schwelle würfeln.
      const computed = computeProbeForCharacter(char.id, source);
      if (!computed) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Eintrag gibt es keine Probe' });
        return;
      }
      const visibility = msg.visibility === 'hidden' ? 'hidden' : 'public';
      const result = performProbeRoll(computed.n, computed.probeZahl);
      const roll: ProbeRollPayload = {
        mode: 'probe',
        source,
        label: computed.label,
        n: computed.n,
        probeZahl: computed.probeZahl,
        dice: result.dice,
        confirmations: result.confirmations,
        pending: result.pending,
        resolved: result.resolved,
        rawSum: result.rawSum,
        adjustedSum: result.adjustedSum,
        criticalFailureCount: result.criticalFailureCount,
        criticalFailure: result.criticalFailure,
        success: result.success,
      };
      insertFeedRoll(meta.groupId, resolveAuthor(meta, char.id), null, visibility, roll);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.confirm': {
      const loaded = loadFeedEntry(Number(msg.entryId));
      if (!loaded || loaded.entry.kind !== 'roll' || loaded.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Wurf nicht gefunden' });
        return;
      }
      // Nur der Werfer selbst bestätigt — auch die Spielleitung nicht.
      if (loaded.entry.authorUserId !== meta.userId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Nur der Werfer kann bestätigen' });
        return;
      }
      const roll = loaded.entry.roll;
      const dieIndex = Number(msg.dieIndex);
      if (!roll.pending.some((p) => p.dieIndex === dieIndex)) {
        // Schon erledigt (oder nie offen gewesen) — z. B. doppelt geklickt.
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Würfel steht nichts mehr aus' });
        return;
      }
      const done: RolledConfirmation[] = [
        ...roll.confirmations.map((c) => ({ dieIndex: c.dieIndex, value: c.value })),
        { dieIndex, value: msg.skip ? null : rollD20() },
      ];
      const next =
        roll.mode === 'probe'
          ? { ...roll, ...resolveProbeRoll(roll.dice, done, roll.probeZahl) }
          : { ...roll, ...resolveExpressionRoll(roll.expression, roll.dice, done) };
      updateFeedRoll(loaded.entry.id, meta.groupId, next);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    // roll.pending.* lands here in a later build-plan phase.
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
