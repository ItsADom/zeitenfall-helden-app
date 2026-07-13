// Importiert ein Arbeitsbuch im Raskir-Template in die Datenbank und
// gleicht alle berechneten Werte gegen die Formelergebnisse des Blatts ab.
//
// Aufruf: npm run import -- <datei.xlsx> [--owner <benutzer>] [--group <gruppe>] [--name <charaktername>]
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  LIST_SECTIONS,
  RESOURCE_KEYS,
  computeBaseValues,
  computeResource,
  listSectionById,
  maximaleLast,
  mrErgebnis,
  probeExprZahl,
  schreibenProbe,
  sprechenProbe,
  talentProbeZahl,
  weaponProbes,
} from 'shared';
import type { AttrCode, Attributes, BaseValueInputs, Resources } from 'shared';
import { readXlsxFull, cellStr, cellNum, cellFormula } from './xlsx.js';
import type { Sheet } from './xlsx.js';
import { extractLanguages, extractTalentValues } from './extract.js';

// --- Argumente ---

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
function opt(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
if (!file) {
  console.error('Aufruf: npm run import -- <datei.xlsx> [--owner <benutzer>] [--group <gruppe>] [--name <charaktername>]');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.HELDEN_DB ?? path.join(here, '..', '..', 'server', 'data', 'helden.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const hasSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='characters'").get();
const catalogCount = hasSchema ? (db.prepare('SELECT COUNT(*) AS n FROM talents_catalog').get() as { n: number }).n : 0;
if (!hasSchema || catalogCount === 0) {
  console.error('Datenbank ist nicht initialisiert. Bitte zuerst im Ordner server "npm run seed" ausführen.');
  process.exit(1);
}

const workbook = readXlsxFull(file);
const wb = workbook.sheets;
const allComments = workbook.comments;
const sheet = (name: string): Sheet => {
  const s = wb.get(name);
  if (!s) throw new Error(`Blatt "${name}" nicht gefunden`);
  return s;
};
// Zellkommentar als Zeilen-Notiz (mehrzeilig erhalten)
function commentAt(sheetName: string, ref: string): string {
  return allComments.get(sheetName)?.get(ref) ?? '';
}
const held = sheet('Heldenbrief');
const ausruestung = sheet('Ausrüstung');
const inventar = sheet('Inventar');
const talente = sheet('Talente');
const zauber = sheet('Zauber');
const waffen = sheet('Waffen');
const bibliothek = sheet('Bibliothek');
const sprachen = sheet('Sprachen');
const artefakte = sheet('Artefakte');
const besitz = sheet('Besitz');
const boni = sheet('Boni');
const vorlieben = sheet('Vorlieben');

const charName = opt('name') ?? cellStr(held, 'A1');
if (!charName) throw new Error('Kein Charaktername gefunden (Heldenbrief!A1)');

// --- Besitzer & Gruppe ---

function findOrCreateUser(username: string): number {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (row) return row.id;
  const password = crypto.randomBytes(4).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const r = db
    .prepare('INSERT INTO users (username, password_hash, display_name, is_gm) VALUES (?, ?, ?, 0)')
    .run(username, `${salt}:${hash}`, username);
  console.log(`Benutzer "${username}" angelegt, Passwort: ${password} (bitte ändern)`);
  return Number(r.lastInsertRowid);
}

function findOrCreateGroup(name: string): number {
  const row = db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined;
  if (row) return row.id;
  const r = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  console.log(`Gruppe "${name}" angelegt`);
  return Number(r.lastInsertRowid);
}

const ownerId = findOrCreateUser(opt('owner') ?? 'spielleiter');
const groupId = findOrCreateGroup(opt('group') ?? 'Import');
db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, ownerId);

// --- Charakter anlegen ---

const existing = db.prepare('SELECT id FROM characters WHERE name = ?').get(charName) as { id: number } | undefined;
if (existing) {
  console.error(`Charakter "${charName}" existiert bereits (ID ${existing.id}). Bitte vorher löschen oder --name verwenden.`);
  process.exit(1);
}
const charId = Number(db.prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, ?)').run(charName, ownerId, groupId).lastInsertRowid);
for (const code of ATTR_ROW_CODES) db.prepare('INSERT INTO char_attributes (character_id, attr) VALUES (?, ?)').run(charId, code);
for (const key of BASE_VALUE_KEYS) db.prepare('INSERT INTO char_base_values (character_id, key) VALUES (?, ?)').run(charId, key);
for (const key of RESOURCE_KEYS) db.prepare('INSERT INTO char_resources (character_id, key) VALUES (?, ?)').run(charId, key);
db.prepare('INSERT INTO char_bio (character_id) VALUES (?)').run(charId);
db.prepare('INSERT INTO char_meta (character_id) VALUES (?)').run(charId);

// --- Abgleich-Protokoll ---

interface Mismatch {
  stelle: string;
  erwartet: number;
  berechnet: number;
}
const mismatches: Mismatch[] = [];
let checks = 0;
function check(stelle: string, erwartet: number | null, berechnet: number | null): void {
  if (erwartet == null || berechnet == null) return;
  checks++;
  if (Math.abs(erwartet - berechnet) > 0.01) mismatches.push({ stelle, erwartet, berechnet });
}

// --- Heldenbrief: Bio ---

const bio = {
  alterGeburtstag: cellStr(held, 'B2'),
  geschlecht: cellStr(held, 'B3'),
  groesse: cellStr(held, 'B4'),
  gewicht: cellStr(held, 'B5'),
  augenfarbe: cellStr(held, 'D1'),
  haarfarbe: cellStr(held, 'D2'),
  hautfarbe: cellStr(held, 'D3'),
  familienstand: cellStr(held, 'D4'),
  anrede: cellStr(held, 'D5'),
  rasse: cellStr(held, 'F1'),
  rasseMod: cellStr(held, 'H1'),
  kultur: cellStr(held, 'F2'),
  kulturMod: cellStr(held, 'H2'),
  profession: cellStr(held, 'F3'),
  zweitprofession: cellStr(held, 'H3'),
  gottheit: cellStr(held, 'F4'),
  goettergeschenke: cellStr(held, 'F5'),
};
db.prepare(
  `UPDATE char_bio SET ${Object.keys(bio)
    .map((k) => `${k} = ?`)
    .join(', ')} WHERE character_id = ?`,
).run(...Object.values(bio), charId);

// --- Heldenbrief: Attribute (Zeilen 9-17) ---

const attrRows: [string, number][] = [
  ['MU', 9], ['KL', 10], ['IN', 11], ['CH', 12], ['FF', 13], ['GE', 14], ['KO', 15], ['KK', 16], ['SO', 17],
];
const attributes = {} as Attributes;
for (const [code, r] of attrRows) {
  const akt = cellNum(held, `B${r}`);
  const mod = cellNum(held, `C${r}`);
  attributes[code as keyof Attributes] = { akt, mod };
  db.prepare('UPDATE char_attributes SET akt = ?, mod = ? WHERE character_id = ? AND attr = ?').run(akt, mod, charId, code);
  check(`Heldenbrief!D${r} (${code} Max)`, cellNum(held, `D${r}`), akt + mod);
}

// --- Heldenbrief: Energien (Zeilen 25-28) ---

const resourceRows: [string, number][] = [['le', 25], ['aus', 26], ['ase', 27], ['mr', 28]];
const resources = {} as Resources;
for (const [key, r] of resourceRows) {
  const input = {
    permanent: cellNum(held, `D${r}`),
    kauf: cellNum(held, `E${r}`),
    kaufMax: cellNum(held, `F${r}`),
    maxPlus: cellNum(held, `G${r}`),
    aktuell: cellNum(held, `I${r}`),
    besonderes: cellStr(held, `K${r}`),
  };
  resources[key as keyof Resources] = input;
  db.prepare(
    'UPDATE char_resources SET permanent = ?, kauf = ?, kaufMax = ?, maxPlus = ?, aktuell = ?, besonderes = ? WHERE character_id = ? AND key = ?',
  ).run(input.permanent, input.kauf, input.kaufMax, input.maxPlus, input.aktuell, input.besonderes, charId, key);
}
for (const [key, r] of resourceRows) {
  const result = computeResource(attributes, key as never, resources[key as keyof Resources]);
  check(`Heldenbrief!C${r} (Vorergebnis ${key})`, cellNum(held, `C${r}`), result.vorergebnis);
  check(`Heldenbrief!H${r} (Ergebnis ${key})`, cellNum(held, `H${r}`), result.ergebnis);
  if (result.max != null && cellStr(held, `J${r}`) !== '') check(`Heldenbrief!J${r} (Max ${key})`, cellNum(held, `J${r}`), result.max);
}

// --- Heldenbrief: Basiswerte (Zeilen 9-19) ---

const baseValueRows: [string, number][] = [
  ['at', 9], ['pa', 10], ['bl', 11], ['fk', 12], ['ini', 13], ['artefaktkontrolle', 14],
  ['todesschwelle', 15], ['wundschwelle', 16], ['ausweichen', 17], ['resilienz', 18], ['gs', 19],
];
const baseInputs: BaseValueInputs = {
  mods: Object.fromEntries(BASE_VALUE_KEYS.map((k) => [k, 0])) as BaseValueInputs['mods'],
  gsBase: cellNum(held, 'H19'),
};
for (const [key, r] of baseValueRows) {
  baseInputs.mods[key as keyof BaseValueInputs['mods']] = cellNum(held, `I${r}`);
}
for (const [key] of baseValueRows) {
  db.prepare('UPDATE char_base_values SET mod = ?, base = ? WHERE character_id = ? AND key = ?').run(
    baseInputs.mods[key as keyof BaseValueInputs['mods']],
    key === 'gs' ? baseInputs.gsBase : 0,
    charId,
    key,
  );
}
const mr = mrErgebnis(attributes, resources);
const baseValues = computeBaseValues(attributes, baseInputs, mr);
for (const [key, r] of baseValueRows) {
  if (key === 'gs') continue;
  const bv = baseValues[key as keyof typeof baseValues];
  check(`Heldenbrief!H${r} (${key} Basis)`, cellNum(held, `H${r}`), bv.base);
  if (cellStr(held, `J${r}`) !== '') check(`Heldenbrief!J${r} (${key} Ergebnis)`, cellNum(held, `J${r}`), bv.ergebnis);
}

// --- Heldenbrief: Meta ---

const meta = {
  stufe: cellNum(held, 'M24'),
  ap: cellNum(held, 'M25'),
  apNextLevel: cellNum(held, 'N25'),
  apGuthaben: cellNum(held, 'M26'),
  karma: cellNum(held, 'M27'),
  karmaGuthaben: cellNum(held, 'M28'),
  ruf: cellNum(held, 'M29'),
  psycheAkt: cellNum(held, 'M30'),
  psycheMax: cellNum(held, 'N30'),
  geldD: cellNum(held, 'B21'),
  geldS: cellNum(held, 'C21'),
  geldH: cellNum(held, 'D21'),
  geldK: cellNum(held, 'E21'),
  bank: cellNum(held, 'H21'),
};
db.prepare(
  `UPDATE char_meta SET ${Object.keys(meta)
    .map((k) => `${k} = ?`)
    .join(', ')} WHERE character_id = ?`,
).run(...Object.values(meta), charId);

// --- Generische Listen-Inserts ---

function insertList(sectionId: string, rows: Record<string, unknown>[]): void {
  const def = listSectionById(sectionId);
  if (!def) throw new Error(`Unbekannte Sektion ${sectionId}`);
  const cols = def.columns.map((c) => c.key);
  const stmt = db.prepare(
    `INSERT INTO sec_${sectionId} (character_id, pos, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
  );
  rows.forEach((r, i) => {
    const values = def.columns.map((c) => {
      const v = r[c.key];
      if (c.type === 'number') return typeof v === 'number' ? v : Number(v) || 0;
      if (c.type === 'bool') return v ? 1 : 0;
      return v == null ? '' : String(v);
    });
    stmt.run(charId, i, ...values);
  });
}

// --- Heldenbrief: Professionsboni, Vorteile/Nachteile, Titel, Perks ---

const profBoni: Record<string, unknown>[] = [];
for (const r of [6, 7]) {
  if (cellStr(held, `D${r}`)) profBoni.push({ bezeichnung: cellStr(held, `D${r}`), effekt: cellStr(held, `E${r}`) });
  if (cellStr(held, `G${r}`)) profBoni.push({ bezeichnung: cellStr(held, `G${r}`), effekt: cellStr(held, `H${r}`) });
}
insertList('professionBoni', profBoni);

const vorteile: Record<string, unknown>[] = [];
for (let r = 3; r <= 9; r++) {
  const name = cellStr(held, `L${r}`);
  if (name) {
    vorteile.push({
      name,
      wert: cellStr(held, `M${r}`),
      gp: cellStr(held, `N${r}`),
      beschreibung: cellStr(held, `O${r}`),
      notiz: commentAt('Heldenbrief', `O${r}`),
    });
  }
}
insertList('vorteile', vorteile);

const nachteile: Record<string, unknown>[] = [];
for (let r = 12; r <= 15; r++) {
  const name = cellStr(held, `L${r}`);
  if (name) {
    nachteile.push({
      name,
      wert: cellStr(held, `M${r}`),
      gp: cellStr(held, `N${r}`),
      beschreibung: cellStr(held, `O${r}`),
      notiz: commentAt('Heldenbrief', `O${r}`),
    });
  }
}
insertList('nachteile', nachteile);

const titel: Record<string, unknown>[] = [];
for (let r = 18; r <= 23; r++) {
  const name = cellStr(held, `L${r}`);
  if (name) titel.push({ name, effekt: cellStr(held, `N${r}`) });
}
insertList('titel', titel);

const perks: Record<string, unknown>[] = [];
for (let r = 30; r <= 60; r++) {
  const name = cellStr(held, `B${r}`);
  if (name) perks.push({ voraussetzung: cellStr(held, `A${r}`), name, effekt: cellStr(held, `C${r}`) });
}
insertList('perks', perks);

// --- Talente ---

interface CatalogRow {
  id: number;
  kategorie: string;
  name: string;
  probe: string;
}
const catalog = db.prepare('SELECT id, kategorie, name, probe FROM talents_catalog').all() as CatalogRow[];
const catalogByName = new Map(catalog.map((c) => [`${c.kategorie}|${c.name}`, c]));
const catalogByPlainName = new Map(catalog.map((c) => [c.name, c]));

const talentValues = extractTalentValues(talente);
const talentStmt = db.prepare(
  `INSERT INTO char_talents (character_id, talent_id, taw, at, pa, bl, billiger, spezialisierung, waffenmeister, berufsbonus)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const charTalents = new Map<number, { at: number; pa: number; bl: number }>();
for (const t of talentValues) {
  const cat = catalogByName.get(`${t.kategorie}|${t.name}`);
  if (!cat) {
    console.warn(`  Talent nicht im Katalog: ${t.name} (${t.kategorie}) — übersprungen`);
    continue;
  }
  talentStmt.run(charId, cat.id, t.taw, t.at, t.pa, t.bl, t.billiger, t.spezialisierung, t.waffenmeister, t.berufsbonus);
  charTalents.set(cat.id, { at: t.at, pa: t.pa, bl: t.bl });
  if (t.expectedProbeZahl != null && cat.probe) {
    const probe = cat.probe.split('/') as [AttrCode, AttrCode, AttrCode];
    check(`Talente ${t.name} (Probe)`, t.expectedProbeZahl, talentProbeZahl(attributes, probe, t.taw));
  }
}

// --- Waffen ---

function talentIdFromFormula(sheetRef: Sheet, cell: string): number {
  const f = cellFormula(sheetRef, cell);
  const m = f ? /Talente!\$?[A-Z]\$?(\d+)/.exec(f) : null;
  if (!m) return 0;
  const name = cellStr(talente, `A${m[1]}`).replace(/\s*\([A-F]\)\s*$/, '').trim();
  return catalogByPlainName.get(name)?.id ?? 0;
}

const waffenNah: Record<string, unknown>[] = [];
for (let r = 7; r <= 13; r++) {
  const name = cellStr(waffen, `A${r}`);
  if (!name) continue;
  const talentId =
    talentIdFromFormula(waffen, `T${r}`) || talentIdFromFormula(waffen, `U${r}`) || talentIdFromFormula(waffen, `V${r}`);
  const split = charTalents.get(talentId) ?? { at: 0, pa: 0, bl: 0 };
  const base = { at: baseValues.at.ergebnis, pa: baseValues.pa.ergebnis, bl: baseValues.bl.ergebnis };
  const at = cellNum(waffen, `F${r}`);
  // Manuell eingetragene (formelfreie) AT-Proben werden als Deckel übernommen
  // (z. B. Nachteil „Schildträger: AT maximal 10" bei der Sühne)
  let atMax = 0;
  const uncapped = weaponProbes({ at, pa: 0, bl: 0 }, base, split).at;
  if (cellStr(waffen, `T${r}`) !== '' && !cellFormula(waffen, `T${r}`) && cellNum(waffen, `T${r}`) < uncapped) {
    atMax = cellNum(waffen, `T${r}`);
  }
  const row = {
    name,
    typMaterial: cellStr(waffen, `B${r}`),
    rd: cellStr(waffen, `C${r}`),
    tp: cellStr(waffen, `D${r}`),
    anforderung: cellStr(waffen, `E${r}`),
    at,
    pa: cellNum(waffen, `J${r}`),
    bl: cellNum(waffen, `K${r}`),
    atMax,
    schaden: cellStr(waffen, `L${r}`),
    iniBonus: cellNum(waffen, `M${r}`),
    reichweite: cellStr(waffen, `N${r}`),
    besonderes: cellStr(waffen, `P${r}`),
    notiz: commentAt('Waffen', `P${r}`),
    expLevel: cellStr(waffen, `W${r + 1}`),
    talentId,
  };
  waffenNah.push(row);
  const probes = weaponProbes({ at: row.at, pa: row.pa, bl: row.bl, atMax: row.atMax }, base, split);
  if (cellStr(waffen, `T${r}`) !== '') check(`Waffen!T${r} (${name} AT)`, cellNum(waffen, `T${r}`), probes.at);
  if (cellStr(waffen, `U${r}`) !== '') check(`Waffen!U${r} (${name} PA)`, cellNum(waffen, `U${r}`), probes.pa);
  if (cellStr(waffen, `V${r}`) !== '') check(`Waffen!V${r} (${name} BL)`, cellNum(waffen, `V${r}`), probes.bl);
}
insertList('waffenNah', waffenNah);

const waffenFern: Record<string, unknown>[] = [];
for (let r = 16; r <= 19; r++) {
  const name = cellStr(waffen, `A${r}`);
  if (!name) continue;
  waffenFern.push({
    name,
    typEbe: cellStr(waffen, `B${r}`),
    entfernung: cellStr(waffen, `C${r}`),
    tpEntfernung: cellStr(waffen, `F${r}`),
    atMod: cellNum(waffen, `M${r}`),
    tp: cellStr(waffen, `O${r}`),
    besonderes: cellStr(waffen, `R${r}`),
    talentId: 0,
  });
}
insertList('waffenFern', waffenFern);

const waffenlosRows: Record<string, unknown>[] = [];
for (let r = 22; r <= 23; r++) {
  const technik = cellStr(waffen, `A${r}`);
  if (!technik) continue;
  waffenlosRows.push({
    technik,
    tpKk: cellStr(waffen, `B${r}`),
    ini: cellNum(waffen, `C${r}`),
    at: cellNum(waffen, `D${r}`),
    pa: cellNum(waffen, `E${r}`),
    tpa: cellStr(waffen, `F${r}`),
    talentId: catalogByPlainName.get(technik)?.id ?? 0,
  });
}
insertList('waffenlos', waffenlosRows);

const munition: Record<string, unknown>[] = [];
for (let r = 16; r <= 24; r++) {
  const art = cellStr(waffen, `T${r}`);
  if (art) munition.push({ art, anzahl: cellStr(waffen, `U${r}`), fuerWaffe: cellStr(waffen, `V${r}`) });
}
insertList('munition', munition);

const kampfstile: Record<string, unknown>[] = [];
for (let r = 22; r <= 30; r++) {
  const name = cellStr(waffen, `J${r}`);
  if (name) kampfstile.push({ name, besonderes: cellStr(waffen, `N${r}`) });
}
insertList('kampfstile', kampfstile);

// --- Zauber: frei benennbare Sektionen (Vorlage: die drei Blöcke des Blatts) ---

const zauberEintraege: Record<string, unknown>[] = [];
const SEKTION_TECHNIKEN = 'Talente/Kampfstile/Stellungen';
const SEKTION_LITURGIEN = 'Liturgien';
const SEKTION_ZAUBER = 'Allgemeinzauber';

for (let r = 5; r <= 19; r++) {
  const name = cellStr(zauber, `A${r}`);
  if (!name) continue;
  const probe = cellStr(zauber, `F${r}`);
  const computed = probeExprZahl(attributes, probe);
  const expected = cellStr(zauber, `G${r}`);
  if (computed != null && expected !== '' && expected.toUpperCase() !== 'X') {
    check(`Zauber!G${r} (${name})`, cellNum(zauber, `G${r}`), computed);
  }
  zauberEintraege.push({
    sektion: SEKTION_TECHNIKEN,
    name,
    stufe: cellStr(zauber, `D${r}`),
    kosten: cellStr(zauber, `E${r}`),
    probe,
    effekt: cellStr(zauber, `H${r}`),
    notiz: commentAt('Zauber', `H${r}`),
    fortschritt: cellNum(zauber, `L${r}`),
    probeZahlManuell: computed == null && expected !== '' && expected.toUpperCase() !== 'X' ? cellNum(zauber, `G${r}`) : 0,
  });
}
for (let r = 5; r <= 12; r++) {
  const name = cellStr(zauber, `M${r}`);
  if (!name) continue;
  zauberEintraege.push({
    sektion: SEKTION_LITURGIEN,
    name,
    kosten: cellStr(zauber, `O${r}`),
    effekt: cellStr(zauber, `Q${r}`),
    probeZahlManuell: cellNum(zauber, `T${r}`),
  });
}
for (let r = 23; r <= 25; r++) {
  const name = cellStr(zauber, `A${r}`);
  if (!name) continue;
  const probe = cellStr(zauber, `F${r}`);
  const computed = probeExprZahl(attributes, probe);
  if (computed != null && cellStr(zauber, `K${r}`) !== '') check(`Zauber!K${r} (${name})`, cellNum(zauber, `K${r}`), computed);
  zauberEintraege.push({
    sektion: SEKTION_ZAUBER,
    name,
    stufe: cellStr(zauber, `C${r}`),
    kosten: cellStr(zauber, `D${r}`),
    probe,
    effekt: cellStr(zauber, `H${r}`),
  });
}
insertList('zauberSektionen', [{ name: SEKTION_TECHNIKEN }, { name: SEKTION_LITURGIEN }, { name: SEKTION_ZAUBER }]);
insertList('zauberEintraege', zauberEintraege);

// --- Ausrüstung ---

const slotDefs: { slot: string; col: string; from: number; to: number }[] = [
  { slot: 'Kopf', col: 'A', from: 2, to: 4 },
  { slot: 'Hals', col: 'C', from: 2, to: 4 },
  { slot: 'Arme', col: 'A', from: 6, to: 8 },
  { slot: 'Brust', col: 'C', from: 6, to: 8 },
  { slot: 'Beine', col: 'A', from: 10, to: 16 },
  { slot: 'Hände', col: 'C', from: 10, to: 12 },
  { slot: 'Schuhe', col: 'C', from: 14, to: 16 },
  { slot: 'Unterwäsche', col: 'A', from: 18, to: 19 },
  { slot: 'Gürtel/Hosentaschen', col: 'F', from: 5, to: 17 },
];
const slots: Record<string, unknown>[] = [];
for (const s of slotDefs) {
  for (let r = s.from; r <= s.to; r++) {
    const v = cellStr(ausruestung, `${s.col}${r}`);
    if (v) slots.push({ slot: s.slot, beschreibung: v });
  }
}
insertList('ausruestungSlots', slots);

const behaelter: Record<string, unknown>[] = [];
for (let r = 3; r <= 4; r++) {
  const name = cellStr(ausruestung, `F${r}`);
  if (name) behaelter.push({ name, kapazitaet: cellStr(ausruestung, `I${r}`) });
}
insertList('behaelter', behaelter);

const proviant: Record<string, unknown>[] = [];
for (let r = 3; r <= 9; r++) {
  const name = cellStr(ausruestung, `K${r}`);
  if (name) proviant.push({ name, portionen: cellNum(ausruestung, `M${r}`), gewicht: cellNum(ausruestung, `O${r}`) });
}
insertList('proviant', proviant);

const kleidungen: Record<string, unknown>[] = [];
for (let r = 13; r <= 17; r++) {
  const anlass = cellStr(ausruestung, `K${r}`);
  if (anlass) kleidungen.push({ anlass, kleidung: cellStr(ausruestung, `M${r}`), gewicht: cellNum(ausruestung, `O${r}`) });
}
insertList('kleidungen', kleidungen);

const tiere: Record<string, unknown>[] = [];
for (let r = 23; r <= 34; r++) {
  const a = cellStr(ausruestung, `A${r}`);
  if (a) tiere.push({ tier: cellStr(ausruestung, 'A21') || 'Pferd', name: a, gewicht: cellNum(ausruestung, `D${r}`) });
  const f = cellStr(ausruestung, `F${r}`);
  if (f) tiere.push({ tier: cellStr(ausruestung, 'F21') || 'Begleiter', name: f, gewicht: cellNum(ausruestung, `I${r}`) });
}
insertList('tierAusruestung', tiere);

// --- Inventar ---

const invRanges: { kategorie: string; nameCol: string; anzahlCol: string; gewichtCol: string }[] = [
  { kategorie: 'Allgemein', nameCol: 'A', anzahlCol: 'B', gewichtCol: 'C' },
  { kategorie: 'Tränke/Proviant', nameCol: 'F', anzahlCol: 'G', gewichtCol: 'H' },
  { kategorie: 'Handwerk', nameCol: 'K', anzahlCol: 'L', gewichtCol: 'M' },
];
const invRows: Record<string, unknown>[] = [];
for (const range of invRanges) {
  for (let r = 5; r <= 52; r++) {
    const name = cellStr(inventar, `${range.nameCol}${r}`);
    if (!name) continue;
    invRows.push({
      kategorie: range.kategorie,
      name,
      anzahl: cellNum(inventar, `${range.anzahlCol}${r}`),
      eGewicht: cellNum(inventar, `${range.gewichtCol}${r}`),
      notiz: commentAt('Inventar', `${range.nameCol}${r}`),
    });
  }
}
insertList('inventar', invRows);
check('Inventar!B1 (Maximale Last)', cellNum(inventar, 'B1'), maximaleLast(attributes));

// --- Sprachen ---

const langCatalog = db.prepare('SELECT id, kind, familie, name FROM languages_catalog').all() as {
  id: number;
  kind: string;
  familie: string;
  name: string;
}[];
const langByKey = new Map(langCatalog.map((l) => [`${l.kind}|${l.familie}|${l.name}`, l.id]));
const langByKindName = new Map(langCatalog.map((l) => [`${l.kind}|${l.name}`, l.id]));
const langStmt = db.prepare('INSERT OR IGNORE INTO char_languages (character_id, language_id, taw, muttersprache) VALUES (?, ?, ?, ?)');
for (const v of extractLanguages(sprachen).values) {
  const id = langByKey.get(`${v.kind}|${v.familie}|${v.name}`) ?? langByKindName.get(`${v.kind}|${v.name}`);
  if (!id) {
    console.warn(`  Sprache nicht im Katalog: ${v.name} — übersprungen`);
    continue;
  }
  langStmt.run(charId, id, v.taw, v.muttersprache ? 1 : 0);
}
check('Sprachen!T6 (Sprechen-Probe)', cellNum(sprachen, 'T6'), sprechenProbe(attributes));
check('Sprachen!V6 (Schreiben-Probe)', cellNum(sprachen, 'V6'), schreibenProbe(attributes));

// --- Artefakte ---

const kraftspeicher: Record<string, unknown>[] = [];
for (let r = 7; r <= 10; r++) {
  const name = cellStr(artefakte, `A${r}`);
  if (name) {
    kraftspeicher.push({
      name,
      pasp: cellStr(artefakte, `B${r}`),
      maxAstral: cellStr(artefakte, `C${r}`),
      momentaneAsp: cellStr(artefakte, `D${r}`),
      einschraenkungen: cellStr(artefakte, `L${r}`),
      besonderes: cellStr(artefakte, `R${r}`),
    });
  }
}
insertList('kraftspeicher', kraftspeicher);

const artefakteRows: Record<string, unknown>[] = [];
for (let r = 13; r <= 49; r++) {
  const name = cellStr(artefakte, `A${r}`);
  if (!name) continue;
  artefakteRows.push({
    name,
    wert: cellStr(artefakte, `B${r}`),
    pasp: cellStr(artefakte, `C${r}`),
    sprueche: cellStr(artefakte, `D${r}`),
    ladungen: cellStr(artefakte, `I${r}`),
    intervallStab: cellStr(artefakte, `M${r}`),
    beseeltheit: cellStr(artefakte, `O${r}`),
    ausloeser: cellStr(artefakte, `Q${r}`),
    haltbarkeit: cellStr(artefakte, `R${r}`),
  });
}
insertList('artefakte', artefakteRows);

// --- Besitz ---

const waehrungen: Record<string, unknown>[] = [];
for (let r = 3; r <= 10; r++) {
  const w = cellStr(besitz, `A${r}`);
  if (w) waehrungen.push({ waehrung: w, menge: cellStr(besitz, `B${r}`) });
}
insertList('waehrungen', waehrungen);

const schulden: Record<string, unknown>[] = [];
for (let r = 3; r <= 10; r++) {
  const g = cellStr(besitz, `E${r}`);
  if (g) {
    schulden.push({
      glaeubiger: g,
      schulden: cellStr(besitz, `G${r}`),
      ort: cellStr(besitz, `I${r}`),
      frist: cellStr(besitz, `L${r}`),
      zinsen: cellStr(besitz, `N${r}`),
    });
  }
}
insertList('schulden', schulden);

const wertgegenstaende: Record<string, unknown>[] = [];
for (let r = 14; r <= 27; r++) {
  const name = cellStr(besitz, `A${r}`);
  if (name) {
    wertgegenstaende.push({
      name,
      aussehen: cellStr(besitz, `D${r}`),
      besonderes: cellStr(besitz, `H${r}`),
      wert: cellStr(besitz, `N${r}`),
    });
  }
}
insertList('wertgegenstaende', wertgegenstaende);

const einnahmequellen: Record<string, unknown>[] = [];
for (let r = 32; r <= 43; r++) {
  const quelle = cellStr(besitz, `A${r}`);
  if (quelle) {
    einnahmequellen.push({
      quelle,
      ort: cellStr(besitz, `C${r}`),
      beschreibung: cellStr(besitz, `F${r}`),
      gewinnProMonat: cellStr(besitz, `M${r}`),
    });
  }
}
insertList('einnahmequellen', einnahmequellen);

const immobilien: Record<string, unknown>[] = [];
for (let r = 48; r <= 59; r++) {
  const typ = cellStr(besitz, `A${r}`);
  if (typ) {
    immobilien.push({
      typ,
      ort: cellStr(besitz, `C${r}`),
      beschreibung: cellStr(besitz, `F${r}`),
      kostenProMonat: cellStr(besitz, `M${r}`),
    });
  }
}
insertList('immobilien', immobilien);

const sonstiges: Record<string, unknown>[] = [];
for (let r = 64; r <= 68; r++) {
  const art = cellStr(besitz, `A${r}`);
  if (art) sonstiges.push({ art, beschreibung: cellStr(besitz, `C${r}`), kostenGewinn: cellStr(besitz, `H${r}`) });
}
insertList('besitzSonstiges', sonstiges);

// --- Bibliothek ---

const buecher: Record<string, unknown>[] = [];
for (let r = 4; r <= 40; r++) {
  const buch = cellStr(bibliothek, `A${r}`);
  if (!buch) continue;
  buecher.push({
    buch,
    typ: cellStr(bibliothek, `C${r}`),
    wert: cellStr(bibliothek, `D${r}`),
    voraussetzungen: cellStr(bibliothek, `E${r}`),
    talente: cellStr(bibliothek, `H${r}`),
    besonderes: cellStr(bibliothek, `N${r}`),
    abgeschlossen: cellStr(bibliothek, `P${r}`) !== '',
    inTasche: cellStr(bibliothek, `R${r}`) !== '',
  });
}
insertList('bibliothek', buecher);

// --- Boni ---

const boniRows: Record<string, unknown>[] = [];
for (let r = 3; r <= 30; r++) {
  const bonus = cellStr(boni, `B${r}`);
  if (bonus) boniRows.push({ bonus, herkunft: cellStr(boni, `C${r}`) });
}
insertList('boni', boniRows);

// --- Vorlieben ---

const vorliebenRows: Record<string, unknown>[] = [];
for (let r = 2; r <= 40; r++) {
  const mag = cellStr(vorlieben, `A${r}`);
  const magNicht = cellStr(vorlieben, `B${r}`);
  if (mag) vorliebenRows.push({ kind: 'mag', text: mag });
  if (magNicht) vorliebenRows.push({ kind: 'magNicht', text: magNicht });
}
insertList('vorlieben', vorliebenRows);

// --- Ergebnis ---

console.log(`\nCharakter "${charName}" importiert (ID ${charId}, Besitzer ${ownerId}, Gruppe ${groupId})`);
console.log(`Abgleich: ${checks} berechnete Werte geprüft, ${mismatches.length} Abweichung(en)`);
for (const m of mismatches) {
  console.log(`  ABWEICHUNG ${m.stelle}: Blatt=${m.erwartet}, App=${m.berechnet}`);
}
