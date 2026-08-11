import express, { Router } from 'express';
import { LIST_SECTION_IDS, MAX_TAB_KEYS, normalizeColumns, normalizeTabOrder, normalizeWidths } from 'shared';
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
  MAX_TABLE_COLUMNS,
  MAX_TABLE_KEY,
  buildSummary,
  deletePortrait,
  importFullCharacter,
  instantiateStandardSections,
  loadAbilities,
  loadAbilityLists,
  loadFullCharacter,
  loadItemCategories,
  loadItems,
  loadPortrait,
  manageAbilityList,
  migrateCharacterPeriphery,
  savePortrait,
  manageItemCategories,
  saveAbilities,
  saveItemCategories,
  saveItems,
  saveSection,
  saveTabOrder,
  saveTableWidths,
  saveVisibility,
  seedAbilitiesFromZauber,
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
  theme: string;
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

// Entwickler-Umschalter „Ansehen als": erlaubt einem Spielleiter, einen
// Charakter aus Sicht eines anderen Nutzers zu laden (Vorschau von
// Zusammenfassung bzw. „kein Zugriff"). Standardmäßig nur außerhalb der
// Produktion aktiv; per DEV_VIEW_AS=1 explizit einschaltbar. Wirkt rein lesend:
// er wählt nur die Ansicht, verleiht aber keine Schreibrechte.
const DEV_VIEW_AS = process.env.NODE_ENV !== 'production' || process.env.DEV_VIEW_AS === '1';

// Ermittelt den „Blickwinkel"-Nutzer für einen Request: normal req.user, im
// Ansehen-als-Modus (nur Spielleiter, nur wenn erlaubt) der gewählte Nutzer.
function viewerFor(req: import('express').Request): { viewer: { id: number; isGm: boolean }; viewAs: { id: number; name: string } | null } {
  const asUserId = Number(req.query.asUser);
  if (DEV_VIEW_AS && req.user!.isGm && asUserId && asUserId !== req.user!.id) {
    const target = db.prepare('SELECT id, display_name, is_gm FROM users WHERE id = ?').get(asUserId) as
      | { id: number; display_name: string; is_gm: number }
      | undefined;
    if (target) return { viewer: { id: target.id, isGm: !!target.is_gm }, viewAs: { id: target.id, name: target.display_name } };
  }
  return { viewer: { id: req.user!.id, isGm: req.user!.isGm }, viewAs: null };
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
  res.json({ ...req.user, devViewAs: DEV_VIEW_AS });
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

api.put('/me/displayName', requireAuth, (req, res) => {
  const displayName = (((req.body ?? {}) as { displayName?: string }).displayName ?? '').trim();
  if (!displayName) {
    res.status(400).json({ error: 'Anzeigename darf nicht leer sein' });
    return;
  }
  if (displayName.length > 60) {
    res.status(400).json({ error: 'Anzeigename darf höchstens 60 Zeichen haben' });
    return;
  }
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user!.id);
  res.json({ displayName });
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
  if (!char) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const { viewer, viewAs } = viewerFor(req);
  const access = characterAccess(viewer, char);
  // Ohne Ansehen-als bleibt „kein Zugriff" ein 404 (nichts verraten). Im
  // Ansehen-als-Modus ist es dagegen ein gültiges Vorschau-Ergebnis.
  if (!access && !viewAs) {
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
    theme: char.theme ?? '',
  };
  if (!access) {
    res.json({ character: info, access: null, viewAs });
    return;
  }
  if (access === 'summary') {
    res.json({ character: info, access, summary: buildSummary(char.id), viewAs });
    return;
  }
  res.json({ character: info, access, data: loadFullCharacter(char.id), viewAs });
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

// Spaltenbreiten einer eingebauten Tabelle (Talente, Waffen, feste Listen).
// Der Schlüssel steht im Rumpf statt im Pfad: er enthält Doppelpunkte und
// Tabellennamen wie „Körperliche Talente", die in einer URL nur Ärger machen.
// Normalisiert wird hier und nicht erst im Client — so liegen in der Datenbank
// ausschließlich Sätze, die sich auf 100 summieren, egal wer sie geschickt hat.
api.put('/characters/:id/table-widths', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const { key, widths } = (req.body ?? {}) as { key?: unknown; widths?: unknown };
  const tableKey = String(key ?? '').trim();
  if (!tableKey || tableKey.length > MAX_TABLE_KEY) {
    res.status(400).json({ error: 'Ungültiger Tabellen-Schlüssel' });
    return;
  }
  if (!Array.isArray(widths) || widths.length === 0 || widths.length > MAX_TABLE_COLUMNS) {
    res.status(400).json({ error: 'Ungültige Spaltenbreiten' });
    return;
  }
  const clean = normalizeWidths(widths as (number | undefined)[]);
  saveTableWidths(char.id, tableKey, clean);
  res.json({ widths: clean });
});

// Reihenfolge der Reiter. Die Liste enthält eingebaute Reiter unter ihrem Namen
// und selbst angelegte als „c<id>“ — welche Schlüssel es gibt, entscheidet der
// Client. Hier wird nur gesäubert (Doppelte, Leeres, zu lange Einträge) und die
// bereinigte Liste zurückgegeben, damit Anzeige und Datenbank übereinstimmen.
api.put('/characters/:id/tab-order', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const { order } = (req.body ?? {}) as { order?: unknown };
  if (!Array.isArray(order) || order.length > MAX_TAB_KEYS) {
    res.status(400).json({ error: 'Ungültige Reiter-Reihenfolge' });
    return;
  }
  const clean = normalizeTabOrder(order);
  saveTabOrder(char.id, clean);
  res.json({ order: clean });
});

// Umbenennen. Anders als PUT /characters/:id (nur Spielleiter, ändert auch
// Besitzer und Gruppe) genügt hier das Bearbeitungsrecht — die Spielerin darf
// ihren eigenen Charakter also selbst umbenennen. Zurück kommt der wirklich
// gespeicherte Name, damit die Anzeige nicht vom Datenbankstand abweicht.
const MAX_CHAR_NAME = 60;

api.put('/characters/:id/name', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const name = String(((req.body ?? {}) as { name?: unknown }).name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'Name darf nicht leer sein' });
    return;
  }
  if (name.length > MAX_CHAR_NAME) {
    res.status(400).json({ error: `Name darf höchstens ${MAX_CHAR_NAME} Zeichen lang sein` });
    return;
  }
  db.prepare('UPDATE characters SET name = ? WHERE id = ?').run(name, char.id);
  res.json({ name });
});

// --- Gegenstände (Cluster 5) — ganze Liste bzw. Kategorienliste ersetzen.
// Server normalisiert und antwortet mit dem gespeicherten Stand, damit Anzeige
// und Datenbank übereinstimmen. ---
api.put('/characters/:id/items', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  saveItems(char.id, req.body);
  res.json({ items: loadItems(char.id) });
});

api.put('/characters/:id/item-categories', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  saveItemCategories(char.id, req.body);
  res.json({ categories: loadItemCategories(char.id) });
});

// Kategorien mit Kaskade verwalten (Einstellungen-Seite): Umbenennen/Entfernen
// zieht die Gegenstände mit. Body: { order, renames:[{from,to}], removes:[name] }.
api.put('/characters/:id/item-categories/manage', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  res.json({ categories: manageItemCategories(char.id, req.body) });
});

// --- Zauber & Fähigkeiten (Cluster 6) ---

// Ganze Stammliste ersetzen (wie /items). Die Reiter zeigen daraus nur an.
api.put('/characters/:id/abilities', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  saveAbilities(char.id, req.body);
  res.json({ abilities: loadAbilities(char.id) });
});

// Element- oder Kategorie-Liste verwalten (mit Kaskade auf die Einträge).
// Body: { kind: 'element'|'kategorie', order, renames:[{from,to}], removes:[name] }.
api.put('/characters/:id/ability-lists/manage', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const kind = String((req.body as { kind?: unknown })?.kind ?? 'kategorie');
  res.json({ abilityLists: manageAbilityList(char.id, kind, req.body) });
});

// Einmaliger Seed-Import aus dem alten dynamischen „Zauber/Fähigkeiten"-Reiter.
// Löscht nichts (der alte Reiter bleibt bestehen); befüllt nur die leere
// Stammliste vor. Läuft nur, wenn noch keine Einträge existieren.
api.post('/characters/:id/abilities/seed', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const result = seedAbilitiesFromZauber(char.id);
  res.json({ ...result, abilities: loadAbilities(char.id), abilityLists: loadAbilityLists(char.id) });
});

// Farbwelt des Charakters (per-Charakter-Theme). Server speichert die Id als
// kurze Zeichenkette; welche Ids gültig sind, weiß der Client (er kappt beim
// Anwenden auf seine Vorgabe). '' = keine eigene Farbwelt.
api.put('/characters/:id/theme', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const theme = String((req.body as { theme?: unknown })?.theme ?? '').slice(0, 40);
  db.prepare('UPDATE characters SET theme = ? WHERE id = ?').run(theme, char.id);
  res.json({ theme });
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

// --- Porträt (Bild-Blob) ---
// Anschauen darf jeder mit Zugriff (auch Gruppenmitglieder in der Zusammenfassung),
// setzen/löschen nur mit Bearbeitungsrecht.
api.get('/characters/:id/portrait', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || !characterAccess(req.user!, char)) {
    res.status(404).end();
    return;
  }
  const p = loadPortrait(char.id);
  if (!p) {
    res.status(404).end();
    return;
  }
  res.type(p.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(p.data);
});

api.put(
  '/characters/:id/portrait',
  requireAuth,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
  (req, res) => {
    const char = editableChar(req, res);
    if (!char) return;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'Kein Bild empfangen' });
      return;
    }
    const mime = String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0].trim();
    savePortrait(char.id, mime, buf);
    res.json({ ok: true });
  },
);

api.delete('/characters/:id/portrait', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  deletePortrait(char.id);
  res.json({ ok: true });
});

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

// Charakter aus einer exportierten JSON-Datei anlegen. Immer als neuer
// Charakter (nie überschreibend), Name mit Zusatz „(Imported)“. Nur Spielleiter.
api.post('/admin/characters/import', requireAuth, requireGm, (req, res) => {
  const { ownerUserId, groupId, payload } = (req.body ?? {}) as {
    ownerUserId?: number;
    groupId?: number;
    payload?: { schema?: string; name?: string; data?: unknown };
  };
  if (!ownerUserId || !groupId) {
    res.status(400).json({ error: 'Besitzer und Gruppe erforderlich' });
    return;
  }
  if (!payload || payload.schema !== 'helden-character' || !payload.data || typeof payload.data !== 'object') {
    res.status(400).json({ error: 'Keine gültige Charakter-Datei' });
    return;
  }
  const owner = db.prepare('SELECT 1 FROM users WHERE id = ?').get(Number(ownerUserId));
  const group = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(Number(groupId));
  if (!owner || !group) {
    res.status(400).json({ error: 'Besitzer oder Gruppe unbekannt' });
    return;
  }
  const baseName = String(payload.name ?? 'Charakter').trim() || 'Charakter';
  try {
    const newId = importFullCharacter(
      `${baseName} (Imported)`,
      Number(ownerUserId),
      Number(groupId),
      payload.data as Parameters<typeof importFullCharacter>[3],
    );
    res.json({ id: newId });
  } catch (e) {
    res.status(400).json({ error: `Import fehlgeschlagen: ${e instanceof Error ? e.message : e}` });
  }
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
