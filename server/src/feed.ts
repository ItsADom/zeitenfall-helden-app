// Visibility filtering and persistence for the group feed (chat + rolls).
// canSeeFeedEntry is the ONE place this predicate lives — used identically
// for live broadcast (ws.ts) and history pagination (loadFeedPage below) so
// the two views can't drift apart. Deliberately takes NO isGm parameter:
// 'hidden' excludes the GM too, the one deliberate exception to this app's
// usual "GM sees everything" pattern.
import type { ChatFeedEntry, FeedEntry, RollFeedEntry, RollPayload, RollVisibility } from 'shared';
import { db } from './db.js';
import { broadcastToGroup } from './ws.js';

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
}

function rowToEntry(row: FeedRow): FeedEntry {
  if (row.kind === 'roll') {
    const roll = JSON.parse(row.roll_json ?? '{}') as RollPayload;
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
  };
  return entry;
}

export function insertFeedMessage(groupId: number, author: FeedAuthor, text: string, isMe: boolean): FeedEntry {
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO group_feed (group_id, created_at, kind, visibility, author_user_id, author_char_id, gm_user_id, author_name, is_me, text)
       VALUES (?, ?, 'message', 'public', ?, ?, NULL, ?, ?, ?)`,
    )
    .run(groupId, createdAt, author.userId, author.charId, author.name, isMe ? 1 : 0, text);
  const entry: ChatFeedEntry = {
    id: Number(info.lastInsertRowid),
    kind: 'message',
    createdAt,
    visibility: 'public',
    authorUserId: author.userId,
    authorCharId: author.charId,
    gmUserId: null,
    authorName: author.name,
    isMe,
    text,
  };
  broadcastToGroup(groupId, entry);
  return entry;
}

export function insertFeedRoll(
  groupId: number,
  author: FeedAuthor,
  gmUserId: number | null,
  visibility: RollVisibility,
  roll: RollPayload,
): FeedEntry {
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO group_feed (group_id, created_at, kind, visibility, author_user_id, author_char_id, gm_user_id, author_name, roll_json)
       VALUES (?, ?, 'roll', ?, ?, ?, ?, ?, ?)`,
    )
    .run(groupId, createdAt, visibility, author.userId, author.charId, gmUserId, author.name, JSON.stringify(roll));
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
  };
  broadcastToGroup(groupId, entry);
  return entry;
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
