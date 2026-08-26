// WebSocket infra for the group feed (chat + dice rolls). Scoped to this
// feature only — Group.tsx/GroupOverview.tsx stay on their existing polling,
// see docs/concepts/dice-rolls-and-chat.md for why.
import type http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  BoardOverlay,
  BoardToken,
  CellCoord,
  ClientToServerMessage,
  LabelOverlayData,
  MeasureOverlayData,
  CoopPoolRequest,
  ExpressionRollPayload,
  FeedEntry,
  GroupRollRequest,
  ProbeRollPayload,
  RollVisibility,
  ServerToClientMessage,
} from 'shared';
import type { RolledConfirmation } from 'shared';
import { BOARD_COVER_BY_KEY, BOARD_STATUS_BY_KEY, MASTER_TABLE, WILD_MAGIC_TABLE, cellKey, overlayCell, parseCellKey, parseDiceExpression, parseTileValue, resolveExpressionRoll, resolveProbeRoll, tokenCells, type DiceExpression } from 'shared';
import { getSessionToken, userForToken } from './auth.js';
import { db } from './db.js';
import { performExpressionRoll, performProbeRoll, rollD20 } from './dice.js';
import { computeProbeForCharacter, parseProbeSource } from './diceSource.js';
import {
  canEditFog as boardCanEditFog,
  canEditTokens as boardCanEditTokens,
  canHighlightTiles as boardCanHighlightTiles,
  canLabel as boardCanLabel,
  canMeasure as boardCanMeasure,
  canMoveToken as boardCanMoveToken,
  canPaint as boardCanPaint,
} from './boardAccess.js';
import {
  type BoardOverlayRow,
  type BoardRow,
  type BoardTokenRow,
  type BoardViewer,
  createOverlay as createBoardOverlay,
  createToken as createBoardToken,
  deleteOverlay as deleteBoardOverlay,
  deleteToken as deleteBoardToken,
  fogSet,
  getOrCreateBoard,
  getOverlay as getBoardOverlay,
  getToken as getBoardToken,
  labelVisibleTo,
  loadOverlays as loadBoardOverlays,
  loadTokens as loadBoardTokens,
  moveToken as moveBoardToken,
  paintHighlights as paintBoardHighlights,
  paintTiles as paintBoardTiles,
  redactCells,
  setFog as setBoardFog,
  tokenVisibleTo,
  updateBoardSettings,
  updateOverlay as updateBoardOverlay,
  updateToken as updateBoardToken,
} from './board.js';
import {
  createPendingRequest,
  getPendingRequest,
  pendingRequestsFor,
  removePendingRequest,
  removePendingRequestsForGroup,
} from './pendingRolls.js';
import {
  cancelGroupRollRequest,
  createGroupRollRequest,
  dropGroupMember,
  forceRevealGroup,
  getGroupRollRequest,
  groupRollRequestsFor,
  holdGroupResult,
  type HeldResult,
} from './groupRolls.js';
import {
  coopPoolsFor,
  createCoopPool,
  getCoopPool,
  joinCoopPool,
  leaveCoopPool,
  removeCoopPool,
} from './coopPools.js';
import { isRoomMember } from './routes.js';
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

// Keyed by user, not by connection: a plain per-socket bucket would refill
// to a full burst on every reconnect, which is exactly the "reconnect loop"
// case the limiter is meant to guard against. Small, bounded by distinct
// users of this self-hosted app — never cleaned up, same tradeoff as `rooms`.
const userRateLimits = new Map<number, TokenBucket>();
function rateLimitFor(userId: number): TokenBucket {
  let bucket = userRateLimits.get(userId);
  if (!bucket) {
    bucket = createMessageRateLimit();
    userRateLimits.set(userId, bucket);
  }
  return bucket;
}

// Rate-limited by default; nothing is currently exempt. Explicit opt-out
// list instead of an allow-list match on msg.type, so a future message type
// can't silently skip the limiter just because it doesn't start with 'roll.'.
const RATE_LIMIT_EXEMPT: ReadonlySet<ClientToServerMessage['type']> = new Set();

const rooms = new Map<number, Set<WebSocket>>();
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

// Wann ein Nutzer zuletzt aus einem Raum verschwand (seine letzte Socket dort
// schloss) — Grundlage für die „X ist beigetreten"-Ansage: kommt dieselbe
// Person innerhalb von RECONNECT_GRACE_MS zurück, war das vermutlich nur ein
// WLAN-Ruckler/Reconnect, keine echte Rückkehr, und bleibt still. Klein und
// an distinct (groupId, userId)-Paare gebunden — nie aufgeräumt, derselbe
// Kompromiss wie bei userRateLimits oben.
const lastLeftRoom = new Map<string, number>();
const RECONNECT_GRACE_MS = 60_000;
function leftKey(groupId: number, userId: number): string {
  return `${groupId}:${userId}`;
}

/** Whether any cell this token occupies is in `cellSet` — used by the fog-reveal/-hide sweep below. */
function tokenCellsIntersect(token: BoardTokenRow, cellSet: ReadonlySet<string>): boolean {
  return tokenCells(token).some((c) => cellSet.has(cellKey(c.x, c.y)));
}

function toWireToken(row: BoardTokenRow): BoardToken {
  return {
    id: row.id,
    boardId: row.boardId,
    kind: row.kind === 'character' ? 'character' : 'marker',
    characterId: row.characterId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    color: row.color,
    icon: row.icon,
    x: row.x,
    y: row.y,
    size: row.size,
    radius: row.radius,
    radiusColor: row.radiusColor,
    hidden: row.hidden,
    statuses: row.statuses,
    cover: row.cover,
    portrait: row.portrait,
    sort: row.sort,
  };
}

// `data` is trusted here — it only ever reaches board_overlays through
// createBoardOverlay/updateBoardOverlay above, both of which already build
// it from validated fields, never from an unchecked client payload.
function toWireOverlay(row: BoardOverlayRow): BoardOverlay {
  if (row.kind === 'measure') {
    return { id: row.id, boardId: row.boardId, kind: 'measure', data: row.data as MeasureOverlayData, hidden: row.hidden };
  }
  return { id: row.id, boardId: row.boardId, kind: 'label', data: row.data as LabelOverlayData, hidden: row.hidden };
}

// Every field checked and clamped to the board — a hand-crafted WS message
// could otherwise plant an out-of-bounds or non-finite coordinate. Returns
// null for anything that doesn't match one of the four known shapes rather
// than rejecting the whole message elsewhere, same tolerance style as
// parseTileValue.
function measurePoint(raw: unknown, board: BoardRow): CellCoord | null {
  const p = raw as Record<string, unknown> | null;
  if (!p) return null;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(board.cols, Math.max(0, x)), y: Math.min(board.rows, Math.max(0, y)) };
}
// Optional, per-shape, never required — unset means the plain default look.
// Same tolerant style as the rest of this validator: silently drop what
// doesn't look right rather than rejecting the whole message over it.
// Returns BOTH keys always, even as `undefined` — `updateOverlay()` (board.ts)
// shallow-merges the returned data onto the existing row (`{...existing,
// ...patch}`), so a key that's simply ABSENT here would leave a stale
// label/color from a previous edit in place forever. An explicit `undefined`
// property still overwrites in the spread (and JSON.stringify then drops it,
// same as never having been set) — that's the only way "clear the label
// field" can ever take effect.
function measureLabelColor(d: Record<string, unknown>): { label: string | undefined; color: string | undefined } {
  const label = typeof d.label === 'string' && d.label.trim() !== '' ? d.label.slice(0, 60).trim() : undefined;
  const color = typeof d.color === 'string' && parseTileValue(d.color)?.kind === 'color' ? d.color : undefined;
  return { label, color };
}
function validateMeasureData(raw: unknown, board: BoardRow): MeasureOverlayData | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || typeof d.kind !== 'string') return null;
  const extra = measureLabelColor(d);
  if (d.kind === 'ruler' || d.kind === 'rectangle') {
    const from = measurePoint(d.from, board);
    const to = measurePoint(d.to, board);
    if (!from || !to) return null;
    return { kind: d.kind, from, to, ...extra };
  }
  if (d.kind === 'circle') {
    const origin = measurePoint(d.origin, board);
    const radius = Number(d.radius);
    if (!origin || !Number.isFinite(radius)) return null;
    return { kind: 'circle', origin, radius: Math.min(50, Math.max(0, radius)), ...extra };
  }
  if (d.kind === 'cone') {
    const origin = measurePoint(d.origin, board);
    const angle = Number(d.angle);
    const length = Number(d.length);
    // Per-shape opening angle, not a fixed constant — clamped to a sane
    // wedge range (a 0° cone is a ruler, >180° stops reading as a cone).
    const spread = Number(d.spread);
    if (!origin || !Number.isFinite(angle) || !Number.isFinite(length) || !Number.isFinite(spread)) return null;
    return {
      kind: 'cone',
      origin,
      angle: ((angle % 360) + 360) % 360,
      length: Math.min(50, Math.max(0, length)),
      spread: Math.min(180, Math.max(1, spread)),
      ...extra,
    };
  }
  return null;
}

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

/**
 * An JEDEN in der Gruppe, ungefiltert — anders als broadcast()/broadcastToGroup()
 * kennt eine Kooperationsprobe-Pool-Nachricht keine Feed-Sichtbarkeitsregeln
 * (canSeeFeedEntry): der ganze Witz eines offenen, selbstbedienten Pools ist,
 * dass alle ihn sehen und beitreten können.
 */
function broadcastUngefiltert(groupId: number, msg: ServerToClientMessage): void {
  const room = rooms.get(groupId);
  if (!room) return;
  for (const ws of room) send(ws, msg);
}

/**
 * Per-viewer broadcast — `build` runs once per connected socket and decides
 * what (if anything) THAT viewer gets; returning null sends nothing. This is
 * the fog/hidden-token counterpart to broadcastUngefiltert() above: every
 * board.* case that can carry redactable content (tiles, tokens, labels)
 * goes through this instead, consulting the pure redaction helpers in
 * board.ts (fogSet/tokenVisibleTo/labelVisibleTo/redactCells) inside its
 * builder. See "Realtime design" in the plan.
 */
function broadcastBuilt(groupId: number, build: (viewer: BoardViewer) => ServerToClientMessage | null): void {
  const room = rooms.get(groupId);
  if (!room) return;
  for (const ws of room) {
    const meta = socketMeta.get(ws);
    if (!meta) continue;
    const msg = build({ userId: meta.userId, isGm: meta.isGm });
    if (msg) send(ws, msg);
  }
}

/**
 * To EVERY room at once — the only message without a group: the instance is
 * about to restart, which concerns everyone. Deliberately its own function
 * rather than a special case inside broadcastUngefiltert(), so that skipping the
 * room boundary stays visible in the signature.
 *
 * Anyone who has never picked a room holds no socket and gets no warning. For
 * them it stays a few seconds of unavailability — accepted, rather than
 * building a second notification channel for it.
 */
export function broadcastWartung(durch: string): void {
  const msg: ServerToClientMessage = { type: 'wartung.angekuendigt', durch };
  for (const room of rooms.values()) {
    for (const ws of room) send(ws, msg);
  }
}

/**
 * Nach einem GM-Reset auf der GM-Übersicht (REST, eigene Session) an den
 * Charakterbesitzer pushen — sonst zeigt dessen Dock den alten Stand, bis
 * er neu lädt (die Klee-Buttons blieben fälschlich deaktiviert).
 */
export function pushSchicksalspunkte(groupId: number, ownerUserId: number, charId: number, aktuell: number, max: number): void {
  sendToUserInGroup(groupId, ownerUserId, { type: 'schicksalspunkte.update', charId, aktuell, max });
}

// Wer postet: der Charakter, wenn einer mitgeschickt wurde UND er dem Absender
// gehört UND zu dieser Gruppe gehört (sonst könnte man unter fremdem Namen
// oder mit einem Charakter aus einer anderen Gruppe posten) — sonst das
// Konto. Der kurze Chat-Anzeigename hat Vorrang vor dem vollen Charakternamen.
// Situative Erleichterung(-)/Erschwernis(+), vom Spieler selbst eingetragen
// (Dock, neben VisibilityPicker) — nicht die Bogen-Bestätigung. Wirkt auf die
// GEWORFENE Summe, nicht auf probeZahl (siehe resolveProbeRoll in
// shared/src/dice.ts): man unterwürfelt den Zielwert, also erschwert ein
// positiver Wert. Trust-based wie Sichtbarkeit/Formeln auch; die Klemmung ist
// nur ein Schutz gegen Zahlendreher, kein Anti-Cheat, und der Wert steht
// sichtbar im Feed-Eintrag.
const MODIFIER_RANGE = 30;
function clampModifier(raw: unknown): number {
  const n = Math.trunc(Number(raw) || 0);
  return Math.max(-MODIFIER_RANGE, Math.min(MODIFIER_RANGE, n));
}

/**
 * 'gm_player'-Sichtbarkeit für einen freien Wurf (kein Anfrage-Fluss): wer
 * neben dem Werfer selbst noch mitliest. Ein Spieler wählt das Gegenüber
 * NICHT selbst — sonst könnte er sich einen beliebigen Mitspieler als
 * heimlichen Zeugen aussuchen; stattdessen zählt die (einzige) gerade in
 * diesem Raum verbundene Spielleitung. Die Spielleitung wählt umgekehrt
 * gezielt EIN Gruppenmitglied (`msg.targetUserId`). Ergebnis geht als
 * `gmUserId` in `insertFeedRoll`/`canSeeFeedEntry` — bei einem GM-Wurf trägt
 * das Feld also die ID des ZIELSPIELERS, nicht der Spielleitung; die
 * Prüfung selbst ist rollenblind (siehe feed.ts), das funktioniert trotzdem.
 * `null` heißt: kein gültiges Gegenüber gefunden.
 */
function resolveGmPlayerCounterpart(meta: SocketMeta, rawTargetUserId: unknown): number | null {
  if (meta.isGm) {
    const targetUserId = Number(rawTargetUserId);
    if (!targetUserId || !isRoomMember(targetUserId, meta.groupId)) return null;
    return targetUserId;
  }
  const room = rooms.get(meta.groupId);
  if (!room) return null;
  for (const socket of room) {
    const socketAuthor = socketMeta.get(socket);
    if (socketAuthor?.isGm) return socketAuthor.userId;
  }
  return null;
}

/**
 * Ob dieser Charakter zu diesem Raum gehört — fest über characters.group_id
 * ODER additiv über temp_group_members (Event-Gruppe). Die beiden schließen
 * sich in der Praxis gegenseitig aus (ein group_id zeigt nie auf eine Event-
 * Gruppe, kein Charakter landet je additiv in seiner eigenen festen Gruppe),
 * ein simples ODER reicht also, ohne wissen zu müssen, welche Art Raum das ist.
 */
function charBelongsToRoom(charId: number, groupId: number): boolean {
  return (
    !!db.prepare('SELECT 1 FROM characters WHERE id = ? AND group_id = ?').get(charId, groupId) ||
    !!db.prepare('SELECT 1 FROM temp_group_members WHERE character_id = ? AND temp_group_id = ?').get(charId, groupId)
  );
}

function resolveAuthor(meta: SocketMeta, rawCharId: unknown): FeedAuthor {
  const charId = rawCharId != null ? Number(rawCharId) : null;
  if (charId != null) {
    const char = db.prepare('SELECT name, chat_name FROM characters WHERE id = ? AND owner_user_id = ?').get(charId, meta.userId) as
      | { name: string; chat_name: string }
      | undefined;
    if (char && charBelongsToRoom(charId, meta.groupId)) return { userId: meta.userId, charId, name: char.chat_name || char.name };
  }
  return { userId: meta.userId, charId: null, name: meta.displayName };
}

/**
 * Der eigene Charakter des Absenders in DIESER Gruppe — anders als
 * resolveAuthor() (die bei einem ungültigen charId stillschweigend auf „kein
 * Charakter" zurückfällt) hier ein hartes null, denn eine Kooperationsprobe
 * ohne echten Charakter dahinter ergibt keinen Sinn (propose/join).
 */
function resolveOwnCharacter(
  meta: SocketMeta,
  rawCharId: unknown,
): { id: number; name: string; chat_name: string } | null {
  const charId = Number(rawCharId);
  if (!charId) return null;
  const char = db.prepare('SELECT id, name, chat_name FROM characters WHERE id = ? AND owner_user_id = ?').get(charId, meta.userId) as
    | { id: number; name: string; chat_name: string }
    | undefined;
  if (!char || !charBelongsToRoom(charId, meta.groupId)) return null;
  return char;
}

// Veröffentlicht die zurückgehaltenen Ergebnisse einer Gruppen-Sammelanfrage
// (siehe groupRolls.ts) — jetzt PUBLIC statt 'gm_player' wie bei der
// einzelnen SL+Spieler-Anfrage: der ganze Witz einer Sammelanfrage ist ja,
// dass alle Ergebnisse gemeinsam sichtbar werden. Eine „/me"-Kopfzeile
// bündelt sie im Feed sichtbar unter der angefragten Probe, statt sie
// unbeschriftet zwischen den Chat-Zeilen stehen zu lassen. `order` bestimmt
// die Reihenfolge; ein Charakter ohne Eintrag in `held` (vorzeitig
// aufgedeckt, nie geantwortet) wird stillschweigend übersprungen — bei
// NIEMANDEM etwas Zurückgehaltenem (reines Verwerfen) bleibt auch die
// Kopfzeile weg.
function revealGroupResults(request: GroupRollRequest, order: number[], held: Map<number, HeldResult>): void {
  if (held.size > 0) {
    insertFeedMessage(
      request.groupId,
      { userId: request.gmUserId, charId: null, name: request.gmName },
      `fordert eine Gruppenprobe an: ${request.label}`,
      true,
    );
  }
  for (const charId of order) {
    const entry = held.get(charId);
    if (!entry) continue;
    // groupRollId (request.id) markiert nur die WÜRFE/PÄSSE selbst, nicht die
    // Kopfzeile — die zieht ihre eigene, unverwechselbare Optik schon aus der
    // „/me"-Formatierung.
    if (entry.kind === 'roll') insertFeedRoll(request.groupId, entry.author, null, 'public', entry.roll, request.id);
    else insertFeedMessage(request.groupId, entry.author, 'hat gepasst.', true, request.id);
  }
  sendToUserInGroup(request.groupId, request.gmUserId, { type: 'roll.group.revealed', requestId: request.id });
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
  if (!msg || typeof msg !== 'object' || typeof msg.reqId !== 'string' || typeof msg.type !== 'string') return;

  if (!RATE_LIMIT_EXEMPT.has(msg.type) && !meta.rateLimit.take()) {
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
      // „/master"/„/wild": Würfel UND Ergebnistext kommen komplett vom
      // Server, nie vom Client — sonst könnte sich ein manipulierter Client
      // sein Tabellenergebnis aussuchen (derselbe Grund wie bei probeZahl).
      const table = msg.table === 'master' || msg.table === 'wild' ? msg.table : undefined;
      const expression: DiceExpression | null = table
        ? table === 'master'
          ? { groups: [{ count: 1, sides: 6 }], modifier: 0 }
          : { groups: [{ count: 1, sides: 6 }, { count: 1, sides: 20 }], modifier: 0 }
        : parseDiceExpression(String(msg.expression ?? ''));
      if (!expression) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültiger Würfelausdruck' });
        return;
      }
      let visibility: RollVisibility = 'public';
      let gmUserId: number | null = null;
      if (msg.visibility === 'hidden') {
        visibility = 'hidden';
      } else if (msg.visibility === 'gm_player') {
        const counterpart = resolveGmPlayerCounterpart(meta, msg.targetUserId);
        if (counterpart === null) {
          send(ws, {
            type: 'error',
            reqId: msg.reqId,
            message: meta.isGm ? 'Unbekanntes Gruppenmitglied' : 'Die Spielleitung ist gerade nicht verbunden',
          });
          return;
        }
        visibility = 'gm_player';
        gmUserId = counterpart;
      }
      const result = performExpressionRoll(expression);
      // Nur der W6 trägt den Tabellennamen; der W20 in „/wild" bleibt reiner
      // Zahlenwert (Unterergebnis), siehe MASTER_TABLE/WILD_MAGIC_TABLE.
      const outcomeLabel =
        table === 'master'
          ? MASTER_TABLE[result.dice[0] - 1]
          : table === 'wild'
            ? `${WILD_MAGIC_TABLE[result.dice[0] - 1]}: ${result.dice[1]}`
            : undefined;
      const roll: ExpressionRollPayload = {
        mode: 'expr',
        label: table ? (table === 'master' ? 'Meisterwurf' : 'Wilde Magie') : String(msg.label ?? '').slice(0, 60).trim(),
        expression: result.expression,
        dice: result.dice,
        confirmations: result.confirmations,
        pending: result.pending,
        resolved: result.resolved,
        rawSum: result.rawSum,
        adjustedSum: result.adjustedSum,
        flagged: result.flagged,
        ...(outcomeLabel !== undefined ? { outcomeLabel } : {}),
      };
      insertFeedRoll(meta.groupId, resolveAuthor(meta, msg.charId), gmUserId, visibility, roll);
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
      const char = db.prepare('SELECT id, name, chat_name FROM characters WHERE id = ? AND owner_user_id = ?').get(charId, meta.userId) as
        | { id: number; name: string; chat_name: string }
        | undefined;
      if (!char || !charBelongsToRoom(char.id, meta.groupId)) {
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
      let visibility: RollVisibility = 'public';
      let gmUserId: number | null = null;
      if (msg.visibility === 'hidden') {
        visibility = 'hidden';
      } else if (msg.visibility === 'gm_player') {
        const counterpart = resolveGmPlayerCounterpart(meta, msg.targetUserId);
        if (counterpart === null) {
          send(ws, {
            type: 'error',
            reqId: msg.reqId,
            message: meta.isGm ? 'Unbekanntes Gruppenmitglied' : 'Die Spielleitung ist gerade nicht verbunden',
          });
          return;
        }
        visibility = 'gm_player';
        gmUserId = counterpart;
      }
      const modifier = clampModifier(msg.modifier);
      const result = performProbeRoll(computed.n, computed.probeZahl, modifier);
      const roll: ProbeRollPayload = {
        mode: 'probe',
        source,
        label: computed.label,
        n: computed.n,
        probeZahl: computed.probeZahl,
        modifier,
        ...(computed.attrParts ? { attrParts: computed.attrParts } : {}),
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
      insertFeedRoll(meta.groupId, resolveAuthor(meta, char.id), gmUserId, visibility, roll);
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
      // Der ursprüngliche Modifikator muss beim Neu-Auflösen wieder mitgegeben
      // werden — roll.probeZahl ist der reine Zielwert, ohne ihn wäre die
      // Bestätigung mit einer STILLE Rückkehr zum unmodifizierten Wurf verbunden.
      const next =
        roll.mode === 'probe'
          ? { ...roll, ...resolveProbeRoll(roll.dice, done, roll.probeZahl, roll.modifier) }
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
      const char = db.prepare('SELECT id, name, chat_name, owner_user_id FROM characters WHERE id = ?').get(targetCharId) as
        | { id: number; name: string; chat_name: string; owner_user_id: number }
        | undefined;
      if (!char || !charBelongsToRoom(char.id, meta.groupId) || char.owner_user_id !== Number(msg.targetUserId)) {
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
    case 'roll.group.request': {
      if (!meta.isGm) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Nur die Spielleitung kann eine Probe anfordern' });
        return;
      }
      const source = parseProbeSource(msg.source);
      if (!source) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Unbekannte Probe' });
        return;
      }
      // „Ganze Gruppe" heißt currently CONNECTED, nicht jedes Gruppenmitglied
      // — wer offline ist, wartet nicht mit auf (siehe TODO-Konzept).
      const room = rooms.get(meta.groupId);
      const connectedUserIds = new Set<number>();
      if (room) {
        for (const socket of room) {
          const m = socketMeta.get(socket);
          if (m && m.userId !== meta.userId) connectedUserIds.add(m.userId);
        }
      }
      if (connectedUserIds.size === 0) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Gerade niemand sonst verbunden' });
        return;
      }
      // UNION statt eines einzelnen WHERE: characters.group_id (feste Gruppe)
      // und temp_group_members (additive Event-Gruppen-Mitgliedschaft) sind
      // exklusiv — dieselbe Abfrage bedient beide, ohne wissen zu müssen,
      // welche Art Raum das ist (siehe charBelongsToRoom).
      const chars = db
        .prepare(
          `SELECT id, name, chat_name, owner_user_id FROM characters WHERE group_id = ?
           UNION
           SELECT c.id, c.name, c.chat_name, c.owner_user_id FROM characters c
           JOIN temp_group_members tgm ON tgm.character_id = c.id WHERE tgm.temp_group_id = ?`,
        )
        .all(meta.groupId, meta.groupId) as { id: number; name: string; chat_name: string; owner_user_id: number }[];
      // Wer die Probe gar nicht kennt (z. B. ein Kampftalent ohne Formel für
      // den falschen Waffentyp), fällt einzeln aus dem Aufgebot, statt die
      // ganze Sammelanfrage zu blockieren.
      const members: { userId: number; charId: number; charName: string; label: string }[] = [];
      for (const c of chars) {
        if (!connectedUserIds.has(c.owner_user_id)) continue;
        const computed = computeProbeForCharacter(c.id, source);
        if (!computed) continue;
        members.push({ userId: c.owner_user_id, charId: c.id, charName: c.chat_name || c.name, label: computed.label });
      }
      if (members.length === 0) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Eintrag gibt es bei niemandem eine Probe' });
        return;
      }
      const group = createGroupRollRequest({
        groupId: meta.groupId,
        source,
        label: members[0].label,
        gmUserId: meta.userId,
        gmName: meta.displayName,
        members: members.map(({ userId, charId, charName }) => ({ userId, charId, charName })),
        onExpire: ({ request, order, held }) => revealGroupResults(request, order, held),
      });
      // Eine einzelne Karte für die Spielleitung (roll.group.created), mit der
      // ganzen Mitgliederliste — statt eines eigenen roll.pending.created je
      // Mitglied, das sonst bei jedem Mitglied einzeln aufgeräumt werden
      // müsste. Jedes Mitglied bekommt trotzdem sein eigenes GEWÖHNLICHES
      // roll.pending.created (nur an sich selbst) — die Spieler-Oberfläche
      // (PendingRequestCard, acceptRequest/declineRequest) braucht dafür keine
      // Änderung.
      sendToUserInGroup(meta.groupId, meta.userId, { type: 'roll.group.created', request: group });
      for (const m of members) {
        const sub = createPendingRequest({
          groupId: meta.groupId,
          source,
          label: m.label,
          gmUserId: meta.userId,
          gmName: meta.displayName,
          targetUserId: m.userId,
          targetCharId: m.charId,
          targetCharName: m.charName,
          groupRequestId: group.id,
          onExpire: (expired) => {
            sendToUserInGroup(expired.groupId, expired.targetUserId, { type: 'roll.pending.expired', requestId: expired.id });
            const done = dropGroupMember(group.id, expired.targetCharId);
            if (done) revealGroupResults(group, done.order, done.held);
          },
        });
        sendToUserInGroup(meta.groupId, sub.targetUserId, { type: 'roll.pending.created', request: sub });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.group.reveal': {
      const request = getGroupRollRequest(msg.groupRequestId);
      if (!request || request.gmUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      const result = forceRevealGroup(msg.groupRequestId);
      // Noch offene Zweige (niemand hat geantwortet) räumen sich nicht von
      // selbst weg — ihre eigene PendingRequestCard muss verschwinden.
      for (const sub of removePendingRequestsForGroup(msg.groupRequestId)) {
        sendToUserInGroup(sub.groupId, sub.targetUserId, { type: 'roll.pending.cancelled', requestId: sub.id });
      }
      if (result) revealGroupResults(request, result.order, result.held);
      else sendToUserInGroup(meta.groupId, meta.userId, { type: 'roll.group.revealed', requestId: request.id });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.group.cancel': {
      const request = getGroupRollRequest(msg.groupRequestId);
      if (!request || request.gmUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      cancelGroupRollRequest(msg.groupRequestId);
      sendToUserInGroup(meta.groupId, meta.userId, { type: 'roll.group.cancelled', requestId: request.id });
      for (const sub of removePendingRequestsForGroup(msg.groupRequestId)) {
        sendToUserInGroup(sub.groupId, sub.targetUserId, { type: 'roll.pending.cancelled', requestId: sub.id });
      }
      // Ein „Verwerfen" schluckte bisher jede Spur der Anfrage — wer schon
      // eine wartende Karte sah, sah sie einfach verschwinden. Eine feste
      // Feed-Zeile macht das für alle sichtbar, statt es stillschweigend
      // fallenzulassen.
      insertFeedMessage(
        meta.groupId,
        { userId: request.gmUserId, charId: null, name: request.gmName },
        `verwirft die Gruppenprobe: ${request.label}`,
        true,
      );
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.coop.propose': {
      // Anders als roll.group.request: JEDER darf vorschlagen, nicht nur die
      // Spielleitung — der Pool ist selbstbedient, siehe coopPools.ts. Da
      // Vorschlagen NICHT automatisch beitritt, braucht es dafür auch KEINEN
      // eigenen Charakter (die Spielleitung hat nie einen) — genau wie
      // RequestGroupProbePicker.tsx die Vorschlagsliste von IRGENDEINEM
      // Charakter lädt (Katalog-Einträge sind gruppenweit gleich), reicht
      // hier irgendein Charakter der Gruppe, rein zur Anzeige des Labels.
      const source = parseProbeSource(msg.source);
      if (!source) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Unbekannte Probe' });
        return;
      }
      const anyChar = db
        .prepare(
          `SELECT id FROM (
             SELECT id FROM characters WHERE group_id = ?
             UNION
             SELECT c.id FROM characters c JOIN temp_group_members tgm ON tgm.character_id = c.id WHERE tgm.temp_group_id = ?
           ) ORDER BY id LIMIT 1`,
        )
        .get(meta.groupId, meta.groupId) as { id: number } | undefined;
      if (!anyChar) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Diese Gruppe hat noch keinen Charakter' });
        return;
      }
      // Nur zur Anzeige im Pool — gewürfelt wird erst bei roll.coop.start,
      // dann pro Mitglied gegen dessen dann aktuelle Werte (siehe dort).
      const computed = computeProbeForCharacter(anyChar.id, source);
      if (!computed) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Für diesen Eintrag gibt es keine Probe' });
        return;
      }
      const pool = createCoopPool({
        groupId: meta.groupId,
        source,
        label: computed.label,
        initiatorUserId: meta.userId,
        initiatorName: meta.displayName,
      });
      broadcastUngefiltert(meta.groupId, { type: 'roll.coop.created', pool });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.coop.join': {
      const char = resolveOwnCharacter(meta, msg.charId);
      if (!char) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Charakter gehört nicht zu dieser Gruppe' });
        return;
      }
      const pool = joinCoopPool(msg.poolId, {
        userId: meta.userId,
        charId: char.id,
        charName: char.chat_name || char.name,
      });
      if (!pool) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Pool nicht gefunden' });
        return;
      }
      broadcastUngefiltert(meta.groupId, { type: 'roll.coop.updated', pool });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.coop.leave': {
      const pool = getCoopPool(msg.poolId);
      if (!pool || pool.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Pool nicht gefunden' });
        return;
      }
      // Kein charId im Protokoll nötig — welcher Charakter des Absenders
      // beigetreten ist, steht schon in pool.members.
      const own = pool.members.find((m) => m.userId === meta.userId);
      const updated = own ? leaveCoopPool(msg.poolId, own.charId) : pool;
      if (updated) broadcastUngefiltert(meta.groupId, { type: 'roll.coop.updated', pool: updated });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.coop.start': {
      const pool = getCoopPool(msg.poolId);
      if (!pool || pool.groupId !== meta.groupId || (pool.initiatorUserId !== meta.userId && !meta.isGm)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Pool nicht gefunden' });
        return;
      }
      removeCoopPool(msg.poolId);
      // Wer die Probe inzwischen gar nicht mehr kennt (Wert geändert/entfernt
      // seit dem Beitritt), fällt einzeln raus — wie beim Aufgebot einer
      // Gruppen-Sammelanfrage (roll.group.request), statt den ganzen Pool zu
      // blockieren.
      const rolls: { charId: number; author: FeedAuthor; roll: ProbeRollPayload }[] = [];
      for (const m of pool.members) {
        const computed = computeProbeForCharacter(m.charId, pool.source);
        if (!computed) continue;
        const result = performProbeRoll(computed.n, computed.probeZahl, 0);
        rolls.push({
          charId: m.charId,
          author: { userId: m.userId, charId: m.charId, name: m.charName },
          roll: {
            mode: 'probe',
            source: pool.source,
            label: computed.label,
            n: computed.n,
            probeZahl: computed.probeZahl,
            modifier: 0,
            ...(computed.attrParts ? { attrParts: computed.attrParts } : {}),
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
          },
        });
      }
      if (rolls.length > 0) {
        insertFeedMessage(
          meta.groupId,
          { userId: pool.initiatorUserId, charId: null, name: pool.initiatorName },
          `schlägt eine Kooperationsprobe vor: ${pool.label}`,
          true,
        );
        for (const r of rolls) insertFeedRoll(meta.groupId, r.author, null, 'public', r.roll, pool.id, true);
      }
      broadcastUngefiltert(meta.groupId, { type: 'roll.coop.closed', poolId: pool.id });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.coop.cancel': {
      const pool = getCoopPool(msg.poolId);
      if (!pool || pool.groupId !== meta.groupId || (pool.initiatorUserId !== meta.userId && !meta.isGm)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Pool nicht gefunden' });
        return;
      }
      removeCoopPool(msg.poolId);
      broadcastUngefiltert(meta.groupId, { type: 'roll.coop.cancelled', poolId: pool.id });
      // Wie beim Verwerfen einer Gruppenprobe: sichtbar machen statt
      // stillschweigend verschwinden lassen. Der TATSÄCHLICH Klickende steht
      // im Text — das kann die Spielleitung sein, die den Pool einer anderen
      // Person verwirft, nicht immer die vorschlagende Person selbst.
      insertFeedMessage(
        meta.groupId,
        { userId: meta.userId, charId: null, name: meta.displayName },
        `verwirft die Kooperationsprobe: ${pool.label}`,
        true,
      );
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
      // Der Werfer sieht genau DIESE Anfrage als erledigt — per id, nicht per
      // Charakter, sonst würde das Annehmen einer von mehreren offenen
      // Anfragen an denselben Charakter auch die anderen wegwischen. Die
      // Spielleitung NUR bei einer normalen Einzelanfrage — bei einer
      // Gruppen-Sammelanfrage bleibt ihre EINE Karte stehen und bekommt
      // stattdessen unten ein roll.group.member („gewürfelt").
      sendToUserInGroup(request.groupId, request.targetUserId, { type: 'roll.pending.accepted', requestId: request.id });
      if (!request.groupRequestId) {
        sendToUserInGroup(request.groupId, request.gmUserId, { type: 'roll.pending.accepted', requestId: request.id });
      }
      const modifier = clampModifier(msg.modifier);
      const result = performProbeRoll(computed.n, computed.probeZahl, modifier);
      const roll: ProbeRollPayload = {
        mode: 'probe',
        source: request.source,
        label: computed.label,
        n: computed.n,
        probeZahl: computed.probeZahl,
        modifier,
        ...(computed.attrParts ? { attrParts: computed.attrParts } : {}),
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
      if (request.groupRequestId) {
        // Teil einer Gruppen-Sammelanfrage: nicht sofort veröffentlichen,
        // sondern zurückhalten, bis auch die letzten Mitglieder geantwortet
        // haben (siehe groupRolls.ts) — dann geht alles gemeinsam raus. Bis
        // dahin bekommt die Spielleitung nur die Statusmeldung, ihre Karte
        // bleibt stehen (siehe GroupRollMember.status).
        const groupReq = getGroupRollRequest(request.groupRequestId);
        const done = holdGroupResult(request.groupRequestId, request.targetCharId, {
          kind: 'roll',
          author: resolveAuthor(meta, request.targetCharId),
          roll,
        });
        if (groupReq) {
          sendToUserInGroup(meta.groupId, groupReq.gmUserId, {
            type: 'roll.group.member',
            requestId: groupReq.id,
            charId: request.targetCharId,
            status: 'rolled',
          });
        }
        if (done && groupReq) revealGroupResults(groupReq, done.order, done.held);
      } else {
        insertFeedRoll(meta.groupId, resolveAuthor(meta, request.targetCharId), request.gmUserId, 'gm_player', roll);
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.pending.decline': {
      const request = getPendingRequest(String(msg.requestId));
      if (!request || request.targetUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      // Ablehnen schreibt nichts — es gab ja nie einen Datenbank-Eintrag. Bei
      // einer Gruppen-Sammelanfrage ist das anders: „passt" soll sichtbar
      // werden, sobald die ganze Gruppe geantwortet hat (siehe unten).
      removePendingRequest(request.id);
      if (request.groupRequestId) {
        const groupReq = getGroupRollRequest(request.groupRequestId);
        const done = holdGroupResult(request.groupRequestId, request.targetCharId, {
          kind: 'passed',
          author: resolveAuthor(meta, request.targetCharId),
        });
        if (groupReq) {
          sendToUserInGroup(meta.groupId, groupReq.gmUserId, {
            type: 'roll.group.member',
            requestId: groupReq.id,
            charId: request.targetCharId,
            status: 'passed',
          });
        }
        if (done && groupReq) revealGroupResults(groupReq, done.order, done.held);
      }
      sendToUserInGroup(request.groupId, request.targetUserId, { type: 'roll.pending.declined', requestId: request.id });
      if (!request.groupRequestId) {
        sendToUserInGroup(request.groupId, request.gmUserId, { type: 'roll.pending.declined', requestId: request.id });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'roll.pending.cancel': {
      const request = getPendingRequest(String(msg.requestId));
      // Nur die Spielleitung, die die Anfrage selbst gestellt hat — sonst
      // könnte irgendwer fremde Anfragen wegklicken.
      if (!request || request.gmUserId !== meta.userId || request.groupId !== meta.groupId) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Anfrage nicht gefunden' });
        return;
      }
      removePendingRequest(request.id);
      // Bei einer Gruppen-Sammelanfrage nimmt das Zurückziehen NUR dieses eine
      // Mitglied aus dem Aufgebot — die übrigen warten weiter (Gegenstück zum
      // Ablauf-Timeout in roll.group.request, siehe dropGroupMember dort). Kein
      // eigener UI-Weg mehr dorthin (die Gruppenkarte hat nur noch die zwei
      // Sammel-Knöpfe), aber die Route bleibt für roll.pending.expired & Co.
      // korrekt, falls sie je wieder gebraucht wird.
      if (request.groupRequestId) {
        const groupReq = getGroupRollRequest(request.groupRequestId);
        const done = dropGroupMember(request.groupRequestId, request.targetCharId);
        if (done && groupReq) revealGroupResults(groupReq, done.order, done.held);
      }
      sendToUserInGroup(request.groupId, request.targetUserId, { type: 'roll.pending.cancelled', requestId: request.id });
      if (!request.groupRequestId) {
        sendToUserInGroup(request.groupId, request.gmUserId, { type: 'roll.pending.cancelled', requestId: request.id });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    // Virtueller Tisch (docs/concepts/virtual-table.md) — reuses this same
    // socket/room rather than a second connection. Fog/hidden redaction
    // (broadcastBuilt + the pure helpers in board.ts) covers token.*,
    // tiles.paint, highlights.paint and the 'label' half of overlay.* below;
    // board.settings.update and the 'measure' half of overlay.* stay
    // unfiltered (broadcastUngefiltert) — settings aren't secret and measure
    // shapes are deliberately NOT redacted by fog (an in-play tool, not a
    // secret-planning annotation like a label — see board.ts's overlayVisibleTo).
    case 'board.token.create': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      if (!boardCanEditTokens(board, viewer, meta.groupId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Marken anzulegen' });
        return;
      }
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültige Position' });
        return;
      }
      const size = Math.min(6, Math.max(1, Math.round(Number(msg.size) || 1)));
      let input: Parameters<typeof createBoardToken>[1];
      if (msg.kind === 'character') {
        const char = db.prepare('SELECT id, name, chat_name, owner_user_id FROM characters WHERE id = ?').get(Number(msg.characterId)) as
          | { id: number; name: string; chat_name: string; owner_user_id: number }
          | undefined;
        if (!char || !charBelongsToRoom(char.id, meta.groupId)) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Charakter gehört nicht zu dieser Gruppe' });
          return;
        }
        // Name/owner come from the character record, never the client — a
        // player editing their own request payload could otherwise post a
        // token under someone else's name. Colour/icon are cosmetic, so a
        // client-supplied value is harmless and stays.
        input = {
          kind: 'character',
          characterId: char.id,
          ownerUserId: char.owner_user_id,
          name: char.chat_name || char.name,
          color: String(msg.color ?? '').slice(0, 20),
          icon: String(msg.icon ?? '').slice(0, 4),
          x,
          y,
          size,
        };
      } else {
        input = {
          kind: 'marker',
          characterId: null,
          ownerUserId: null,
          name: String(msg.name ?? 'Marker').slice(0, 60).trim() || 'Marker',
          color: String(msg.color ?? '').slice(0, 20),
          icon: String(msg.icon ?? '').slice(0, 4),
          x,
          y,
          size,
        };
      }
      const token = createBoardToken(board.id, input);
      const fogAtCreate = fogSet(board);
      broadcastBuilt(meta.groupId, (v) => (tokenVisibleTo(token, fogAtCreate, v) ? { type: 'board.token.created', token: toWireToken(token) } : null));
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.token.update': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      const existing = getBoardToken(Number(msg.tokenId));
      if (!existing || existing.boardId !== board.id) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Marke nicht gefunden' });
        return;
      }
      if (!boardCanEditTokens(board, viewer, meta.groupId, existing.ownerUserId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, diese Marke zu bearbeiten' });
        return;
      }
      const p = msg.patch ?? {};
      const patch: Parameters<typeof updateBoardToken>[1] = {};
      if (typeof p.name === 'string') patch.name = p.name.slice(0, 60).trim();
      if (typeof p.color === 'string') patch.color = p.color.slice(0, 20);
      if (typeof p.icon === 'string') patch.icon = p.icon.slice(0, 4);
      // Bewusst NICHT über den Besitzer-Bypass oben erreichbar — „hidden"
      // ist der Spielleitung vorbehalten (siehe Spaltenkommentar in db.ts),
      // die Besitzerin eines Charakters bekommt sonst dieselben Rechte wie
      // die Spielleitung, aber gerade dieses eine Feld nicht.
      if (typeof p.hidden === 'boolean' && meta.isGm) patch.hidden = p.hidden;
      if (typeof p.size === 'number') patch.size = Math.min(6, Math.max(1, Math.round(p.size)));
      if (typeof p.radius === 'number' && Number.isFinite(p.radius)) patch.radius = Math.min(50, Math.max(0, p.radius));
      if (typeof p.radiusColor === 'string' && parseTileValue(p.radiusColor)?.kind === 'color') patch.radiusColor = p.radiusColor;
      // Nie unbekannte Schlüssel übernehmen — ein veralteter Client oder ein
      // manuell gebasteltes Nachricht könnte sonst Katalog-fremde Werte
      // einschleusen, die BOARD_STATUS_BY_KEY/BOARD_COVER_BY_KEY nie kennen.
      if (Array.isArray(p.statuses)) patch.statuses = p.statuses.filter((s): s is string => typeof s === 'string' && s in BOARD_STATUS_BY_KEY);
      if (typeof p.cover === 'string' && (p.cover === '' || p.cover in BOARD_COVER_BY_KEY)) patch.cover = p.cover;
      const updated = updateBoardToken(existing.id, patch);
      if (updated) {
        const fog = fogSet(board);
        // Only `hidden` can flip visibility here (position is untouched) —
        // still computed generally via tokenVisibleTo so this stays correct
        // if that ever changes. A viewer who never had this token needs
        // 'created' (the reducer's 'updated' handler only replaces an
        // existing entry, see DicePanelProvider.tsx), one who had it and
        // loses it needs 'deleted', and unchanged visibility keeps 'updated'.
        broadcastBuilt(meta.groupId, (v) => {
          const wasVisible = tokenVisibleTo(existing, fog, v);
          const nowVisible = tokenVisibleTo(updated, fog, v);
          if (!nowVisible) return wasVisible ? { type: 'board.token.deleted', tokenId: updated.id } : null;
          if (wasVisible) return { type: 'board.token.updated', token: toWireToken(updated) };
          return { type: 'board.token.created', token: toWireToken(updated) };
        });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.token.move': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      const existing = getBoardToken(Number(msg.tokenId));
      if (!existing || existing.boardId !== board.id) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Marke nicht gefunden' });
        return;
      }
      if (!boardCanMoveToken(board, viewer, meta.groupId, existing.ownerUserId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Marken zu verschieben' });
        return;
      }
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültige Position' });
        return;
      }
      // One message per drag — the client renders the whole drag locally and
      // only sends the dropped-at position (see VirtualTable.tsx), so there's
      // nothing to debounce or re-broadcast mid-drag: write and tell the room once.
      moveBoardToken(existing.id, existing.boardId, x, y);
      const moved = { ...existing, x, y };
      const fogAtMove = fogSet(board);
      // Moving into/out of a fogged cell is the plan's headline fog example:
      // players get 'removed' walking in, 'created' walking out — same
      // visibility-transition shape as board.token.update above.
      broadcastBuilt(meta.groupId, (v) => {
        const wasVisible = tokenVisibleTo(existing, fogAtMove, v);
        const nowVisible = tokenVisibleTo(moved, fogAtMove, v);
        if (!nowVisible) return wasVisible ? { type: 'board.token.deleted', tokenId: moved.id } : null;
        if (wasVisible) return { type: 'board.token.updated', token: toWireToken(moved) };
        return { type: 'board.token.created', token: toWireToken(moved) };
      });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.token.delete': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      const existing = getBoardToken(Number(msg.tokenId));
      if (!existing || existing.boardId !== board.id) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Marke nicht gefunden' });
        return;
      }
      if (!boardCanEditTokens(board, viewer, meta.groupId, existing.ownerUserId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, diese Marke zu löschen' });
        return;
      }
      deleteBoardToken(existing.id);
      const fogAtDelete = fogSet(board);
      // Only tell a viewer who could actually see this token that it's gone
      // — nothing else about it leaks (not even that an id existed) to one
      // who couldn't.
      broadcastBuilt(meta.groupId, (v) => (tokenVisibleTo(existing, fogAtDelete, v) ? { type: 'board.token.deleted', tokenId: existing.id } : null));
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.settings.update': {
      if (!meta.isGm) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Nur die Spielleitung ändert die Karten-Rechte' });
        return;
      }
      const board = getOrCreateBoard(meta.groupId);
      const p = msg.patch ?? {};
      const isPerm = (v: unknown): v is 'gm' | 'all' => v === 'gm' || v === 'all';
      const patch: Parameters<typeof updateBoardSettings>[1] = {};
      if (isPerm(p.permTiles)) patch.permTiles = p.permTiles;
      if (isPerm(p.permLabels)) patch.permLabels = p.permLabels;
      if (isPerm(p.permTokens)) patch.permTokens = p.permTokens;
      if (isPerm(p.permImages)) patch.permImages = p.permImages;
      if (isPerm(p.permMove)) patch.permMove = p.permMove;
      const updated = updateBoardSettings(board.id, patch);
      broadcastUngefiltert(meta.groupId, {
        type: 'board.settings.updated',
        board: {
          id: updated.id,
          groupId: updated.groupId,
          cols: updated.cols,
          rows: updated.rows,
          seed: updated.seed,
          permTiles: updated.permTiles as 'gm' | 'all',
          permLabels: updated.permLabels as 'gm' | 'all',
          permTokens: updated.permTokens as 'gm' | 'all',
          permImages: updated.permImages as 'gm' | 'all',
          permMove: updated.permMove as 'gm' | 'all',
          round: updated.round,
          turnIndex: updated.turnIndex,
          rev: updated.rev,
        },
      });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.tiles.paint': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      if (!boardCanPaint(board, viewer, meta.groupId)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Kacheln zu bemalen' });
        return;
      }
      const raw = msg.cells ?? {};
      // Nie unbekannten Kram übernehmen: eine ungültige Zellen-Adresse, eine
      // Zelle außerhalb des Bretts, oder ein Wert, den parseTileValue nicht
      // kennt (außer der leere String, das ist Radieren) — still übersprungen
      // statt die ganze Nachricht abzulehnen, wie parseTileValue selbst schon
      // tolerant gegenüber Ausreißern ist. 10000 = das größte je erlaubte
      // Brett (100×100), als reine Notbremse gegen eine erfundene Nachricht.
      const cells: Record<string, string> = {};
      let n = 0;
      for (const [key, value] of Object.entries(raw)) {
        if (n >= 10000) break;
        if (typeof value !== 'string') continue;
        const cell = parseCellKey(key);
        if (!cell || cell.x < 0 || cell.y < 0 || cell.x >= board.cols || cell.y >= board.rows) continue;
        if (value !== '' && !parseTileValue(value)) continue;
        cells[key] = value;
        n++;
      }
      if (n === 0) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine gültigen Zellen' });
        return;
      }
      paintBoardTiles(board.id, cells);
      const fogAtPaint = fogSet(board);
      // A painted cell that's currently fogged is withheld from players
      // entirely (see redactCells) — GM still gets the full stroke.
      broadcastBuilt(meta.groupId, (v) => {
        const redacted = redactCells(cells, fogAtPaint, v);
        return Object.keys(redacted).length > 0 ? { type: 'board.tiles.painted', cells: redacted } : null;
      });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.highlights.paint': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      if (!boardCanHighlightTiles(viewer)) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Felder einzufärben' });
        return;
      }
      const raw = msg.cells ?? {};
      // Gleiche Toleranz wie board.tiles.paint, aber nur Farbwerte zulässig —
      // eine Textur/Asset-Kachel ergibt auf der Einfärbe-Ebene keinen Sinn.
      const cells: Record<string, string> = {};
      let n = 0;
      for (const [key, value] of Object.entries(raw)) {
        if (n >= 10000) break;
        if (typeof value !== 'string') continue;
        const cell = parseCellKey(key);
        if (!cell || cell.x < 0 || cell.y < 0 || cell.x >= board.cols || cell.y >= board.rows) continue;
        if (value !== '' && parseTileValue(value)?.kind !== 'color') continue;
        cells[key] = value;
        n++;
      }
      if (n === 0) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine gültigen Zellen' });
        return;
      }
      paintBoardHighlights(board.id, cells);
      const fogAtHighlight = fogSet(board);
      // Same fog redaction as tiles.paint — a GM tint over a fogged cell
      // would otherwise leak the room's shape to players who can't see the
      // tile itself.
      broadcastBuilt(meta.groupId, (v) => {
        const redacted = redactCells(cells, fogAtHighlight, v);
        return Object.keys(redacted).length > 0 ? { type: 'board.highlights.painted', cells: redacted } : null;
      });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.overlay.create': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      // Der Wire-Typ kennt heute 'label'/'measure', aber msg kam als beliebiges
      // JSON herein — ein handgebasteltes Paket könnte trotzdem etwas anderes
      // schicken, deshalb zur Laufzeit prüfen statt dem Typsystem zu trauen.
      const kind = msg.kind as string;
      if (kind === 'label') {
        if (!boardCanLabel(board, viewer, meta.groupId)) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Beschriftungen anzulegen' });
          return;
        }
        const x = Number((msg.data as { x?: unknown })?.x);
        const y = Number((msg.data as { y?: unknown })?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > board.cols || y > board.rows) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültige Position' });
          return;
        }
        const text = String((msg.data as { text?: unknown })?.text ?? '').slice(0, 80);
        const overlay = createBoardOverlay(board.id, 'label', { x, y, text });
        const fogAtLabel = fogSet(board);
        // GM plans maps secretly (developer's call): a label the GM drops on
        // a currently-fogged cell never reaches a player at all.
        broadcastBuilt(meta.groupId, (v) =>
          labelVisibleTo(overlay.data as LabelOverlayData, fogAtLabel, v) ? { type: 'board.overlay.created', overlay: toWireOverlay(overlay) } : null,
        );
        send(ws, { type: 'ack', reqId: msg.reqId });
        return;
      }
      if (kind === 'measure') {
        // Messen ist immer 'all' — jeder Raum-Teilnehmer darf, siehe canMeasure.
        if (!boardCanMeasure()) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, zu messen' });
          return;
        }
        const data = validateMeasureData(msg.data, board);
        if (!data) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültige Messform' });
          return;
        }
        const overlay = createBoardOverlay(board.id, 'measure', data);
        broadcastUngefiltert(meta.groupId, { type: 'board.overlay.created', overlay: toWireOverlay(overlay) });
        send(ws, { type: 'ack', reqId: msg.reqId });
        return;
      }
      send(ws, { type: 'error', reqId: msg.reqId, message: 'Unbekannte Beschriftungsart' });
      return;
    }
    case 'board.overlay.update': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      const existing = getBoardOverlay(Number(msg.overlayId));
      if (!existing || existing.boardId !== board.id) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Objekt nicht gefunden' });
        return;
      }
      if (existing.kind === 'label') {
        if (!boardCanLabel(board, viewer, meta.groupId)) {
          send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, Beschriftungen zu bearbeiten' });
          return;
        }
        const p = (msg.patch ?? {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if (typeof p.x === 'number' && Number.isFinite(p.x)) patch.x = Math.min(board.cols, Math.max(0, p.x));
        if (typeof p.y === 'number' && Number.isFinite(p.y)) patch.y = Math.min(board.rows, Math.max(0, p.y));
        if (typeof p.text === 'string') patch.text = p.text.slice(0, 80);
        const updated = updateBoardOverlay(existing.id, patch);
        if (updated) {
          const fog = fogSet(board);
          // Same visibility-transition shape as a token move: dragging a
          // label into/out of a fogged cell needs 'created'/'deleted', not
          // 'updated', for a viewer who didn't already have it (see the
          // reducer comment on board.token.update above).
          broadcastBuilt(meta.groupId, (v) => {
            const wasVisible = labelVisibleTo(existing.data as LabelOverlayData, fog, v);
            const nowVisible = labelVisibleTo(updated.data as LabelOverlayData, fog, v);
            if (!nowVisible) return wasVisible ? { type: 'board.overlay.deleted', overlayId: updated.id } : null;
            if (wasVisible) return { type: 'board.overlay.updated', overlay: toWireOverlay(updated) };
            return { type: 'board.overlay.created', overlay: toWireOverlay(updated) };
          });
        }
        send(ws, { type: 'ack', reqId: msg.reqId });
        return;
      }
      // measure: eine Bewegung/Größenänderung schickt die ganze neue `data`
      // (siehe Protokoll-Kommentar) statt einzelner Felder — validateMeasureData
      // verlangt deshalb ein vollständiges, gültiges Objekt, kein Teil-Patch.
      if (!boardCanMeasure()) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, zu messen' });
        return;
      }
      const data = validateMeasureData(msg.patch, board);
      if (!data) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Ungültige Messform' });
        return;
      }
      const updated = updateBoardOverlay(existing.id, data);
      if (updated) broadcastUngefiltert(meta.groupId, { type: 'board.overlay.updated', overlay: toWireOverlay(updated) });
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.overlay.delete': {
      const board = getOrCreateBoard(meta.groupId);
      const viewer = { userId: meta.userId, isGm: meta.isGm };
      const existing = getBoardOverlay(Number(msg.overlayId));
      if (!existing || existing.boardId !== board.id) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Objekt nicht gefunden' });
        return;
      }
      const allowed = existing.kind === 'label' ? boardCanLabel(board, viewer, meta.groupId) : boardCanMeasure();
      if (!allowed) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine Berechtigung, das zu löschen' });
        return;
      }
      deleteBoardOverlay(existing.id);
      if (existing.kind === 'label') {
        const fog = fogSet(board);
        // Same "only tell whoever could actually see it" rule as a token delete.
        broadcastBuilt(meta.groupId, (v) =>
          labelVisibleTo(existing.data as LabelOverlayData, fog, v) ? { type: 'board.overlay.deleted', overlayId: existing.id } : null,
        );
      } else {
        broadcastUngefiltert(meta.groupId, { type: 'board.overlay.deleted', overlayId: existing.id });
      }
      send(ws, { type: 'ack', reqId: msg.reqId });
      return;
    }
    case 'board.fog.set': {
      if (!boardCanEditFog({ userId: meta.userId, isGm: meta.isGm })) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Nur die Spielleitung ändert den Nebel' });
        return;
      }
      const board = getOrCreateBoard(meta.groupId);
      const raw = msg.cells ?? {};
      // Same tolerance/cap as board.tiles.paint — silently drop what doesn't
      // fit rather than reject the whole message.
      const delta: Record<string, boolean> = {};
      let n = 0;
      for (const [key, value] of Object.entries(raw)) {
        if (n >= 10000) break;
        if (typeof value !== 'boolean') continue;
        const cell = parseCellKey(key);
        if (!cell || cell.x < 0 || cell.y < 0 || cell.x >= board.cols || cell.y >= board.rows) continue;
        delta[key] = value;
        n++;
      }
      if (n === 0) {
        send(ws, { type: 'error', reqId: msg.reqId, message: 'Keine gültigen Zellen' });
        return;
      }
      const { board: updatedBoard, revealedCells, hiddenCells } = setBoardFog(board.id, delta);
      if (revealedCells.length === 0 && hiddenCells.length === 0) {
        send(ws, { type: 'ack', reqId: msg.reqId });
        return;
      }
      // The mask itself is public — every viewer, GM and players alike, gets
      // the same delta unfiltered (see the plan: "the fog set itself is
      // public"). What's now UNDER a revealed/hidden cell is a separate,
      // per-viewer concern handled below.
      broadcastUngefiltert(meta.groupId, { type: 'board.fog.updated', cells: delta });

      if (revealedCells.length > 0) {
        const revealedSet = new Set(revealedCells);
        const tiles = JSON.parse(updatedBoard.tilesJson || '{}') as Record<string, string>;
        const revealedTiles: Record<string, string> = {};
        for (const key of revealedCells) if (tiles[key] !== undefined) revealedTiles[key] = tiles[key];
        const highlights = JSON.parse(updatedBoard.highlightsJson || '{}') as Record<string, string>;
        const revealedHighlights: Record<string, string> = {};
        for (const key of revealedCells) if (highlights[key] !== undefined) revealedHighlights[key] = highlights[key];
        // Players never had these — GM already does, so skip it there too
        // (redundant data over the wire for no reason).
        if (Object.keys(revealedTiles).length > 0) {
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.tiles.painted', cells: revealedTiles }));
        }
        if (Object.keys(revealedHighlights).length > 0) {
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.highlights.painted', cells: revealedHighlights }));
        }
        for (const token of loadBoardTokens(board.id)) {
          if (token.hidden || !tokenCellsIntersect(token, revealedSet)) continue;
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.token.created', token: toWireToken(token) }));
        }
        for (const overlay of loadBoardOverlays(board.id)) {
          if (overlay.kind !== 'label') continue;
          const cell = overlayCell(overlay.data as LabelOverlayData);
          if (!revealedSet.has(cellKey(cell.x, cell.y))) continue;
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.overlay.created', overlay: toWireOverlay(overlay) }));
        }
      }
      if (hiddenCells.length > 0) {
        const hiddenSet = new Set(hiddenCells);
        for (const token of loadBoardTokens(board.id)) {
          if (token.hidden || !tokenCellsIntersect(token, hiddenSet)) continue;
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.token.deleted', tokenId: token.id }));
        }
        for (const overlay of loadBoardOverlays(board.id)) {
          if (overlay.kind !== 'label') continue;
          const cell = overlayCell(overlay.data as LabelOverlayData);
          if (!hiddenSet.has(cellKey(cell.x, cell.y))) continue;
          broadcastBuilt(meta.groupId, (v) => (v.isGm ? null : { type: 'board.overlay.deleted', overlayId: overlay.id }));
        }
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
    if (!groupExists || (!user.isGm && !isRoomMember(user.id, groupId))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      socketMeta.set(ws, { userId: user.id, isGm: user.isGm, displayName: user.displayName, groupId, rateLimit: rateLimitFor(user.id) });
      let room = rooms.get(groupId);
      if (!room) {
        room = new Set();
        rooms.set(groupId, room);
      }
      // Wer schon im Raum ist, VOR dem Hinzufügen dieser Socket ermitteln —
      // sonst zählte man sich selbst mit.
      const othersBefore = new Map<number, string>();
      for (const socket of room) {
        const m = socketMeta.get(socket);
        if (m) othersBefore.set(m.userId, m.displayName);
      }
      room.add(ws);

      // Nur für diesen einen, gerade verbundenen Nutzer sichtbar — siehe
      // presence.snapshot im Protokoll.
      send(ws, { type: 'presence.snapshot', names: [...othersBefore.values()].sort((a, b) => a.localeCompare(b, 'de')) });

      // „X ist beigetreten" an alle SCHON verbundenen — aber nur bei einer
      // echten Rückkehr, kein bloßes Reconnect-Aufflackern kurz nach dem
      // eigenen letzten Verbindungsabbruch in diesem Raum (siehe RECONNECT_GRACE_MS).
      const key = leftKey(groupId, user.id);
      const leftAt = lastLeftRoom.get(key);
      if (leftAt === undefined || Date.now() - leftAt >= RECONNECT_GRACE_MS) {
        for (const socket of room) {
          if (socket === ws) continue;
          send(socket, { type: 'presence.joined', name: user.displayName });
        }
      }

      // Offene Anfragen nachreichen — wer nach dem Anfragen neu lädt oder die
      // Verbindung verliert, soll die Karte wiedersehen. Ein Zweig einer
      // Gruppen-Sammelanfrage NUR für den angefragten Spieler selbst — die
      // Spielleitung sieht ihn nicht einzeln, sondern über die EINE
      // roll.group.created-Karte gleich darunter (siehe groupRollRequestsFor).
      for (const request of pendingRequestsFor(groupId, user.id)) {
        if (request.groupRequestId && request.targetUserId !== user.id) continue;
        send(ws, { type: 'roll.pending.created', request });
      }
      for (const groupRequest of groupRollRequestsFor(groupId, user.id)) {
        send(ws, { type: 'roll.group.created', request: groupRequest });
      }
      // Kooperationsprobe-Pools sind für ALLE in der Gruppe sichtbar, nicht
      // nur für die vorschlagende Person — anders als die beiden oben also
      // ungefiltert an jeden neu Verbundenen.
      for (const pool of coopPoolsFor(groupId)) {
        send(ws, { type: 'roll.coop.created', pool });
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
        // Nur vermerken, wenn das die LETZTE Socket dieses Nutzers in diesem
        // Raum war — mehrere Tabs/Geräte zählen als weiter verbunden.
        const stillHere = room && [...room].some((s) => socketMeta.get(s)?.userId === user.id);
        if (!stillHere) lastLeftRoom.set(leftKey(groupId, user.id), Date.now());
        if (room && room.size === 0) rooms.delete(groupId);
        socketMeta.delete(ws);
      });
      ws.on('message', (data) => handleMessage(ws, data));
    });
  });
}
