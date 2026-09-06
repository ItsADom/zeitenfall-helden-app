import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATTR_ROW_CODES, BASE_VALUE_KEYS, LIST_SECTIONS, RESOURCE_KEYS } from 'shared';
import type { ColumnDef } from 'shared';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(process.env.HELDEN_DB ?? path.join(dir, 'helden.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function colSql(c: ColumnDef): string {
  switch (c.type) {
    case 'number':
      return `${c.key} REAL NOT NULL DEFAULT 0`;
    case 'bool':
      return `${c.key} INTEGER NOT NULL DEFAULT 0`;
    default:
      return `${c.key} TEXT NOT NULL DEFAULT ''`;
  }
}

const listTables = LIST_SECTIONS.map(
  (s) => `
  CREATE TABLE IF NOT EXISTS sec_${s.id} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    ${s.columns.map(colSql).join(',\n    ')}
  );`,
).join('\n');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    is_gm INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  -- is_temp unterscheidet eine Event-Gruppe von einer festen Gruppe — EINE
  -- id-Folge statt zweier getrennter Tabellen, damit group_feed (und jede
  -- künftige Chat/Würfel-Tabelle) mit einer einzigen FK auf groups(id)
  -- auskommt. created_by/created_at bleiben NULL für feste Gruppen, sind nur
  -- bei is_temp=1 befüllt.
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_temp INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER
  );
  -- Mitgliedschaft in einer Event-Gruppe: rein additiv zur festen Gruppe
  -- (characters.group_id bleibt unberührt) — ein Charakter bleibt in seiner
  -- festen Gruppe UND taucht im Event-Aufgebot auf. GM-only end-to-end, keine
  -- Spieler-Selbstanmeldung. Löschen der Gruppe entfernt nur die Zuordnungen
  -- (ON DELETE CASCADE) — keine Charakterdaten betroffen.
  CREATE TABLE IF NOT EXISTS temp_group_members (
    temp_group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (temp_group_id, character_id)
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    -- group_id ist NULLBAR: ein Charakter kann (noch) in keiner Gruppe sein.
    -- Selbst angelegte Charaktere starten gruppenlos; requested_group_id trägt
    -- die vom Spieler erbetene Gruppe, bis Spielleitung/Verwaltung sie freigibt.
    -- Zustände: (group_id gesetzt) = aktiv in Gruppe; (beide NULL) = gruppenlos;
    -- (group_id NULL, requested_group_id gesetzt) = Freigabe ausstehend.
    group_id INTEGER REFERENCES groups(id),
    requested_group_id INTEGER REFERENCES groups(id),
    requested_at INTEGER,
    -- Farbwelt des Charakters (Theme-Id, '' = keine → Betrachter sieht seine
    -- persönliche Vorgabe). Gilt für JEDEN, der den Charakter öffnet.
    theme TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS character_visibility (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, section)
  );
  -- Spaltenbreiten der fest eingebauten Tabellen (Talente, Waffen, Listen).
  -- Prozentwerte als JSON-Array; die Spalten selbst stehen im Code, hier hängt
  -- nur die Darstellung. Die selbst angelegten Tabellen brauchen das nicht —
  -- deren Breiten stecken in der Spaltendefinition (DynColumn.width).
  CREATE TABLE IF NOT EXISTS character_table_widths (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    table_key TEXT NOT NULL,
    widths TEXT NOT NULL,
    PRIMARY KEY (character_id, table_key)
  );
  -- Selbst gewählte Reihenfolge der Reiter als JSON-Array von Schlüsseln
  -- ('Talente', 'c7', …). Eingebaute und selbst angelegte Reiter stehen in
  -- derselben Liste — nur so lassen sie sich gemeinsam sortieren. Fehlt der
  -- Eintrag, gilt die Voreinstellung aus shared/tabOrder.
  CREATE TABLE IF NOT EXISTS character_tab_order (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    keys TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS char_bio (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    alterGeburtstag TEXT NOT NULL DEFAULT '', geschlecht TEXT NOT NULL DEFAULT '',
    groesse TEXT NOT NULL DEFAULT '', gewicht TEXT NOT NULL DEFAULT '',
    augenfarbe TEXT NOT NULL DEFAULT '', haarfarbe TEXT NOT NULL DEFAULT '', hautfarbe TEXT NOT NULL DEFAULT '',
    familienstand TEXT NOT NULL DEFAULT '', anrede TEXT NOT NULL DEFAULT '',
    rasse TEXT NOT NULL DEFAULT '', rasseMod TEXT NOT NULL DEFAULT '',
    -- Verweis in den Rassen-Katalog (races_catalog); rasse bleibt als Freitext-
    -- Spalte erhalten (Altbestand, kein Datenverlust) und wird beim Auswählen
    -- einer Katalog-Rasse mit deren Namen mitgesetzt, aber nicht mehr frei
    -- editiert — siehe rasseId in shared/src/types.ts.
    rasseId INTEGER REFERENCES races_catalog(id) ON DELETE SET NULL,
    kultur TEXT NOT NULL DEFAULT '', kulturMod TEXT NOT NULL DEFAULT '',
    profession TEXT NOT NULL DEFAULT '', zweitprofession TEXT NOT NULL DEFAULT '',
    gottheit TEXT NOT NULL DEFAULT '', goettergeschenke TEXT NOT NULL DEFAULT '',
    -- Freies Notizfeld der Seitenleiste (privater Notizzettel, NICHT im
    -- Heldenbrief/Zusammenfassung gerendert — die zeigen nur feste Bio-Felder).
    sidebarNotiz TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS char_meta (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    stufe REAL NOT NULL DEFAULT 0, ap REAL NOT NULL DEFAULT 0, apNextLevel REAL NOT NULL DEFAULT 0,
    apGuthaben REAL NOT NULL DEFAULT 0, karma REAL NOT NULL DEFAULT 0, karmaGuthaben REAL NOT NULL DEFAULT 0,
    ruf REAL NOT NULL DEFAULT 0, psycheAkt REAL NOT NULL DEFAULT 0, psycheMax REAL NOT NULL DEFAULT 0,
    psycheBase REAL NOT NULL DEFAULT 0, psycheBonus REAL NOT NULL DEFAULT 0,
    geldD REAL NOT NULL DEFAULT 0, geldS REAL NOT NULL DEFAULT 0, geldH REAL NOT NULL DEFAULT 0,
    geldK REAL NOT NULL DEFAULT 0, bank REAL NOT NULL DEFAULT 0,
    -- House-rule wound tracking (TODO.md "Wound tracking / count-display on
    -- VTT tokens") — separate from the LE resource. Purely manual entry
    -- (+1/-1 on the VTT token, no damage-number math), VTT-only display: not
    -- part of the character sheet, only ever shown to the token's owner and
    -- the GM (see BoardToken.wounds's doc comment in shared/src/boardProtocol.ts).
    small_wounds INTEGER NOT NULL DEFAULT 0, big_wounds INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_attributes (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    attr TEXT NOT NULL,
    akt REAL NOT NULL DEFAULT 0,
    mod REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, attr)
  );
  CREATE TABLE IF NOT EXISTS char_base_values (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    mod REAL NOT NULL DEFAULT 0,
    base REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, key)
  );
  CREATE TABLE IF NOT EXISTS char_resources (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    permanent REAL NOT NULL DEFAULT 0, kauf REAL NOT NULL DEFAULT 0,
    kaufMax REAL NOT NULL DEFAULT 0, maxPlus REAL NOT NULL DEFAULT 0,
    aktuell REAL NOT NULL DEFAULT 0, besonderes TEXT NOT NULL DEFAULT '',
    -- Rassenbonus (races_catalog.le/.au/.ae), additiv zum Formelwert — vorbelegt
    -- bei Rassen-Auswahl, danach gesperrt (siehe ResourceInput.raceBase).
    raceBase REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, key)
  );

  -- Spezialenergien: Vorräte neben LE/AUS/AsE. EIGENE Tabelle statt
  -- Zusatzspalten in char_resources, damit die festen Energien unberührt
  -- bleiben. Wie Talente/Sprachen eine Liste (pos). catalog_id verweist auf
  -- special_energies_catalog (NULL = Altbestand von vor dem Katalog, siehe
  -- SpecialResource in shared/src/types.ts); hat der Katalog-Eintrag eine
  -- Formel, ist max hier nur ein ungenutzter Snapshot und bonus fließt additiv
  -- in das live berechnete Maximum ein (analog zu maxPlus bei LE/AUS/AsE).
  CREATE TABLE IF NOT EXISTS char_special_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    catalog_id INTEGER REFERENCES special_energies_catalog(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    max REAL NOT NULL DEFAULT 0,
    bonus REAL NOT NULL DEFAULT 0,
    aktuell REAL NOT NULL DEFAULT 0
  );

  -- Externe Attributspunkte: frei benannte Quellen (Boni, Ausnahmen …), die
  -- zusätzlich zur stufenbasierten Attributspunkte-Vergabe zählen. Wie
  -- Spezialenergien eine eigene Liste (pos), nur Quelle + Punktzahl.
  CREATE TABLE IF NOT EXISTS char_attr_extern (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    quelle TEXT NOT NULL DEFAULT '',
    punkte REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS talents_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kategorie TEXT NOT NULL,
    gruppe TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    probe TEXT NOT NULL DEFAULT '',
    ableiten TEXT NOT NULL DEFAULT '',
    skill100 TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_talents (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    talent_id INTEGER NOT NULL REFERENCES talents_catalog(id) ON DELETE CASCADE,
    taw REAL NOT NULL DEFAULT 0,
    at REAL NOT NULL DEFAULT 0, pa REAL NOT NULL DEFAULT 0, bl REAL NOT NULL DEFAULT 0,
    billiger TEXT NOT NULL DEFAULT '', spezialisierung TEXT NOT NULL DEFAULT '',
    waffenmeister TEXT NOT NULL DEFAULT '', berufsbonus TEXT NOT NULL DEFAULT '',
    notiz TEXT NOT NULL DEFAULT '',
    favorit INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, talent_id)
  );

  CREATE TABLE IF NOT EXISTS languages_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    familie TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    komplexitaet TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_languages (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    language_id INTEGER NOT NULL REFERENCES languages_catalog(id) ON DELETE CASCADE,
    taw REAL NOT NULL DEFAULT 0,
    muttersprache INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, language_id)
  );

  -- Merkmale-Katalog (GM-Tags, z.B. "Hat Gefahreninstinkt"): frei vom
  -- Spielleiter gepflegt (wie Talente/Sprachen), auf der GM-Übersicht je
  -- Charakter zugewiesen. Zuweisung ist bewusst NICHT Teil der normalen
  -- section-save-Rechte (Besitzer hat dort 'edit') — eigene requireGm-Routen.
  CREATE TABLE IF NOT EXISTS tags_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_tags (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags_catalog(id) ON DELETE CASCADE,
    PRIMARY KEY (character_id, tag_id)
  );

  -- Rassen-Katalog (Rassenbrief + Psyche/Resilienz-Dokument): anders als
  -- Talente/Sprachen/Merkmale hat ein Charakter höchstens EINE Rasse — kein
  -- char_races-Zuordnungstabelle nötig, char_bio.rasseId zeigt direkt auf
  -- einen Eintrag hier (siehe unten). Boni (le/au/ae/mr/ak) sind additive
  -- Modifikatoren, NULL wenn die Quelle keine Werte-Tabelle hatte. gs ist
  -- dagegen ein absoluter Basiswert (kein Bonus) — entspricht baseValues.gsBase
  -- auf dem Bogen. psyche/resilienz sind Rassengrundwerte, die additiv in die
  -- Formel einfließen (Meta.psycheBase bzw. BaseValueInputs.resilienzBase) —
  -- beide werden bei Rassen-Auswahl übernommen und danach gesperrt.
  CREATE TABLE IF NOT EXISTS races_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gruppe TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    beschreibung TEXT NOT NULL DEFAULT '',
    spezialisierung TEXT NOT NULL DEFAULT '',
    talente TEXT NOT NULL DEFAULT '',
    le REAL, au REAL, ae REAL, mr REAL, ak REAL, gs REAL, psyche REAL, resilienz REAL,
    notiz TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );

  -- Spezialenergien-Katalog (GM-Liste aus dem "20+ Bäume"-Umfeld, s.
  -- server/data/specialEnergies.json): ersetzt das freie Eintippen im
  -- Energien-Panel durch eine Auswahl aus vorgegebenen Namen. formula ist
  -- eine kleine Arithmetik-Formel über Attributen/Pool-Maxima (leer = rein
  -- manueller Eintrag, Spieler pflegt max/aktuell wie bisher selbst), siehe
  -- evaluateEnergyFormula in shared/src/rules.ts. regeneration/umrechnung
  -- sind reiner Freitext wie beschreibung (keine App-Berechnung) — wie
  -- regeneriert sich die Energie, und wie rechnet sie in LE/AUS/AsE um
  -- (z. B. "1 Punkt Drachenenergie = 5 AsE").
  CREATE TABLE IF NOT EXISTS special_energies_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    formula TEXT NOT NULL DEFAULT '',
    beschreibung TEXT NOT NULL DEFAULT '',
    regeneration TEXT NOT NULL DEFAULT '',
    umrechnung TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );

  -- Währungs-Katalog (GM-editierbar wie Talente/Sprachen/Rassen): ein System
  -- hat mehrere Münzsorten mit eigenem Umrechnungsfaktor zur kleinsten Einheit
  -- des Systems — nicht zwingend dezimal (z. B. Aventurisch: K/H/S/D bei je
  -- ×10, dazu eine Garethische Dublone bei ×500), daher Katalog-Zeilen statt
  -- fester Spalten wie früher (char_meta.geldD/S/H/K).
  CREATE TABLE IF NOT EXISTS currency_systems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notiz TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS currency_denominations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id INTEGER NOT NULL REFERENCES currency_systems(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    faktor REAL NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  -- Geldbeutel je Besitzer: ein oder mehrere benannte Behälter (Gürtelbeutel,
  -- Bank, …), jeder an EIN Währungssystem gebunden. kapazitaet zählt in Münzen
  -- (Stück, jede Sorte gleich gewichtet) — 0 = unbegrenzt, gleiche Konvention
  -- wie char_items.kapazitaet. Bewusst NICHT Teil des allgemeinen Behälter-
  -- Systems (char_items/ist_behaelter): die Kapazität wird direkt im Geld-
  -- Bereich gepflegt, nicht über die Ausrüstung (Spieler-Entscheidung 2026-08-16).
  -- Gruppenkasse (2026-09-02): owner_type/owner_id statt eines harten
  -- character_id-FKs, dasselbe Paar wie char_items — ein Beutel gehört einem
  -- Charakter ODER einer Gruppe. Genau eine 'group'-Zeile je Gruppe, analog
  -- zur Bank (getOrCreateGroupPouch in characterData.ts erzeugt sie bei Bedarf),
  -- kein GM-Vorrat (bislang kein Bedarf, siehe docs/concepts/shared-inventories.md
  -- für die entsprechende Item-Diskussion, falls das mal nachgezogen wird).
  CREATE TABLE IF NOT EXISTS char_pouches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_type TEXT NOT NULL DEFAULT 'character',
    owner_id INTEGER NOT NULL DEFAULT 0,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    system_id INTEGER REFERENCES currency_systems(id) ON DELETE SET NULL,
    kapazitaet REAL NOT NULL DEFAULT 0,
    is_bank INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_pouch_coins (
    pouch_id INTEGER NOT NULL REFERENCES char_pouches(id) ON DELETE CASCADE,
    denomination_id INTEGER NOT NULL REFERENCES currency_denominations(id) ON DELETE CASCADE,
    anzahl REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (pouch_id, denomination_id)
  );

  -- Freitext-GM-Notiz je Charakter: bewusst eigene Tabelle statt char_bio
  -- (dort hat der Besitzer 'edit'-Zugriff) — nur der Spielleiter sieht/ändert
  -- das, unabhängig von der Sichtbarkeits-/Bearbeitungsrechten des Heldenbriefs.
  CREATE TABLE IF NOT EXISTS char_gm_notes (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    notiz TEXT NOT NULL DEFAULT ''
  );

  ${listTables}

  CREATE TABLE IF NOT EXISTS char_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    tab_id INTEGER REFERENCES char_tabs(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'table',
    columns TEXT NOT NULL DEFAULT '[]',
    visible INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS char_section_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES char_sections(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}'
  );

  -- Gemeinsame Inhalte einer Gruppe (Inventar, Questlog, NPCs …).
  -- Bewusst eigene Tabellen statt einer Besitzer-Spalte in den char_*-Tabellen:
  -- gleiche Struktur, aber ohne Eingriff in die bestehenden Charakterdaten.
  CREATE TABLE IF NOT EXISTS group_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS group_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    tab_id INTEGER REFERENCES group_tabs(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'table',
    columns TEXT NOT NULL DEFAULT '[]',
    visible INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS group_section_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES group_sections(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}'
  );

  -- One feed per group: chat messages and dice rolls interleaved in
  -- chronological order, instead of two tables + UNION — visibility and
  -- ordering must be identical for both row kinds. Grows unbounded (no
  -- retention window), hence the secondary index.
  CREATE TABLE IF NOT EXISTS group_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    kind TEXT NOT NULL,                        -- 'message' | 'roll'
    visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'hidden' | 'gm_player'
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_char_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    gm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL DEFAULT '',       -- display name frozen at post time
    is_me INTEGER NOT NULL DEFAULT 0,           -- kind='message'
    text TEXT NOT NULL DEFAULT '',              -- kind='message'
    roll_json TEXT                              -- kind='roll', see shared/src/diceProtocol.ts
  );
  CREATE INDEX IF NOT EXISTS idx_group_feed_group_id ON group_feed(group_id, id);

  CREATE TABLE IF NOT EXISTS char_portraits (
    character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    mime TEXT NOT NULL DEFAULT 'image/jpeg',
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Einheitliches Gegenstands-Modell (Cluster 5): jeder Besitz ist EINE Zeile
  -- mit Gewicht (kg je Stück), Kategorie und Ort. Inventar, Kategorie-Summen,
  -- getragene Last und (5b) getragene Ausrüstung leiten sich hieraus ab.
  -- Shared inventories (docs/concepts/shared-inventories.md): ein Item gehört
  -- einem OWNER, nicht direkt einem Charakter — owner_type/owner_id statt
  -- eines harten character_id-FKs, genau das Paar, das assets/store.ts schon
  -- für Bilder benutzt. 'character'/'group'/'gm'; KEINE eigene FK mehr (SQLite
  -- kennt keine tabellenübergreifende CASCADE über owner_type hinweg — das
  -- manuelle Löschen beim Charakter-/Gruppen-Löschen übernimmt loescheItemsFuer,
  -- genau wie loescheAssetsFuer es für den Bild-Store schon tut). Der Name
  -- char_items bleibt trotzdem (eine milde Lüge jetzt) — umbenennen würde jeden
  -- SQL-String und beide Kind-FKs anfassen, ohne Verhaltensgewinn.
  CREATE TABLE IF NOT EXISTS char_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_type TEXT NOT NULL DEFAULT 'character',
    owner_id INTEGER NOT NULL DEFAULT 0,
    pos INTEGER NOT NULL DEFAULT 0,
    uid TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    anzahl REAL NOT NULL DEFAULT 1,
    gewicht REAL NOT NULL DEFAULT 0,
    kategorie TEXT NOT NULL DEFAULT '',
    -- Houses (docs/concepts/houses.md): freiwillige Orts-Angabe, nur bei
    -- gruppen-eigenen Items sinnvoll — freier String mit eigener
    -- Vorschlagsliste (group_houses/group_rooms), kein Fremdschlüssel, genau
    -- wie kategorie. raum ist innerhalb von haus verschachtelt.
    haus TEXT NOT NULL DEFAULT '',
    raum TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT 'inventar',
    -- 5b: Körperzone (bei location='getragen'), Behälter-Zugehörigkeit
    -- (container_uid → uid des Behälters, bei location='behaelter'), Behälter-
    -- Eigenschaft samt Art (quick/storage), Kapazität und Gewichtsreduktion in %,
    -- sowie Rüstungsschutz (manuell, höchster getragener zählt).
    zone TEXT NOT NULL DEFAULT '',
    -- beidseitig: getragen zugleich auf der Gegenseite (Arm/Hand/Bein) — ein
    -- Datensatz, in beiden Zellen angezeigt (Gewicht/RS zählen einmal).
    beidseitig INTEGER NOT NULL DEFAULT 0,
    container_uid TEXT NOT NULL DEFAULT '',
    ist_behaelter INTEGER NOT NULL DEFAULT 0,
    container_art TEXT NOT NULL DEFAULT 'storage',
    kapazitaet REAL NOT NULL DEFAULT 0,
    kapazitaet_art TEXT NOT NULL DEFAULT 'gewicht',
    gewichtsreduktion REAL NOT NULL DEFAULT 0,
    rs REAL NOT NULL DEFAULT 0,
    -- Haltbarkeit wie LP für Gegenstände (0 = nicht verfolgt, siehe haltbarkeitPct
    -- in shared/src/items.ts).
    haltbarkeit_max REAL NOT NULL DEFAULT 0,
    haltbarkeit_aktuell REAL NOT NULL DEFAULT 0,
    notiz TEXT NOT NULL DEFAULT '',
    -- Hidden/revealable Ausrüstung stats (TODO.md): rs/haltbarkeit bleiben als
    -- Felder sichtbar, zeigen aber „???" statt der Zahl, solange verborgen.
    -- Default 0 (sichtbar) hält bestehende Zeilen unverändert.
    rs_verborgen INTEGER NOT NULL DEFAULT 0,
    haltbarkeit_verborgen INTEGER NOT NULL DEFAULT 0,
    -- Weapons as real items (TODO.md): '' = kein Waffe, sonst 'nah'/'fern'.
    -- Routet die Karte in den Waffen-Reiter/den richtigen Feldsatz; die
    -- tatsächlichen Waffenwerte liegen in char_item_weapon_stats.
    waffen_art TEXT NOT NULL DEFAULT ''
  );
  -- Der Index auf (owner_type, owner_id, pos) steht NICHT hier, sondern erst
  -- nach der owner_type-Migration weiter unten: auf einer bestehenden DB mit
  -- der alten character_id-Spalte gäbe es owner_type zu diesem Zeitpunkt
  -- (CREATE TABLE IF NOT EXISTS ist für sie ein No-op) noch gar nicht — CREATE
  -- INDEX schlüge mit "no such column" fehl, bevor die Migration überhaupt lief.
  -- Waffen-Stat-Zeilen (Weapons as real items, TODO.md) — eigene Kind-Tabelle
  -- wie char_item_bonuses, ein Item hat 0..N Zeilen (eine je Waffen-Feld,
  -- siehe waffenFelderFuerArt in shared/src/items.ts). Anders als ein
  -- verdeckter ItemBonus (Zeile komplett unsichtbar) bleibt eine verdeckte
  -- Waffen-Stat-Zeile als Zeile sichtbar — nur ihr Wert wird beim Ausliefern
  -- an einen Nicht-SL geleert (siehe ohneVerborgeneItems) —, damit der Reiter
  -- „???" zeigen kann, statt so zu tun, als gäbe es das Feld gar nicht.
  CREATE TABLE IF NOT EXISTS char_item_weapon_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES char_items(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    uid TEXT NOT NULL DEFAULT '',
    feld TEXT NOT NULL DEFAULT '',
    wert TEXT NOT NULL DEFAULT '',
    verborgen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_item_weapon_stats_item ON char_item_weapon_stats(item_id);
  -- Boni, die ein Gegenstand verleiht, solange er getragen wird (siehe ItemBonus
  -- in shared/src/items.ts) — eigene Kind-Tabelle wie char_pouch_coins zu
  -- char_pouches, NICHT JSON-in-TEXT wie char_abilities.kategorien. Referenziert
  -- char_items.id (die DB-Zeilen-id, NICHT die client-vergebene uid).
  -- uid (wie bei char_items) macht eine Zeile über applyItemOps() einzeln
  -- ansprechbar (addBonus/patchBonus/removeBonus) statt die ganze Liste eines
  -- Items ersetzen zu müssen — genau die Kennung, deren Fehlen den Bug hinter
  -- "Hidden/revealable Ausrüstung stats" (TODO.md) erst möglich gemacht hat.
  CREATE TABLE IF NOT EXISTS char_item_bonuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES char_items(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    uid TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'attr',
    code TEXT NOT NULL DEFAULT '',
    feld TEXT NOT NULL DEFAULT '',
    wert REAL NOT NULL DEFAULT 0,
    -- Hidden/revealable Ausrüstung stats (TODO.md): eine verdeckte Zeile ist
    -- für einen Nicht-SL komplett unsichtbar (siehe ohneVerborgeneItems).
    verborgen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_item_bonuses_item ON char_item_bonuses(item_id);
  -- Selbst verwaltete Kategorienliste je Owner (Reihenfolge über pos) — dieselbe
  -- owner_type/owner_id-Verallgemeinerung wie char_items, siehe dort. Ein
  -- Charakter behält seine eigene Liste unverändert; Gruppenpool und GM-Pool
  -- bekommen je ihre eigene (docs/concepts/shared-inventories.md, Abschnitt 2.6).
  CREATE TABLE IF NOT EXISTS char_item_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_type TEXT NOT NULL DEFAULT 'character',
    owner_id INTEGER NOT NULL DEFAULT 0,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT ''
  );
  -- Index folgt nach der Migration weiter unten, aus demselben Grund wie bei
  -- char_items oben.

  -- Houses (docs/concepts/houses.md): kuratierte Vorschlags-/Umbenennen-Listen
  -- für char_items.haus/raum — dieselbe Rolle wie char_item_categories für
  -- kategorie, KEIN Fremdschlüssel (char_items.haus/raum bleiben freie Strings,
  -- shared-inventories.md §3.1 zeigt, dass das gefahrlos ist). Direkte, echte
  -- group_id-FK statt des generischen owner_type/owner_id-Paars — ein Haus
  -- gehört strukturell IMMER einer Gruppe, nie einem Charakter oder dem SL, es
  -- gibt also keine Owner-Art-Mehrdeutigkeit zu verallgemeinern, und eine echte
  -- ON DELETE CASCADE erspart das manuelle Aufräumen, das char_items für sein
  -- generisches Paar in Kauf nehmen musste.
  CREATE TABLE IF NOT EXISTS group_houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_group_houses_group ON group_houses (group_id, pos);
  -- Räume liegen eine Ebene tiefer, verschachtelt über den Haus-NAMEN (haus),
  -- nicht über eine group_houses.id — Räume sind wie Kategorien reine
  -- Zeichenketten, siehe oben.
  CREATE TABLE IF NOT EXISTS group_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    haus TEXT NOT NULL DEFAULT '',
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_group_rooms_group_haus ON group_rooms (group_id, haus, pos);

  -- Item movement log (TODO.md, 2026-09-03): GM-only audit trail of every
  -- cross-owner move touching a group pool (either direction). Kept forever
  -- for now (no retention policy yet, see pruneItemMoveLogBefore in
  -- characterData.ts) — deliberately NOT a group_id FK, so deleting a group
  -- later can never cascade away its own history. item_name/anzahl are a
  -- denormalized SNAPSHOT at move time (like char_items itself has no live
  -- reference back to a deleted/renamed item), same for from_label/to_label
  -- (a resolved character/group name at move time, not an id — a later
  -- rename or delete must not turn old log rows into dangling references).
  CREATE TABLE IF NOT EXISTS item_move_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    item_name TEXT NOT NULL DEFAULT '',
    anzahl REAL NOT NULL DEFAULT 0,
    from_label TEXT NOT NULL DEFAULT '',
    to_label TEXT NOT NULL DEFAULT '',
    acting_user TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_item_move_log_group ON item_move_log (group_id, ts DESC);

  -- Einheitliches Zauber-/Fähigkeiten-Modell (Cluster 6): eine Quelle der
  -- Wahrheit je Charakter, aus der die Reiter „Zauber" (magisch=1) und
  -- „Fähigkeiten" (magisch=0) nur noch anzeigen. magierstufe liegt in
  -- char_meta; Magiepunkte/Voraussetzungen sind rein abgeleitet.
  CREATE TABLE IF NOT EXISTS char_abilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0,
    uid TEXT NOT NULL DEFAULT '',
    magisch INTEGER NOT NULL DEFAULT 1,
    passiv INTEGER NOT NULL DEFAULT 0,
    signatur INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    element TEXT NOT NULL DEFAULT '',
    kategorien TEXT NOT NULL DEFAULT '[]',
    stufe REAL NOT NULL DEFAULT 0,
    komplexitaet REAL NOT NULL DEFAULT 0,
    kosten TEXT NOT NULL DEFAULT '',
    probe TEXT NOT NULL DEFAULT '',
    effekt TEXT NOT NULL DEFAULT '',
    fortschritt REAL NOT NULL DEFAULT 0,
    notiz TEXT NOT NULL DEFAULT '',
    favorit INTEGER NOT NULL DEFAULT 0
  );
  -- Selbst verwaltete Element- und Kategorie-Listen je Charakter (kind trennt
  -- die beiden Achsen, nach denen die Reiter gruppieren können).
  CREATE TABLE IF NOT EXISTS char_ability_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'kategorie',
    pos INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT ''
  );

  -- Kleiner Schlüssel/Wert-Speicher für App-weite Merker (kein Charakterbezug).
  -- Aktuell: Wasserstand des Changelog→Discord-Spiegels (server/discord.ts).
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  -- Virtueller Tisch (siehe docs/concepts/virtual-table.md). Ein Brett pro
  -- Raum — group_id reicht, ohne room_kind: eine Event-Gruppe ist seit
  -- be5a995 eine ganz normale Zeile in groups, im selben Id-Raum, also deckt
  -- ein einziges ON DELETE CASCADE beide Gruppenarten sauber ab.
  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    cols INTEGER NOT NULL DEFAULT 40,
    rows INTEGER NOT NULL DEFAULT 30,
    tiles_json TEXT NOT NULL DEFAULT '{}', -- sparse bemalte Felder, siehe parseTileValue (shared/src/board.ts)
    -- Sparse Einfärbung ÜBER den Feldern, gleiches #rrggbb(aa)-Format wie
    -- tiles_json, aber eine eigene Ebene: die Kachel darunter bleibt unverändert
    -- gespeichert, auch bei 100 % Deckkraft. Wie fog_json GM-only, keine
    -- perm_*-Spalte — kein Spieler-Rechte-Fall, siehe canHighlightTiles.
    highlights_json TEXT NOT NULL DEFAULT '{}',
    fog_json TEXT NOT NULL DEFAULT '[]',   -- sparse VERBORGENE Felder (leer = nichts verborgen)
    seed INTEGER NOT NULL DEFAULT 0,       -- Wiedergabe-Saat: Texturvariation + Kantenrauschen
    -- GM-einstellbare Nutzungsrechte, 'gm' | 'all'. Messen ist immer 'all',
    -- Nebel immer 'gm' — beides bekommt bewusst keine Spalte, das ist keine
    -- Einstellung.
    perm_tiles TEXT NOT NULL DEFAULT 'gm',
    perm_labels TEXT NOT NULL DEFAULT 'gm',
    perm_tokens TEXT NOT NULL DEFAULT 'gm',
    perm_images TEXT NOT NULL DEFAULT 'gm',
    perm_move TEXT NOT NULL DEFAULT 'all',
    round INTEGER NOT NULL DEFAULT 0,
    turn_index INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL DEFAULT 0,        -- monoton; Clients erkennen Lücken und laden neu
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_group_id ON boards(group_id);

  CREATE TABLE IF NOT EXISTS board_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                    -- 'character' | 'marker'
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 1,       -- Felder in der Kante
    -- Reichweiten-Ring um die Marke, in Schritt (0 = kein Ring) — AOE eines
    -- Zaubers, Fackel-/Sichtweite. Bewegt sich mit der Marke, keine eigene
    -- Position.
    radius REAL NOT NULL DEFAULT 0,
    -- Farbe+Deckkraft des Rings, #rrggbb(aa) wie tiles_json/highlights_json —
    -- unabhängig von der Spalte "color" (die Marke selbst), damit ein
    -- greller Marken-Ton nicht automatisch auch der Ring-Ton sein muss.
    radius_color TEXT NOT NULL DEFAULT '#ffcc0033',
    -- Blickrichtung in Grad, rein kosmetisch (dreht nur Kreis+Icon, nicht
    -- Reichweiten-Ring/Status/Cover) — siehe BoardToken.rotation.
    rotation REAL NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,     -- nur für die Spielleitung sichtbar
    statuses TEXT NOT NULL DEFAULT '[]',   -- Eck-Marken: Array von Status-Schlüsseln
    cover TEXT NOT NULL DEFAULT '',        -- Ganzfeld-Überlagerung, immer nur eine ('' = keine)
    cover_asset TEXT,                      -- reserviert: hochgeladene Overlay-Grafik, in v1 immer NULL
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_board_tokens_board_id ON board_tokens(board_id);

  CREATE TABLE IF NOT EXISTS board_overlays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                    -- 'label' | 'measure'
    data_json TEXT NOT NULL DEFAULT '{}',  -- Text/Anker, oder Form+Ursprung+Radius
    hidden INTEGER NOT NULL DEFAULT 0,
    -- Wer's angelegt hat — NULL für jede vor dieser Spalte entstandene Zeile
    -- (unbekannt, zählt für niemandes Kappung mit) und für 'label' immer NULL
    -- (nur 'measure' zählt gegen das Limit, siehe "Limit active measure shapes
    -- per player" in TODO.md). Gleiches Muster wie board_tokens.owner_user_id.
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_board_overlays_board_id ON board_overlays(board_id);

  -- Bilder auf dem Tisch: Objekt (interaktiv) oder Hintergrund (gesperrt,
  -- unter den Feldern). Behält immer seine eigene Fläche — nie über das
  -- ganze Brett gestreckt. Liegt in helden-assets.db; siehe loescheAssetsFuer
  -- in jedem Löschpfad, der eine Bild-Zeile mitreißt (Bild, Brett, Raum).
  CREATE TABLE IF NOT EXISTS board_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    asset_slug TEXT NOT NULL,
    modus TEXT NOT NULL DEFAULT 'objekt',  -- 'objekt' | 'hintergrund' (= gesperrt, nicht interaktiv)
    x REAL NOT NULL DEFAULT 0,             -- Brettkoordinaten in FELDERN, obere linke Ecke
    y REAL NOT NULL DEFAULT 0,
    w REAL NOT NULL DEFAULT 1,
    h REAL NOT NULL DEFAULT 1,
    rotation REAL NOT NULL DEFAULT 0,      -- Grad
    opacity REAL NOT NULL DEFAULT 1,
    z INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0      -- nur Spielleitung: Spielern ganz vorenthalten
  );
  CREATE INDEX IF NOT EXISTS idx_board_images_board_id ON board_images(board_id);

  -- Zeiger-Design (siehe boardProtocol.ts): die ganze Kampfliste würfelt
  -- zusammen — ini_basis + ein FRISCHER 1W6, nie kumulativ — beim Kampfstart
  -- und jedes Mal, wenn der Zug-Zeiger über den letzten Kämpfenden hinausläuft.
  -- ini_basis ist von der SL eingetragen (Marke ohne Bogen); für eine
  -- Charakter-Marke wird sie ignoriert und live aus dem Bogen gelesen.
  -- active_this_round ist 0 nur vor dem ALLERERSTEN Wurf (Zugang vor
  -- Kampfbeginn) — ein Zugang MITTEN im Kampf ist sofort aktiv (GM-Regel:
  -- normal = zuletzt dran, Überraschung = sofort/unterbricht, siehe
  -- round_order). round_order bestimmt die Zugreihenfolge dieser Runde —
  -- NICHT mehr live aus value sortiert, weil ein Überraschungsangriff genau
  -- an der aktuellen Zeigerposition einschieben muss, kein wertvergleichbarer
  -- Rang ist. rolled_this_round ist 0 für einen frischen Zugang (Normal oder
  -- Überraschung) — die Oberfläche zeigt „—" statt value, wie schon vor
  -- Kampfbeginn. Beide werden bei jedem Massenwurf für ALLE zurückgesetzt.
  CREATE TABLE IF NOT EXISTS board_initiative (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    token_id INTEGER NOT NULL REFERENCES board_tokens(id) ON DELETE CASCADE,
    ini_basis INTEGER NOT NULL DEFAULT 0,
    value INTEGER NOT NULL DEFAULT 0,
    active_this_round INTEGER NOT NULL DEFAULT 0,
    round_order INTEGER NOT NULL DEFAULT 0,
    rolled_this_round INTEGER NOT NULL DEFAULT 0,
    death_countdown INTEGER                -- NULL = stirbt nicht; sonst verbleibende Runden
  );
  CREATE INDEX IF NOT EXISTS idx_board_initiative_board_id ON board_initiative(board_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_board_initiative_token ON board_initiative(token_id);

  -- Personal round-duration countdowns (TODO.md "Round tracker for spell
  -- duration"), separate from the ordered board_initiative roster above.
  -- Fully private — never sent to any viewer but creator_user_id itself, GM
  -- included — so there is no owner-bypass/redaction logic anywhere for this
  -- table, unlike every other board_* row. Decrements by 1 (floored at 0, no
  -- auto-removal) at the same round-wrap point that rerolls initiative, see
  -- stepTurn in server/src/board.ts. current_count can also be bumped freely
  -- by its owner at any time (e.g. recasting a spell recharges its duration).
  CREATE TABLE IF NOT EXISTS board_round_trackers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    current_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_board_round_trackers_board_id ON board_round_trackers(board_id);
`);

// Migration: 'magierstufe'-Spalte an bestehende char_meta ergänzen (Cluster 6a).
// 0 = kein Magier, 1–5 = Rang. Einziger vom Menschen gepflegter Magier-Wert.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_meta)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('magierstufe')) db.exec('ALTER TABLE char_meta ADD COLUMN magierstufe REAL NOT NULL DEFAULT 0');
  // Additiver Zusatz auf die berechnete maximale Traglast (kg); kann negativ sein.
  if (!cols.has('traglastBonus')) db.exec('ALTER TABLE char_meta ADD COLUMN traglastBonus REAL NOT NULL DEFAULT 0');
  // Psyche wandert aus "Stufe & Punkte" in die Energien-Tabelle: Rassengrundwert
  // + Bonus, das Maximum wird daraus + MU-Anteil berechnet (psycheMax()). Start
  // bei 0 — psycheMax ist kein zuverlässiger Rückrechnungswert, die Spieler
  // tragen ihren Rassengrundwert selbst ein.
  if (!cols.has('psycheBase')) db.exec('ALTER TABLE char_meta ADD COLUMN psycheBase REAL NOT NULL DEFAULT 0');
  if (!cols.has('psycheBonus')) db.exec('ALTER TABLE char_meta ADD COLUMN psycheBonus REAL NOT NULL DEFAULT 0');
  // Schicksalspunkte: erlauben eine komplette Probe neu zu würfeln, wenn die
  // Spielleitung zustimmt — reines Zählen, kein eigener Wurf-Mechanismus.
  // Default 1 ist die aktuell gültige Hausregel (früher 3/Spieltag); Max bleibt
  // pro Charakter änderbar für Ausnahmen (z. B. Vorteile, die mehr gewähren).
  if (!cols.has('schicksalspunkteMax')) db.exec('ALTER TABLE char_meta ADD COLUMN schicksalspunkteMax REAL NOT NULL DEFAULT 1');
  if (!cols.has('schicksalspunkteAktuell')) db.exec('ALTER TABLE char_meta ADD COLUMN schicksalspunkteAktuell REAL NOT NULL DEFAULT 1');
  // Additiver Bonus (m) auf die Zauber-Reichweite aus SPELL_REICHWEITE_REFERENZ
  // (shared/src/abilities.ts) — reine Anzeige im Zauber-Tab, keine Formel liest ihn.
  if (!cols.has('reichweiteBonus')) db.exec('ALTER TABLE char_meta ADD COLUMN reichweiteBonus REAL NOT NULL DEFAULT 0');
  // Trainings-/Lesesitzungen: ein gemeinsamer Zähler (nicht zwei getrennte),
  // rein manuell vom Spieler gepflegt — der eigentliche Lernfortschritt bleibt
  // außerhalb der App. Läuft am selben Reset wie Schicksalspunkte mit (siehe
  // routes.ts), deshalb kein eigenes Max-Feld — die Obergrenze (4) ist fix.
  if (!cols.has('trainingLeseHeute')) db.exec('ALTER TABLE char_meta ADD COLUMN trainingLeseHeute REAL NOT NULL DEFAULT 0');
  // Migration: 'small_wounds'/'big_wounds' an bestehende char_meta ergänzen
  // (VTT-Wundverfolgung, siehe Spaltenkommentar an der Tabelle oben). 0 ist
  // für jeden bereits bestehenden Charakter der richtige Rückfall — niemand
  // hatte vor dieser Spalte je eine eingetragene Wunde.
  if (!cols.has('small_wounds')) db.exec('ALTER TABLE char_meta ADD COLUMN small_wounds INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('big_wounds')) db.exec('ALTER TABLE char_meta ADD COLUMN big_wounds INTEGER NOT NULL DEFAULT 0');
}

// Migration (Cluster 6): 'gruppe' und 'kategorie' waren dieselbe Achse doppelt.
// Zusammengeführt zu 'kategorie'; die Spalte 'gruppe' entfällt. Bestehende
// Werte, sofern kategorie leer ist, nach kategorie retten, dann Spalte löschen.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_abilities)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('gruppe')) {
    db.exec("UPDATE char_abilities SET kategorie = gruppe WHERE (kategorie IS NULL OR kategorie = '') AND gruppe <> ''");
    db.exec('ALTER TABLE char_abilities DROP COLUMN gruppe');
  }
  if (!cols.has('signatur')) db.exec('ALTER TABLE char_abilities ADD COLUMN signatur INTEGER NOT NULL DEFAULT 0');
}

// Migration: 'kategorie' (ein Wert) → 'kategorien' (JSON-Array), damit ein
// Zauber/eine Fähigkeit in mehreren Kategorien zugleich stehen kann. Bestehende
// Werte wandern 1:1 in ein Ein-Element-Array, Leerwerte in ein leeres Array —
// nichts geht verloren. Muss VOR der Vorschlagslisten-Nachfüllung unten laufen,
// die schon das neue Spaltenformat erwartet.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_abilities)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('kategorie') && !cols.has('kategorien')) {
    db.exec('ALTER TABLE char_abilities RENAME COLUMN kategorie TO kategorien');
    const rows = db.prepare('SELECT id, kategorien FROM char_abilities').all() as { id: number; kategorien: string }[];
    const up = db.prepare('UPDATE char_abilities SET kategorien = ? WHERE id = ?');
    const migrate = db.transaction(() => {
      for (const r of rows) up.run(JSON.stringify(r.kategorien ? [r.kategorien] : []), r.id);
    });
    migrate();
  }
}

// Migration (Cluster 6): Element-/Kategorie-Vorschlagsliste aus den tatsächlich
// vergebenen Werten nachfüllen, wo sie noch leer ist. Früh geseedete Charaktere
// (und alle vor dem Kategorie-Seed) haben Werte an den Einträgen, aber keine
// Vorschlagsliste — die Werkstatt-Dropdowns blieben dadurch leer. Nur befüllen,
// wenn die Liste der jeweiligen Art leer ist (kuratierte Listen bleiben unberührt).
{
  const chars = db.prepare('SELECT DISTINCT character_id FROM char_abilities').all() as { character_id: number }[];
  const listCount = db.prepare('SELECT COUNT(*) AS n FROM char_ability_lists WHERE character_id = ? AND kind = ?');
  const rowsFor = db.prepare('SELECT element, kategorien FROM char_abilities WHERE character_id = ? ORDER BY pos, id');
  const ins = db.prepare('INSERT INTO char_ability_lists (character_id, kind, pos, name) VALUES (?, ?, ?, ?)');
  const backfill = db.transaction(() => {
    for (const { character_id } of chars) {
      const rows = rowsFor.all(character_id) as { element: string; kategorien: string }[];
      if ((listCount.get(character_id, 'element') as { n: number }).n === 0) {
        const seen: string[] = [];
        for (const r of rows) if (r.element && !seen.includes(r.element)) seen.push(r.element);
        seen.forEach((v, i) => ins.run(character_id, 'element', i, v));
      }
      if ((listCount.get(character_id, 'kategorie') as { n: number }).n === 0) {
        const seen: string[] = [];
        for (const r of rows) {
          let cats: string[] = [];
          try {
            const v = JSON.parse(r.kategorien || '[]');
            if (Array.isArray(v)) cats = v.map((s) => String(s));
          } catch {
            /* alter Einzelwert vor der Migration oben — kommt hier nicht mehr vor */
          }
          for (const c of cats) if (c && !seen.includes(c)) seen.push(c);
        }
        seen.forEach((v, i) => ins.run(character_id, 'kategorie', i, v));
      }
    }
  });
  backfill();
}

// Migration: 'theme'-Spalte an bestehende characters ergänzen (per-Charakter-Farbwelt)
{
  const cols = new Set((db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('theme')) db.exec("ALTER TABLE characters ADD COLUMN theme TEXT NOT NULL DEFAULT ''");
}

// Migration: add 'dice_shortcuts' column to existing characters (per-character
// dice favorites, "Label: expression" per line — see shared/src/dice.ts
// parseDiceShortcuts).
{
  const cols = new Set((db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('dice_shortcuts')) db.exec("ALTER TABLE characters ADD COLUMN dice_shortcuts TEXT NOT NULL DEFAULT ''");
}

// Migration: add 'chat_name' column to existing characters — a short optional
// override for the name shown in the group feed (chat/rolls), so a character
// with a long full name doesn't flood the chat with it. '' = use the full name.
{
  const cols = new Set((db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('chat_name')) db.exec("ALTER TABLE characters ADD COLUMN chat_name TEXT NOT NULL DEFAULT ''");
}

// Migration: add 'dice_shortcuts' column to users — account-level dice
// favorites (same "Label: expression" format as characters.dice_shortcuts,
// see shared/src/dice.ts parseDiceShortcuts), usable across all chat rooms.
// Mainly for the GM, who has no character of their own to hang per-character
// shortcuts off of, but not role-restricted at the storage layer.
{
  const cols = new Set((db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('dice_shortcuts')) db.exec("ALTER TABLE users ADD COLUMN dice_shortcuts TEXT NOT NULL DEFAULT ''");
}

// Migration: Selbst-Anlage von Charakteren mit ausstehender Gruppen-Freigabe.
// Zwei Teile: (a) group_id von NOT NULL auf NULLBAR lockern (ein gruppenloser
// Charakter braucht keine Gruppe), (b) requested_group_id/requested_at ergänzen.
// SQLite kann NOT NULL nicht in-place lösen → einmaliger Tabellen-Neuaufbau der
// WURZELTABELLE. Alle Zeilen samt id werden kopiert, damit jede char_*-FK gültig
// bleibt (kein Datenverlust). foreign_keys wird dafür kurz abgeschaltet.
{
  const info = db.prepare('PRAGMA table_info(characters)').all() as { name: string; notnull: number }[];
  const groupCol = info.find((c) => c.name === 'group_id');
  const cols = new Set(info.map((c) => c.name));
  const needsNullable = !!groupCol && groupCol.notnull === 1;
  if (needsNullable) {
    // Ganzer Neuaufbau: neue Spalten sind dabei automatisch enthalten.
    db.pragma('foreign_keys = OFF');
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE characters_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          owner_user_id INTEGER NOT NULL REFERENCES users(id),
          group_id INTEGER REFERENCES groups(id),
          requested_group_id INTEGER REFERENCES groups(id),
          requested_at INTEGER,
          theme TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO characters_new (id, name, owner_user_id, group_id, requested_group_id, requested_at, theme)
          SELECT id, name, owner_user_id, group_id, NULL, NULL, theme FROM characters;
        DROP TABLE characters;
        ALTER TABLE characters_new RENAME TO characters;
      `);
    });
    rebuild();
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    db.pragma('foreign_keys = ON');
    if (violations.length) {
      throw new Error(`characters-Neuaufbau ließ FK-Verletzungen zurück: ${JSON.stringify(violations)}`);
    }
    console.log('Migration: characters.group_id ist nun nullbar (Selbst-Anlage mit Gruppen-Freigabe)');
  } else {
    // group_id schon nullbar (oder frische DB) — nur fehlende Spalten ergänzen.
    if (!cols.has('requested_group_id')) db.exec('ALTER TABLE characters ADD COLUMN requested_group_id INTEGER REFERENCES groups(id)');
    if (!cols.has('requested_at')) db.exec('ALTER TABLE characters ADD COLUMN requested_at INTEGER');
  }
}

// Migration: 'is_admin'-Rolle an bestehende users ergänzen. Rollen wurden
// aufgeteilt (Spielleitung = Spiel, Verwaltung = Konten). Bisher trug is_gm
// BEIDES; damit nach dem Update niemand ausgesperrt ist, werden alle bisherigen
// Spielleiter EINMALIG zusätzlich zu Admins gemacht — sie hatten die Konten-
// rechte ja bereits. Wer davon künftig keine Charaktere mehr sehen soll, gibt
// über die neue Oberfläche einfach seine Spielleiter-Rolle ab und behält Admin.
{
  const cols = new Set((db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE users SET is_admin = 1 WHERE is_gm = 1');
  }
}

// Migration: 'sidebarNotiz'-Spalte an bestehende char_bio ergänzen (Notizfeld der Seitenleiste)
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_bio)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('sidebarNotiz')) db.exec("ALTER TABLE char_bio ADD COLUMN sidebarNotiz TEXT NOT NULL DEFAULT ''");
}

// Migration: 'rasseId'-Spalte an bestehende char_bio ergänzen (Rassen-Katalog).
// Die alte Freitext-Spalte 'rasse' bleibt unverändert stehen (kein Datenverlust);
// Spieler wählen künftig aus dem Katalog neu, siehe rasseId in shared/src/types.ts.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_bio)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('rasseId')) db.exec('ALTER TABLE char_bio ADD COLUMN rasseId INTEGER REFERENCES races_catalog(id) ON DELETE SET NULL');
}

// Migration: 'psyche'/'resilienz'-Spalten an bestehende races_catalog ergänzen
// (Rassengrundwerte aus dem separaten Psyche/Resilienz-Dokument, nachträglich
// zur ersten Katalog-Fassung dazugekommen).
{
  const cols = new Set((db.prepare('PRAGMA table_info(races_catalog)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('psyche')) db.exec('ALTER TABLE races_catalog ADD COLUMN psyche REAL');
  if (!cols.has('resilienz')) db.exec('ALTER TABLE races_catalog ADD COLUMN resilienz REAL');
}

// Migration: 'catalog_id'-Spalte an bestehende char_special_resources ergänzen
// (Bindung an den neuen special_energies_catalog). NULL ist hier absichtlich
// der richtige Ausgangszustand für jede vorhandene Zeile — sie ist Altbestand,
// bis eine Namens-Übereinstimmung sie unten (server/src/seed.ts, nach dem
// Katalog-Seed) verknüpft. Kein Datenverlust: name/max/aktuell bleiben unberührt.
{
  const cols = new Set(
    (db.prepare('PRAGMA table_info(char_special_resources)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has('catalog_id')) {
    db.exec('ALTER TABLE char_special_resources ADD COLUMN catalog_id INTEGER REFERENCES special_energies_catalog(id) ON DELETE SET NULL');
  }
  if (!cols.has('bonus')) {
    db.exec('ALTER TABLE char_special_resources ADD COLUMN bonus REAL NOT NULL DEFAULT 0');
  }
}

// Migration: 'regeneration'/'umrechnung'-Spalten an bestehenden
// special_energies_catalog ergänzen (Freitext, s. Kommentar an der Tabelle
// oben). Default '' ist für Altbestand korrekt, keine Nachzieh-Migration nötig.
{
  const cols = new Set(
    (db.prepare('PRAGMA table_info(special_energies_catalog)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has('regeneration')) db.exec("ALTER TABLE special_energies_catalog ADD COLUMN regeneration TEXT NOT NULL DEFAULT ''");
  if (!cols.has('umrechnung')) db.exec("ALTER TABLE special_energies_catalog ADD COLUMN umrechnung TEXT NOT NULL DEFAULT ''");
}

// Migration: 'AT-Deckel' (atMax) aus den Nahkampfwaffen entfernt. Bestehende
// Werte dürfen nicht still verschwinden (höchstrangige Regel) — sie wandern
// sichtbar in die Notiz der Zeile, danach wird atMax genullt, damit die einmalige
// Umschreibung idempotent bleibt. Auf frischen Datenbanken hat sec_waffenNah die
// Spalte gar nicht mehr → nichts zu tun.
{
  const cols = new Set((db.prepare('PRAGMA table_info(sec_waffenNah)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('atMax') && cols.has('notiz')) {
    const rows = db.prepare('SELECT id, atMax, notiz FROM sec_waffenNah WHERE atMax > 0').all() as {
      id: number;
      atMax: number;
      notiz: string;
    }[];
    if (rows.length) {
      const upd = db.prepare('UPDATE sec_waffenNah SET notiz = ?, atMax = 0 WHERE id = ?');
      const tx = db.transaction(() => {
        for (const r of rows) {
          const note = `AT-Deckel: ${r.atMax}`;
          upd.run(r.notiz && r.notiz.trim() ? `${r.notiz} · ${note}` : note, r.id);
        }
      });
      tx();
      console.log(`Migration: ${rows.length} AT-Deckel-Wert(e) in die Waffen-Notiz übernommen`);
    }
  }
}

// Migration: verwaiste Schnellzugriff-Behälter (containerArt 'quick') zurück
// sichtbar machen. AddContainerDialog bot 'quick' bis vor Kurzem auch aus dem
// allgemeinen Inventar-/Gruppenpool-Dialog heraus an, setzte dabei aber nie
// location — die Zeile blieb bei 'inventar' stehen. Ausruestung.tsx zeigt den
// Inhalt eines Schnellzugriff-Behälters aber nur bei location 'getragen' oder
// 'bench', Inventar.tsx/PoolInventory.tsx rendern 'quick'-Behälter überhaupt
// nicht — solche Zeilen waren komplett unerreichbar, zählten aber weiter zur
// Traglast. 'storage' ist der einzige Behälter-Typ, den beide je gerendert
// haben, also der richtige sichtbare Zustand für einen so entstandenen
// Behälter — echte, korrekt getragene Schnellzugriff-Behälter (location
// 'getragen'/'bench') bleiben unangetastet. Idempotent: einmal umgeschrieben,
// greift die WHERE-Bedingung beim nächsten Start nicht mehr.
{
  const verwaist = db
    .prepare("SELECT COUNT(*) AS n FROM char_items WHERE ist_behaelter = 1 AND container_art = 'quick' AND location NOT IN ('getragen', 'bench')")
    .get() as { n: number };
  if (verwaist.n > 0) {
    db.exec(
      "UPDATE char_items SET container_art = 'storage' WHERE ist_behaelter = 1 AND container_art = 'quick' AND location NOT IN ('getragen', 'bench')",
    );
    console.log(`Migration: ${verwaist.n} verwaiste(r) Schnellzugriff-Behälter als Stauraum-Behälter sichtbar gemacht`);
  }
}

// Migration: 'visible'/'tab_id'-Spalten an bestehende char_sections ergänzen
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_sections)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('visible')) db.exec('ALTER TABLE char_sections ADD COLUMN visible INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('tab_id')) db.exec('ALTER TABLE char_sections ADD COLUMN tab_id INTEGER REFERENCES char_tabs(id) ON DELETE CASCADE');
}

// Migration (Cluster 5b): getragene Ausrüstung & Behälter an char_items ergänzen.
// uid gibt jeder bestehenden Zeile eine stabile Kennung (hex(randomblob) je
// Zeile), auf die die Behälter-Zugehörigkeit später verweisen kann.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('uid')) db.exec("ALTER TABLE char_items ADD COLUMN uid TEXT NOT NULL DEFAULT ''");
  if (!cols.has('zone')) db.exec("ALTER TABLE char_items ADD COLUMN zone TEXT NOT NULL DEFAULT ''");
  if (!cols.has('container_uid')) db.exec("ALTER TABLE char_items ADD COLUMN container_uid TEXT NOT NULL DEFAULT ''");
  if (!cols.has('ist_behaelter')) db.exec('ALTER TABLE char_items ADD COLUMN ist_behaelter INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('container_art')) db.exec("ALTER TABLE char_items ADD COLUMN container_art TEXT NOT NULL DEFAULT 'storage'");
  if (!cols.has('kapazitaet')) db.exec('ALTER TABLE char_items ADD COLUMN kapazitaet REAL NOT NULL DEFAULT 0');
  if (!cols.has('kapazitaet_art')) db.exec("ALTER TABLE char_items ADD COLUMN kapazitaet_art TEXT NOT NULL DEFAULT 'gewicht'");
  if (!cols.has('gewichtsreduktion')) db.exec('ALTER TABLE char_items ADD COLUMN gewichtsreduktion REAL NOT NULL DEFAULT 0');
  if (!cols.has('rs')) db.exec('ALTER TABLE char_items ADD COLUMN rs REAL NOT NULL DEFAULT 0');
  if (!cols.has('beidseitig')) db.exec('ALTER TABLE char_items ADD COLUMN beidseitig INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('haltbarkeit_max')) db.exec('ALTER TABLE char_items ADD COLUMN haltbarkeit_max REAL NOT NULL DEFAULT 0');
  if (!cols.has('haltbarkeit_aktuell')) db.exec('ALTER TABLE char_items ADD COLUMN haltbarkeit_aktuell REAL NOT NULL DEFAULT 0');
  // Bestehende Zeilen ohne uid nachträglich befüllen (eine zufällige je Zeile).
  db.exec("UPDATE char_items SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''");
}

// Migration: Hidden/revealable Ausrüstung stats (TODO.md) — verdeckbare
// RS/Haltbarkeit auf char_items, verdeckbare Bonus-Zeilen auf
// char_item_bonuses. Default 0 (sichtbar) hält bestehende Zeilen unverändert.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('rs_verborgen')) db.exec('ALTER TABLE char_items ADD COLUMN rs_verborgen INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('haltbarkeit_verborgen')) db.exec('ALTER TABLE char_items ADD COLUMN haltbarkeit_verborgen INTEGER NOT NULL DEFAULT 0');
}
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_item_bonuses)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('verborgen')) db.exec('ALTER TABLE char_item_bonuses ADD COLUMN verborgen INTEGER NOT NULL DEFAULT 0');
  // uid für gezielte Bonus-Zeilen-Ops (applyItemOps) — siehe Tabellenkommentar
  // oben. Bestehende Zeilen bekommen nachträglich eine zufällige, wie
  // char_items.uid es bei seiner eigenen Einführung schon tat.
  if (!cols.has('uid')) {
    db.exec("ALTER TABLE char_item_bonuses ADD COLUMN uid TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE char_item_bonuses SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''");
  }
}

// Migration: Weapons as real items (TODO.md) — `waffen_art` auf char_items.
// Default '' (kein Waffe) hält bestehende Zeilen unverändert; die Waffen-
// Stat-Zeilen-Tabelle selbst ist neu und braucht keine ALTER-Migration.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('waffen_art')) db.exec("ALTER TABLE char_items ADD COLUMN waffen_art TEXT NOT NULL DEFAULT ''");
}

// Migration (shared inventories, docs/concepts/shared-inventories.md):
// char_items/char_item_categories gain owner_type/owner_id instead of a hard
// character_id FK, so an item or a curated category list can belong to a
// group's pool or the GM's pool too, not only a character. SQLite cannot drop
// NOT NULL/a FK via ALTER, so both tables get a one-way rebuild: create the
// new shape, copy every row (character_id -> owner_type='character',
// owner_id=character_id) PRESERVING id, drop, rename. Ids are preserved so
// char_item_bonuses/char_item_weapon_stats (which reference char_items.id,
// untouched here) stay valid without needing to be touched themselves. Must
// run AFTER the char_items column ALTERs above (so the copied column set is
// complete) and BEFORE the weapons-as-items data migration further below
// (which inserts into char_items and has to target the new column pair).
//
// Two accepted consequences (see the concept doc): the DB-level cascade on
// character/group delete is gone from here on — loescheItemsFuer()
// (characterData.ts) takes over, exactly like loescheAssetsFuer() already
// does for the cross-database asset store — and this migration is one-way: a
// rollback onto older code would read a character_id column that no longer
// exists.
{
  const itemCols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  const catCols = new Set((db.prepare('PRAGMA table_info(char_item_categories)').all() as { name: string }[]).map((c) => c.name));
  if (itemCols.has('character_id') || catCols.has('character_id')) {
    db.pragma('foreign_keys = OFF');
    const rebuild = db.transaction(() => {
      if (itemCols.has('character_id')) {
        db.exec(`
          CREATE TABLE char_items_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_type TEXT NOT NULL DEFAULT 'character',
            owner_id INTEGER NOT NULL DEFAULT 0,
            pos INTEGER NOT NULL DEFAULT 0,
            uid TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            anzahl REAL NOT NULL DEFAULT 1,
            gewicht REAL NOT NULL DEFAULT 0,
            kategorie TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT 'inventar',
            zone TEXT NOT NULL DEFAULT '',
            beidseitig INTEGER NOT NULL DEFAULT 0,
            container_uid TEXT NOT NULL DEFAULT '',
            ist_behaelter INTEGER NOT NULL DEFAULT 0,
            container_art TEXT NOT NULL DEFAULT 'storage',
            kapazitaet REAL NOT NULL DEFAULT 0,
            kapazitaet_art TEXT NOT NULL DEFAULT 'gewicht',
            gewichtsreduktion REAL NOT NULL DEFAULT 0,
            rs REAL NOT NULL DEFAULT 0,
            haltbarkeit_max REAL NOT NULL DEFAULT 0,
            haltbarkeit_aktuell REAL NOT NULL DEFAULT 0,
            notiz TEXT NOT NULL DEFAULT '',
            rs_verborgen INTEGER NOT NULL DEFAULT 0,
            haltbarkeit_verborgen INTEGER NOT NULL DEFAULT 0,
            waffen_art TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO char_items_new (id, owner_type, owner_id, pos, uid, name, anzahl, gewicht, kategorie, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, haltbarkeit_max, haltbarkeit_aktuell, notiz, rs_verborgen, haltbarkeit_verborgen, waffen_art)
            SELECT id, 'character', character_id, pos, uid, name, anzahl, gewicht, kategorie, location, zone, beidseitig, container_uid, ist_behaelter, container_art, kapazitaet, kapazitaet_art, gewichtsreduktion, rs, haltbarkeit_max, haltbarkeit_aktuell, notiz, rs_verborgen, haltbarkeit_verborgen, waffen_art
            FROM char_items;
          DROP TABLE char_items;
          ALTER TABLE char_items_new RENAME TO char_items;
          CREATE INDEX IF NOT EXISTS idx_items_owner ON char_items (owner_type, owner_id, pos);
        `);
      }
      if (catCols.has('character_id')) {
        db.exec(`
          CREATE TABLE char_item_categories_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_type TEXT NOT NULL DEFAULT 'character',
            owner_id INTEGER NOT NULL DEFAULT 0,
            pos INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO char_item_categories_new (id, owner_type, owner_id, pos, name)
            SELECT id, 'character', character_id, pos, name FROM char_item_categories;
          DROP TABLE char_item_categories;
          ALTER TABLE char_item_categories_new RENAME TO char_item_categories;
          CREATE INDEX IF NOT EXISTS idx_item_categories_owner ON char_item_categories (owner_type, owner_id, pos);
        `);
      }
    });
    rebuild();
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    db.pragma('foreign_keys = ON');
    if (violations.length) {
      throw new Error(`char_items/char_item_categories-Neuaufbau ließ FK-Verletzungen zurück: ${JSON.stringify(violations)}`);
    }
    console.log('Migration: char_items/char_item_categories tragen jetzt owner_type/owner_id statt character_id (shared inventories)');
  }
}

// Index auf (owner_type, owner_id, pos) — unconditional und idempotent, läuft
// hier statt in den CREATE-TABLE-Blöcken oben, weil owner_type auf einer
// bestehenden (noch nicht migrierten) DB zu diesem Zeitpunkt garantiert
// existiert, während es dort oben (vor der Migration) noch fehlen könnte.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_items_owner ON char_items (owner_type, owner_id, pos);
  CREATE INDEX IF NOT EXISTS idx_item_categories_owner ON char_item_categories (owner_type, owner_id, pos);
`);

// Migration (Gruppenkasse, 2026-09-02): char_pouches gains owner_type/owner_id
// instead of a hard character_id FK, same rebuild technique and reasoning as
// the char_items migration above (SQLite cannot drop NOT NULL/a FK via ALTER;
// id is preserved so char_pouch_coins.pouch_id, untouched here, stays valid).
// The DB-level cascade on character/group delete is gone from here on —
// loeschePouchenFuer() (characterData.ts) takes over, exactly like
// loescheItemsFuer() already does for char_items.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_pouches)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('character_id')) {
    db.pragma('foreign_keys = OFF');
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE char_pouches_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_type TEXT NOT NULL DEFAULT 'character',
          owner_id INTEGER NOT NULL DEFAULT 0,
          pos INTEGER NOT NULL DEFAULT 0,
          name TEXT NOT NULL DEFAULT '',
          system_id INTEGER REFERENCES currency_systems(id) ON DELETE SET NULL,
          kapazitaet REAL NOT NULL DEFAULT 0,
          is_bank INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO char_pouches_new (id, owner_type, owner_id, pos, name, system_id, kapazitaet, is_bank)
          SELECT id, 'character', character_id, pos, name, system_id, kapazitaet, is_bank FROM char_pouches;
        DROP TABLE char_pouches;
        ALTER TABLE char_pouches_new RENAME TO char_pouches;
        CREATE INDEX IF NOT EXISTS idx_pouches_owner ON char_pouches (owner_type, owner_id, pos);
      `);
    });
    rebuild();
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    db.pragma('foreign_keys = ON');
    if (violations.length) {
      throw new Error(`char_pouches-Neuaufbau ließ FK-Verletzungen zurück: ${JSON.stringify(violations)}`);
    }
    console.log('Migration: char_pouches trägt jetzt owner_type/owner_id statt character_id (Gruppenkasse)');
  }
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_pouches_owner ON char_pouches (owner_type, owner_id, pos);`);

// Migration (Houses, docs/concepts/houses.md): haus/raum auf char_items —
// plain additive ALTERs, kein Neuaufbau nötig (anders als die owner_type-
// Migration oben: das hier sind zwei ganz neue, nullable-mit-Default-Spalten,
// keine NOT-NULL-Umwandlung). Läuft bewusst NACH dem obigen Neuaufbau: der
// hat seine eigene, feste Spaltenliste und würde haus/raum sonst beim
// Kopieren stillschweigend wieder verwerfen, kämen sie vorher dazu.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('haus')) db.exec("ALTER TABLE char_items ADD COLUMN haus TEXT NOT NULL DEFAULT ''");
  if (!cols.has('raum')) db.exec("ALTER TABLE char_items ADD COLUMN raum TEXT NOT NULL DEFAULT ''");
}

// Migration ("brought in by" marker, TODO.md 2026-09-03): mitgebracht_von auf
// char_items — plain additive ALTER, same shape as haus/raum above. Server-set
// only (moveItem), never part of the client-writable patch column set.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_items)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('mitgebracht_von')) db.exec("ALTER TABLE char_items ADD COLUMN mitgebracht_von TEXT NOT NULL DEFAULT ''");
}

// Migration: Magieresistenz von den Energien zu den Basiswerten.
// Früher lag sie in char_resources mit getrenntem permanent/kauf; da beides in
// der Praxis dasselbe war, wird es zu einem einzelnen Basiswert-Modifikator
// zusammengefasst. Je Charakter geschützt und damit wiederholbar; die alte
// char_resources-Zeile bleibt als Quelle stehen und wird nicht mehr gelesen.
db.exec(`
  INSERT INTO char_base_values (character_id, key, mod, base)
  SELECT r.character_id, 'mr', r.permanent + r.kauf, 0
  FROM char_resources r
  WHERE r.key = 'mr'
    AND NOT EXISTS (
      SELECT 1 FROM char_base_values b WHERE b.character_id = r.character_id AND b.key = 'mr'
    );
`);

// Migration: 'skill100'-Spalte (Meisterschaft bei 100 TaW) im Talent-Katalog ergänzen
{
  const cols = new Set((db.prepare('PRAGMA table_info(talents_catalog)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('skill100')) db.exec("ALTER TABLE talents_catalog ADD COLUMN skill100 TEXT NOT NULL DEFAULT ''");
}

// Migration: 'klasse' aus dem Talent-Katalog entfernen — die Steigerungsklasse
// wird im Regelwerk nicht verwendet und stand ohnehin überall leer.
{
  const cols = new Set((db.prepare('PRAGMA table_info(talents_catalog)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('klasse')) db.exec('ALTER TABLE talents_catalog DROP COLUMN klasse');
}

// Migration: 'notiz'-Spalte für char_talents (freies Notizfeld je Talent-Zeile).
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_talents)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('notiz')) db.exec("ALTER TABLE char_talents ADD COLUMN notiz TEXT NOT NULL DEFAULT ''");
}

// Migration: 'favorit'-Spalte für char_talents/char_abilities (📌 fürs
// Würfel-Dock, siehe ShortcutsFlyout.tsx). Startet false für jede Bestandszeile.
{
  const talentCols = new Set((db.prepare('PRAGMA table_info(char_talents)').all() as { name: string }[]).map((c) => c.name));
  if (!talentCols.has('favorit')) db.exec('ALTER TABLE char_talents ADD COLUMN favorit INTEGER NOT NULL DEFAULT 0');
  const abilityCols = new Set((db.prepare('PRAGMA table_info(char_abilities)').all() as { name: string }[]).map((c) => c.name));
  if (!abilityCols.has('favorit')) db.exec('ALTER TABLE char_abilities ADD COLUMN favorit INTEGER NOT NULL DEFAULT 0');
}

// Migration: Anmeldung soll Groß-/Kleinschreibung beim Benutzernamen ignorieren
// (Spieler tippen ihn nicht immer gleich — siehe TODO). Die login-Abfrage nutzt
// dafür COLLATE NOCASE; damit das eindeutig bleibt, braucht es zusätzlich einen
// case-insensitive UNIQUE-Index — sonst könnten künftig "Anna" UND "anna"
// nebeneinander entstehen und die Abfrage träfe mehrdeutig. Gäbe es SCHON
// Bestandskonten, die sich nur in Groß-/Kleinschreibung unterscheiden, würde
// der Indexaufbau daran scheitern; in dem seltenen Fall überspringen wir ihn
// und melden es, statt den Serverstart abzubrechen.
{
  const dupes = db
    .prepare('SELECT LOWER(username) AS u, COUNT(*) AS n FROM users GROUP BY LOWER(username) HAVING n > 1')
    .all() as { u: string; n: number }[];
  if (dupes.length === 0) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)');
  } else {
    console.warn(
      `Benutzernamen mit unterschiedlicher Groß-/Kleinschreibung gefunden (${dupes.map((d) => d.u).join(', ')}) — bitte manuell bereinigen (z. B. einen der Duplikat-Accounts umbenennen), erst dann greift die eindeutige Anmeldung ohne Groß-/Kleinschreibung.`,
    );
  }
}

// Migration: neu hinzugekommene Spalten in bestehenden Listen-Tabellen ergänzen
for (const s of LIST_SECTIONS) {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(sec_${s.id})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const c of s.columns) {
    if (!existing.has(c.key)) {
      db.exec(`ALTER TABLE sec_${s.id} ADD COLUMN ${colSql(c)}`);
    }
  }
}

// Migration: bestehende Nah-/Fernkampfwaffen einmalig in die neue Waffen-
// Tabelle (waffenNahNeu/waffenFernNeu, Kartenansicht im Client) kopieren —
// reine 1:1-Umbenennung der Felder ("tp" heißt jetzt klarer "haltbarkeit"),
// nichts geht verloren. sec_waffenNah/sec_waffenFern bleiben unverändert
// bestehen (der alte Reiter „Waffen (alt)" ist seit 2026-08-16 stillgelegt,
// keine UI liest mehr live von dort — die Tabellen sind reines Archiv).
// Läuft nur einmal: sobald die neue Tabelle Zeilen hat, fasst der Serverstart
// sie nicht mehr an (auch nicht für neue Charaktere — die haben ohnehin nichts
// in der alten Tabelle zu migrieren).
{
  const nahEmpty = (db.prepare('SELECT COUNT(*) AS n FROM sec_waffenNahNeu').get() as { n: number }).n === 0;
  if (nahEmpty) {
    db.exec(`
      INSERT INTO sec_waffenNahNeu (character_id, pos, typ, material, rd, haltbarkeit, anforderung, at, pa, bl, schaden, iniBonus, reichweite, besonderes, expLevel, talentId, notiz)
        SELECT character_id, pos, name, typMaterial, rd, tp, anforderung, at, pa, bl, schaden, iniBonus, reichweite, besonderes, expLevel, talentId, notiz
        FROM sec_waffenNah;
    `);
  }
  const fernEmpty = (db.prepare('SELECT COUNT(*) AS n FROM sec_waffenFernNeu').get() as { n: number }).n === 0;
  if (fernEmpty) {
    db.exec(`
      INSERT INTO sec_waffenFernNeu (character_id, pos, typ, eBE, entfernung, schaden, atMod, haltbarkeit, besonderes, talentId, notiz)
        SELECT character_id, pos, name, typEbe, entfernung, tpEntfernung, atMod, tp, besonderes, talentId, notiz
        FROM sec_waffenFern;
    `);
  }
}

// Migration: Weapons as real items (TODO.md) — bestehende Karten aus
// sec_waffenNahNeu/sec_waffenFernNeu einmalig als echte char_items-Zeilen
// (waffen_art gesetzt) + char_item_weapon_stats-Zeilen anlegen.
// sec_waffenNahNeu/sec_waffenFernNeu bleiben unangetastet stehen (reines
// Archiv, wie sec_waffenNah/sec_waffenFern es seit der vorigen Migration
// schon sind) — WaffenNeu.tsx liest ab jetzt nur noch aus char_items. Läuft
// nur einmal: sobald irgendein Item waffen_art gesetzt hat, fasst der
// Serverstart nichts mehr an (auch nicht für neue Charaktere — die haben
// ohnehin nichts in den alten Tabellen zu migrieren). Freitext-Haltbarkeit,
// die sich nicht als reine Zahl lesen lässt, geht NICHT verloren — sie
// landet als „Haltbarkeit: <Text>" in der Notiz (no-data-loss rule).
{
  const tableExists = (name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  const already = (db.prepare("SELECT COUNT(*) AS n FROM char_items WHERE waffen_art != ''").get() as { n: number }).n > 0;
  if (!already && tableExists('sec_waffenNahNeu') && tableExists('sec_waffenFernNeu')) {
    const NAH_FELDER = ['talentId', 'schaden', 'material', 'rd', 'reichweite', 'iniBonus', 'anforderung', 'expLevel', 'at', 'pa', 'bl', 'besonderes'];
    const FERN_FELDER = ['talentId', 'schaden', 'eBE', 'rd', 'entfernung', 'atMod', 'besonderes'];
    const newUid = (): string => (db.prepare('SELECT lower(hex(randomblob(16))) AS u').get() as { u: string }).u;
    const insItem = db.prepare(
      `INSERT INTO char_items (owner_type, owner_id, pos, uid, name, notiz, haltbarkeit_max, haltbarkeit_aktuell, waffen_art)
       VALUES ('character', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insStat = db.prepare('INSERT INTO char_item_weapon_stats (item_id, pos, uid, feld, wert) VALUES (?, ?, ?, ?, ?)');
    // Alte Haltbarkeit war reiner Freitext (kein current/max-Paar wie bei
    // Item.haltbarkeit) — eine reine Zahl wird zu max=aktuell=Zahl (frisch,
    // volle Haltbarkeit), alles andere (leer, "12/15", "gut", …) bleibt als
    // Text erhalten und wandert in die Notiz statt verloren zu gehen.
    const parseHaltbarkeit = (raw: unknown): { max: number; aktuell: number; rest: string } => {
      const trimmed = String(raw ?? '').trim();
      if (trimmed && /^\d+([.,]\d+)?$/.test(trimmed)) {
        const n = Number(trimmed.replace(',', '.'));
        return { max: n, aktuell: n, rest: '' };
      }
      return { max: 0, aktuell: 0, rest: trimmed };
    };
    const migrateTable = (table: string, felder: string[], art: 'nah' | 'fern', posOffset: number) => {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY character_id, pos, id`).all() as Record<string, unknown>[];
      for (const row of rows) {
        const { max, aktuell, rest } = parseHaltbarkeit(row.haltbarkeit);
        const notizParts = [String(row.notiz ?? '').trim(), rest ? `Haltbarkeit: ${rest}` : ''].filter(Boolean);
        const itemId = Number(
          insItem.run(
            row.character_id, posOffset + Number(row.pos ?? 0), newUid(),
            String(row.typ ?? ''), notizParts.join('\n'), max, aktuell, art,
          ).lastInsertRowid,
        );
        felder.forEach((feld, i) => insStat.run(itemId, i, newUid(), feld, String(row[feld] ?? '')));
      }
    };
    const migrate = db.transaction(() => {
      migrateTable('sec_waffenNahNeu', NAH_FELDER, 'nah', 2_000_000);
      migrateTable('sec_waffenFernNeu', FERN_FELDER, 'fern', 3_000_000);
    });
    migrate();
  }
}

// Migration: feste Zauber-Sektionen (techniken/liturgien/allgemeinzauber) in die
// frei benennbaren Sektionen (zauberSektionen/zauberEintraege) überführen
const hasTable = (name: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
if (hasTable('sec_techniken')) {
  const migrate = db.transaction(() => {
    const empty = (db.prepare('SELECT COUNT(*) AS n FROM sec_zauberEintraege').get() as { n: number }).n === 0;
    if (empty) {
      db.exec(`
        INSERT INTO sec_zauberEintraege (character_id, pos, sektion, name, stufe, kosten, probe, effekt, fortschritt, probeZahlManuell, notiz)
          SELECT character_id, pos, 'Talente/Kampfstile/Stellungen', name, stufe, kosten, probe, effekt, fortschritt, probeZahlManuell, ''
          FROM sec_techniken;
        INSERT INTO sec_zauberEintraege (character_id, pos, sektion, name, stufe, kosten, probe, effekt, fortschritt, probeZahlManuell, notiz)
          SELECT character_id, 1000 + pos, 'Liturgien', name, '', kosten, '', effekt, 0, probeZahlManuell, ''
          FROM sec_liturgien;
        INSERT INTO sec_zauberEintraege (character_id, pos, sektion, name, stufe, kosten, probe, effekt, fortschritt, probeZahlManuell, notiz)
          SELECT character_id, 2000 + pos, 'Allgemeinzauber', name, stufe, kosten, probe, effekt, 0, 0, ''
          FROM sec_allgemeinzauber;
      `);
      // Für jeden Charakter mit Einträgen die drei Standard-Sektionen anlegen
      const chars = db.prepare('SELECT DISTINCT character_id FROM sec_zauberEintraege').all() as { character_id: number }[];
      const ins = db.prepare('INSERT INTO sec_zauberSektionen (character_id, pos, name, notiz) VALUES (?, ?, ?, ?)');
      for (const c of chars) {
        ['Talente/Kampfstile/Stellungen', 'Liturgien', 'Allgemeinzauber'].forEach((name, i) => ins.run(c.character_id, i, name, ''));
      }
    }
    db.exec('DROP TABLE sec_techniken; DROP TABLE sec_liturgien; DROP TABLE sec_allgemeinzauber;');
  });
  migrate();
}

// Migration: 'is_bank'-Spalte an bestehende char_pouches ergänzen (siehe
// CoinPouch.bank in currency.ts).
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_pouches)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_bank')) db.exec('ALTER TABLE char_pouches ADD COLUMN is_bank INTEGER NOT NULL DEFAULT 0');
}

// Migration (Geld-Umbau): Aventurisch-Basissystem seeden — D/S/H/K exakt wie
// das alte Vier-Münzen-Modell (gleiche Codes, gleiche ×10-Leiter), damit die
// Übernahme eine reine Umbenennung ist — und bestehende char_meta-Werte
// (geldD/S/H/K/bank) einmalig in neue Geldbeutel kopieren: "Gürtelbeutel" für
// die vier Münzsorten, "Bank" für den alten bank-Wert (stand in Dublonen,
// wandert 1:1 in die D-Sorte). Nichts geht verloren; die alten char_meta-
// Spalten bleiben unverändert stehen (Altbestand, saveSection schreibt sie
// nicht mehr, siehe characterData.ts). Läuft nur, solange currency_systems
// leer ist — GM-gepflegte Katalogdaten werden danach nicht mehr angefasst,
// auch nicht bei neuen Charakteren ohne Altdaten.
{
  const systemsEmpty = (db.prepare('SELECT COUNT(*) AS n FROM currency_systems').get() as { n: number }).n === 0;
  if (systemsEmpty) {
    const seed = db.transaction(() => {
      const sysId = Number(
        db.prepare("INSERT INTO currency_systems (name, notiz, sort) VALUES ('Aventurisch', '', 0)").run().lastInsertRowid,
      );
      const insDenom = db.prepare(
        'INSERT INTO currency_denominations (system_id, code, name, faktor, sort) VALUES (?, ?, ?, ?, ?)',
      );
      const denomIds: Record<string, number> = {};
      const denoms: [string, string, number, number][] = [
        ['D', 'Dublone', 1000, 0],
        ['S', 'Silbertaler', 100, 1],
        ['H', 'Heller', 10, 2],
        ['K', 'Kreuzer', 1, 3],
      ];
      for (const [code, name, faktor, sort] of denoms) {
        denomIds[code] = Number(insDenom.run(sysId, code, name, faktor, sort).lastInsertRowid);
      }

      const chars = db
        .prepare(
          `SELECT character_id, geldD, geldS, geldH, geldK, bank FROM char_meta
           WHERE geldD <> 0 OR geldS <> 0 OR geldH <> 0 OR geldK <> 0 OR bank <> 0`,
        )
        .all() as { character_id: number; geldD: number; geldS: number; geldH: number; geldK: number; bank: number }[];
      const insPouch = db.prepare(
        "INSERT INTO char_pouches (owner_type, owner_id, pos, name, system_id, kapazitaet, is_bank) VALUES ('character', ?, ?, ?, ?, 0, ?)",
      );
      const insCoin = db.prepare('INSERT INTO char_pouch_coins (pouch_id, denomination_id, anzahl) VALUES (?, ?, ?)');
      for (const c of chars) {
        if (c.geldD || c.geldS || c.geldH || c.geldK) {
          const pouchId = Number(insPouch.run(c.character_id, 0, 'Gürtelbeutel', sysId, 0).lastInsertRowid);
          if (c.geldD) insCoin.run(pouchId, denomIds.D, c.geldD);
          if (c.geldS) insCoin.run(pouchId, denomIds.S, c.geldS);
          if (c.geldH) insCoin.run(pouchId, denomIds.H, c.geldH);
          if (c.geldK) insCoin.run(pouchId, denomIds.K, c.geldK);
        }
        if (c.bank) {
          const pouchId = Number(insPouch.run(c.character_id, 1, 'Bank', sysId, 1).lastInsertRowid);
          insCoin.run(pouchId, denomIds.D, c.bank);
        }
      }
    });
    seed();
    console.log('Migration: Aventurisch-Währungssystem geseedet, bestehende Münzen/Bank in Geldbeutel übernommen');
  }
}

// Reparatur (läuft bei JEDEM Start, nicht nur einmalig): jeder Charakter hat
// GENAU einen Bank-Beutel (immer da, unlöschbar, unbegrenzt — siehe
// CoinPouch.bank). Der generische Geldbeutel-Umbau hatte diese Sonderrolle
// zunächst verloren (neue Charaktere bekamen gar keinen, ein bestehender ließ
// sich wie jeder andere Beutel löschen) — das hier legt fehlende Bank-Beutel
// nachträglich an, ohne bestehende anzufassen.
{
  const firstSystem = db.prepare('SELECT id FROM currency_systems ORDER BY sort, id LIMIT 1').get() as
    | { id: number }
    | undefined;
  if (firstSystem) {
    const missing = db
      .prepare(
        `SELECT c.id FROM characters c
         WHERE NOT EXISTS (SELECT 1 FROM char_pouches p WHERE p.owner_type = 'character' AND p.owner_id = c.id AND p.is_bank = 1)`,
      )
      .all() as { id: number }[];
    if (missing.length > 0) {
      const insBank = db.prepare(
        "INSERT INTO char_pouches (owner_type, owner_id, pos, name, system_id, kapazitaet, is_bank) VALUES ('character', ?, 1, ?, ?, 0, 1)",
      );
      const repair = db.transaction(() => {
        for (const c of missing) insBank.run(c.id, 'Bank', firstSystem.id);
      });
      repair();
      console.log(`Reparatur: ${missing.length} fehlende Bank-Beutel angelegt`);
    }
  }
}

// Migration: group_roll_id an group_feed ergänzen — markiert Einträge, die zu
// derselben Gruppen-Sammelanfrage gehören (siehe server/src/groupRolls.ts),
// damit der Client sie im Feed als einen Block darstellen kann. NULL bei
// jeder bestehenden Zeile ist der richtige Wert (keine davon gehörte je zu
// einer Sammelanfrage), also braucht es kein Nachziehen wie bei abgeleiteten
// Spalten.
{
  const cols = new Set((db.prepare('PRAGMA table_info(group_feed)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('group_roll_id')) db.exec('ALTER TABLE group_feed ADD COLUMN group_roll_id TEXT');
}

// Migration: is_coop an group_feed ergänzen — markiert Einträge einer
// aufgelösten Kooperationsprobe (server/src/coopPools.ts), unterscheidet sie
// von einer gewöhnlichen Gruppenprobe, die denselben group_roll_id-
// Mechanismus nutzt. 0 bei jeder bestehenden Zeile ist der richtige Wert
// (Kooperationsproben gab es vorher nicht), kein Nachziehen nötig.
{
  const cols = new Set((db.prepare('PRAGMA table_info(group_feed)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_coop')) db.exec('ALTER TABLE group_feed ADD COLUMN is_coop INTEGER NOT NULL DEFAULT 0');
}

// Migration: is_repeat an group_feed ergänzen — markiert jeden Eintrag eines
// per führendem "Nx" wiederholten freien Wurfs (server/src/ws.ts, roll.expr),
// unterscheidet ihn von einer gewöhnlichen Gruppenprobe, die denselben
// group_roll_id-Mechanismus nutzt. 0 bei jeder bestehenden Zeile ist der
// richtige Wert (Wiederholungs-Würfe gab es vorher nicht), kein Nachziehen nötig.
{
  const cols = new Set((db.prepare('PRAGMA table_info(group_feed)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_repeat')) db.exec('ALTER TABLE group_feed ADD COLUMN is_repeat INTEGER NOT NULL DEFAULT 0');
}

// Migration: is_competitive an group_feed ergänzen — Gegenstück zu is_coop
// für einen aufgelösten Wettstreit-Pool (server/src/coopPools.ts, PoolMode
// 'competitive'), eigene Spalte statt Wiederverwendung von is_coop, damit
// beide Pool-Arten unabhängig bleiben (nie beide 1 für dieselbe Zeile). 0 bei
// jeder bestehenden Zeile ist der richtige Wert (Wettstreite gab es vorher
// nicht), kein Nachziehen nötig.
{
  const cols = new Set((db.prepare('PRAGMA table_info(group_feed)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_competitive')) db.exec('ALTER TABLE group_feed ADD COLUMN is_competitive INTEGER NOT NULL DEFAULT 0');
}

// Migration: Event-Gruppen (bisher eine eigene temp_groups-Tabelle mit eigener
// id-Folge) in groups zusammenführen, per is_temp unterschieden — damit
// group_feed (und jede künftige Chat/Würfel-Tabelle) mit einer einzigen FK auf
// groups(id) auskommt, statt zwei id-Folgen auseinanderhalten zu müssen, die
// kollidieren könnten (Gruppe 5 und Event-Gruppe 5 als zwei verschiedene
// Zeilen). temp_group_members bleibt die additive Mitgliedschaft, nur ihr Ziel
// wandert von temp_groups(id) auf groups(id). Auf einer frischen Datenbank
// bringt CREATE TABLE die Spalten schon mit und temp_groups existiert nie —
// dieser Block läuft dann als reines No-op.
{
  const groupCols = new Set((db.prepare('PRAGMA table_info(groups)').all() as { name: string }[]).map((c) => c.name));
  if (!groupCols.has('is_temp')) {
    db.exec(`
      ALTER TABLE groups ADD COLUMN is_temp INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE groups ADD COLUMN created_by INTEGER REFERENCES users(id);
      ALTER TABLE groups ADD COLUMN created_at INTEGER;
    `);
    const tempGroupsExists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'temp_groups'").get();
    if (tempGroupsExists) {
      const oldGroups = db.prepare('SELECT id, name, created_by, created_at FROM temp_groups').all() as {
        id: number;
        name: string;
        created_by: number;
        created_at: number;
      }[];
      const idMap = new Map<number, number>();
      const insertGroup = db.prepare('INSERT INTO groups (name, is_temp, created_by, created_at) VALUES (?, 1, ?, ?)');
      for (const g of oldGroups) idMap.set(g.id, Number(insertGroup.run(g.name, g.created_by, g.created_at).lastInsertRowid));
      const oldMembers = db.prepare('SELECT temp_group_id, character_id FROM temp_group_members').all() as {
        temp_group_id: number;
        character_id: number;
      }[];
      db.pragma('foreign_keys = OFF');
      const rebuild = db.transaction(() => {
        db.exec(`
          CREATE TABLE temp_group_members_new (
            temp_group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
            PRIMARY KEY (temp_group_id, character_id)
          );
        `);
        const insertMember = db.prepare('INSERT INTO temp_group_members_new (temp_group_id, character_id) VALUES (?, ?)');
        for (const m of oldMembers) {
          const newId = idMap.get(m.temp_group_id);
          if (newId !== undefined) insertMember.run(newId, m.character_id);
        }
        db.exec(`
          DROP TABLE temp_group_members;
          ALTER TABLE temp_group_members_new RENAME TO temp_group_members;
          DROP TABLE temp_groups;
        `);
      });
      rebuild();
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      db.pragma('foreign_keys = ON');
      if (violations.length) {
        throw new Error(`temp_group_members-Neuaufbau ließ FK-Verletzungen zurück: ${JSON.stringify(violations)}`);
      }
      console.log(`Migration: ${oldGroups.length} Event-Gruppe(n) in groups zusammengeführt (is_temp)`);
    }
  }
}

// Migration: 'raceBase'-Spalte an bestehende char_resources ergänzen —
// Rassenbonus auf LE/AU/AsE (races_catalog.le/.au/.ae), analog zu
// baseValues.gsBase/resilienzBase. Wie üblich reicht ALTER TABLE allein nicht:
// bestehende Charaktere mit gewählter Rasse müssten sonst bis zur nächsten
// Rassen-Auswahl bei 0 stehen bleiben.
{
  const cols = new Set((db.prepare('PRAGMA table_info(char_resources)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('raceBase')) db.exec('ALTER TABLE char_resources ADD COLUMN raceBase REAL NOT NULL DEFAULT 0');
}

// Reparatur/Nachziehen (läuft bei JEDEM Start): LE/AU/AsE/MR/Artefaktkontrolle-
// Rassenboni aus races_catalog in char_resources.raceBase bzw.
// char_base_values.base (key 'mr'/'artefaktkontrolle') spiegeln. Anders als
// gs/resilienz/psyche haben diese fünf Werte kein freies Eingabefeld — sie
// sind IMMER exakt der aktuelle Rassenwert (0 ohne Rasse bzw. wenn die Rasse
// dafür keinen Wert hinterlegt hat), es gibt also nichts, was ein erneuter
// Abgleich zerstören könnte. Läuft deshalb unconditional bei jedem Start statt
// nur einmalig — deckt sowohl den Erst-Rollout als auch einen Rollback/Restore
// auf eine ältere Datenbank ab (siehe CLAUDE.md, "abgeleitete Spalte").
{
  const sync = db.transaction(() => {
    db.exec(`
      UPDATE char_resources SET raceBase = COALESCE((
        SELECT rc.le FROM char_bio b JOIN races_catalog rc ON rc.id = b.rasseId WHERE b.character_id = char_resources.character_id
      ), 0) WHERE key = 'le';
      UPDATE char_resources SET raceBase = COALESCE((
        SELECT rc.au FROM char_bio b JOIN races_catalog rc ON rc.id = b.rasseId WHERE b.character_id = char_resources.character_id
      ), 0) WHERE key = 'aus';
      UPDATE char_resources SET raceBase = COALESCE((
        SELECT rc.ae FROM char_bio b JOIN races_catalog rc ON rc.id = b.rasseId WHERE b.character_id = char_resources.character_id
      ), 0) WHERE key = 'ase';
      UPDATE char_base_values SET base = COALESCE((
        SELECT rc.mr FROM char_bio b JOIN races_catalog rc ON rc.id = b.rasseId WHERE b.character_id = char_base_values.character_id
      ), 0) WHERE key = 'mr';
      UPDATE char_base_values SET base = COALESCE((
        SELECT rc.ak FROM char_bio b JOIN races_catalog rc ON rc.id = b.rasseId WHERE b.character_id = char_base_values.character_id
      ), 0) WHERE key = 'artefaktkontrolle';
    `);
  });
  sync();
}

// Migration: group_members war eine eigene Spieler-Gruppe-Zuordnung aus der
// Zeit vor der Charakter-Selbst-Anlage/Freigabe, als die Spielleitung jeden
// Charakter selbst anlegte. Mitgliedschaft ist seither ohnehin nur über
// characters.group_id sinnvoll (siehe isGroupMember) — die Tabelle war zuletzt
// nur noch eine zweite, teils veraltete Kopie derselben Information.
db.exec('DROP TABLE IF EXISTS group_members');

// Migration: 'highlights_json'-Spalte an bestehende boards ergänzen (Kachel-
// Einfärbung als eigene Ebene über tiles_json, siehe Kommentar an der Spalte).
{
  const cols = new Set((db.prepare('PRAGMA table_info(boards)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('highlights_json')) db.exec("ALTER TABLE boards ADD COLUMN highlights_json TEXT NOT NULL DEFAULT '{}'");
}

// Migration: 'radius'-Spalte an bestehende board_tokens ergänzen (Reichweiten-
// Ring, siehe Kommentar an der Spalte).
{
  const cols = new Set((db.prepare('PRAGMA table_info(board_tokens)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('radius')) db.exec('ALTER TABLE board_tokens ADD COLUMN radius REAL NOT NULL DEFAULT 0');
  if (!cols.has('radius_color')) db.exec("ALTER TABLE board_tokens ADD COLUMN radius_color TEXT NOT NULL DEFAULT '#ffcc0033'");
  // Migration: 'rotation'-Spalte (Blickrichtung, developer feedback) — 0 ist
  // ein neutraler Rückfall für jede bereits bestehende Marke, kein Nachrechnen
  // nötig.
  if (!cols.has('rotation')) db.exec('ALTER TABLE board_tokens ADD COLUMN rotation REAL NOT NULL DEFAULT 0');
  // Migration: 'icon_asset'-Spalte (gewähltes Bild aus TOKEN_ICONS, siehe
  // shared/src/tokenIcons.ts) — leer ist der richtige Rückfall für jede
  // bereits bestehende Marke (kein Bild gewählt), kein Nachrechnen nötig.
  if (!cols.has('icon_asset')) db.exec("ALTER TABLE board_tokens ADD COLUMN icon_asset TEXT NOT NULL DEFAULT ''");
}

// Migration: 'owner_user_id' an bestehende board_overlays ergänzen ("Limit
// active measure shapes per player" in TODO.md). NULL für jede schon
// bestehende Zeile ist der richtige Rückfall, kein Nachrechnen möglich (wer's
// angelegt hat, ist nirgends sonst gespeichert) — zählt einfach für niemandes
// Kappung mit, genau wie ein Wert, den der Server künftig nicht kennt.
{
  const cols = new Set((db.prepare('PRAGMA table_info(board_overlays)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('owner_user_id')) db.exec('ALTER TABLE board_overlays ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}

// Migration: board_initiative auf das Zeiger-Design umgestellt (rolled/done
// weg, ini_basis/active_this_round neu, siehe Kommentar an der Tabelle oben).
// Phase 10 ist noch unveröffentlicht — nichts in dieser Tabelle ist echte
// Spieldaten, deshalb DROP+CREATE statt spaltenweisem ALTER.
{
  const cols = new Set((db.prepare('PRAGMA table_info(board_initiative)').all() as { name: string }[]).map((c) => c.name));
  if (cols.has('rolled') || cols.has('done')) {
    db.exec(`
      DROP TABLE board_initiative;
      CREATE TABLE board_initiative (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        token_id INTEGER NOT NULL REFERENCES board_tokens(id) ON DELETE CASCADE,
        ini_basis INTEGER NOT NULL DEFAULT 0,
        value INTEGER NOT NULL DEFAULT 0,
        active_this_round INTEGER NOT NULL DEFAULT 0,
        death_countdown INTEGER
      );
      CREATE INDEX idx_board_initiative_board_id ON board_initiative(board_id);
      CREATE UNIQUE INDEX idx_board_initiative_token ON board_initiative(token_id);
    `);
  }
}

// Migration: 'round_order'/'rolled_this_round'-Spalten an bestehende
// board_initiative ergänzen (Überraschungsangriffe/Normal-Zugänge mitten im
// Kampf, siehe Kommentar an der Tabelle oben). Defaults (0) sind für jede
// bestehende Zeile harmlos — beide Felder gelten erst ab dem NÄCHSTEN Wurf.
{
  const cols = new Set((db.prepare('PRAGMA table_info(board_initiative)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('round_order')) db.exec('ALTER TABLE board_initiative ADD COLUMN round_order INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('rolled_this_round')) db.exec('ALTER TABLE board_initiative ADD COLUMN rolled_this_round INTEGER NOT NULL DEFAULT 0');
}

// Legt die festen Zeilen (Attribute, Basiswerte, Energien, Bio, Meta) für einen Charakter an
export function initCharacterRows(characterId: number): void {
  const attr = db.prepare('INSERT OR IGNORE INTO char_attributes (character_id, attr) VALUES (?, ?)');
  for (const code of ATTR_ROW_CODES) attr.run(characterId, code);
  const bv = db.prepare('INSERT OR IGNORE INTO char_base_values (character_id, key) VALUES (?, ?)');
  for (const key of BASE_VALUE_KEYS) bv.run(characterId, key);
  const res = db.prepare('INSERT OR IGNORE INTO char_resources (character_id, key) VALUES (?, ?)');
  for (const key of RESOURCE_KEYS) res.run(characterId, key);
  db.prepare('INSERT OR IGNORE INTO char_bio (character_id) VALUES (?)').run(characterId);
  db.prepare('INSERT OR IGNORE INTO char_meta (character_id) VALUES (?)').run(characterId);
  // Neue Charaktere starten mit einem leeren, unbegrenzten Standard-Geldbeutel
  // im ersten Katalog-System (sortiert) — ohne das wäre ein frischer Charakter
  // ohne jeden Beutel und müsste erst „+ Beutel" klicken, um überhaupt Geld
  // eintragen zu können. Dazu immer der Bank-Beutel (siehe CoinPouch.bank) —
  // genau einer, von Anfang an, nicht erst über die Start-Reparatur oben.
  const firstSystem = db.prepare('SELECT id FROM currency_systems ORDER BY sort, id LIMIT 1').get() as
    | { id: number }
    | undefined;
  if (firstSystem) {
    const insPouch = db.prepare(
      "INSERT INTO char_pouches (owner_type, owner_id, pos, name, system_id, kapazitaet, is_bank) VALUES ('character', ?, ?, ?, ?, 0, ?)",
    );
    insPouch.run(characterId, 0, 'Gürtelbeutel', firstSystem.id, 0);
    insPouch.run(characterId, 1, 'Bank', firstSystem.id, 1);
  }
}
