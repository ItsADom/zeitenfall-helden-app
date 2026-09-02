// Test-Nutzer-Seed: legt EIN universell nutzbares Test-Konto mit mehreren
// Gruppen und Charakteren an, darunter ein voll ausgestatteter Charakter
// (Zauber aus mehreren Elementen/Kategorien, aktive UND passive Fähigkeiten,
// Nah- UND Fernkampfwaffen, Talente, Notizen, Geld). Gedacht für manuelles
// Durchklicken/API-Tests ohne erst von Hand einen Charakter befüllen zu
// müssen. Bewusst KEIN Teil des automatischen Start-Seeds (server/src/seed.ts) —
// nur manuell über `npm run seed:testuser -w server`.
//
// Sicherheitsnetze wie seedDummy.ts: bricht bei NODE_ENV=production ab und
// ist idempotent (per Name erkannt, zweiter Lauf erzeugt keine Duplikate).
import { makeItem, waffenStatsFuerArt } from 'shared';
import type { WaffenArt, WaffenStatFeld } from 'shared';
import { db, initCharacterRows } from './db.js';
import { hashPassword } from './auth.js';
import { applyItemOps, instantiateStandardSections, saveAbilities, saveSection } from './characterData.js';
import { instantiateGroupTabs } from './dynSections.js';

// Legt eine Waffe als echtes Item an (Weapons become real items, TODO.md) —
// dieselbe Op-basierte Anlage wie der Client (AddItemDialog), damit der
// Test-Account weiterhin über den Waffen-Reiter sichtbare, funktionierende
// Waffen bekommt statt in der stillgelegten sec_waffenNahNeu/sec_waffenFernNeu
// zu landen, die niemand mehr liest.
function addWaffe(
  charId: number,
  art: WaffenArt,
  felder: Partial<Record<WaffenStatFeld, string>>,
  over: { name: string; haltbarkeitMax?: number; haltbarkeitAktuell?: number; notiz?: string },
): void {
  const stats = waffenStatsFuerArt(art).map((s) => (felder[s.feld] !== undefined ? { ...s, wert: felder[s.feld]! } : s));
  const item = makeItem({
    name: over.name, waffenArt: art, waffenStats: stats,
    haltbarkeitMax: over.haltbarkeitMax ?? 0, haltbarkeitAktuell: over.haltbarkeitAktuell ?? 0, notiz: over.notiz ?? '',
  });
  applyItemOps(charId, [{ op: 'add', item }], true);
}

const TESTUSER_PASSWORD = process.env.TESTUSER_PASSWORD ?? 'test1234';
const USERNAME = 'testspieler';
const DISPLAY_NAME = 'Testspieler';

const GROUP_ALPHA = 'Seed-Testgruppe Alpha';
const GROUP_BETA = 'Seed-Testgruppe Beta';

function abortIfProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ Test-Nutzer-Seed abgebrochen: NODE_ENV=production. Diese Daten gehören niemals in die echte Datenbank.');
    process.exit(1);
  }
}

function ensureUser(username: string, displayName: string): number {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db
    .prepare('INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, 0, 0)')
    .run(username, hashPassword(TESTUSER_PASSWORD), displayName);
  return Number(r.lastInsertRowid);
}

function ensureGroup(name: string): number {
  const existing = db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  const id = Number(r.lastInsertRowid);
  instantiateGroupTabs(id);
  return id;
}

// Legt einen Charakter an (oder liefert die vorhandene ID), falls noch keiner
// gleichen Namens für diesen Besitzer existiert. groupId darf null sein
// (gruppenloser Charakter).
function ensureCharacter(name: string, ownerUserId: number, groupId: number | null): { id: number; created: boolean } {
  const existing = db
    .prepare('SELECT id FROM characters WHERE name = ? AND owner_user_id = ?')
    .get(name, ownerUserId) as { id: number } | undefined;
  if (existing) return { id: existing.id, created: false };
  const r = db
    .prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, ?)')
    .run(name, ownerUserId, groupId);
  const id = Number(r.lastInsertRowid);
  initCharacterRows(id);
  instantiateStandardSections(id);
  return { id, created: true };
}

function talentId(name: string): number {
  const row = db.prepare('SELECT id FROM talents_catalog WHERE name = ?').get(name) as { id: number } | undefined;
  if (!row) throw new Error(`Talent "${name}" nicht im Katalog gefunden — lief server/src/seed.ts schon durch?`);
  return row.id;
}

function denominationId(code: string): number {
  const row = db
    .prepare('SELECT id FROM currency_denominations WHERE code = ? ORDER BY sort LIMIT 1')
    .get(code) as { id: number } | undefined;
  if (!row) throw new Error(`Münzsorte "${code}" nicht im Katalog gefunden`);
  return row.id;
}

// "Rasse" ist im Heldenbrief ein <RaceSelect>, das an races_catalog.id hängt
// (client/src/tabs/Heldenbrief.tsx:99/108) — ein reiner Freitext in char_bio.rasse
// bleibt ohne rasseId unsichtbar in der Auswahl. Beide Felder zusammen setzen.
function raceId(name: string): number {
  const row = db.prepare('SELECT id FROM races_catalog WHERE name = ?').get(name) as { id: number } | undefined;
  if (!row) throw new Error(`Rasse "${name}" nicht im Katalog gefunden — lief server/src/seed.ts schon durch?`);
  return row.id;
}

// Füllt die Elemente-/Kategorien-Vorschlagslisten für Zauber & Fähigkeiten.
function setAbilityLists(charId: number, elements: string[], kategorien: string[]): void {
  db.prepare('DELETE FROM char_ability_lists WHERE character_id = ?').run(charId);
  const ins = db.prepare('INSERT INTO char_ability_lists (character_id, kind, pos, name) VALUES (?, ?, ?, ?)');
  elements.forEach((name, i) => ins.run(charId, 'element', i, name));
  kategorien.forEach((name, i) => ins.run(charId, 'kategorie', i, name));
}

// Setzt Beutelinhalt (Münzsorte -> Anzahl) für den Gürtelbeutel eines Charakters.
// Der Beutel existiert bereits durch initCharacterRows.
function setPouchCoins(charId: number, coins: Record<string, number>): void {
  const pouch = db
    .prepare("SELECT id FROM char_pouches WHERE owner_type = 'character' AND owner_id = ? AND is_bank = 0 ORDER BY pos LIMIT 1")
    .get(charId) as { id: number } | undefined;
  if (!pouch) return;
  const ins = db.prepare(
    'INSERT INTO char_pouch_coins (pouch_id, denomination_id, anzahl) VALUES (?, ?, ?) ' +
      'ON CONFLICT (pouch_id, denomination_id) DO UPDATE SET anzahl = excluded.anzahl',
  );
  for (const [code, anzahl] of Object.entries(coins)) {
    ins.run(pouch.id, denominationId(code), anzahl);
  }
}

function fillRichCharacter(charId: number): void {
  db.prepare(
    'UPDATE char_meta SET stufe = ?, ap = ?, apGuthaben = ?, magierstufe = ?, ruf = ? WHERE character_id = ?',
  ).run(7, 1200, 35, 3, 2, charId);

  db.prepare(
    "UPDATE char_bio SET rasse = 'Menschen', rasseId = ?, kultur = 'Mittelreich', profession = 'Gildenmagierin', " +
      "geschlecht = 'weiblich', sidebarNotiz = ? WHERE character_id = ?",
  ).run(
    raceId('Menschen'),
    'Sucht einen Kontakt in der Magiergilde von Kuslik. Schuldet dem Wirt "Zum blauen Ochsen" noch 5 Silbertaler.',
    charId,
  );

  db.prepare('INSERT INTO char_gm_notes (character_id, notiz) VALUES (?, ?) ' +
    'ON CONFLICT (character_id) DO UPDATE SET notiz = excluded.notiz').run(
    charId,
    'Plothook: Ihr verschwundener Lehrmeister taucht in Kapitel 3 als Antagonist wieder auf.',
  );

  setAbilityLists(
    charId,
    ['Feuer', 'Wasser', 'Luft', 'Erde/Humus'],
    ['Kampfmagie', 'Heilmagie', 'Hellsicht', 'Verwandlung', 'Wahrnehmung', 'Körperbeherrschung', 'Kampf'],
  );

  saveAbilities(charId, [
    // Zauber (magisch=true) — vier Elemente, Kampf-/Heil-/Hellsichtmagie, aktiv & passiv gemischt
    {
      magisch: true, passiv: false, signatur: true, name: 'Ignifaxius', element: 'Feuer',
      kategorien: ['Kampfmagie'], stufe: 4, komplexitaet: 2, kosten: '4', probe: 'MU+KL+IN',
      effekt: 'Feuerstrahl, 2W6 Schaden', notiz: 'Signaturzauber seit der Lehrzeit.',
    },
    {
      magisch: true, passiv: false, signatur: false, name: 'Odem des Sturms', element: 'Luft',
      kategorien: ['Kampfmagie'], stufe: 3, komplexitaet: 2, kosten: '3', probe: 'IN+CH+KO',
      effekt: 'Windstoß, wirft Gegner zurück', notiz: '',
    },
    {
      magisch: true, passiv: false, signatur: false, name: 'Balsam Salabunde', element: 'Erde/Humus',
      kategorien: ['Heilmagie'], stufe: 2, komplexitaet: 1, kosten: '2', probe: 'MU+KL+KO',
      effekt: 'Heilt 1W6 LeP', notiz: '',
    },
    {
      magisch: true, passiv: true, signatur: false, name: 'Klarum Purum', element: 'Wasser',
      kategorien: ['Hellsicht'], stufe: 1, komplexitaet: 1, kosten: '1', probe: 'KL+IN+FF',
      effekt: 'Reinigt Wasser und kleine Flächen dauerhaft', notiz: 'Permanenter Alltagszauber.',
    },
    // Fähigkeiten (magisch=false) — aktiv & passiv, verschiedene Kategorien
    {
      magisch: false, passiv: true, signatur: false, name: 'Gefahreninstinkt', element: '',
      kategorien: ['Wahrnehmung'], stufe: 2, komplexitaet: 0, kosten: '', probe: '',
      effekt: 'Warnt vor Hinterhalten', notiz: '',
    },
    {
      magisch: false, passiv: true, signatur: false, name: 'Falkenauge', element: '',
      kategorien: ['Wahrnehmung'], stufe: 1, komplexitaet: 0, kosten: '', probe: '',
      effekt: 'Verdoppelte Sichtweite', notiz: '',
    },
    {
      magisch: false, passiv: true, signatur: false, name: 'Herausragende Balance', element: '',
      kategorien: ['Körperbeherrschung'], stufe: 1, komplexitaet: 0, kosten: '', probe: '',
      effekt: 'Kein Sturzrisiko auf schmalen Flächen', notiz: '',
    },
    {
      magisch: false, passiv: false, signatur: false, name: 'Meisterparade', element: '',
      kategorien: ['Kampf'], stufe: 3, komplexitaet: 0, kosten: '2 AsP', probe: '',
      effekt: 'Automatischer Erfolg bei der nächsten Parade', notiz: '',
    },
  ]);

  saveSection(charId, 'talents', [
    { talentId: talentId('Schwerter'), taw: 9, at: 2, pa: 2, bl: 0 },
    { talentId: talentId('Klettern'), taw: 4 },
    { talentId: talentId('Menschenkenntnis'), taw: 6 },
    { talentId: talentId('Sinnesschärfe'), taw: 8 },
    { talentId: talentId('Wildnisleben'), taw: 3 },
    { talentId: talentId('Überreden'), taw: 5 },
  ]);

  addWaffe(charId, 'nah', {
    schaden: '1W6+2', material: 'Eschenholz mit Silberbeschlag', rd: '1', reichweite: 'kurz',
    besonderes: 'Doppelt als Fokus nutzbar', talentId: String(talentId('Stäbe')), at: '10', pa: '8',
  }, { name: 'Gildenmagierstab', haltbarkeitMax: 6, haltbarkeitAktuell: 6 });
  addWaffe(charId, 'nah', {
    schaden: '1W6', material: 'Stahl', iniBonus: '1', reichweite: 'kurz',
    besonderes: 'Versteckt am Unterarm getragen', talentId: String(talentId('Dolche')), at: '8', pa: '6',
  }, { name: 'Dolch', haltbarkeitMax: 5, haltbarkeitAktuell: 5 });

  addWaffe(charId, 'fern', {
    eBE: 'Eibenholz', entfernung: '5/10/25', besonderes: 'Ererbt von der Großmutter',
    schaden: '1W6+2', talentId: String(talentId('Jagdbögen')),
  }, { name: 'Jagdbogen', haltbarkeitMax: 5, haltbarkeitAktuell: 5 });

  setPouchCoins(charId, { D: 2, S: 18, H: 4, K: 12 });
}

function fillLightCharacter(charId: number): void {
  db.prepare('UPDATE char_meta SET stufe = ?, ap = ? WHERE character_id = ?').run(3, 400, charId);
  db.prepare(
    "UPDATE char_bio SET rasse = 'Zwerge', rasseId = ?, kultur = 'Erzfeste', profession = 'Söldner' WHERE character_id = ?",
  ).run(raceId('Zwerge'), charId);

  saveSection(charId, 'talents', [{ talentId: talentId('Äxte'), taw: 11, at: 3, pa: 1, bl: 1 }]);

  addWaffe(charId, 'nah', {
    schaden: '1W6+4', material: 'Zwergenstahl', iniBonus: '-1', rd: '2', reichweite: 'mittel',
    anforderung: 'KK 14', talentId: String(talentId('Äxte')), at: '12', pa: '6', bl: '1',
  }, { name: 'Kriegsaxt', haltbarkeitMax: 8, haltbarkeitAktuell: 8 });

  setPouchCoins(charId, { S: 6, H: 2 });
}

function seedTestUser(): void {
  abortIfProduction();

  const userId = ensureUser(USERNAME, DISPLAY_NAME);
  const groupAlpha = ensureGroup(GROUP_ALPHA);
  const groupBeta = ensureGroup(GROUP_BETA);

  const rich = ensureCharacter('Kyra Vollausstattung', userId, groupAlpha);
  if (rich.created) fillRichCharacter(rich.id);

  const light = ensureCharacter('Barin Schildbrecher', userId, groupBeta);
  if (light.created) fillLightCharacter(light.id);

  // Bewusst gruppenlos: deckt die Ansicht eines eigenständig erstellten
  // Charakters ohne Gruppenzuordnung ab.
  ensureCharacter('Nils Unbehaust', userId, null);

  console.log(
    `✓ Test-Nutzer-Seed fertig. Login: "${USERNAME}" / "${TESTUSER_PASSWORD}".\n` +
      '  Charaktere: "Kyra Vollausstattung" (voll ausgestattet, Gruppe Alpha), ' +
      '"Barin Schildbrecher" (schlank, Gruppe Beta), "Nils Unbehaust" (gruppenlos).',
  );
}

seedTestUser();
