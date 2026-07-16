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

## Über das öffentliche Internet testen

Der Server liefert API und Web-UI aus einem Prozess auf **einem Port** aus. Für
Tests mit externen Nutzern gehört zwingend HTTPS davor — sonst reisen Passwort
und Sitzungs-Cookie im Klartext.

**Checkliste vor der Freigabe:**

1. **GM-Passwort ändern** — als `spielleiter` anmelden und im Dashboard unter
   „Passwort ändern" ersetzen (oder `GM_PASSWORD=…` **vor dem ersten** Seed auf
   frischer DB setzen). Der Standard `spielleiter/spielleiter` ist öffentlich bekannt.
2. **Mit `SECURE_COOKIES=1` starten** — hinter einem HTTPS-Proxy, damit das
   Sitzungs-Cookie das `Secure`-Flag erhält.
3. **`server/data/helden.db` sichern** — die einzige Kopie aller Charakterdaten;
   während des Tests regelmäßig wegkopieren (WAL: am besten bei gestopptem Server).

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
| `HELDEN_DB` | `server/data/helden.db` | Pfad zur SQLite-Datei |

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
