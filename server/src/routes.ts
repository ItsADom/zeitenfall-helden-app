import express, { Router } from 'express';
import { ACCESS_DENIED, LIST_SECTION_IDS, MAX_TAB_KEYS, normalizeColumns, normalizeTabOrder, normalizeWidths } from 'shared';
import type { UserInfo } from 'shared';
import { instanceGate, mayEnter } from './accessGate.js';
import {
  createSession,
  destroySession,
  getSessionToken,
  hashPassword,
  requireAdmin,
  requireAuth,
  requireGm,
  requireGmOrAdmin,
  SESSION_TTL_DAYS,
  verifyPassword,
} from './auth.js';
import type { SessionUser } from './auth.js';
import { createAttemptLimiter, clientIp } from './rateLimit.js';
import { wikiApi } from './wiki/router.js';
import { loescheAssetsFuer } from './assets/store.js';
import {
  hatGruppenPortrait,
  ladeGruppenPortrait,
  loescheGruppenPortrait,
  speichereGruppenPortrait,
} from './assets/portraits.js';
import { db, initCharacterRows } from './db.js';
import { loadFeedPage } from './feed.js';
import { listRollableProbes } from './diceSource.js';
import { broadcastWartung, pushSchicksalspunkte } from './ws.js';
import { BOOT_ID, deployLaeuft, deployVerfuegbar, leseDeployStatus, stossDeployAn } from './deploy.js';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_KEY,
  addCharTag,
  buildGroupOverview,
  buildSummary,
  removeCharTag,
  setGmNotiz,
  talentCatalogList,
  tagCatalogList,
  deletePortrait,
  importFullCharacter,
  instantiateStandardSections,
  loadAbilities,
  loadAbilityLists,
  loadFullCharacter,
  loadItemCategories,
  loadItems,
  loadPouches,
  hasPortrait,
  loadPortrait,
  manageAbilityList,
  migrateCharacterPeriphery,
  savePortrait,
  manageItemCategories,
  saveAbilities,
  saveItemCategories,
  saveItems,
  savePouches,
  saveSection,
  saveTabOrder,
  saveTableWidths,
  saveVisibility,
  seedAbilitiesFromZauber,
  retireOldZauberTab,
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

// Liveness probe for the waiting screen of an admin-triggered redeploy — the
// one route deliberately registered ABOVE the instance gate, and the only one.
// On the dev instance that gate answers 403 to an authenticated player, and
// this endpoint has to keep working precisely when everything else is
// uncertain. It therefore carries no authentication and says as little as it
// possibly can: no commit, no version, no path. The boot id is a random value
// per process start and identifies nothing but "this is a different process
// than the one you were talking to".
//
// `wartung` is the single bit beyond liveness, and it earns its place: the
// announcement over the WebSocket necessarily goes out BEFORE anyone knows
// whether there is anything to deploy, so without it a run that ends in
// "already up to date" would leave every other browser waiting for a restart
// that never comes. It discloses nothing an observer could not see anyway by
// watching the site go briefly unavailable.
api.get('/health', (_req, res) => {
  res.json({ ok: true, boot: BOOT_ID, wartung: deployLaeuft() });
});

// Instance access gate — MUST stay the first middleware on the api router, and
// nothing but /health may be registered above it. A sub-router mounted above
// this line (api.use('/wiki', wikiApi), say) would bypass the gate entirely.
// Without RESTRICT_TO_ROLES this is a no-op, so nothing changes in production.
api.use(instanceGate);

// Das Wiki bringt seine eigenen Routen, seinen eigenen Zugriffscheck und sein
// eigenes Schema mit (server/src/wiki/) und hängt sich hier mit einer Zeile ein
// — statt diese Datei weiter wachsen zu lassen.
api.use('/wiki', wikiApi);

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
  // NULL, solange der Charakter keiner Gruppe angehört (Selbst-Anlage vor der
  // Freigabe oder eine abgelehnte Anfrage). requested_group_id trägt die vom
  // Spieler erbetene Gruppe, bis Spielleitung/Verwaltung entscheidet.
  group_id: number | null;
  requested_group_id: number | null;
  requested_at: number | null;
  theme: string;
  dice_shortcuts: string;
  chat_name: string;
}

function getChar(id: number): CharRow | undefined {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as CharRow | undefined;
}

// Mitgliedschaft ist rein abgeleitet: wer einen Charakter in der Gruppe
// besitzt, ist Mitglied. Es gibt keine eigenständige Spieler-Gruppe-Zuordnung
// mehr (siehe Migration in db.ts).
export function isGroupMember(userId: number, groupId: number): boolean {
  return !!db.prepare('SELECT 1 FROM characters WHERE group_id = ? AND owner_user_id = ?').get(groupId, userId);
}

/** Additive Mitgliedschaft einer Event-Gruppe (temp_group_members) statt der festen characters.group_id. */
export function isTempGroupMember(userId: number, groupId: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM temp_group_members tgm JOIN characters c ON c.id = tgm.character_id
       WHERE tgm.temp_group_id = ? AND c.owner_user_id = ?`,
    )
    .get(groupId, userId);
}

/** Mitglied dieser Gruppe, egal ob fest oder additiv über eine Event-Gruppe. */
export function isRoomMember(userId: number, groupId: number): boolean {
  return isGroupMember(userId, groupId) || isTempGroupMember(userId, groupId);
}

type Access = 'edit' | 'summary' | null;

function characterAccess(user: { id: number; isGm: boolean }, char: CharRow): Access {
  if (user.isGm || char.owner_user_id === user.id) return 'edit';
  // Gruppenlose Charaktere (group_id NULL) sind für Nicht-Besitzer unsichtbar.
  if (char.group_id != null && isGroupMember(user.id, char.group_id)) return 'summary';
  return null;
}

// Entwickler-Umschalter „Ansehen als": erlaubt einem Spielleiter, einen
// Charakter aus Sicht eines anderen Nutzers zu laden (Vorschau von
// Zusammenfassung bzw. „kein Zugriff"). Standardmäßig nur außerhalb der
// Produktion aktiv; per DEV_VIEW_AS=1 explizit einschaltbar. Wirkt rein lesend:
// er wählt nur die Ansicht, verleiht aber keine Schreibrechte.
const DEV_VIEW_AS = process.env.NODE_ENV !== 'production' || process.env.DEV_VIEW_AS === '1';

// The single place that builds the user record the client receives. Login and
// /api/me have to answer with the same shape: built separately, the login
// response silently omitted devViewAs, so a freshly logged-in GM saw no
// "Ansehen als" bar until a full page reload replaced the record via /api/me.
function userInfo(u: SessionUser): UserInfo {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isGm: u.isGm,
    isAdmin: u.isAdmin,
    devViewAs: DEV_VIEW_AS,
  };
}

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

const SECTION_IDS = new Set(['bio', 'meta', 'attributes', 'baseValues', 'resources', 'special', 'attrExtern', 'talents', 'languages', ...LIST_SECTION_IDS]);

// --- Auth ---

// Brute-Force-Bremse am Login. Zwei Fenster (10 min): pro Konto (IP+Name) eng,
// pro IP insgesamt weiter — so wird gezieltes Raten eines Kontos wie auch das
// Durchprobieren vieler Namen gebremst, ohne echte Nutzer zu sperren (nur
// FEHLversuche zählen, ein Erfolg setzt das Konto-Fenster zurück). Die Zahlen
// sind großzügig: ein Haushalt mit mehreren Spielern hinter einer IP tippt sich
// nicht versehentlich aus.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const perAccount = createAttemptLimiter({ windowMs: LOGIN_WINDOW_MS, max: 8 });
const perIp = createAttemptLimiter({ windowMs: LOGIN_WINDOW_MS, max: 40 });

api.post('/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const ip = clientIp(req);
  const acctKey = `${ip}|${(username ?? '').toLowerCase()}`;

  // Gesperrt? Die längere der beiden Wartezeiten melden.
  const retry = Math.max(perAccount.blocked(acctKey) || 0, perIp.blocked(ip) || 0);
  if (retry > 0) {
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.' });
    return;
  }

  // Groß-/Kleinschreibung ist beim Anmelden egal — Spieler tippen den Namen
  // nicht immer gleich. Ein case-insensitive UNIQUE-Index (siehe db.ts) hält
  // das eindeutig, sonst wäre diese Abfrage bei einem Duplikat mehrdeutig.
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username ?? '') as
    | { id: number; username: string; password_hash: string; display_name: string; is_gm: number; is_admin: number }
    | undefined;
  if (!user || !verifyPassword(password ?? '', user.password_hash)) {
    perAccount.fail(acctKey);
    perIp.fail(ip);
    res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    return;
  }
  // Restricted instance (dev): refuse before a session exists. Deliberately
  // above perAccount.reset() — the attempt counter only resets on a login that
  // actually goes through. This 403 does confirm that the credentials were
  // right, unlike the 401 above; accepted, because a bare "wrong password"
  // would leave a legitimate player guessing why they cannot get in.
  if (!mayEnter({ isGm: !!user.is_gm, isAdmin: !!user.is_admin })) {
    res.status(403).json({ error: ACCESS_DENIED });
    return;
  }
  perAccount.reset(acctKey);
  const token = createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_DAYS * 24 * 60 * 60));
  res.json(
    userInfo({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isGm: !!user.is_gm,
      isAdmin: !!user.is_admin,
    }),
  );
});

api.post('/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) destroySession(token);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  res.json(userInfo(req.user!));
});

// Konto-weite Würfel-Favoriten ("Label: Ausdruck" pro Zeile, gleiches Format
// wie characters.dice_shortcuts) — gelten in jedem Chatraum, unabhängig vom
// dort gespielten Charakter. Vor allem für die Spielleitung gedacht, die
// keinen eigenen Charakter hat, an dem die Favoriten sonst hängen könnten.
api.get('/me/dice-shortcuts', requireAuth, (req, res) => {
  const row = db.prepare('SELECT dice_shortcuts AS diceShortcuts FROM users WHERE id = ?').get(req.user!.id) as
    | { diceShortcuts: string }
    | undefined;
  res.json({ diceShortcuts: row?.diceShortcuts ?? '' });
});

api.put('/me/dice-shortcuts', requireAuth, (req, res) => {
  const text = String((req.body as { text?: unknown })?.text ?? '').slice(0, 8000);
  db.prepare('UPDATE users SET dice_shortcuts = ? WHERE id = ?').run(text, req.user!.id);
  res.json({ diceShortcuts: text });
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
  const tags = db.prepare('SELECT * FROM tags_catalog ORDER BY sort').all();
  const races = db.prepare('SELECT * FROM races_catalog ORDER BY sort').all();
  const specialEnergies = db.prepare('SELECT * FROM special_energies_catalog ORDER BY sort').all();
  const currencies = currencySystemsList();
  res.json({ talents, languages, tags, races, specialEnergies, currencies });
});

// --- Dashboard / Gruppen ---

api.get('/overview', requireAuth, (req, res) => {
  const user = req.user!;
  // ?mine=1 zwingt auch den Spielleiter auf die eigenen Charaktere/Gruppen —
  // genutzt von der Einstellungen-Seite, damit der GM dort nicht die Konten
  // anderer Spieler umkonfigurieren kann.
  const allScope = user.isGm && req.query.mine !== '1';
  const characters = allScope
    ? db.prepare('SELECT * FROM characters ORDER BY name').all()
    : db.prepare('SELECT * FROM characters WHERE owner_user_id = ? ORDER BY name').all(user.id);
  // is_temp = 0: diese Übersicht ist die feste Gruppenverwaltung — Event-
  // Gruppen haben ihre eigene Verwaltung (/admin/temp-groups) und würden hier
  // nur als scheinbar leere/verwaiste Gruppe auftauchen.
  const groups = allScope
    ? db.prepare('SELECT * FROM groups WHERE is_temp = 0 ORDER BY name').all()
    : db
        .prepare(
          'SELECT DISTINCT g.* FROM groups g JOIN characters c ON c.group_id = g.id WHERE c.owner_user_id = ? ORDER BY g.name',
        )
        .all(user.id);
  res.json({ characters, groups });
});

// Alle Gruppennamen — damit ein Spieler bei der Selbst-Anlage eines Charakters
// eine beliebige bestehende Gruppe erbitten kann (die Freigabe ist die
// eigentliche Hürde, nicht die Sichtbarkeit der Namen). Bewusst nur id + name.
// is_temp = 0: eine Event-Gruppe ist keine gültige permanente Gruppe.
api.get('/groups/names', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT id, name FROM groups WHERE is_temp = 0 ORDER BY name').all());
});

// Nur die eigenen Gruppen (Mitgliedschaft, GM sieht alle) — für den
// Chatraum-Umschalter im Dice-Dock. Bewusst ein eigener, schlanker Endpunkt
// statt /api/overview mitzunutzen, der zusätzlich JEDEN Charakter mitliefert
// (bei einem Spielleiter potenziell die ganze Kampagne) und für einen simplen
// Raum-Umschalter unnötig schwer wäre.
api.get('/groups/mine', requireAuth, (req, res) => {
  const user = req.user!;
  // Wer in einer Gruppe postet, ist die Gruppe's eigener Charakter des Nutzers
  // (siehe DicePanelProvider — der Chatraum bestimmt, wer postet, nicht die
  // gerade betrachtete Seite) — nie ein Konto-Name, außer für die Spielleitung,
  // die grundsätzlich ohne Charakterbezug chattet.
  if (user.isGm) {
    // Feste und Event-Gruppen leben in derselben Tabelle (is_temp) — diese
    // Abfrage listet also automatisch beide, ohne sie unterscheiden zu müssen.
    const groups = db.prepare('SELECT id, name FROM groups ORDER BY name').all() as { id: number; name: string }[];
    // Für „SL-Wurf": wen die Spielleitung im Sichtbarkeits-Menü als Gegenüber
    // wählen kann. Charaktername (Chat-Anzeigename bevorzugt) statt Konto-
    // name, damit die Liste dieselben Namen zeigt wie der Rest des Docks. UNION
    // aus fester (group_id) und additiver (temp_group_members) Mitgliedschaft,
    // siehe charBelongsToRoom in ws.ts für dieselbe Überlegung.
    const memberRows = db
      .prepare(
        `SELECT c.group_id AS groupId, u.id AS userId, COALESCE(NULLIF(c.chat_name, ''), c.name, u.display_name) AS name
         FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.group_id IS NOT NULL
         UNION
         SELECT tgm.temp_group_id AS groupId, u.id AS userId, COALESCE(NULLIF(c.chat_name, ''), c.name, u.display_name) AS name
         FROM temp_group_members tgm
         JOIN characters c ON c.id = tgm.character_id
         JOIN users u ON u.id = c.owner_user_id
         ORDER BY name`,
      )
      .all() as { groupId: number; userId: number; name: string }[];
    // Irgendein Charakter je Gruppe — die Spielleitung hat selbst keinen,
    // braucht aber trotzdem eine Probenliste für „/koop" (Katalog-Einträge
    // sind gruppenweit gleich, siehe RequestGroupProbePicker.tsx's anyCharId).
    const anyCharRows = db
      .prepare(
        `SELECT groupId, MIN(charId) AS anyCharId FROM (
           SELECT group_id AS groupId, id AS charId FROM characters WHERE group_id IS NOT NULL
           UNION ALL
           SELECT temp_group_id AS groupId, character_id AS charId FROM temp_group_members
         ) GROUP BY groupId`,
      )
      .all() as { groupId: number; anyCharId: number }[];
    // Eigene, kontoweite Würfel-Favoriten der Spielleitung (siehe
    // /me/dice-shortcuts) — gelten in jedem Raum gleich, da die Spielleitung
    // selbst keinen Charakter hat, an dem raumbezogene Favoriten hängen könnten.
    const gmShortcuts = (
      db.prepare('SELECT dice_shortcuts AS diceShortcuts FROM users WHERE id = ?').get(user.id) as
        | { diceShortcuts: string }
        | undefined
    )?.diceShortcuts ?? '';
    res.json(
      groups.map((g) => ({
        ...g,
        myCharacterId: null,
        myCharacterName: null,
        myDiceShortcuts: gmShortcuts,
        schicksalspunkteAktuell: 0,
        schicksalspunkteMax: 0,
        anyCharId: anyCharRows.find((r) => r.groupId === g.id)?.anyCharId ?? null,
        members: memberRows.filter((m) => m.groupId === g.id).map(({ userId, name }) => ({ userId, name })),
      })),
    );
    return;
  }
  // UNION aus fester Gruppe (group_id) und additiver Event-Gruppen-
  // Mitgliedschaft (temp_group_members) — ein Spieler bleibt in seiner festen
  // Gruppe UND sieht die Event-Gruppen, in denen sein Charakter mitläuft.
  const rows = db
    .prepare(
      `SELECT g.id, g.name AS name, c.id AS charId, c.name AS charName, c.chat_name AS charChatName,
              c.dice_shortcuts AS charShortcuts, cm.schicksalspunkteAktuell AS spAktuell, cm.schicksalspunkteMax AS spMax
       FROM groups g
       JOIN characters c ON c.group_id = g.id AND c.owner_user_id = ?
         -- Falls ein Nutzer ausnahmsweise mehrere Charaktere in derselben Gruppe
         -- hat, würde ohne diese Bedingung die Gruppe mehrfach auftauchen (ein
         -- Chatraum-Eintrag pro Charakter). Deterministisch auf den mit der
         -- kleinsten Charakter-ID einschränken, damit jede Gruppe genau einmal
         -- erscheint.
         AND c.id = (SELECT MIN(c2.id) FROM characters c2 WHERE c2.group_id = g.id AND c2.owner_user_id = ?)
       LEFT JOIN char_meta cm ON cm.character_id = c.id
       UNION
       SELECT g.id, g.name AS name, c.id AS charId, c.name AS charName, c.chat_name AS charChatName,
              c.dice_shortcuts AS charShortcuts, cm.schicksalspunkteAktuell AS spAktuell, cm.schicksalspunkteMax AS spMax
       FROM groups g
       JOIN temp_group_members tgm ON tgm.temp_group_id = g.id
       JOIN characters c ON c.id = tgm.character_id AND c.owner_user_id = ?
         AND c.id = (
           SELECT MIN(c2.id) FROM characters c2
           JOIN temp_group_members tgm2 ON tgm2.character_id = c2.id
           WHERE tgm2.temp_group_id = g.id AND c2.owner_user_id = ?
         )
       LEFT JOIN char_meta cm ON cm.character_id = c.id
       ORDER BY name`,
    )
    .all(user.id, user.id, user.id, user.id) as {
    id: number;
    name: string;
    charId: number | null;
    charName: string | null;
    charChatName: string | null;
    charShortcuts: string | null;
    spAktuell: number | null;
    spMax: number | null;
  }[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      myCharacterId: r.charId,
      myCharacterName: r.charId ? r.charChatName || r.charName : null,
      myDiceShortcuts: r.charShortcuts ?? '',
      schicksalspunkteAktuell: r.spAktuell ?? 0,
      schicksalspunkteMax: r.spMax ?? 0,
      anyCharId: r.charId,
      // Nur die Spielleitung wählt ein Gegenüber (siehe oben) — ein Spieler
      // sieht dieses Feld gar nicht erst in seiner Sichtbarkeits-Auswahl.
      members: [] as { userId: number; name: string }[],
    })),
  );
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
      `SELECT DISTINCT u.id, u.username, u.display_name AS displayName
       FROM characters c JOIN users u ON u.id = c.owner_user_id WHERE c.group_id = ?`,
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
    return { ...c, access, portrait: hasPortrait(c.id) };
  });
  // Standard-Tabs nachziehen (idempotent) — so bekommen auch Gruppen,
  // die es vor diesem Feature schon gab, ihre Inhalte
  instantiateGroupTabs(groupId);
  res.json({
    group: { ...group, portrait: hatGruppenPortrait(groupId) },
    members,
    characters,
    tabs: loadDynTabs(groupId, GROUP_DYN),
  });
});

// Spielleiter-Übersicht: alle Charaktere der Gruppe mit ihren wichtigsten
// Kennwerten für die chip-basierte Kartenansicht. Nur Spielleiter (requireGm).
// Bedient feste UND Event-Gruppen gleichermaßen (is_temp unterscheidet sie
// nur noch per Datenbankzeile, nicht mehr per Route) — buildGroupOverview
// findet die zugehörigen Charaktere für beide gleich.
api.get('/groups/:id/overview', requireAuth, requireGm, (req, res) => {
  const groupId = Number(req.params.id);
  const group = db.prepare('SELECT id, name, is_temp AS isTemp FROM groups WHERE id = ?').get(groupId) as
    | { id: number; name: string; isTemp: number }
    | undefined;
  if (!group) {
    res.status(404).json({ error: 'Gruppe nicht gefunden' });
    return;
  }
  res.json({
    group: { id: group.id, name: group.name, isTemp: !!group.isTemp },
    talentCatalog: talentCatalogList(),
    tagCatalog: tagCatalogList(),
    characters: buildGroupOverview(groupId),
  });
});

// Merkmal einem Charakter zuweisen/entziehen und die GM-Notiz setzen — bewusst
// eigene requireGm-Routen statt des generischen section-save-Wegs (dort hat der
// Charakterbesitzer 'edit'-Zugriff, hier soll ausschließlich der SL schreiben).
api.post('/characters/:id/tags', requireAuth, requireGm, (req, res) => {
  const charId = Number(req.params.id);
  const tagId = Number((req.body ?? {}).tagId);
  if (!tagId) {
    res.status(400).json({ error: 'tagId erforderlich' });
    return;
  }
  addCharTag(charId, tagId);
  res.json({ ok: true });
});

api.delete('/characters/:id/tags/:tagId', requireAuth, requireGm, (req, res) => {
  removeCharTag(Number(req.params.id), Number(req.params.tagId));
  res.json({ ok: true });
});

api.put('/characters/:id/gm-notiz', requireAuth, requireGm, (req, res) => {
  const notiz = String((req.body ?? {}).notiz ?? '');
  setGmNotiz(Number(req.params.id), notiz);
  res.json({ ok: true });
});

// Schicksalspunkte: eigener, schmaler Endpunkt statt des generischen
// section-save-Wegs — der schreibt IMMER die komplette char_meta-Zeile, ein
// Teil-Body von hier (nur aktuell/max) würde also stufe/ap/ruf/psyche/… mit
// num(undefined) auf 0 zurücksetzen. Der Charakterbesitzer darf NUR AUSGEBEN
// (aktuell sinken, nie über den bisherigen Stand steigen; max unveränderbar) —
// Gutschriften und Max-Änderungen sind Spielleitungssache, sonst könnte sich
// ein Spieler beliebig viele Neuwürfe selbst genehmigen. Das wird hier serverseitig
// erzwungen, nicht nur in der Oberfläche versteckt.
api.put('/characters/:id/schicksalspunkte', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const current = db
    .prepare('SELECT schicksalspunkteAktuell, schicksalspunkteMax FROM char_meta WHERE character_id = ?')
    .get(char.id) as { schicksalspunkteAktuell: number; schicksalspunkteMax: number };
  const body = (req.body ?? {}) as { aktuell?: unknown; max?: unknown };
  const isGm = req.user!.isGm;

  const max = isGm && body.max !== undefined ? Math.max(0, Number(body.max) || 0) : current.schicksalspunkteMax;
  let aktuell = body.aktuell !== undefined ? Math.max(0, Number(body.aktuell) || 0) : current.schicksalspunkteAktuell;
  aktuell = Math.min(max, aktuell);
  if (!isGm) aktuell = Math.min(aktuell, current.schicksalspunkteAktuell); // Besitzer darf nur ausgeben, nie gutschreiben

  db.prepare('UPDATE char_meta SET schicksalspunkteAktuell = ?, schicksalspunkteMax = ? WHERE character_id = ?').run(
    aktuell,
    max,
    char.id,
  );
  res.json({ aktuell, max });
});

// GM-Sammel-Reset für eine ganze Gruppe („Neuer Spieltag") — setzt jeden
// Charakter der Gruppe auf sein eigenes Maximum zurück.
// Wie buildGroupOverview: UNION aus fester Mitgliedschaft (group_id) und
// additiver Event-Gruppen-Mitgliedschaft (temp_group_members), damit „Neuer
// Spieltag" auch auf einer Event-Gruppe alle Beteiligten trifft statt
// stillschweigend niemanden zu finden.
api.post('/groups/:id/schicksalspunkte/reset', requireAuth, requireGm, (req, res) => {
  const groupId = Number(req.params.id);
  const affected = db
    .prepare(
      `SELECT c.id AS charId, c.owner_user_id AS ownerUserId, m.schicksalspunkteMax AS max
       FROM characters c JOIN char_meta m ON m.character_id = c.id WHERE c.group_id = ?
       UNION
       SELECT c.id AS charId, c.owner_user_id AS ownerUserId, m.schicksalspunkteMax AS max
       FROM characters c
       JOIN char_meta m ON m.character_id = c.id
       JOIN temp_group_members tgm ON tgm.character_id = c.id
       WHERE tgm.temp_group_id = ?`,
    )
    .all(groupId, groupId) as { charId: number; ownerUserId: number; max: number }[];
  db.prepare(
    `UPDATE char_meta SET schicksalspunkteAktuell = schicksalspunkteMax
     WHERE character_id IN (
       SELECT id FROM characters WHERE group_id = ?
       UNION
       SELECT character_id FROM temp_group_members WHERE temp_group_id = ?
     )`,
  ).run(groupId, groupId);
  // Reset passiert per REST in der GM-Session — die betroffenen Spieler
  // sitzen in ihrer eigenen Session und würden es sonst erst beim nächsten
  // Laden der Räume sehen (Dock-Buttons blieben bis dahin fälschlich aus).
  for (const a of affected) pushSchicksalspunkte(groupId, a.ownerUserId, a.charId, a.max, a.max);
  res.json({ ok: true });
});

// GM-Reset für einen einzelnen Charakter — dieselbe Aktion wie oben, nur auf
// eine Karte der GM-Übersicht beschränkt statt auf die ganze Gruppe.
api.post('/characters/:id/schicksalspunkte/reset', requireAuth, requireGm, (req, res) => {
  const charId = Number(req.params.id);
  const char = db.prepare('SELECT owner_user_id AS ownerUserId, group_id AS groupId FROM characters WHERE id = ?').get(charId) as
    | { ownerUserId: number; groupId: number | null }
    | undefined;
  if (!char) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  db.prepare('UPDATE char_meta SET schicksalspunkteAktuell = schicksalspunkteMax WHERE character_id = ?').run(charId);
  if (char.groupId !== null) {
    const max = (
      db.prepare('SELECT schicksalspunkteMax AS max FROM char_meta WHERE character_id = ?').get(charId) as { max: number }
    ).max;
    pushSchicksalspunkte(char.groupId, char.ownerUserId, charId, max, max);
  }
  res.json({ ok: true });
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

// History page for the docked chat/roll panel — filtered through the SAME
// canSeeFeedEntry predicate used for live broadcast (server/src/ws.ts), so a
// hidden or GM+player roll can't leak into a page scrolled back into. Bewusst
// eigene Prüfung statt editableGroup (die ist auch für group_tabs/-sections
// zuständig, die Event-Gruppen nicht bekommen) — isRoomMember statt
// isGroupMember, damit additiv verbundene Event-Gruppen-Mitglieder auch die
// Feed-Historie laden können.
api.get('/groups/:id/feed', requireAuth, (req, res) => {
  const groupId = Number(req.params.id);
  const user = req.user!;
  const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId);
  if (!exists || (!user.isGm && !isRoomMember(user.id, groupId))) {
    res.status(404).json({ error: 'Gruppe nicht gefunden' });
    return;
  }
  const before = req.query.before != null ? Number(req.query.before) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const { entries, hasMore } = loadFeedPage(groupId, { userId: req.user!.id }, before, limit);
  res.json({ entries, hasMore });
});

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
  // Event-Gruppen sind rein additiv (siehe temp_group_members) — der Charakter
  // steckt hier zusätzlich zu seiner festen Gruppe, für jeden mit Zugriff auf den
  // Bogen sichtbar (Besitzer wie Spielleitung), nicht nur die Spielleitung.
  const tempGroups = db
    .prepare(
      `SELECT g.id, g.name FROM groups g
       JOIN temp_group_members m ON m.temp_group_id = g.id
       WHERE m.character_id = ? ORDER BY g.name`,
    )
    .all(char.id) as { id: number; name: string }[];
  const info = {
    id: char.id,
    name: char.name,
    ownerUserId: char.owner_user_id,
    ownerName: owner?.display_name ?? '',
    groupId: char.group_id,
    groupName: group?.name ?? '',
    tempGroups,
    theme: char.theme ?? '',
    diceShortcuts: char.dice_shortcuts ?? '',
    chatName: char.chat_name ?? '',
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

// Selbst-Anlage durch einen Spieler: jeder angemeldete Nutzer darf sich einen
// eigenen Charakter anlegen. Er startet gruppenlos und dem anlegenden Nutzer
// gehörend; eine optional erbetene Gruppe wird als requested_group_id gemerkt und
// muss von Spielleitung/Verwaltung freigegeben werden, bevor der Charakter dort
// auftaucht. Standard-Zeilen/-Sektionen wie bei der Verwaltungs-Anlage.
api.post('/characters', requireAuth, (req, res) => {
  const body = (req.body ?? {}) as { name?: unknown; requestedGroupId?: unknown };
  const name = String(body.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'Name darf nicht leer sein' });
    return;
  }
  if (name.length > MAX_CHAR_NAME) {
    res.status(400).json({ error: `Name darf höchstens ${MAX_CHAR_NAME} Zeichen lang sein` });
    return;
  }
  let requestedGroupId: number | null = null;
  if (body.requestedGroupId != null && body.requestedGroupId !== '') {
    requestedGroupId = Number(body.requestedGroupId);
    if (!Number.isInteger(requestedGroupId) || !db.prepare('SELECT 1 FROM groups WHERE id = ? AND is_temp = 0').get(requestedGroupId)) {
      res.status(400).json({ error: 'Gruppe unbekannt' });
      return;
    }
  }
  const r = db
    .prepare('INSERT INTO characters (name, owner_user_id, group_id, requested_group_id, requested_at) VALUES (?, ?, NULL, ?, ?)')
    .run(name, req.user!.id, requestedGroupId, requestedGroupId ? Date.now() : null);
  const newId = Number(r.lastInsertRowid);
  initCharacterRows(newId);
  instantiateStandardSections(newId);
  res.json({ id: newId });
});

// Gruppen-Anfrage eines gruppenlosen Charakters setzen, ändern oder zurückziehen
// (requestedGroupId = null). Nur der Besitzer, und nur solange der Charakter noch
// keiner Gruppe angehört — eine bereits freigegebene Zuordnung ändert weiter nur
// die Spielleitung/Verwaltung über PUT /characters/:id.
api.put('/characters/:id/request', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || char.owner_user_id !== req.user!.id) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  if (char.group_id != null) {
    res.status(400).json({ error: 'Charakter ist bereits einer Gruppe zugeordnet' });
    return;
  }
  const raw = ((req.body ?? {}) as { requestedGroupId?: unknown }).requestedGroupId;
  let requestedGroupId: number | null = null;
  if (raw != null && raw !== '') {
    requestedGroupId = Number(raw);
    if (!Number.isInteger(requestedGroupId) || !db.prepare('SELECT 1 FROM groups WHERE id = ? AND is_temp = 0').get(requestedGroupId)) {
      res.status(400).json({ error: 'Gruppe unbekannt' });
      return;
    }
  }
  db.prepare('UPDATE characters SET requested_group_id = ?, requested_at = ? WHERE id = ?').run(
    requestedGroupId,
    requestedGroupId ? Date.now() : null,
    char.id,
  );
  res.json({ requestedGroupId });
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

// Geldbeutel (Geld-Umbau) — ganze Liste ersetzen, wie /items.
api.put('/characters/:id/pouches', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  savePouches(char.id, req.body);
  res.json({ pouches: loadPouches(char.id) });
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

api.post('/characters/:id/abilities/retire-old-tab', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  res.json(retireOldZauberTab(char.id));
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

// Würfel-Favoriten des Charakters ("Label: Ausdruck" pro Zeile, siehe
// shared/src/dice.ts parseDiceShortcuts) — gleiche Rechte wie /theme.
api.put('/characters/:id/dice-shortcuts', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const text = String((req.body as { text?: unknown })?.text ?? '').slice(0, 8000);
  db.prepare('UPDATE characters SET dice_shortcuts = ? WHERE id = ?').run(text, char.id);
  res.json({ diceShortcuts: text });
});

// Kurzer, optionaler Anzeigename im Gruppen-Feed (Chat/Würfe) — überschreibt
// den vollen Charakternamen nur dort, wenn gesetzt ('' = voller Name).
api.put('/characters/:id/chat-name', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  const chatName = String((req.body as { chatName?: unknown })?.chatName ?? '').trim().slice(0, 24);
  db.prepare('UPDATE characters SET chat_name = ? WHERE id = ?').run(chatName, char.id);
  res.json({ chatName });
});

// Alles, worauf dieser Charakter würfeln kann — Auswahlliste für „Probe
// anfordern" auf der Spielleiter-Übersicht UND für die Talent-Vorschläge im
// Würfel-Chat (siehe DicePanel.tsx). Bewusst auf Abruf statt mitgeladen: die
// Liste ist lang und wird selten gebraucht. GM sieht jeden Charakter, der
// Besitzer nur den eigenen — sonst könnte man fremde Proben-Listen abfragen.
api.get('/characters/:id/probes', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || characterAccess(req.user!, char) !== 'edit') {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  res.json(listRollableProbes(char.id));
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
// `/full` ist das größere Master-Bild für die Vergrößerungs-Ansicht (siehe
// assets/portraits.ts) — sonst identisch zur 512px-Anzeigegröße darüber.
api.get('/characters/:id/portrait/full', requireAuth, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || !characterAccess(req.user!, char)) {
    res.status(404).end();
    return;
  }
  const p = loadPortrait(char.id, true);
  if (!p) {
    res.status(404).end();
    return;
  }
  res.type(p.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(p.data);
});

api.put(
  '/characters/:id/portrait/full',
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
    savePortrait(char.id, mime, buf, true);
    res.json({ ok: true });
  },
);

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

// Löscht beide Größen (Anzeige + Master) in einem Zug — siehe deletePortrait.
api.delete('/characters/:id/portrait', requireAuth, (req, res) => {
  const char = editableChar(req, res);
  if (!char) return;
  deletePortrait(char.id);
  res.json({ ok: true });
});

// --- Gruppen-Porträt: dieselbe Anzeige/Master-Aufteilung wie beim Charakter,
// aber „jedes Gruppenmitglied darf bearbeiten" statt nur der Besitzer (siehe
// editableGroup weiter unten) — genau wie bei Tabs/Sections der Gruppe.
function viewableGroup(req: import('express').Request, res: import('express').Response): number | null {
  const groupId = Number(req.params.id);
  const user = req.user!;
  const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId);
  if (!exists || (!user.isGm && !isGroupMember(user.id, groupId))) {
    res.status(404).end();
    return null;
  }
  return groupId;
}

api.get('/groups/:id/portrait/full', requireAuth, (req, res) => {
  const groupId = viewableGroup(req, res);
  if (groupId === null) return;
  const p = ladeGruppenPortrait(groupId, true);
  if (!p) {
    res.status(404).end();
    return;
  }
  res.type(p.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(p.data);
});

api.put(
  '/groups/:id/portrait/full',
  requireAuth,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
  (req, res) => {
    const groupId = editableGroup(req, res);
    if (!groupId) return;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'Kein Bild empfangen' });
      return;
    }
    const mime = String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0].trim();
    speichereGruppenPortrait(groupId, mime, buf, true);
    res.json({ ok: true });
  },
);

api.get('/groups/:id/portrait', requireAuth, (req, res) => {
  const groupId = viewableGroup(req, res);
  if (groupId === null) return;
  const p = ladeGruppenPortrait(groupId);
  if (!p) {
    res.status(404).end();
    return;
  }
  res.type(p.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(p.data);
});

api.put(
  '/groups/:id/portrait',
  requireAuth,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
  (req, res) => {
    const groupId = editableGroup(req, res);
    if (!groupId) return;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'Kein Bild empfangen' });
      return;
    }
    const mime = String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0].trim();
    speichereGruppenPortrait(groupId, mime, buf);
    res.json({ ok: true });
  },
);

api.delete('/groups/:id/portrait', requireAuth, (req, res) => {
  const groupId = editableGroup(req, res);
  if (!groupId) return;
  loescheGruppenPortrait(groupId);
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

// Zuordnung eines Charakters (Name/Besitzer/Gruppe) — Verwaltungssache, kein
// Blick in den Bogen. Darum Spielleitung ODER Verwaltung.
api.put('/characters/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char) {
    res.status(404).json({ error: 'Charakter nicht gefunden' });
    return;
  }
  const { name, ownerUserId, groupId } = (req.body ?? {}) as { name?: string; ownerUserId?: number; groupId?: number };
  const nextGroup = groupId ?? char.group_id;
  // Weist die Verwaltung/Spielleitung direkt eine Gruppe zu, ist eine etwaige
  // offene Anfrage damit erledigt — sonst bliebe der Charakter in „Offene
  // Anfragen" hängen, obwohl er schon in einer Gruppe steckt.
  const clearRequest = nextGroup != null;
  db.prepare(
    `UPDATE characters SET name = ?, owner_user_id = ?, group_id = ?${clearRequest ? ', requested_group_id = NULL, requested_at = NULL' : ''} WHERE id = ?`,
  ).run(name ?? char.name, ownerUserId ?? char.owner_user_id, nextGroup, char.id);
  res.json({ ok: true });
});

api.delete('/characters/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  // Bilder liegen in einer ZWEITEN Datei (helden-assets.db), und SQLite kann
  // nicht über Dateigrenzen kaskadieren — der Haken muss von Hand gesetzt sein.
  // Betrifft inzwischen das Porträt; ein wöchentlicher Durchlauf fängt zusätzlich
  // ab, was hier durchrutscht.
  loescheAssetsFuer('character', id);
  res.json({ ok: true });
});

// --- Verwaltung (nur Spielleiter) ---

// Anzahl verbleibender Admins — Grundlage für die „letzter Admin"-Sperre, die
// verhindert, dass sich die Verwaltung selbst aussperrt.
function adminCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number }).n;
}

// Liste dürfen Spielleitung UND Verwaltung sehen (Onboarding bzw. Kontenpflege).
// Die Rollen-Flags reisen mit, damit die Oberfläche die passenden Bedienelemente
// zeigt; das sind reine Konto-Metadaten, keine Charakterdaten.
api.get('/admin/users', requireAuth, requireGmOrAdmin, (_req, res) => {
  res.json(
    db.prepare('SELECT id, username, display_name AS displayName, is_gm AS isGm, is_admin AS isAdmin FROM users ORDER BY username').all(),
  );
});

api.post('/admin/users', requireAuth, requireGmOrAdmin, (req, res) => {
  const { username, password, displayName, isGm, isAdmin } = (req.body ?? {}) as {
    username?: string;
    password?: string;
    displayName?: string;
    isGm?: boolean;
    isAdmin?: boolean;
  };
  if (!username || !password) {
    res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    return;
  }
  // Rollen darf nur die Verwaltung vergeben. Eine Spielleitung ohne Admin-Rolle
  // legt ausschließlich einfache Spieler an — Flags aus dem Body werden ignoriert.
  const gm = req.user!.isAdmin ? !!isGm : false;
  const admin = req.user!.isAdmin ? !!isAdmin : false;
  try {
    const r = db
      .prepare('INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, ?, ?)')
      .run(username, hashPassword(password), displayName ?? username, gm ? 1 : 0, admin ? 1 : 0);
    res.json({ id: r.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Benutzername bereits vergeben' });
  }
});

api.put('/admin/users/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { password, displayName, isGm, isAdmin } = (req.body ?? {}) as {
    password?: string;
    displayName?: string;
    isGm?: boolean;
    isAdmin?: boolean;
  };
  const target = db.prepare('SELECT id, is_gm AS isGm, is_admin AS isAdmin FROM users WHERE id = ?').get(id) as
    | { id: number; isGm: number; isAdmin: number }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'Benutzer nicht gefunden' });
    return;
  }

  // Eine Spielleitung ohne Admin-Rolle darf nur EINFACHE Spieler betreuen
  // (Anzeigename/Passwort) und keinerlei Rollen ändern.
  if (!req.user!.isAdmin) {
    if (target.isGm || target.isAdmin) {
      res.status(403).json({ error: 'Nur die Verwaltung darf Spielleitungs-/Verwaltungskonten ändern' });
      return;
    }
    if (isGm !== undefined || isAdmin !== undefined) {
      res.status(403).json({ error: 'Rollen darf nur die Verwaltung vergeben' });
      return;
    }
    if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
    if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    res.json({ ok: true });
    return;
  }

  // Verwaltung: darf alles — aber dem letzten Admin nicht die Admin-Rolle nehmen.
  if (isAdmin === false && target.isAdmin && adminCount() <= 1) {
    res.status(400).json({ error: 'Der letzte Admin kann seine Verwaltungsrolle nicht abgeben' });
    return;
  }
  if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
  if (isGm !== undefined) db.prepare('UPDATE users SET is_gm = ? WHERE id = ?').run(isGm ? 1 : 0, id);
  if (isAdmin !== undefined) db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  res.json({ ok: true });
});

// Konten löschen darf nur die Verwaltung. Drei Sicherungen: nicht sich selbst,
// nicht den letzten Admin, und nicht solange der Nutzer noch Charaktere besitzt
// (die müssten sonst verwaisen — höchstrangige Regel: kein stiller Datenverlust).
api.delete('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Das eigene Konto kann nicht gelöscht werden' });
    return;
  }
  const target = db.prepare('SELECT id, is_admin AS isAdmin FROM users WHERE id = ?').get(id) as
    | { id: number; isAdmin: number }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'Benutzer nicht gefunden' });
    return;
  }
  if (target.isAdmin && adminCount() <= 1) {
    res.status(400).json({ error: 'Der letzte Admin kann nicht gelöscht werden' });
    return;
  }
  const owned = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE owner_user_id = ?').get(id) as { n: number };
  if (owned.n > 0) {
    res.status(400).json({ error: 'Benutzer besitzt noch Charaktere' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// is_temp = 0: Event-Gruppen haben ihre eigene Verwaltung (/admin/temp-groups).
api.get('/admin/groups', requireAuth, requireGmOrAdmin, (_req, res) => {
  const groups = db.prepare('SELECT * FROM groups WHERE is_temp = 0 ORDER BY name').all() as { id: number; name: string }[];
  res.json(groups);
});

api.post('/admin/groups', requireAuth, requireGmOrAdmin, (req, res) => {
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

api.put('/admin/groups/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name } = (req.body ?? {}) as { name?: string };
  if (name) db.prepare('UPDATE groups SET name = ? WHERE id = ? AND is_temp = 0').run(name, id);
  res.json({ ok: true });
});

api.delete('/admin/groups/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const chars = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE group_id = ?').get(id) as { n: number };
  if (chars.n > 0) {
    res.status(400).json({ error: 'Gruppe enthält noch Charaktere' });
    return;
  }
  db.prepare('DELETE FROM groups WHERE id = ? AND is_temp = 0').run(id);
  // Gruppenporträt liegt in helden-assets.db — dieselbe Zweite-Datei-Lücke wie
  // beim Charakter (siehe dort), muss also von Hand geschlossen werden.
  loescheAssetsFuer('group', id);
  res.json({ ok: true });
});

// --- Temporäre/Event-Gruppen (GM-only end-to-end, siehe TODO.md) ---
// Bewusst requireGm statt requireGmOrAdmin wie bei den festen Gruppen: die
// Verwaltung sieht/verwaltet feste Gruppen mit, Event-Gruppen bleiben Sache der
// Spielleitung. Mitgliedschaft ist additiv über Charakter-IDs, kein Ersatz für
// characters.group_id.

api.get('/admin/temp-groups', requireAuth, requireGm, (_req, res) => {
  const groups = db
    .prepare('SELECT id, name, created_by AS createdBy, created_at AS createdAt FROM groups WHERE is_temp = 1 ORDER BY created_at DESC')
    .all() as {
    id: number;
    name: string;
    createdBy: number;
    createdAt: number;
  }[];
  const members = db.prepare('SELECT temp_group_id, character_id FROM temp_group_members').all() as {
    temp_group_id: number;
    character_id: number;
  }[];
  res.json(
    groups.map((g) => ({
      ...g,
      memberCharacterIds: members.filter((m) => m.temp_group_id === g.id).map((m) => m.character_id),
    })),
  );
});

api.post('/admin/temp-groups', requireAuth, requireGm, (req, res) => {
  const { name } = (req.body ?? {}) as { name?: string };
  if (!name) {
    res.status(400).json({ error: 'Name erforderlich' });
    return;
  }
  const r = db.prepare('INSERT INTO groups (name, is_temp, created_by, created_at) VALUES (?, 1, ?, ?)').run(name, req.user!.id, Date.now());
  res.json({ id: Number(r.lastInsertRowid) });
});

api.put('/admin/temp-groups/:id', requireAuth, requireGm, (req, res) => {
  const id = Number(req.params.id);
  const { name, memberCharacterIds } = (req.body ?? {}) as { name?: string; memberCharacterIds?: number[] };
  if (name) db.prepare("UPDATE groups SET name = ? WHERE id = ? AND is_temp = 1").run(name, id);
  if (Array.isArray(memberCharacterIds)) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM temp_group_members WHERE temp_group_id = ?').run(id);
      const stmt = db.prepare('INSERT INTO temp_group_members (temp_group_id, character_id) VALUES (?, ?)');
      for (const cid of memberCharacterIds) stmt.run(id, Number(cid));
    });
    tx();
  }
  res.json({ ok: true });
});

// Löschen ist immer erlaubt (anders als feste Gruppen): die Zuordnung ist
// additiv, ON DELETE CASCADE räumt temp_group_members UND group_feed auf
// (beide haben eine echte FK auf groups(id)) — keine Charakterdaten
// betroffen, daher kein „enthält noch Charaktere"-Schutz nötig.
api.delete('/admin/temp-groups/:id', requireAuth, requireGm, (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ? AND is_temp = 1').run(Number(req.params.id));
  res.json({ ok: true });
});

// Eigene GM-Übersicht der Event-Gruppe gibt es nicht mehr getrennt — /groups/:id/overview
// bedient inzwischen beide Gruppenarten, siehe dort.

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
  tags: {
    table: 'tags_catalog',
    refTable: 'char_tags',
    refCol: 'tag_id',
    cols: ['name', 'sort'],
  },
  races: {
    table: 'races_catalog',
    // Kein Join-Table: ein Charakter hat höchstens eine Rasse, char_bio.rasseId
    // zeigt direkt auf races_catalog(id) — der generische "wird verwendet"-
    // Check unten funktioniert unverändert auch gegen eine echte Spalte.
    refTable: 'char_bio',
    refCol: 'rasseId',
    cols: ['gruppe', 'name', 'beschreibung', 'spezialisierung', 'talente', 'le', 'au', 'ae', 'mr', 'ak', 'gs', 'psyche', 'resilienz', 'notiz', 'sort'],
    // Boni/Basiswert sind nullbare Zahlen (leer = „keine Werte-Tabelle in der
    // Quelle"), anders als bei den übrigen Katalogen, die reine Textspalten sind.
    numCols: ['le', 'au', 'ae', 'mr', 'ak', 'gs', 'psyche', 'resilienz'],
  },
  specialEnergies: {
    table: 'special_energies_catalog',
    refTable: 'char_special_resources',
    refCol: 'catalog_id',
    // formula bleibt Text (evaluateEnergyFormula in shared/src/rules.ts parst
    // sie selbst) — leer = rein manueller Eintrag ohne Formel-Maximum.
    cols: ['name', 'formula', 'beschreibung', 'sort'],
  },
} as const;

function catalogDef(type: string) {
  return type in CATALOGS ? CATALOGS[type as keyof typeof CATALOGS] : null;
}

// sort ist immer eine Zahl (Reihenfolge), numCols (falls vorhanden) sind
// nullbare Zahlen (leer/undefined → NULL), alles andere bleibt Text.
function catalogValue(def: (typeof CATALOGS)[keyof typeof CATALOGS], col: string, raw: unknown): unknown {
  if (col === 'sort') return Number(raw) || 0;
  const numCols = 'numCols' in def ? (def.numCols as readonly string[]) : [];
  if (numCols.includes(col)) {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw ?? '');
}

api.post('/admin/catalogs/:type', requireAuth, requireGmOrAdmin, (req, res) => {
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
  const values = def.cols.map((c) => catalogValue(def, c, body[c]));
  const r = db
    .prepare(`INSERT INTO ${def.table} (${def.cols.join(', ')}) VALUES (${def.cols.map(() => '?').join(', ')})`)
    .run(...values);
  res.json({ id: r.lastInsertRowid });
});

api.put('/admin/catalogs/:type/:id', requireAuth, requireGmOrAdmin, (req, res) => {
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
  const values = cols.map((c) => catalogValue(def, c, body[c]));
  db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  res.json({ ok: true });
});

api.delete('/admin/catalogs/:type/:id', requireAuth, requireGmOrAdmin, (req, res) => {
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

// Verteilt `sort` in großen, gleichmäßigen Schritten neu (aktuelle Reihenfolge
// bleibt erhalten). Fallback für "vor/nach diesem Eintrag einfügen" (Admin.tsx),
// wenn der Lückenwert (Mittelwert zweier Nachbarn) numerisch keine
// unterscheidbare Zahl mehr zwischen ihnen findet — praktisch nur nach sehr
// vielen Einfügungen an derselben Stelle.
api.post('/admin/catalogs/:type/renumber', requireAuth, requireGmOrAdmin, (req, res) => {
  const def = catalogDef(String(req.params.type));
  if (!def) {
    res.status(400).json({ error: 'Unbekannter Katalog' });
    return;
  }
  const rows = db.prepare(`SELECT id FROM ${def.table} ORDER BY sort, id`).all() as { id: number }[];
  const upd = db.prepare(`UPDATE ${def.table} SET sort = ? WHERE id = ?`);
  db.transaction(() => {
    rows.forEach((r, i) => upd.run((i + 1) * 100, r.id));
  })();
  res.json({ ok: true });
});

// Währungs-Katalog (Geld-Umbau): zweistufig (System → Münzsorten), passt nicht
// in das generische CATALOGS-Muster oben (eine Tabelle, flache Zeilen) — daher
// eigene Routen. Löschen ist blockiert, solange ein Geldbeutel/eine Münzzeile
// noch darauf verweist, gleiche Prüfung wie bei den übrigen Katalogen.
function currencySystemsList() {
  const systems = db.prepare('SELECT * FROM currency_systems ORDER BY sort').all() as { id: number }[];
  const denominations = db.prepare('SELECT * FROM currency_denominations ORDER BY sort').all() as {
    id: number;
    system_id: number;
  }[];
  return systems.map((s) => ({ ...s, denominations: denominations.filter((d) => d.system_id === s.id) }));
}

api.post('/admin/currency-systems', requireAuth, requireGmOrAdmin, (req, res) => {
  const { name, notiz, sort } = (req.body ?? {}) as { name?: unknown; notiz?: unknown; sort?: unknown };
  if (!name) {
    res.status(400).json({ error: 'Name erforderlich' });
    return;
  }
  const r = db
    .prepare('INSERT INTO currency_systems (name, notiz, sort) VALUES (?, ?, ?)')
    .run(String(name), String(notiz ?? ''), sort === undefined ? 9999 : Number(sort) || 0);
  res.json({ id: r.lastInsertRowid });
});

api.put('/admin/currency-systems/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cols = ['name', 'notiz', 'sort'].filter((c) => c in body);
  if (cols.length === 0) {
    res.status(400).json({ error: 'Keine Felder' });
    return;
  }
  const values = cols.map((c) => (c === 'sort' ? Number(body[c]) || 0 : String(body[c] ?? '')));
  db.prepare(`UPDATE currency_systems SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  res.json({ ok: true });
});

// Gleiche Idee wie oben bei den generischen Katalogen, nur für die zwei
// Währungs-Tabellen (Systeme flach, Münzsorten je System).
api.post('/admin/currency-systems/renumber', requireAuth, requireGmOrAdmin, (req, res) => {
  const rows = db.prepare('SELECT id FROM currency_systems ORDER BY sort, id').all() as { id: number }[];
  const upd = db.prepare('UPDATE currency_systems SET sort = ? WHERE id = ?');
  db.transaction(() => {
    rows.forEach((r, i) => upd.run((i + 1) * 100, r.id));
  })();
  res.json({ ok: true });
});

api.delete('/admin/currency-systems/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM char_pouches WHERE system_id = ?').get(id) as { n: number };
  if (used.n > 0) {
    res.status(400).json({ error: `Wird von ${used.n} Geldbeutel(n) verwendet` });
    return;
  }
  db.prepare('DELETE FROM currency_systems WHERE id = ?').run(id);
  res.json({ ok: true });
});

api.post('/admin/currency-denominations', requireAuth, requireGmOrAdmin, (req, res) => {
  const { systemId, code, name, faktor, sort } = (req.body ?? {}) as {
    systemId?: unknown;
    code?: unknown;
    name?: unknown;
    faktor?: unknown;
    sort?: unknown;
  };
  const sysId = Number(systemId);
  if (!sysId || !code || !name) {
    res.status(400).json({ error: 'Währungssystem, Code und Name erforderlich' });
    return;
  }
  if (!db.prepare('SELECT 1 FROM currency_systems WHERE id = ?').get(sysId)) {
    res.status(400).json({ error: 'Unbekanntes Währungssystem' });
    return;
  }
  const r = db
    .prepare('INSERT INTO currency_denominations (system_id, code, name, faktor, sort) VALUES (?, ?, ?, ?, ?)')
    .run(sysId, String(code), String(name), Number(faktor) || 1, sort === undefined ? 9999 : Number(sort) || 0);
  res.json({ id: r.lastInsertRowid });
});

api.put('/admin/currency-denominations/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const cols = ['code', 'name', 'faktor', 'sort'].filter((c) => c in body);
  if (cols.length === 0) {
    res.status(400).json({ error: 'Keine Felder' });
    return;
  }
  const values = cols.map((c) => (c === 'faktor' || c === 'sort' ? Number(body[c]) || 0 : String(body[c] ?? '')));
  db.prepare(`UPDATE currency_denominations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  res.json({ ok: true });
});

// Münzsorten sortieren nur innerhalb ihres eigenen Systems neu — die anderen
// Systeme sind von einer Lücken-Erschöpfung hier nicht betroffen.
api.post('/admin/currency-denominations/renumber', requireAuth, requireGmOrAdmin, (req, res) => {
  const { systemId } = (req.body ?? {}) as { systemId?: unknown };
  const sysId = Number(systemId);
  if (!sysId) {
    res.status(400).json({ error: 'Währungssystem erforderlich' });
    return;
  }
  const rows = db.prepare('SELECT id FROM currency_denominations WHERE system_id = ? ORDER BY sort, id').all(sysId) as { id: number }[];
  const upd = db.prepare('UPDATE currency_denominations SET sort = ? WHERE id = ?');
  db.transaction(() => {
    rows.forEach((r, i) => upd.run((i + 1) * 100, r.id));
  })();
  res.json({ ok: true });
});

api.delete('/admin/currency-denominations/:id', requireAuth, requireGmOrAdmin, (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM char_pouch_coins WHERE denomination_id = ?').get(id) as { n: number };
  if (used.n > 0) {
    res.status(400).json({ error: `Wird von ${used.n} Geldbeutel(n) verwendet` });
    return;
  }
  db.prepare('DELETE FROM currency_denominations WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Offene Gruppen-Anfragen selbst angelegter Charaktere (requested_group_id
// gesetzt, aber noch keiner Gruppe zugeordnet). Spielleitung ODER Verwaltung
// sieht und bearbeitet sie; die Zahl speist das Navigations-Abzeichen.
api.get('/admin/requests', requireAuth, requireGmOrAdmin, (_req, res) => {
  const requests = db
    .prepare(
      `SELECT c.id AS characterId, c.name, c.owner_user_id AS ownerUserId, u.display_name AS ownerName,
              c.requested_group_id AS requestedGroupId, g.name AS requestedGroupName, c.requested_at AS requestedAt
       FROM characters c
       JOIN users u ON u.id = c.owner_user_id
       JOIN groups g ON g.id = c.requested_group_id
       WHERE c.group_id IS NULL AND c.requested_group_id IS NOT NULL
       ORDER BY c.requested_at`,
    )
    .all();
  res.json({ requests });
});

// Anfrage annehmen: Charakter der erbetenen Gruppe zuordnen, Anfrage löschen.
// Gruppenmitgliedschaft ist rein abgeleitet (isGroupMember), braucht also
// keinen eigenen Eintrag mehr.
api.post('/admin/requests/:id/approve', requireAuth, requireGmOrAdmin, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || char.group_id != null || char.requested_group_id == null) {
    res.status(404).json({ error: 'Keine offene Anfrage' });
    return;
  }
  const groupId = char.requested_group_id;
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ? AND is_temp = 0').get(groupId)) {
    res.status(400).json({ error: 'Erbetene Gruppe existiert nicht mehr' });
    return;
  }
  db.prepare('UPDATE characters SET group_id = ?, requested_group_id = NULL, requested_at = NULL WHERE id = ?').run(groupId, char.id);
  res.json({ ok: true, groupId });
});

// Anfrage ablehnen: nur die Anfrage zurücksetzen. Der Charakter bleibt
// gruppenlos erhalten (kein Datenverlust); der Spieler kann neu anfragen.
api.post('/admin/requests/:id/reject', requireAuth, requireGmOrAdmin, (req, res) => {
  const char = getChar(Number(req.params.id));
  if (!char || char.group_id != null || char.requested_group_id == null) {
    res.status(404).json({ error: 'Keine offene Anfrage' });
    return;
  }
  db.prepare('UPDATE characters SET requested_group_id = NULL, requested_at = NULL WHERE id = ?').run(char.id);
  res.json({ ok: true });
});

// Charakterliste NUR als Verwaltungs-Metadaten (Name/Besitzer/Gruppe) für die
// „Kataloge & Nutzer"-Seite — kein Bogen-Inhalt. Spielleitung ODER Verwaltung.
// Bewusst getrennt von /overview (das die persönliche Charakter-Startseite
// bedient), damit ein reiner Admin dort weiter nur seine eigenen sieht.
api.get('/admin/characters', requireAuth, requireGmOrAdmin, (_req, res) => {
  res.json(db.prepare('SELECT id, name, owner_user_id, group_id FROM characters ORDER BY name').all());
});

api.post('/admin/characters', requireAuth, requireGmOrAdmin, (req, res) => {
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
api.post('/admin/characters/import', requireAuth, requireGmOrAdmin, (req, res) => {
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
  const group = db.prepare('SELECT 1 FROM groups WHERE id = ? AND is_temp = 0').get(Number(groupId));
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

// ————————————————————————————————————————————————————————————————
// Maintenance: roll out a new version from the web interface
// ————————————————————————————————————————————————————————————————
//
// requireAdmin, NOT requireGmOrAdmin like nearly every other /admin/ route.
// Putting a new build on the machine is operations, not game mastering. The
// note is here because an unexplained deviation gets "unified" sooner or later.
//
// What gets deployed appears nowhere below: the branch hangs off the name of
// the systemd unit on the server (dev → develop, prod → main). These routes can
// only say "now", never "what".

api.get('/admin/deploy/status', requireAuth, requireAdmin, (_req, res) => {
  // boot rides along on EVERY answer, not just on /api/health. That way the
  // waiting browser notices the restart on the new process's first status
  // reply, without having to observe a connection drop that a fast restart may
  // never give it a chance to see.
  res.json({ verfuegbar: deployVerfuegbar(), boot: BOOT_ID, status: leseDeployStatus() });
});

api.post('/admin/deploy', requireAuth, requireAdmin, (req, res) => {
  if (!deployVerfuegbar()) {
    res.status(501).json({ error: 'Auf dieser Instanz ist kein Ausrollen eingerichtet.' });
    return;
  }
  if (deployLaeuft()) {
    res.status(409).json({ error: 'Es läuft bereits ein Ausrollen. Bitte warte, bis es durch ist.' });
    return;
  }

  const user = req.user!;
  try {
    stossDeployAn(user);
  } catch (e) {
    res.status(500).json({ error: `Der Anstoß ließ sich nicht ablegen: ${e instanceof Error ? e.message : e}` });
    return;
  }

  // Audit trail. The request file itself is consumed by helden-deploy-trigger
  // and gone seconds later — the journal is what remains.
  console.log(`[deploy] angefordert von ${user.username} (id ${user.id})`);
  broadcastWartung(user.displayName);

  // 202, not 200: accepted, not done. This response could not report "done"
  // even in principle — the process writing it gets killed by the very thing it
  // is starting. The outcome arrives through /admin/deploy/status.
  res.status(202).json({ boot: BOOT_ID });
});
