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
import { createPendingRequest, getPendingRequest, pendingRequestsFor, removePendingRequest } from './pendingRolls.js';
import { isGroupMember } from './routes.js';
import { canSeeFeedEntry, insertFeedMessage, insertFeedRoll, loadFeedEntry, updateFeedRoll, type FeedAuthor } from './feed.js';
import { createTokenBucket, type TokenBucket } from './rateLimit.js';

interface SocketMeta {
  userId: number;
  isGm: boolean;
  displayName: string;
  groupId: number;
  rateLimit: TokenBucket;
}

// Burst up to 20 chat/roll messages, refilling at 5/s after — generous for
// normal play (nobody rolls or types that fast by hand) while capping a
// stuck macro or reconnect loop from flooding the permanently-stored feed.
function createMessageRateLimit(): TokenBucket {
  return createTokenBucket({ capacity: 20, refillPerSec: 5 });
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

/** Gezielt an einen Nutzer in dieser Gruppe (er kann mehrere Tabs offen haben). */
function sendToUserInGroup(groupId: number, userId: number, msg: ServerToClientMessage): void {
  const room = rooms.get(groupId);
  if (!room) return;
  for (const ws of room) {
    if (socketMeta.get(ws)?.userId === userId) send(ws, msg);
  }
}

// Wer postet: der Charakter, wenn einer mitgeschickt wurde UND er dem Absender
// gehört (sonst könnte man unter fremdem Namen posten) — sonst das Konto. Der
// kurze Chat-Anzeigename hat Vorrang vor dem vollen Charakternamen.
// Situative Erleichterung(+)/Erschwernis(-), vom Spieler selbst eingetragen
// (Dock, neben VisibilityPicker) — nicht die Bogen-Bestätigung. Trust-based
// wie Sichtbarkeit/Formeln auch; die Klemmung ist nur ein Schutz gegen
// Zahlendreher, kein Anti-Cheat, und der Wert steht sichtbar im Feed-Eintrag.
const MODIFIER_RANGE = 30;
function clampModifier(raw: unknown): number {
  const n = Math.trunc(Number(raw) || 0);
  return Math.max(-MODIFIER_RANGE, Math.min(MODIFIER_RANGE, n));
}

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

  if ((msg.type === 'chat.send' || msg.type.startsWith('roll.')) && !meta.rateLimit.take()) {
    send(ws, { type: 'error', reqId: msg.reqId, message: 'Zu viele Anfragen, bitte kurz warten' });
    return;
  }

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
      const modifier = clampModifier(msg.modifier);
      const result = performProbeRoll(computed.n, computed.probeZahl + modifier);
      const roll: ProbeRollPayload = {
        mode: 'probe',
        source,
        label: computed.label,
        n: computed.n,
        probeZahl: computed.probeZahl + modifier,
        modifier,
        dice: result.dice,
        confirmations: result.confirmations,
        pending: result.pending,
        resolved: result.resolved,
        rawSum: result.rawSum,
        adjustedSum: result.adjustedSum,
        criticalFailureCount: result.criticalFailureCount,
        criticalFailure: result.criticalFailure,
        success: result.success,
        narrow: result.narrow,
        criticalSuccess: result.criticalSuccess,
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
    case 'roll.pending.request': {
      // Nur die Spielleitung fordert Proben an.
      if (!meta.isGm) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Nur die Spielleitung kann eine Probe anfordern' });
        return;
      }
      const source = parseProbeSource(msg.source);
      if (!source) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Unbekannte Probe' });
        return;
      }
      const targetCharId = Number(msg.targetCharId);
      const char = db
        .prepare('SELECT id, name, chat_name, owner_user_id, group_id FROM characters WHERE id = ?')
        .get(targetCharId) as
        | { id: number; name: string; chat_name: string; owner_user_id: number; group_id: number | null }
        | undefined;
      if (!char || char.group_id !== meta.groupId || char.owner_user_id !== Number(msg.targetUserId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Charakter gehört nicht zu dieser Gruppe' });
        return;
      }
      // Nur zur Anzeige in der Karte — gewürfelt wird erst beim Annehmen, und
      // dann gegen die dann aktuellen Werte.
      const computed = computeProbeForCharacter(char.id, source);
      if (!computed) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Eintrag gibt es keine Probe' });
        return;
      }
      const request = createPendingRequest({
        groupId: meta.groupId,
        source,
        label: computed.label,
        gmUserId: meta.userId,
        gmName: meta.displayName,
        targetUserId: char.owner_user_id,
        targetCharId: char.id,
        targetCharName: char.chat_name || char.name,
        onExpire: (expired) => {
          for (const uid of [expired.targetUserId, expired.gmUserId]) {
            sendToUserInGroup(expired.groupId, uid, { type: 'roll.pending.expired', requestId: expired.id });
          }
        },
      });
      // Beide Seiten sehen die Anfrage — der Spieler zum Beantworten, die
      // Spielleitung, damit sie weiß, dass sie noch offen ist.
      for (const uid of [request.targetUserId, request.gmUserId]) {
        sendToUserInGroup(meta.groupId, uid, { type: 'roll.pending.created', request });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.pending.accept': {
      const request = getPendingRequest(String(msg.requestId));
      // Annehmen darf nur der angefragte Spieler selbst.
      if (!request || request.targetUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      // Bewusst NEU rechnen statt den Wert von vorhin zu übernehmen: zwischen
      // Anfrage und Annahme kann sich der Bogen geändert haben.
      const computed = computeProbeForCharacter(request.targetCharId, request.source);
      if (!computed) {
        removePendingRequest(request.id);
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Eintrag gibt es keine Probe' });
        return;
      }
      removePendingRequest(request.id);
      const modifier = clampModifier(msg.modifier);
      const result = performProbeRoll(computed.n, computed.probeZahl + modifier);
      const roll: ProbeRollPayload = {
        mode: 'probe',
        source: request.source,
        label: computed.label,
        n: computed.n,
        probeZahl: computed.probeZahl + modifier,
        modifier,
        dice: result.dice,
        confirmations: result.confirmations,
        pending: result.pending,
        resolved: result.resolved,
        rawSum: result.rawSum,
        adjustedSum: result.adjustedSum,
        criticalFailureCount: result.criticalFailureCount,
        criticalFailure: result.criticalFailure,
        success: result.success,
        narrow: result.narrow,
        criticalSuccess: result.criticalSuccess,
      };
      insertFeedRoll(meta.groupId, resolveAuthor(meta, request.targetCharId), request.gmUserId, 'gm_player', roll);
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.pending.decline': {
      const request = getPendingRequest(String(msg.requestId));
      if (!request || request.targetUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      // Ablehnen schreibt nichts — es gab ja nie einen Datenbank-Eintrag.
      removePendingRequest(request.id);
      for (const uid of [request.targetUserId, request.gmUserId]) {
        sendToUserInGroup(request.groupId, uid, { type: 'roll.pending.declined', requestId: request.id });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    default: {
      // Alle bekannten Typen sind oben abgehandelt — TypeScript hält diesen
      // Zweig deshalb für unerreichbar. Zur Laufzeit ist er es nicht: die
      // Nachricht kam als beliebiges JSON herein.
      const unknown = msg as { reqId?: unknown };
      if (typeof unknown.reqId === 'string') {
        send(ws, { type: 'error', reqId: unknown.reqId, message: 'Unbekannte Anfrage' });
      }
    }
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
      socketMeta.set(ws, { userId: user.id, isGm: user.isGm, displayName: user.displayName, groupId, rateLimit: createMessageRateLimit() });
      let room = rooms.get(groupId);
      if (!room) {
        room = new Set();
        rooms.set(groupId, room);
      }
      room.add(ws);

      // Offene Anfragen nachreichen — wer nach dem Anfragen neu lädt oder die
      // Verbindung verliert, soll die Karte wiedersehen.
      for (const request of pendingRequestsFor(groupId, user.id)) {
        send(ws, { type: 'roll.pending.created', request });
      }

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
