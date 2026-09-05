// Visibility filtering and persistence for the group feed (chat + rolls).
// canSeeFeedEntry is the ONE place this predicate lives — used identically
// for live broadcast (ws.ts) and history pagination (loadFeedPage below) so
// the two views can't drift apart. Deliberately takes NO isGm parameter:
// 'hidden' excludes the GM too, the one deliberate exception to this app's
// usual "GM sees everything" pattern.
import type { ChatFeedEntry, FeedEntry, FormulaNode, PoolMode, RollFeedEntry, RollPayload, RollVisibility } from 'shared';
import { db } from './db.js';
import { broadcastToGroup, broadcastUpdateToGroup } from './ws.js';

export interface FeedAuthor {
  userId: number;
  charId: number | null;
  name: string;
}

export function canSeeFeedEntry(
  entry: { visibility: RollVisibility; authorUserId: number | null; gmUserId: number | null },
  viewer: { userId: number },
): boolean {
  if (entry.visibility === 'public') return true;
  if (entry.visibility === 'hidden') return entry.authorUserId === viewer.userId;
  return entry.authorUserId === viewer.userId || entry.gmUserId === viewer.userId;
}

interface FeedRow {
  id: number;
  group_id: number;
  created_at: number;
  kind: 'message' | 'roll';
  visibility: RollVisibility;
  author_user_id: number | null;
  author_char_id: number | null;
  gm_user_id: number | null;
  author_name: string;
  is_me: number;
  text: string;
  roll_json: string | null;
  group_roll_id: string | null;
  is_coop: number;
  is_competitive: number;
  is_repeat: number;
}

// Zwei Vorgänger-Formen von `expression` liegen im Verlauf, jeweils vor einer
// eigenen Erweiterung: das ursprüngliche flache { count, sides, modifier }
// (vor gemischten Pools) und danach { groups, modifier } (vor der
// Dice-formula-Grammatik-Umstellung auf einen echten Ausdrucksbaum, siehe
// TODO.md "Dice formula overhaul"). Ältere Zeilen lassen sich nicht
// rückwirkend umschreiben — also beim Lesen einmalig heben, sonst stürzt die
// Anzeige an jedem älteren freien Wurf. Reihenfolge (Gruppen, dann
// Modifikator) bleibt erhalten, damit die bereits gespeicherten `dice`-Werte
// weiter zur rekonstruierten `sides`-Reihenfolge passen.
function migrateLegacyExpression(roll: RollPayload): RollPayload {
  if (roll.mode !== 'expr') return roll;
  const expr = roll.expression as unknown as {
    count?: number;
    sides?: number;
    modifier?: number;
    groups?: { count: number; sides: number }[];
  };
  const groups =
    expr && expr.groups === undefined && typeof expr.count === 'number' && typeof expr.sides === 'number'
      ? [{ count: expr.count, sides: expr.sides }]
      : expr?.groups;
  if (!groups) return roll; // schon der neue Baum
  let tree: FormulaNode | null = null;
  for (const g of groups) {
    const diceNode: FormulaNode = { kind: 'dice', count: g.count, sides: g.sides };
    tree = tree ? { kind: 'bin', op: '+', left: tree, right: diceNode } : diceNode;
  }
  const modifier = expr?.modifier ?? 0;
  if (!tree) tree = { kind: 'num', value: modifier };
  else if (modifier !== 0) tree = { kind: 'bin', op: '+', left: tree, right: { kind: 'num', value: modifier } };
  return { ...roll, expression: tree };
}

function rowToEntry(row: FeedRow): FeedEntry {
  if (row.kind === 'roll') {
    const roll = migrateLegacyExpression(JSON.parse(row.roll_json ?? '{}') as RollPayload);
    const entry: RollFeedEntry = {
      id: row.id,
      kind: 'roll',
      createdAt: row.created_at,
      visibility: row.visibility,
      authorUserId: row.author_user_id,
      authorCharId: row.author_char_id,
      gmUserId: row.gm_user_id,
      authorName: row.author_name,
      roll,
      ...(row.group_roll_id ? { groupRollId: row.group_roll_id } : {}),
      ...(row.is_coop ? { coop: true as const } : {}),
      ...(row.is_competitive ? { competitive: true as const } : {}),
      ...(row.is_repeat ? { repeat: true as const } : {}),
    };
    return entry;
  }
  const entry: ChatFeedEntry = {
    id: row.id,
    kind: 'message',
    createdAt: row.created_at,
    visibility: row.visibility,
    authorUserId: row.author_user_id,
    authorCharId: row.author_char_id,
    gmUserId: row.gm_user_id,
    authorName: row.author_name,
    isMe: !!row.is_me,
    text: row.text,
    ...(row.group_roll_id ? { groupRollId: row.group_roll_id } : {}),
  };
  return entry;
}

export function insertFeedMessage(
  groupId: number,
  author: FeedAuthor,
  text: string,
  isMe: boolean,
  groupRollId?: string,
  visibility: RollVisibility = 'public',
  gmUserId: number | null = null,
): FeedEntry {
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO group_feed (group_id, created_at, kind, visibility, author_user_id, author_char_id, gm_user_id, author_name, is_me, text, group_roll_id)
       VALUES (?, ?, 'message', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(groupId, createdAt, visibility, author.userId, author.charId, gmUserId, author.name, isMe ? 1 : 0, text, groupRollId ?? null);
  const entry: ChatFeedEntry = {
    id: Number(info.lastInsertRowid),
    kind: 'message',
    createdAt,
    visibility,
    authorUserId: author.userId,
    authorCharId: author.charId,
    gmUserId,
    authorName: author.name,
    isMe,
    text,
    ...(groupRollId ? { groupRollId } : {}),
  };
  broadcastToGroup(groupId, entry);
  return entry;
}

/**
 * Persists a roll WITHOUT broadcasting it.
 *
 * For the one case where the entry does not reach its readers through
 * feed.append: for a „großer Wurf" („/i") it travels inside roll.important and
 * each client appends it only once its own cinematic has finished (see ws.ts).
 * insertFeedRoll below is the ordinary path and the one to reach for.
 */
export function writeFeedRoll(
  groupId: number,
  author: FeedAuthor,
  gmUserId: number | null,
  visibility: RollVisibility,
  roll: RollPayload,
  groupRollId?: string,
  /** Nur bei einem aufgelösten Kooperationsprobe-/Wettstreit-Pool gesetzt — siehe coopPools.ts. */
  poolMode?: PoolMode,
  /** Nur bei einem per führendem "Nx" wiederholten freien Wurf gesetzt — siehe roll.expr in ws.ts. */
  repeat?: boolean,
): RollFeedEntry {
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO group_feed (group_id, created_at, kind, visibility, author_user_id, author_char_id, gm_user_id, author_name, roll_json, group_roll_id, is_coop, is_competitive, is_repeat)
       VALUES (?, ?, 'roll', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      groupId,
      createdAt,
      visibility,
      author.userId,
      author.charId,
      gmUserId,
      author.name,
      JSON.stringify(roll),
      groupRollId ?? null,
      poolMode === 'coop' ? 1 : 0,
      poolMode === 'competitive' ? 1 : 0,
      repeat ? 1 : 0,
    );
  const entry: RollFeedEntry = {
    id: Number(info.lastInsertRowid),
    kind: 'roll',
    createdAt,
    visibility,
    authorUserId: author.userId,
    authorCharId: author.charId,
    gmUserId,
    authorName: author.name,
    roll,
    ...(groupRollId ? { groupRollId } : {}),
    ...(poolMode === 'coop' ? { coop: true as const } : {}),
    ...(poolMode === 'competitive' ? { competitive: true as const } : {}),
    ...(repeat ? { repeat: true as const } : {}),
  };
  return entry;
}

export function insertFeedRoll(
  groupId: number,
  author: FeedAuthor,
  gmUserId: number | null,
  visibility: RollVisibility,
  roll: RollPayload,
  groupRollId?: string,
  poolMode?: PoolMode,
  repeat?: boolean,
): RollFeedEntry {
  const entry = writeFeedRoll(groupId, author, gmUserId, visibility, roll, groupRollId, poolMode, repeat);
  broadcastToGroup(groupId, entry);
  return entry;
}

/** Ein einzelner Eintrag, für Nachreichungen an einem bestehenden Wurf. */
export function loadFeedEntry(entryId: number): { entry: FeedEntry; groupId: number } | null {
  const row = db.prepare('SELECT * FROM group_feed WHERE id = ?').get(entryId) as FeedRow | undefined;
  if (!row) return null;
  return { entry: rowToEntry(row), groupId: row.group_id };
}

/**
 * Schreibt die Wurf-Nutzlast eines bestehenden Eintrags fort (nachgereichte
 * Bestätigung) und schickt den neuen Stand an alle, die ihn sehen dürfen.
 */
export function updateFeedRoll(entryId: number, groupId: number, roll: RollPayload): FeedEntry | null {
  db.prepare('UPDATE group_feed SET roll_json = ? WHERE id = ?').run(JSON.stringify(roll), entryId);
  const loaded = loadFeedEntry(entryId);
  if (!loaded) return null;
  broadcastUpdateToGroup(groupId, loaded.entry);
  return loaded.entry;
}

export function loadFeedPage(
  groupId: number,
  viewer: { userId: number },
  before: number | null,
  limit: number,
): { entries: FeedEntry[]; hasMore: boolean } {
  const entries: FeedEntry[] = [];
  let cursor = before;
  let hasMore = false;
  // Over-fetch in batches: visibility filtering happens after the SQL query,
  // so a straight LIMIT would under-fill the page whenever hidden rows are skipped.
  const BATCH = Math.max(limit * 2, 20);
  outer: for (;;) {
    const rows = (
      cursor === null
        ? db.prepare('SELECT * FROM group_feed WHERE group_id = ? ORDER BY id DESC LIMIT ?').all(groupId, BATCH)
        : db.prepare('SELECT * FROM group_feed WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(groupId, cursor, BATCH)
    ) as FeedRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (!canSeeFeedEntry(entry, viewer)) continue;
      if (entries.length === limit) {
        hasMore = true;
        break outer;
      }
      entries.push(entry);
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) break; // table exhausted, nothing left at all
  }
  return { entries, hasMore };
}
