# Heldenverwaltung

Web-App zur Charakterverwaltung für das hauseigene DSA-inspirierte Pen-&-Paper-System.
Alle berechneten Werte (Basiswerte, Energien, Proben, Gewichte …) werden live aus den
eingegebenen Werten berechnet.

## Struktur

```
shared/    Regelwerk-Engine (alle Formeln) + Typen + Sektions-Definitionen — von Client UND Server genutzt
server/    Express-API, SQLite-Datenbank (better-sqlite3), Auth, Rechte
client/    React-Oberfläche (Vite), deutsche UI
```

## Erste Schritte

Node 22 oder neuer (in der `package.json` als `engines` festgehalten, `engine-strict`
lässt npm bei älteren Versionen abbrechen statt nur zu warnen). `better-sqlite3` ist
ein nativer Baustein: passt die Node-Version nicht zu einem fertigen Binary, will npm
es selbst übersetzen und verlangt dafür Visual-Studio-Build-Tools. Eine LTS-Version
erspart das.

```bash
npm ci                    # installiert exakt das, was in der package-lock.json steht
npm run seed              # legt Spielleiter-Konto an (spielleiter / spielleiter) und lädt die Kataloge
npm run dev:server        # API auf http://localhost:3001
npm run dev:client        # Web-UI auf http://localhost:5173
```

Anmelden als `spielleiter` / `spielleiter` (Passwort danach im Dashboard ändern).

### `npm ci` statt `npm install`

`npm ci` installiert stur nach `package-lock.json` und **schreibt die Datei nie um**.
`npm install` löst die Abhängigkeiten dagegen neu auf und schreibt die Lock-Datei
nebenbei neu — je nach npm-Version fallen dann Änderungen an, die mit dem Projekt
nichts zu tun haben (das erzeugt auf zwei Rechnern unnötige Diffs).

Deshalb: **`npm ci` zum Installieren, `npm install` nur zum bewussten Hinzufügen oder
Aktualisieren einer Abhängigkeit** — und die dabei geänderte `package-lock.json` dann
mit committen.

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

## Über das öffentliche Internet testen

Der Server liefert API und Web-UI aus einem Prozess auf **einem Port** aus. Für
Tests mit externen Nutzern gehört zwingend HTTPS davor — sonst reisen Passwort
und Sitzungs-Cookie im Klartext.

- Domain: Strato
- DNS und Tunnel: Cloudflare
- Webserver: Nginx
- Anwendung: Express (Docker)
- SSL: Cloudflare bzw. Let's Encrypt (kostenlos)

**Checkliste vor der Freigabe:**

1. **GM-Passwort ändern** — als `spielleiter` anmelden und im Dashboard unter
   „Passwort ändern" ersetzen (oder `GM_PASSWORD=…` **vor dem ersten** Seed auf
   frischer DB setzen). Der Standard `spielleiter/spielleiter` ist öffentlich bekannt.
2. **Mit `SECURE_COOKIES=1` starten** — hinter einem HTTPS-Proxy, damit das
   Sitzungs-Cookie das `Secure`-Flag erhält.
3. **Sicherungen prüfen** — der Server legt automatisch täglich eine Kopie unter
   `server/data/backups/helden-JJJJ-MM-TT.db` an (siehe unten). Diese liegen auf
   derselben Platte wie das Original: für echten Schutz zusätzlich regelmäßig
   **weg vom Rechner** kopieren.

**Einfachster HTTPS-Weg (Cloudflare Tunnel, ohne Portfreigabe):**

```bash
SECURE_COOKIES=1 npm start                       # App auf :3001 (baut + serviert)
cloudflared tunnel --url http://localhost:3001   # liefert eine https://…-Adresse
```

Die ausgegebene `https://…trycloudflare.com`-Adresse an die Tester geben; TLS
endet bei Cloudflare, das `Secure`-Cookie greift. Für eine feste Adresse auf
eigener Domain den benannten Tunnel einrichten (`cloudflared tunnel login`).

**Umgebungsvariablen** (im Prozess/Service setzen — es gibt keinen `.env`-Loader):

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3001` | Port des Servers |
| `SECURE_COOKIES` | aus | `1`/`true` → `Secure`-Flag am Sitzungs-Cookie (hinter HTTPS) |
| `SESSION_TTL_DAYS` | `30` | Gültigkeitsdauer einer Sitzung in Tagen |
| `GM_PASSWORD` | `spielleiter` | Erst-Passwort des GM-Kontos (nur beim allerersten Seed) |
| `ADMIN_USER` | — | Zweites Konto mit Spielleiter-Rechten (z. B. der Entwickler) |
| `ADMIN_PASSWORD` | — | Passwort dazu — nur beim Anlegen, setzt später nichts zurück |
| `ADMIN_NAME` | = `ADMIN_USER` | Anzeigename des zweiten Kontos |
| `HELDEN_DB` | `server/data/helden.db` | Pfad zur SQLite-Datei |
| `BACKUP_DIR` | `server/data/backups` | Ablage der täglichen Sicherungen |
| `BACKUP_KEEP` | `14` | Anzahl aufbewahrter Sicherungen (ältere werden gelöscht) |
| `BACKUP_INTERVAL_HOURS` | `24` | Abstand zwischen den Sicherungsläufen |

## Zweites Spielleiter-Konto

`spielleiter` ist das Konto der Spielleitung — wer die App entwickelt oder betreibt,
braucht ein eigenes. Mit `ADMIN_USER` + `ADMIN_PASSWORD` legt der Server beim Start
ein zweites Konto mit Spielleiter-Rechten an:

```bash
ADMIN_USER=dominik ADMIN_PASSWORD='…' npm start
```

Das funktioniert auch auf einer bestehenden Datenbank. Existiert das Konto bereits,
bleibt es unangetastet — insbesondere wird das Passwort **nicht** bei jedem Start
zurückgesetzt. Die Variablen können danach wieder entfallen.

## Sicherungen

Der Server sichert die Datenbank beim Start und danach im eingestellten Takt nach
`server/data/backups/helden-JJJJ-MM-TT.db` — über die Online-Backup-API von SQLite,
also im laufenden Betrieb und WAL-sicher (ein bloßes Kopieren der `.db`-Datei wäre
das nicht). Pro Tag entsteht **eine** Sicherung; eine bereits vorhandene wird nicht
überschrieben, damit ein Neustart mit beschädigtem Stand die gute Kopie des Tages
nicht ersetzt. Ältere Sicherungen jenseits von `BACKUP_KEEP` werden aufgeräumt.

Wiederherstellen: Server stoppen, die gewünschte Sicherung nach
`server/data/helden.db` kopieren (vorhandene `helden.db-wal`/`-shm` daneben
entfernen), Server starten.

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

## Tests

```bash
npm test    # Regelwerk-Engine gegen bekannte Werte
```
