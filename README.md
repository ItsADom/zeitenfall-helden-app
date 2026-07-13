# Heldenverwaltung

Web-App zur Charakterverwaltung für das hauseigene DSA-inspirierte Pen-&-Paper-System.
Alle berechneten Werte (Basiswerte, Energien, Proben, Gewichte …) werden live aus den
eingegebenen Werten berechnet — die Formeln entsprechen exakt dem Excel-Template (Raskir.xlsx).

## Struktur

```
shared/    Regelwerk-Engine (alle Formeln) + Typen + Sektions-Definitionen — von Client UND Server genutzt
server/    Express-API, SQLite-Datenbank (better-sqlite3), Auth, Rechte
client/    React-Oberfläche (Vite), deutsche UI, 12 Tabs wie im Excel-Blatt
importer/  Import von Arbeitsbüchern im Raskir-Template inkl. Formel-Abgleich
```

## Erste Schritte

```bash
npm install
npm run seed              # legt Spielleiter-Konto an (spielleiter / spielleiter) und lädt die Kataloge
npm run dev:server        # API auf http://localhost:3001
npm run dev:client        # Web-UI auf http://localhost:5173
```

Anmelden als `spielleiter` / `spielleiter` (Passwort danach im Dashboard ändern).

## Für die Gruppe betreiben (ohne Dev-Server)

```bash
npm start         # baut den Client und startet API + Web-UI auf http://localhost:3001
```

`npm start` baut den Client jedes Mal frisch und liefert ihn selbst aus — für die
Spielrunde reicht also ein Prozess auf einem Rechner im Netzwerk (Port mit `PORT=…`
änderbar, GM-Erstpasswort mit `GM_PASSWORD=…` beim ersten Seed).

**Beim Entwickeln** dagegen die beiden Dev-Server nutzen (`npm run dev:server` +
`npm run dev:client`, Port 5173) — die zeigen Änderungen sofort. Port 3001 zeigt nur
den zuletzt gebauten Stand; nach Code-Änderungen dort erst `npm start` (baut neu) laufen lassen.

## Charakter aus Excel importieren

```bash
npm run import -- pfad/zu/Charakter.xlsx --owner <benutzername> --group <gruppenname>
```

- Fehlende Benutzer/Gruppen werden angelegt (Passwort wird ausgegeben).
- Der Importer prüft alle berechneten Zellen des Blatts gegen die Regelwerk-Engine
  und meldet Abweichungen („ABWEICHUNG …").
- Zellkommentare aus dem Blatt werden als „— Anmerkung: …" an die passenden Felder angehängt.
- Manuell (ohne Formel) eingetragene AT-Proben werden als **AT-Deckel** der Waffe übernommen
  (z. B. Nachteil „Schildträger: AT maximal 10").

## Rollen & Rechte

- **Spielleiter** (`is_gm`): sieht und bearbeitet alles; legt Benutzer, Gruppen und Charaktere an.
- **Besitzer**: bearbeitet die eigenen Charaktere vollständig, steuert im Tab „Sichtbarkeit",
  welche Bereiche Gruppenmitglieder sehen.
- **Gruppenmitglieder**: sehen die Personenbeschreibung (Alter, Größe …) immer,
  freigegebene Bereiche als schreibgeschützte Zusammenfassung.
- Alle anderen: kein Zugriff (404).

## Kataloge

Talent- und Sprachlisten sind Daten (aus dem Blatt extrahiert, per Seed geladen) und können
vom Spielleiter unter **Verwaltung → Kataloge** bearbeitet werden. Einträge, die von
Charakteren verwendet werden, sind gegen Löschen geschützt.

## Bekannte Abweichung zum Excel-Blatt

Der Import von Raskir.xlsx meldet eine bewusste Abweichung:

- **Waffen!V7** (Drachenturmschild, Blocken-Probe): Die Blatt-Formel verwendet versehentlich
  das *Parade*-Ergebnis (9) statt des Blocken-Ergebnisses (20). Die App rechnet kanonisch
  mit dem Blocken-Ergebnis (40 statt 29).

(Die frühere zweite Abweichung — Sühne, AT manuell auf 10 — wird inzwischen als AT-Deckel
importiert und stimmt damit überein.)

## Tests

```bash
npm test    # Regelwerk-Engine gegen bekannte Werte aus Raskir.xlsx
```
