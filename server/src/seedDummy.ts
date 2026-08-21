// Dummy-Seed: füllt eine ENTWICKLUNGS-Datenbank mit Test-Spielern, -Gruppen und
// -Charakteren, damit sich die Verwaltungs-/Gruppierungs-Ansichten unter realistischer
// Last testen lassen. Bewusst KEIN Teil des automatischen Start-Seeds (server/src/seed.ts) —
// nur manuell über `npm run seed:dummy -w server` und niemals gegen die echte Datenbank.
//
// Sicherheitsnetze:
//   • Bricht ab, sobald NODE_ENV=production ist (so läuft die Produktion sie auch
//     dann nicht, wenn der Befehl versehentlich dort abgesetzt wird).
//   • Idempotent: bereits vorhandene Dummy-Datensätze (per Name erkannt) werden
//     übersprungen, ein zweiter Lauf erzeugt also keine Duplikate.
//
// Die Datensätze tragen bewusst keine „dummy"-Präfixe: diese Daten erreichen nichts,
// was echte Nutzer sehen, und die Produktion bekommt sie durch die Guard nie zu Gesicht.
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { initCharacterRows } from './db.js';
import { instantiateStandardSections } from './characterData.js';
import { instantiateGroupTabs } from './dynSections.js';

// Einheitliches Test-Passwort für alle Dummy-Konten (nur Entwicklung).
const DUMMY_PASSWORD = process.env.DUMMY_PASSWORD ?? 'test1234';

// 12 Spieler (schlichte Vornamen als Anzeigename, Benutzername kleingeschrieben).
const PLAYERS = [
  'Anna', 'Ben', 'Clara', 'David', 'Emma', 'Finn',
  'Greta', 'Hannes', 'Ida', 'Jonas', 'Klara', 'Lukas',
];

// 4 Gruppen.
const GROUPS = [
  'Die Wächter von Anduria',
  'Schatten über Grauenstein',
  'Die Silberne Hand',
  'Kompanie der Morgenröte',
];

// 25 Charakternamen (DSA-artige Fantasy-Namen).
const CHARACTERS = [
  'Arok Steinfaust', 'Brigida Falkenauge', 'Cadwyn Mondschatten', 'Doran Wetterfels',
  'Elined Rosendorn', 'Faelan Grauwind', 'Gwenneth Silbermähne', 'Hagen Bärentöter',
  'Isolde Nachtblume', 'Jorlan Eisenhardt', 'Kyra Schattentanz', 'Lennart Sturmklinge',
  'Mirjam Weißhaar', 'Nandor Flammenschild', 'Odara Tiefwasser', 'Perrin Habichtsflug',
  'Quenna Dornbach', 'Roderick Wolfszahn', 'Selina Abendrot', 'Torben Felsenkern',
  'Ulrike Windläufer', 'Valdric Nebelgang', 'Wanda Glutauge', 'Yorick Rabenschwinge',
  'Zilla Morgentau',
];

function abortIfProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ Dummy-Seed abgebrochen: NODE_ENV=production. Diese Daten gehören niemals in die echte Datenbank.');
    process.exit(1);
  }
}

// Legt einen Spieler an (oder gibt die vorhandene ID zurück). Rein Spieler-Rolle.
function ensurePlayer(displayName: string): number {
  const username = displayName.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db
    .prepare('INSERT INTO users (username, password_hash, display_name, is_gm, is_admin) VALUES (?, ?, ?, 0, 0)')
    .run(username, hashPassword(DUMMY_PASSWORD), displayName);
  return Number(r.lastInsertRowid);
}

// Legt eine Gruppe an (oder gibt die vorhandene ID zurück) inkl. Standard-Tabs.
function ensureGroup(name: string): number {
  const existing = db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  const id = Number(r.lastInsertRowid);
  instantiateGroupTabs(id);
  return id;
}

// Legt einen schlanken Charakter an (Name/Besitzer/Gruppe + Standardsektionen),
// falls noch keiner gleichen Namens in derselben Gruppe existiert.
function ensureCharacter(name: string, ownerUserId: number, groupId: number): void {
  const existing = db
    .prepare('SELECT id FROM characters WHERE name = ? AND group_id = ?')
    .get(name, groupId) as { id: number } | undefined;
  if (existing) return;
  const r = db.prepare('INSERT INTO characters (name, owner_user_id, group_id) VALUES (?, ?, ?)').run(name, ownerUserId, groupId);
  const id = Number(r.lastInsertRowid);
  initCharacterRows(id);
  instantiateStandardSections(id);
}

function seedDummy(): void {
  abortIfProduction();

  const groupIds = GROUPS.map(ensureGroup);
  const userIds = PLAYERS.map(ensurePlayer);

  // Jeder Spieler gehört genau einer Gruppe (reihum verteilt, ~3 pro Gruppe) —
  // ergibt sich allein daraus, dass sein Charakter unten in diese Gruppe kommt.
  const groupOfUser = userIds.map((_, i) => groupIds[i % groupIds.length]);

  // Charaktere reihum auf die Spieler verteilen; die Gruppe folgt dem Besitzer,
  // damit Gruppen-/Spieler-Gruppierung in der Verwaltung konsistent aussieht.
  CHARACTERS.forEach((charName, i) => {
    const ownerIdx = i % userIds.length;
    ensureCharacter(charName, userIds[ownerIdx], groupOfUser[ownerIdx]);
  });

  const stats = {
    users: (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n,
    groups: (db.prepare('SELECT COUNT(*) AS n FROM groups').get() as { n: number }).n,
    characters: (db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n,
  };
  console.log(
    `✓ Dummy-Seed fertig. Test-Passwort für alle Dummy-Spieler: "${DUMMY_PASSWORD}".\n` +
      `  Datenbankstand jetzt: ${stats.users} Nutzer, ${stats.groups} Gruppen, ${stats.characters} Charaktere.`,
  );
}

seedDummy();
