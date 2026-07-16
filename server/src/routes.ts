import { Router } from 'express';
import { LIST_SECTION_IDS, normalizeColumns } from 'shared';
import {
  createSession,
  destroySession,
  getSessionToken,
  hashPassword,
  requireAuth,
  requireGm,
  SESSION_TTL_DAYS,
  verifyPassword,
} from './auth.js';
import { db, initCharacterRows } from './db.js';
import {
  buildSummary,
  instantiateStandardSections,
  loadFullCharacter,
  migrateCharacterPeriphery,
  saveSection,
  saveVisibility,
} from './characterData.js';
import {
  CHAR_DYN,
  GROUP_DYN,
  createDynSection,
  createTab,
  deleteDynSection,
  deleteTab,
  instantiateGroupTabs,
  loadDynTabs,
  renameTab,
  reorderDynSections,
  reorderTabs,
  saveDynRows,
  sectionBelongsTo,
  tabBelongsTo,
  tabIsLocked,
  updateDynSection,
} from './dynSections.js';

export const api = Router();

// Hinter einem HTTPS-Reverse-Proxy SECURE_COOKIES=1 setzen, damit das
// Sitzungs-Cookie nur über verschlüsselte Verbindungen übertragen wird.
const SECURE_COOKIES = /^(1|true)$/i.test(process.env.SECURE_COOKIES ?? '');
function sessionCookie(token: string, maxAgeSec: number): string {
  const parts = [`helden_session=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (SECURE_COOKIES) parts.push('Secure');
  return parts.join('; ');
}

interface CharRow {
  id: number;
  name: string;
  owner_user_id: number;
  group_id: number;
}

function getChar(id: number): CharRow | undefined {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as CharRow | undefined;
}

function isGroupMember(userId: number, groupId: number): boolean {
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

type Access = 'edit' | 'summary' | null;

function characterAccess(user: { id: number; isGm: boolean }, char: CharRow): Access {
  if (user.isGm || char.owner_user_id === user.id) return 'edit';
  if (isGroupMember(user.id, char.group_id)) return 'summary';
  return null;
}

const SECTION_IDS = new Set(['bio', 'meta', 'attributes', 'baseValues', 'resources', 'talents', 'languages', ...LIST_SECTION_IDS]);

// --- Auth ---

api.post('/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username ?? '') as
    | { id: number; username: string; password_hash: string; display_name: string; is_gm: number }
    | undefined;
  if (!user || !verifyPassword(password ?? '', user.password_hash)) {
    res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    return;
  }
  const token = createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_DAYS * 24 * 60 * 60));
  res.json({ id: user.id, username: user.username, displayName: user.display_name, isGm: !!user.is_gm });
});

api.post('/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) destroySession(token);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

api.put('/me/password', requireAuth, (req, res) => {
  const { password } = (req.body ?? {}) as { password?: string };
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user!.id);
  res.json({ ok: true });
});

// --- Kataloge ---

api.get('/catalogs', requireAuth, (_req, res) => {
  const talents = db.prepare('SELECT * FROM talents_catalog ORDER BY sort').all();
  const languages = db.prepare('SELECT * FROM languages_catalog ORDER BY sort').all();
  res.json({ talents, languages });
});

// --- Dashboard / Gruppen ---

api.get('/overview', requireAuth, (req, res) => {
  const user = req.user!;
  const characters = user.isGm
    ? db.prepare('SELECT * FROM characters ORDER BY name').all()
    : db.prepare('SELECT * FROM characters WHERE owner_user_id = ? ORDER BY name').all(user.id);
  const groups = user.isGm
    ? db.prepare('SELECT * FROM groups ORDER BY name').all()
    : db.prepare('SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name').all(user.id);
  res.json({ characters, groups });
});

api.get('/groups/:id', requireAuth, (req, res) => {
  const groupId = Number(req.params.id);
  const user = req.user!;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as { id: number; name: string } | undefined;
  if (!group || (!user.isGm && !isGroupMember(user.id, groupId))) {
    res.status(404).json({ error: 'Gruppe nicht gefunden' });
    return;
  }
  const members = db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`,
    )
    .all(groupId);
  const chars = db
    .prepare(
      `SELECT c.id, c.name, c.owner_user_id AS ownerUserId, u.display_name AS ownerName
       FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.group_id = ? ORDER BY c.name`,
    )
    .all(groupId) as { id: number; name: string; ownerUserId: number; ownerName: string }[];
  const characters = chars.map((c) => {
    const access = characterAccess(user, getChar(c.id)!);
    return { ...c, access };
  });
  // Standard-Tabs nachziehen (idempotent) — so bekommen auch Gruppen,
  // die es vor diesem Feature schon gab, ihre Inhalte
  instantiateGroupTabs(groupId);
  res.json({ group, members, characters, tabs: loadDynTabs(groupId, GROUP_DYN) });
});

// --- Gemeinsame Gruppeninhalte (jedes Gruppenmitglied darf bearbeiten) ---

function editableGroup(req: import('express').Request, res: import('express').Response): number | null {
  const groupId = Number(req.params.id);
  const user = req.user!;
  const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId);
  if (!exists || (!user.isGm && !isGroupMember(user.id, groupId))) {
    res.status(404).json({ error: 'Gruppe nicht gefunden' });
    return null;
  }
  return groupId;
}

api.post('/groups/:id/tabs', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const { name } = (req.body ?? {}) as { name?: string };
  res.json({ id: createTab(groupId, String(name ?? 'Neuer Tab'), false, GROUP_DYN) });
});

api.put('/groups/:id/tabs/reorder', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).map(Number) : [];
  reorderTabs(groupId, order, GROUP_DYN);
  res.json({ ok: true });
});

api.put('/groups/:id/tabs/:tid', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const tid = Number(req.params.tid);
  if (!tabBelongsTo(tid, groupId, GROUP_DYN)) {
    res.status(404).json({ error: 'Tab nicht gefunden' });
    return;
  }
  const { name } = (req.body ?? {}) as { name?: string };
  if (name !== undefined) renameTab(tid, String(name), GROUP_DYN);
  res.json({ ok: true });
});

api.delete('/groups/:id/tabs/:tid', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const tid = Number(req.params.tid);
  if (!tabBelongsTo(tid, groupId, GROUP_DYN)) {
    res.status(404).json({ error: 'Tab nicht gefunden' });
    return;
  }
  if (tabIsLocked(tid, GROUP_DYN)) {
    res.status(400).json({ error: 'Pflicht-Tab kann nicht gelöscht werden' });
    return;
  }
  deleteTab(tid, GROUP_DYN);
  res.json({ ok: true });
});

api.post('/groups/:id/sections', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const { tabId, name, type, columns } = (req.body ?? {}) as { tabId?: number; name?: string; type?: string; columns?: unknown };
  if (!tabId || !tabBelongsTo(Number(tabId), groupId, GROUP_DYN)) {
    res.status(400).json({ error: 'Tab nicht gefunden' });
    return;
  }
  const id = createDynSection(
    groupId,
    Number(tabId),
    String(name ?? 'Neue Sektion'),
    type === 'notes' ? 'notes' : 'table',
    normalizeColumns(columns),
    GROUP_DYN,
  );
  res.json({ id });
});

api.put('/groups/:id/sections/reorder', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).map(Number) : [];
  reorderDynSections(groupId, order, GROUP_DYN);
  res.json({ ok: true });
});

api.put('/groups/:id/sections/:sid', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, groupId, GROUP_DYN)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  const body = (req.body ?? {}) as { name?: string; columns?: unknown; visible?: boolean };
  const patch: { name?: string; columns?: ReturnType<typeof normalizeColumns>; visible?: boolean } = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.columns !== undefined) patch.columns = normalizeColumns(body.columns);
  if (body.visible !== undefined) patch.visible = !!body.visible;
  updateDynSection(sid, patch, GROUP_DYN);
  res.json({ ok: true });
});

api.delete('/groups/:id/sections/:sid', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, groupId, GROUP_DYN)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  deleteDynSection(sid, GROUP_DYN);
  res.json({ ok: true });
});

api.put('/groups/:id/sections/:sid/rows', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, groupId, GROUP_DYN)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  saveDynRows(sid, Array.isArray(req.body) ? (req.body as Record<string, unknown>[]) : [], GROUP_DYN);
  res.json({ ok: true });
});

// --- Charaktere ---

api.get('/characters/:id', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  const access = char ? characterAccess(req.user!, char) : null;
  if (!char || !access) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(char.owner_user_id) as { display_name: string };
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(char.group_id) as { name: string };
  const info = {
    id: char.id,
    name: char.name,
    ownerUserId: char.owner_user_id,
    ownerName: owner?.display_name ?? '',
    groupId: char.group_id,
    groupName: group?.name ?? '',
  };
  if (access === 'summary') {
    res.json({ character: info, access, summary: buildSummary(char.id) });
    return;
  }
  res.json({ character: info, access, data: loadFullCharacter(char.id) });
});

api.put('/characters/:id/section/:section', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const section = String(req.params.section);
  if (!SECTION_IDS.has(section)) {
    res.status(400).json({ error: `Unbekannte Sektion: ${section}` });
    return;
  }
  saveSection(char.id, section, req.body);
  res.json({ ok: true });
});

api.put('/characters/:id/visibility', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  saveVisibility(char.id, (req.body ?? {}) as Record<string, unknown>);
  res.json({ ok: true });
});

// --- Datengesteuerte Sektionen (nur mit Bearbeitungsrecht) ---

function editableChar(req: import('express').Request, res: import('express').Response): CharRow | null {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return null;
  }
  return char;
}

// Tabs
api.post('/characters/:id/tabs', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const { name } = (req.body ?? {}) as { name?: string };
  const id = createTab(char.id, String(name ?? 'Neuer Tab'), false);
  res.json({ id });
});

api.put('/characters/:id/tabs/reorder', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).map(Number) : [];
  reorderTabs(char.id, order);
  res.json({ ok: true });
});

api.put('/characters/:id/tabs/:tid', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const tid = Number(req.params.tid);
  if (!tabBelongsTo(tid, char.id)) {
    res.status(404).json({ error: 'Tab nicht gefunden' });
    return;
  }
  const { name } = (req.body ?? {}) as { name?: string };
  if (name !== undefined) renameTab(tid, String(name));
  res.json({ ok: true });
});

api.delete('/characters/:id/tabs/:tid', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const tid = Number(req.params.tid);
  if (!tabBelongsTo(tid, char.id)) {
    res.status(404).json({ error: 'Tab nicht gefunden' });
    return;
  }
  if (tabIsLocked(tid)) {
    res.status(400).json({ error: 'Pflicht-Tab kann nicht gelöscht werden' });
    return;
  }
  deleteTab(tid);
  res.json({ ok: true });
});

// Sektionen (innerhalb eines Tabs)
api.post('/characters/:id/sections', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const { tabId, name, type, columns } = (req.body ?? {}) as { tabId?: number; name?: string; type?: string; columns?: unknown };
  if (!tabId || !tabBelongsTo(Number(tabId), char.id)) {
    res.status(400).json({ error: 'Tab nicht gefunden' });
    return;
  }
  const id = createDynSection(char.id, Number(tabId), String(name ?? 'Neue Sektion'), type === 'notes' ? 'notes' : 'table', normalizeColumns(columns));
  res.json({ id });
});

api.put('/characters/:id/sections/reorder', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).map(Number) : [];
  reorderDynSections(char.id, order);
  res.json({ ok: true });
});

api.put('/characters/:id/sections/:sid', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, char.id)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  const body = (req.body ?? {}) as { name?: string; columns?: unknown; visible?: boolean };
  const patch: { name?: string; columns?: ReturnType<typeof normalizeColumns>; visible?: boolean } = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.columns !== undefined) patch.columns = normalizeColumns(body.columns);
  if (body.visible !== undefined) patch.visible = !!body.visible;
  updateDynSection(sid, patch);
  res.json({ ok: true });
});

api.delete('/characters/:id/sections/:sid', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, char.id)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  deleteDynSection(sid);
  res.json({ ok: true });
});

api.put('/characters/:id/sections/:sid/rows', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const sid = Number(req.params.sid);
  if (!sectionBelongsTo(sid, char.id)) {
    res.status(404).json({ error: 'Sektion nicht gefunden' });
    return;
  }
  saveDynRows(sid, Array.isArray(req.body) ? (req.body as Record<string, unknown>[]) : []);
  res.json({ ok: true });
});

api.put('/characters/:id', requireAuth, requireGm, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const { name, ownerUserId, groupId } = (req.body ?? {}) as { name?: string; ownerUserId?: number; groupId?: number };
  db.prepare('UPDATE characters SET name = ?, owner_user_id = ?, group_id = ? WHERE id = ?').run(
    name ?? char.name,
    ownerUserId ?? char.owner_user_id,
    groupId ?? char.group_id,
    char.id,
  );
  res.json({ ok: true });
});

api.delete('/characters/:id', requireAuth, requireGm, (req, res) => {
  db.prepare('DELETE FROM characters WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Verwaltung (nur Spielleiter) ---

api.get('/admin/users', requireAuth, requireGm, (_req, res) => {
  res.json(db.prepare('SELECT id, username, display_name AS displayName, is_gm AS isGm FROM users ORDER BY username').all());
});

api.post('/admin/users', requireAuth, requireGm, (req, res) => {
  const { username, password, displayName, isGm } = (req.body ?? {}) as {
    username?: string;
    password?: string;
    displayName?: string;
    isGm?: boolean;
  };
  if (!username || !password) {
    res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    return;
  }
  try {
    const r = db
      .prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?, ?, ?, ?)')
      .run(username, hashPassword(password), displayName ?? username, isGm ? 1 : 0);
    res.json({ id: r.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Benutzername bereits vergeben' });
  }
});

api.put('/admin/users/:id', requireAuth, requireGm, (req, res) => {
  const id = Number(req.params.id);
  const { password, displayName, isGm } = (req.body ?? {}) as { password?: string; displayName?: string; isGm?: boolean };
  if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
  if (isGm !== undefined) db.prepare('UPDATE users SET is_gm = ? WHERE id = ?').run(isGm ? 1 : 0, id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  res.json({ ok: true });
});

api.delete('/admin/users/:id', requireAuth, requireGm, (req, res) => {
  const id = Number(req.params.id);
  const owned = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE owner_user_id = ?').get(id) as { n: number };
  if (owned.n > 0) {
    res.status(400).json({ error: 'Benutzer besitzt noch Charaktere' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

api.get('/admin/groups', requireAuth, requireGm, (_req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY name').all() as { id: number; name: string }[];
  const members = db.prepare('SELECT group_id, user_id FROM group_members').all() as { group_id: number; user_id: number }[];
  res.json(
    groups.map((g) => ({ ...g, memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.user_id) })),
  );
});

api.post('/admin/groups', requireAuth, requireGm, (req, res) => {
  const { name } = (req.body ?? {}) as { name?: string };
  if (!name) {
    res.status(400).json({ error: 'Name erforderlich' });
    return;
  }
  const r = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  const id = Number(r.lastInsertRowid);
  instantiateGroupTabs(id);
  res.json({ id });
});

api.put('/admin/groups/:id', requireAuth, requireGm, (req, res) => {
  const id = Number(req.params.id);
  const { name, memberIds } = (req.body ?? {}) as { name?: string; memberIds?: number[] };
  if (name) db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
  if (Array.isArray(memberIds)) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      const stmt = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');
      for (const uid of memberIds) stmt.run(id, Number(uid));
    });
    tx();
  }
  res.json({ ok: true });
});

api.delete('/admin/groups/:id', requireAuth, requireGm, (req, res) => {
  const id = Number(req.params.id);
  const chars = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE group_id = ?').get(id) as { n: number };
  if (chars.n > 0) {
    res.status(400).json({ error: 'Gruppe enthält noch Charaktere' });
    return;
  }
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Kataloge bearbeiten (nur Spielleiter) ---

const CATALOGS = {
  talents: {
    table: 'talents_catalog',
    refTable: 'char_talents',
    refCol: 'talent_id',
    cols: ['kategorie', 'gruppe', 'name', 'probe', 'ableiten', 'skill100', 'sort'],
  },
  languages: {
    table: 'languages_catalog',
    refTable: 'char_languages',
    refCol: 'language_id',
    cols: ['kind', 'familie', 'name', 'komplexitaet', 'sort'],
  },
} as const;

function catalogDef(type: string) {
  return type in CATALOGS ? CATALOGS[type as keyof typeof CATALOGS] : null;
}

api.post('/admin/catalogs/:type', requireAuth, requireGm, (req, res) => {
  const def = catalogDef(String(req.params.type));
  if (!def) {
    res.status(400).json({ error: 'Unbekannter Katalog' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body.name) {
    res.status(400).json({ error: 'Name erforderlich' });
    return;
  }
  const values = def.cols.map((c) => (c === 'sort' ? Number(body[c]) || 0 : String(body[c] ?? '')));
  const r = db
    .prepare(`INSERT INTO ${def.table} (${def.cols.join(', ')}) VALUES (${def.cols.map(() => '?').join(', ')})`)
    .run(...values);
  res.json({ id: r.lastInsertRowid });
});

api.put('/admin/catalogs/:type/:id', requireAuth, requireGm, (req, res) => {
  const def = catalogDef(String(req.params.type));
  if (!def) {
    res.status(400).json({ error: 'Unbekannter Katalog' });
    return;
  }
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cols = def.cols.filter((c) => c in body);
  if (cols.length === 0) {
    res.status(400).json({ error: 'Keine Felder' });
    return;
  }
  const values = cols.map((c) => (c === 'sort' ? Number(body[c]) || 0 : String(body[c] ?? '')));
  db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  res.json({ ok: true });
});

api.delete('/admin/catalogs/:type/:id', requireAuth, requireGm, (req, res) => {
  const def = catalogDef(String(req.params.type));
  if (!def) {
    res.status(400).json({ error: 'Unbekannter Katalog' });
    return;
  }
  const id = Number(req.params.id);
  const used = db.prepare(`SELECT COUNT(*) AS n FROM ${def.refTable} WHERE ${def.refCol} = ?`).get(id) as { n: number };
  if (used.n > 0) {
    res.status(400).json({ error: `Eintrag wird von ${used.n} Charakter(en) verwendet` });
    return;
  }
  db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
  res.json({ ok: true });
});

api.post('/admin/characters', requireAuth, requireGm, (req, res) => {
  const { name, ownerUserId, groupId } = (req.body ?? {}) as { name?: string; ownerUserId?: number; groupId?: number };
  if (!name || !ownerUserId || !groupId) {
    res.status(400).json({ error: 'Name, Besitzer und Gruppe erforderlich' });
    return;
  }
  const r = db.prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, ?)').run(name, ownerUserId, groupId);
  const newId = Number(r.lastInsertRowid);
  initCharacterRows(newId);
  instantiateStandardSections(newId);
  res.json({ id: newId });
});

// Einmalige Migration bestehender Listendaten in generische Sektionen
api.post('/admin/characters/:id/migrate-sections', requireAuth, requireGm, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const result = migrateCharacterPeriphery(char.id);
  res.json(result);
});
