# Betrieb auf einem eigenen Linux-Server

Schritt-für-Schritt-Anleitung für den Dauerbetrieb hinter HTTPS. Geschrieben für
Ubuntu 24.04 mit bereits laufendem Nginx, lässt sich aber auf jede Distribution
mit systemd übertragen.

## Zielbild

```
Internet → Router (80/443) → Nginx (TLS) → 127.0.0.1:3001 → Express → helden.db
```

Ein einziger Node-Prozess liefert API **und** Web-UI aus (siehe `server/src/index.ts`),
Nginx terminiert nur TLS und reicht durch. Der Zustand steckt in **zwei**
SQLite-Dateien: `helden.db` für alles Geschriebene (Charaktere, Wiki-Texte,
Protokolle) und `helden-assets.db` für alle Bilder (Wiki-Bilder und Porträts).
Getrennt sind sie wegen der Sicherung, nicht wegen der Struktur — siehe
„Zwei Datenbanken, zwei Takte".

## Werte für diese Installation

Alle folgenden Befehle nutzen diese Werte. Beim Übertragen auf eine andere
Maschine nur diesen Block anpassen.

| Platzhalter | Wert |
|---|---|
| Hostname | `zeitenfall.duckdns.org` |
| SSH-Zugang | `jonas@jonasvanhagen.duckdns.org` |
| Dienst-Nutzer | `helden` |
| Basisverzeichnis | `/srv/helden` |
| Interner Port | `3001` |

## Verzeichnis-Layout

```
/opt/node22/                Node 22 (Tarball) — nur dieser Dienst kennt den Pfad
/srv/helden/repo/           Git-Klon, Quelle für Updates
/srv/helden/releases/<ts>/  ausgerollte Stände
/srv/helden/app             Symlink auf den aktiven Stand
/srv/helden/data/           helden.db + helden-assets.db (Bilder) + WAL
                                                   ← überlebt jedes Update
/srv/helden/backups/        Sicherungen beider Reihen ← überlebt jedes Update
/srv/helden/deploy.sh       Update-Skript
/etc/helden-app.env         Zugangsdaten, chmod 600
/etc/systemd/system/helden-app.service
/etc/nginx/sites-available/zeitenfall
/etc/nginx/snippets/helden-proxy.conf
/etc/nginx/conf.d/helden-ratelimit.conf
```

Daten liegen **außerhalb** des Code-Verzeichnisses, gesteuert über `HELDEN_DB` und
`BACKUP_DIR`. Dadurch darf ein Update den Code komplett ersetzen, ohne dass
Spielerdaten je in Gefahr geraten. Die Kataloge (`server/data/talents.json`,
`languages.json`) bleiben dagegen im Code-Verzeichnis — `server/src/seed.ts` liest
sie über einen festen relativen Pfad, nicht über eine Variable.

---

## Alltagsbefehle

Die Kurzfassung für den laufenden Betrieb. Alles darunter beschreibt die
Erstinstallation und wird nur einmal gebraucht.

### Update ausrollen

```bash
sudo /srv/helden/deploy.sh                 # Standard-Branch: develop
sudo /srv/helden/deploy.sh main            # anderer Branch
```

Dauert 5–10 Minuten. Gebaut wird im neuen Verzeichnis, umgeschaltet erst nach
erfolgreichem Build — schlägt etwas fehl, läuft die alte Version unberührt weiter.
Eine abgerissene SSH-Verbindung schadet deshalb ebenfalls nicht: einfach neu
verbinden und wiederholen.

### In den Git-Klon schauen

```bash
sudo -u helden git -C /srv/helden/repo status
sudo -u helden git -C /srv/helden/repo log --oneline -5
```

Immer **als `helden`** und mit `-C` statt `cd`. Der Klon gehört dem Dienstnutzer;
ruft `jonas` dort git auf, kommt:

```
fatal: detected dubious ownership in repository at '/srv/helden/repo'
```

Das ist der Schutz aus CVE-2022-24765: in `.git/config` lassen sich Befehle
hinterlegen (`core.pager`, `core.fsmonitor`, Hooks), die git beim Arbeiten selbst
ausführt — ein fremdes Repository könnte so Code unter der eigenen Kennung starten.
Die angebotene Abhilfe `git config --global --add safe.directory …` **nicht**
setzen: `jonas` hat auf dem Klon ohnehin nur Lese-, kein Schreibrecht, und Dateien,
die dort als `jonas` entstehen, machen den Klon gemischt-eigentümlich — der nächste
Deploy-Lauf als `helden` bricht dann an schwerer deutbarer Stelle ab.

Aktualisiert wird der Klon nie von Hand, sondern nur durch `deploy.sh`. Ein
`git pull` wäre dort auch inhaltlich falsch: das Skript nutzt
`checkout -B <branch> origin/<branch>` und zwingt den lokalen Branch damit hart auf
den Remote-Stand. `pull` könnte stattdessen einen Merge-Commit oder Konflikt
erzeugen — in einem Verzeichnis, das nur ein Spiegel sein soll.

### Zustand und Protokoll

```bash
systemctl status helden-app --no-pager     # Zustand, Speicher, Laufzeit
sudo journalctl -u helden-app -f           # Live-Protokoll
sudo journalctl -u helden-app -n 50 --no-pager
sudo readlink -f /srv/helden/app           # welcher Stand läuft gerade?
```

### Neu starten

```bash
sudo systemctl restart helden-app
```

### Zurückrollen

```bash
sudo ls -1 /srv/helden/releases/
sudo -u helden ln -sfn /srv/helden/releases/<alter-stand> /srv/helden/app.new
sudo -u helden mv -Tf /srv/helden/app.new /srv/helden/app
sudo systemctl restart helden-app
```

Das Skript bewahrt die letzten drei Stände auf und löscht nie den gerade aktiven —
auch nicht nach einem Rollback auf einen älteren.

### Erreichbarkeit prüfen

```bash
curl -s -o /dev/null -w 'HTTPS: %{http_code}\n' https://zeitenfall.duckdns.org/
curl -s -o /dev/null -w 'SPA:   %{http_code}\n' https://zeitenfall.duckdns.org/charakter/1
curl -s https://zeitenfall.duckdns.org/api/me; echo
```

Erwartet: zweimal `200` und `{"error":"Nicht angemeldet"}`. Die Prüfungen laufen
bewusst als GET — der SPA-Rückfall greift nur bei `req.method === 'GET'`, ein
`curl -I` (HEAD) auf eine Unterseite sähe fälschlich nach einem Fehler aus.

### Sicherungen

```bash
ls -lh /srv/helden/backups/                          # lokal
rclone lsl onedrive:Backups/zeitenfall-helden        # ausgelagert
du -h /srv/helden/data/helden.db                     # Größe der Datenbank

systemctl list-timers helden-backup-onedrive.timer --no-pager
sudo journalctl -u helden-backup-onedrive -n 20 --no-pager
/usr/local/bin/helden-backup-onedrive                # sofort auslagern
```

Wiederherstellen siehe Abschnitt „Sicherungen und Wiederherstellung".

### Zertifikat

```bash
sudo certbot certificates | grep -E 'Certificate Name|Expiry'
systemctl list-timers --no-pager | grep certbot
sudo certbot renew --dry-run
```

Die Erneuerung läuft automatisch, **solange der Server läuft**. Nach längerer
Abschaltung deshalb als Erstes die Restlaufzeiten prüfen.

### Nginx

```bash
sudo nginx -t && sudo systemctl reload nginx     # nie ohne den Test davor
sudo tail -20 /var/log/nginx/error.log
```

Einträge mit `limiting requests … zone "helden_login"` sind **kein** Fehler,
sondern die arbeitende Anmelde-Bremse.

### Konfiguration ändern

```bash
sudo nano /etc/helden-app.env
sudo systemctl restart helden-app
```

Es gibt keinen `.env`-Loader in der App — Änderungen greifen erst nach dem Neustart.

---

## Phase 1 — Node 22 installieren

Die App verlangt Node ≥ 22 (`engines` in der `package.json`), und wegen
`engine-strict=true` in der `.npmrc` bricht `npm ci` bei älteren Versionen ab,
statt nur zu warnen.

Auf einem Server mit weiteren Diensten wird das System-Node **nicht** angefasst.
Node 22 kommt parallel nach `/opt/node22`:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
TARBALL=$(grep -o 'node-v22\.[0-9.]*-linux-x64\.tar\.xz' SHASUMS256.txt | head -1)
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$TARBALL"
sha256sum --ignore-missing -c SHASUMS256.txt      # muss "OK" melden

sudo mkdir -p /opt/node22
sudo tar -xJf "$TARBALL" -C /opt/node22 --strip-components=1
/opt/node22/bin/node --version                    # v22.x.y
```

Das System-Node bleibt unberührt — `node --version` meldet weiterhin die alte
Version, und nichts anderes auf dem Server ändert sein Verhalten.

## Phase 2 — Nutzer und Verzeichnisse

```bash
sudo useradd --system --home-dir /srv/helden --shell /usr/sbin/nologin helden
sudo mkdir -p /srv/helden/{releases,data,backups,.cache}
sudo chown -R helden:helden /srv/helden
sudo chmod 750 /srv/helden
```

Ein Systemnutzer ohne Login-Shell: fällt die App aus, bleibt der Schaden auf ihr
eigenes Verzeichnis begrenzt.

## Phase 3 — Konfiguration hinterlegen

### Die beiden Erstpasswörter haben verschiedene Aufgaben

| | `GM_PASSWORD` | `ADMIN_PASSWORD` |
|---|---|---|
| Konto | `spielleiter` — die Spielleitung | das Konto der Betreiberin/des Betreibers |
| Wer erfährt es | einmalig die Spielleitung | niemand sonst |
| Lebensdauer | bis zur ersten Anmeldung | dauerhaft |
| Form | **sprechbare Passphrase** | **kryptisch** |

Spielerkonten legt die Spielleitung später in der App selbst an und vergibt dort
die Passwörter (`POST /admin/users`) — das läuft nie über den Betrieb.

Eine diktierbare Passphrase erzeugen:

```bash
WOERTER=(Amboss Anker Bernstein Birke Distel Dolch Drache Eiche Falke Feder Fjord
Flamme Garten Gerste Gletscher Hafen Hammer Harfe Heide Hirsch Honig Insel Kessel
Klinge Komet Krone Lanze Laterne Lawine Leuchte Linde Marmor Mondlicht Moos Nebel
Norden Otter Pfeil Quelle Rabe Reiter Riegel Ruder Rune Salbei Schatten Schiefer
Schmiede Segel Silber Sturm Tanne Tinte Turm Ufer Wacholder Walnuss Wanderer Weide
Wolke Zeder Zinne)

for i in 1 2 3; do
  echo "$(shuf -e "${WOERTER[@]}" -n 3 | paste -sd '-')-$(shuf -i 10-99 -n 1)"
done

openssl rand -base64 18        # das kryptische fuer das Betreiber-Konto
```

Ergibt etwa `Nebel-Schmiede-Rabe-47`: am Telefon diktierbar, ohne
`l`/`1`/`O`/`0`-Verwechslung. Rund 25 Bit Entropie — schwächer als 18 zufällige
Bytes, aber vertretbar, weil das Passwort nur ein Konto betrifft, nur bis zur
ersten Anmeldung gilt und das Nginx-Ratenlimit aus Phase 6 auf fünf Versuche pro
Minute bremst.

### Datei anlegen

Erst mit Platzhaltern, dann im Editor befüllen — ein direkt eingetipptes Passwort
landet mitsamt Heredoc im Klartext in `~/.bash_history`:

```bash
sudo tee /etc/helden-app.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3001
SECURE_COOKIES=1
HELDEN_DB=/srv/helden/data/helden.db
HELDEN_ASSETS_DB=/srv/helden/data/helden-assets.db
BACKUP_DIR=/srv/helden/backups
BACKUP_KEEP=14
BACKUP_INTERVAL_HOURS=24
BACKUP_ASSETS_KEEP=8
BACKUP_ASSETS_INTERVAL_HOURS=168
SESSION_TTL_DAYS=30
GM_PASSWORD=PLATZHALTER_GM
ADMIN_USER=PLATZHALTER_ADMIN_NAME
ADMIN_PASSWORD=PLATZHALTER_ADMIN
EOF

sudo nano /etc/helden-app.env      # beide Platzhalter ersetzen

sudo chown root:root /etc/helden-app.env
sudo chmod 600 /etc/helden-app.env
```

Keine Leerzeichen um das `=`, keine Anführungszeichen, kein `#` im Passwort —
systemd liest die Datei zeilenweise und behandelt `#` als Kommentarbeginn.

Kontrolle:

```bash
sudo ls -l /etc/helden-app.env                              # -rw------- root root
sudo sed -E 's/(PASSWORD=).*/\1***/' /etc/helden-app.env    # 11 Zeilen, geschwaerzt
sudo grep -c PLATZHALTER /etc/helden-app.env                # muss 0 sein
sudo grep -nE '^\s|\s=|=\s|"' /etc/helden-app.env           # muss leer bleiben
```

`600 root:root` ist ausreichend und zugleich das Strengste, was geht: systemd liest
`EnvironmentFile` als PID 1 — also als root, **bevor** es auf den Nutzer `helden`
herunterschaltet. Der Dienstnutzer braucht selbst kein Leserecht an der Datei.

Wozu die einzelnen Werte dienen:

- **`NODE_ENV=production`** schaltet den Entwickler-Umschalter „Ansehen als" ab
  (`DEV_VIEW_AS` in `server/src/routes.ts` ist sonst standardmäßig aktiv).
- **`SECURE_COOKIES=1`** gibt dem Sitzungs-Cookie das `Secure`-Flag. Zwingend,
  sobald HTTPS steht — ohne das reist der Sitzungsschlüssel notfalls im Klartext.
- **`GM_PASSWORD`** greift **nur beim allerersten Start** auf leerer Datenbank.
  Danach ist es wirkungslos; das Passwort wird dann in der App geändert. Also
  jetzt richtig setzen — der Standard `spielleiter/spielleiter` steht in der README
  und ist damit öffentlich bekannt.
- **`ADMIN_USER`/`ADMIN_PASSWORD`** legen ein zweites Spielleiter-Konto an (für
  dich als Betreiber, getrennt vom Konto der Spielleitung). Idempotent: ein
  bestehendes Konto wird nie zurückgesetzt.

Es gibt bewusst **keinen `.env`-Loader** in der App — die Variablen kommen
ausschließlich aus dieser Datei über systemd.

## Phase 4 — Code ausliefern

**Auf dem Windows-Rechner** (PowerShell, im Projektverzeichnis):

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
git archive --format=tar.gz -o "$env:TEMP\helden-$stamp.tar.gz" HEAD
scp "$env:TEMP\helden-$stamp.tar.gz" jonas@jonasvanhagen.duckdns.org:/tmp/
Write-Host "Stand: $stamp"
```

`git archive` statt `rsync` aus gutem Grund: es packt exakt die versionierten
Dateien. `node_modules`, `client/dist` und `*.db` fallen automatisch weg, weil sie
in der `.gitignore` stehen.

> **Niemals `node_modules` von Windows mitkopieren.** `better-sqlite3` ist ein
> nativer Baustein und liegt dort als Windows-Binary — auf Linux stürzt der Server
> beim Start ab. Deshalb wird auf dem Server frisch installiert.

Zu beachten: `git archive HEAD` liefert den **letzten Commit**, keine
uncommitteten Änderungen. Vor dem Ausliefern also committen.

**Auf dem Server** (`$STAMP` durch den ausgegebenen Wert ersetzen):

```bash
ARCHIV=$(ls -t /tmp/helden-*.tar.gz | head -1)
STAMP=$(basename "$ARCHIV" .tar.gz | sed 's/^helden-//')
echo "Stand: $STAMP"

sudo -u helden mkdir -p /srv/helden/releases/$STAMP
sudo -u helden tar -xzf "$ARCHIV" -C /srv/helden/releases/$STAMP
sudo ls /srv/helden/releases/$STAMP/package-lock.json      # Auspacken geglueckt?

sudo -H -u helden env PATH=/opt/node22/bin:/usr/bin:/bin \
  sh -c "cd /srv/helden/releases/$STAMP && npm ci"
sudo -H -u helden env PATH=/opt/node22/bin:/usr/bin:/bin \
  sh -c "cd /srv/helden/releases/$STAMP && npm run build"
```

Drei Feinheiten, die sonst Zeit kosten:

- **Das `cd` steckt _in_ der `sh -c`-Zeile**, nicht davor. `/srv/helden` ist
  `chmod 750` — ein gewöhnliches Konto kommt dort nicht hinein, das vorgelagerte
  `cd` scheiterte also, und npm liefe im falschen Verzeichnis.
- **`-H`** setzt `HOME` auf `/srv/helden`. Ohne das behält `sudo` das `HOME` des
  aufrufenden Nutzers, und npm scheitert beim Schreiben seines Caches.
- **`env PATH=/opt/node22/bin:…`** wählt Node 22. Fehlt es, bricht `npm ci` sofort
  mit `EBADENGINE` ab, weil `engine-strict=true` in der `.npmrc` steht.

`npm run build` erzeugt `client/dist`. Der Build braucht rund 1 GB Arbeitsspeicher
und läuft einmal beim Deployment — **nicht** bei jedem Dienststart. Das
Wurzel-Skript `npm start` würde beides zusammen tun; für den Dauerbetrieb ist das
falsch, deshalb startet die systemd-Unit unten nur den Server.

## Phase 5 — systemd-Unit

```bash
sudo tee /etc/systemd/system/helden-app.service >/dev/null <<'EOF'
[Unit]
Description=Zeitenfall Heldenverwaltung
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=helden
Group=helden
WorkingDirectory=/srv/helden/app
Environment=PATH=/opt/node22/bin:/usr/bin:/bin
Environment=XDG_CACHE_HOME=/srv/helden/.cache
EnvironmentFile=/etc/helden-app.env
ExecStart=/srv/helden/app/node_modules/.bin/tsx server/src/index.ts
SuccessExitStatus=143
Restart=always
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/srv/helden/data /srv/helden/backups /srv/helden/.cache

[Install]
WantedBy=multi-user.target
EOF
```

Zur Erklärung der weniger offensichtlichen Zeilen:

- **`ExecStart` ruft `tsx` direkt auf**, nicht `npm run start`. Der Server läuft als
  TypeScript über `tsx` — es gibt keinen Kompilierschritt. Der direkte Aufruf spart
  einen npm-Wrapperprozess, sodass systemd den echten Server überwacht.
- **`Environment=PATH=/opt/node22/bin:…`** ist der Kern der parallelen Installation:
  die `tsx`-Startdatei beginnt mit `#!/usr/bin/env node` und findet so das Node 22,
  während der Rest des Systems weiter das alte Node sieht.
- **`ProtectSystem=strict`** macht das gesamte Dateisystem schreibgeschützt, außer
  den unter `ReadWritePaths` genannten Pfaden. Die App schreibt ausschließlich in
  Datenbank und Sicherungen — der Code bleibt zur Laufzeit unveränderlich.

Jetzt den ersten Stand aktivieren und starten (`$STAMP` ist noch aus Phase 4
gesetzt — in einer neuen Sitzung vorher erneut belegen):

```bash
sudo -u helden ln -sfn /srv/helden/releases/$STAMP /srv/helden/app.new
sudo -u helden mv -Tf /srv/helden/app.new /srv/helden/app

sudo systemctl daemon-reload
sudo systemctl enable --now helden-app
```

Der Umweg über `app.new` + `mv -T` tauscht den Symlink in einem Rutsch — es gibt
keinen Moment, in dem `app` ins Leere zeigt.

**Prüfen, bevor es weitergeht:**

```bash
systemctl status helden-app --no-pager
journalctl -u helden-app -n 40 --no-pager

curl -s -o /dev/null -w 'Startseite:  %{http_code}\n' http://127.0.0.1:3001/
curl -s -o /dev/null -w 'SPA-Route:   %{http_code}\n' http://127.0.0.1:3001/charakter/1
curl -s                                            http://127.0.0.1:3001/api/me
```

Erwartet: zweimal `200` und `{"error":"Nicht angemeldet"}`. Die Prüfungen laufen
bewusst als GET — der SPA-Rückfall in `server/src/index.ts` greift nur bei
`req.method === 'GET'`, ein `curl -I` (HEAD) auf eine Unterseite liefe daher ins
Leere und sähe fälschlich nach einem Fehler aus.

Im Log müssen beim ersten Start diese Zeilen stehen:

```
Talent-Katalog geladen: … Einträge
Sprachen-Katalog geladen: … Einträge
Spielleiter-Konto angelegt: …
Liefere gebauten Client aus client/dist aus
Helden-App Server läuft auf http://localhost:3001
```

Der Seed läuft automatisch bei jedem Start und ist idempotent — ein separater
`npm run seed`-Schritt ist beim Deployment nicht nötig.

> **Wenn der Dienst mit `EACCES` oder `EROFS` abbricht:** dann will ein Werkzeug an
> eine Stelle schreiben, die `ProtectSystem=strict` sperrt. Fehlenden Pfad aus dem
> Journal ablesen und zu `ReadWritePaths` hinzufügen; im Zweifel ersatzweise
> `ReadWritePaths=/srv/helden`.

## Phase 6 — DNS und Nginx

### 6a — Subdomain anlegen und in die Pflege aufnehmen

Zuerst auf [duckdns.org](https://www.duckdns.org) anmelden und die Subdomain
`zeitenfall` anlegen.

Damit ist es aber **nicht** getan. Die IP-Aktualisierung übernimmt auf diesem
Server ein Container (`linuxserver/duckdns`), und der pflegt ausschließlich die
Namen aus seiner `SUBDOMAINS`-Variable. Ein dort nicht eingetragener Name zeigt
nach dem nächsten IP-Wechsel ins Leere — und mit ihm fällt auch die
Zertifikatserneuerung aus, weil Let's Encrypt den Host nicht mehr erreicht.

```bash
cd /home/jonas/duckdns
cp docker-compose.yml docker-compose.yml.bak       # vor dem Ändern sichern
nano docker-compose.yml
```

Die Zeile mit den Subdomains erweitern — kommagetrennt, **ohne Leerzeichen**:

```yaml
- SUBDOMAINS=familievanhagen,zeitenfall
```

Übernehmen und kontrollieren:

```bash
docker compose up -d
sleep 20
docker logs duckdns --tail 20                       # muss "OK" je Subdomain zeigen
docker inspect duckdns --format '{{range .Config.Env}}{{println .}}{{end}}' | grep SUBDOMAINS
```

Der DuckDNS-Token gilt für das ganze Konto, nicht je Subdomain — er muss also
nicht angefasst werden.

Zum Schluss prüfen, dass der Name auf die richtige Adresse zeigt:

```bash
dig +short zeitenfall.duckdns.org
curl -s https://api.ipify.org; echo
```

Beide Zeilen müssen dieselbe IP nennen. Bis zur Ausbreitung können ein paar
Minuten vergehen.

### 6b — Nginx-Server-Block

Ratenbegrenzung fürs Anmelden — muss in den `http`-Kontext, also in ein eigenes
File unter `conf.d/`, **nicht** in den Server-Block:

```bash
sudo tee /etc/nginx/conf.d/helden-ratelimit.conf >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=helden_login:10m rate=5r/m;
EOF
```

Die Proxy-Kopfzeilen einmal zentral, damit sie nicht an zwei Stellen doppelt stehen:

```bash
sudo tee /etc/nginx/snippets/helden-proxy.conf >/dev/null <<'EOF'
proxy_pass http://127.0.0.1:3001;
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
EOF
```

Der Server-Block:

```bash
sudo tee /etc/nginx/sites-available/zeitenfall >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name zeitenfall.duckdns.org;

    # Porträt-Upload erlaubt 3 MB; der Nginx-Standard von 1 MB
    # ließe ihn mit HTTP 413 scheitern.
    client_max_body_size 5M;

    # Let's-Encrypt-Prüfung lokal bedienen, nicht durchreichen —
    # gleiche Handhabung wie im bestehenden nextcloud-duckdns-Vhost.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
        try_files $uri =404;
    }

    location = /api/login {
        limit_req zone=helden_login burst=3 nodelay;
        limit_req_status 429;
        include snippets/helden-proxy.conf;
    }

    location / {
        include snippets/helden-proxy.conf;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/zeitenfall /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Test über HTTP, bevor TLS dazukommt:

```bash
curl -sI http://zeitenfall.duckdns.org/ | head -1
```

## Phase 7 — HTTPS

Erst trocken proben, dann ernst machen:

```bash
sudo certbot certonly --nginx -d zeitenfall.duckdns.org --dry-run
sudo certbot --nginx -d zeitenfall.duckdns.org --redirect
```

Der Trockenlauf braucht zwingend `certonly` — mit dem Standard-Unterbefehl `run`
(holen **und** einbauen) lehnt Certbot `--dry-run` ab. Der scharfe Aufruf dagegen
läuft ohne `certonly`, denn dort soll auch der Server-Block angepasst werden.

Certbot beweist den Besitz über Port 80 (HTTP-01), holt das Zertifikat und
schreibt den Server-Block um: `listen 443 ssl`, Zertifikatspfade und die
Umleitung von HTTP auf HTTPS. Bei der Frage nach der Umleitung **„redirect"**
wählen.

Danach prüfen:

```bash
curl -s -o /dev/null -w 'HTTPS: %{http_code}\n' https://zeitenfall.duckdns.org/
curl -s -o /dev/null -w 'HTTP:  %{http_code}\n' http://zeitenfall.duckdns.org/
systemctl list-timers --no-pager | grep certbot        # automatische Erneuerung
sudo certbot renew --dry-run
```

Erwartet: `200` über HTTPS, `301` über HTTP.

DuckDNS-Namen funktionieren mit Let's Encrypt ohne Sonderbehandlung: `duckdns.org`
steht auf der Public Suffix List, jede Subdomain zählt daher als eigene Domain.

## Phase 8 — Freigabe

1. **Anmelden** auf `https://zeitenfall.duckdns.org` als `spielleiter` mit dem
   gesetzten `GM_PASSWORD` — und als Betreiber-Konto mit dem `ADMIN_PASSWORD`
   gegenprüfen.

2. **Porträt-Upload mit einem Bild von 1–3 MB testen.** Der eigentliche Prüfstein
   für `client_max_body_size 5M`: die App erlaubt bis 3 MB, Nginx riegelt ohne die
   Zeile bei 1 MB mit `413` ab. Ein kleines Testbild fände den Fehler nicht.

3. **Sicherung prüfen** — nach dem ersten Start muss eine Datei existieren:
   ```bash
   sudo ls -l /srv/helden/backups/
   ```

4. **Neustart-Festigkeit prüfen**:
   ```bash
   sudo systemctl restart helden-app && sleep 4 && systemctl is-active helden-app
   sudo journalctl -u helden-app -n 8 --no-pager
   ```
   Im Log muss beim Stoppen `Deactivated successfully` stehen. Erscheint stattdessen
   `Failed with result 'exit-code'` mit `status=143`, fehlt `SuccessExitStatus=143`
   in der Unit: 143 ist `128+15`, also das SIGTERM, mit dem systemd selbst
   beendet hat — `tsx` reicht es als Rückgabewert durch.

### Umgang mit den Erstpasswörtern

`GM_PASSWORD` ist nach dem ersten Seed **wirkungslos** — es wird nur gelesen, wenn
die Benutzertabelle leer ist. `ADMIN_USER`/`ADMIN_PASSWORD` werden bei jedem Start
gelesen, sind aber idempotent: ein bestehendes Konto wird nie zurückgesetzt.

Daraus folgen zwei gangbare Wege:

- **Stehenlassen** — dann legt ein Neustart das Betreiber-Konto automatisch wieder
  an, falls es je verlorengeht. Preis: Wird ein Passwort später *in der App*
  geändert, ist der Wert in der Datei still veraltet.
- **Entfernen**, sobald beide Anmeldungen bestätigt sind. Dann alle drei Zeilen
  zusammen — `ADMIN_USER` ohne `ADMIN_PASSWORD` erzeugt bei jedem Start eine Warnung:
  ```bash
  sudo sed -i '/^GM_PASSWORD=/d; /^ADMIN_USER=/d; /^ADMIN_PASSWORD=/d' /etc/helden-app.env
  sudo systemctl restart helden-app
  ```

Unabhängig davon: Der Seed schreibt das GM-Passwort beim ersten Start **im Klartext
ins Journal**. Bei der Übergabe an die Spielleitung deshalb klar dazusagen, dass es
sofort zu ändern ist — es ist ein Transportgeheimnis, keine Dauerlösung.

---

## Phase 9 — Updates direkt aus Git

Phase 4 hat den Code vom Arbeitsrechner hochgeladen — das funktioniert auch ohne
GitHub-Zugriff des Servers und ist deshalb als Erstinstallation dokumentiert. Für
den laufenden Betrieb ist ein Klon auf dem Server bequemer: Updates werden damit
zu einem einzigen Befehl.

### Einmalig: klonen

```bash
sudo -H -u helden git clone https://github.com/ItsADom/zeitenfall-helden-app.git /srv/helden/repo
sudo -H -u helden git -C /srv/helden/repo log --oneline -3
```

Bei einem öffentlichen Repo genügt HTTPS ohne Anmeldung — kein SSH-Schlüssel nötig.
Wird das Repo später privat, ist ein **Deploy Key** (Repo → Settings → Deploy keys,
nur lesend, nur dieses Repo) die richtige Wahl; ein kontoweiter SSH-Schlüssel gäbe
dem Server Zugriff auf alles.

Der Klon liegt bewusst **neben** den Releases. Ausgerollt wird weiterhin über
`git archive` in ein frisches Verzeichnis: so bleibt `/srv/helden/app` frei von
`.git`, und der atomare Symlink-Wechsel funktioniert unverändert.

### Das Deploy-Skript

```bash
sudo tee /srv/helden/deploy.sh >/dev/null <<'EOF'
#!/bin/bash
# Heldenverwaltung aus dem Git-Klon ausrollen.
# Aufruf: sudo /srv/helden/deploy.sh [branch]      (Standard: develop)
set -euo pipefail

BRANCH="${1:-develop}"
REPO=/srv/helden/repo

# Alles, was dem Dienstnutzer gehört, läuft als dieser — mit Node 22 im PATH.
als_helden() { sudo -H -u helden env PATH=/opt/node22/bin:/usr/bin:/bin sh -c "$1"; }

echo "→ Stand aus GitHub holen ($BRANCH)"
als_helden "git -C $REPO fetch --prune origin"
als_helden "git -C $REPO checkout -B $BRANCH origin/$BRANCH"

SHA=$(als_helden "git -C $REPO rev-parse --short HEAD")
STAMP="$(date +%Y%m%d-%H%M%S)-$SHA"
REL="/srv/helden/releases/$STAMP"
echo "→ Release $STAMP"

# git archive statt kopieren: das Release bleibt frei von .git
als_helden "mkdir -p $REL && git -C $REPO archive --format=tar HEAD | tar -x -C $REL"

echo "→ Abhängigkeiten und Client-Build"
als_helden "cd $REL && npm ci"
als_helden "cd $REL && npm run build"

echo "→ Umschalten und Neustart"
als_helden "ln -sfn $REL /srv/helden/app.new"
als_helden "mv -Tf /srv/helden/app.new /srv/helden/app"
systemctl restart helden-app

sleep 4
if systemctl is-active --quiet helden-app; then
    echo "✓ Läuft: $STAMP"
else
    echo "✗ Start fehlgeschlagen — Log:"
    journalctl -u helden-app -n 30 --no-pager
    exit 1
fi

echo "→ Alte Stände aufräumen (die letzten 3 bleiben)"
AKTIV=$(readlink -f /srv/helden/app)
find /srv/helden/releases -mindepth 1 -maxdepth 1 -type d | sort | head -n -3 | while read -r alt; do
    # Nach einem Rollback zeigt der Symlink auf einen alten Stand — den nie löschen.
    if [ "$(readlink -f "$alt")" != "$AKTIV" ]; then rm -rf "$alt"; fi
done
EOF

sudo chmod 750 /srv/helden/deploy.sh
sudo bash -n /srv/helden/deploy.sh && echo "Syntax in Ordnung"
```

Ab dann ist ein Update ein Befehl — der Arbeitsrechner wird dafür nicht mehr
gebraucht:

```bash
sudo /srv/helden/deploy.sh
```

Rechne mit 5–10 Minuten: `npm ci` installiert neu und übersetzt `better-sqlite3`.

Drei Entwurfsentscheidungen, die den Unterschied machen:

- **Gebaut wird im neuen Verzeichnis, umgeschaltet erst danach.** Scheitert `npm ci`
  oder der Build, bricht das Skript wegen `set -e` ab — und `/srv/helden/app` zeigt
  unverändert auf den laufenden Stand. Ein halb ausgerolltes Deployment kann es
  nicht geben. Auch eine abgerissene SSH-Verbindung schadet deshalb nicht.
- **`checkout -B $BRANCH origin/$BRANCH`** verwirft lokale Abweichungen im Klon
  bewusst. Auf einem Deployment-Server ist der Klon ein Spiegel, keine Werkstatt.
- **Der Stand-Name enthält den Commit-Hash** (`20260807-213849-9874c95`) — am
  Verzeichnisnamen ist damit ablesbar, welcher Commit läuft.

**Zurückrollen** auf einen älteren Stand:

```bash
ls -1d /srv/helden/releases/*/
sudo -u helden ln -sfn /srv/helden/releases/<alter-stand> /srv/helden/app.new
sudo -u helden mv -Tf /srv/helden/app.new /srv/helden/app
sudo systemctl restart helden-app
```

## Sicherungen und Wiederherstellung

Der Server sichert selbstständig — beim Start und danach alle `BACKUP_INTERVAL_HOURS`
nach `/srv/helden/backups/helden-JJJJ-MM-TT.db`, über die Online-Backup-API von
SQLite (im laufenden Betrieb und WAL-sicher; ein bloßes Kopieren der Datei wäre das
nicht). Pro Tag entsteht genau eine Sicherung, eine vorhandene wird nie
überschrieben.

### Zwei Datenbanken, zwei Takte

Seit dem Wiki gibt es eine **zweite** Datei: `/srv/helden/data/helden-assets.db`
enthält ausschließlich Bilder — Wiki-Bilder und Charakter-Porträts. Sie liegt
bereits innerhalb der `ReadWritePaths` der Unit — an der systemd-Datei ist
**nichts** zu ändern.

Sie hat ihren eigenen Zeitplan: **wöchentlich** nach
`helden-assets-JJJJ-MM-TT.db` (`BACKUP_ASSETS_INTERVAL_HOURS=168`,
`BACKUP_ASSETS_KEEP=8` ≈ zwei Monate). Der Grund ist genau diese Auslagerung:
Bilder sind groß und ändern sich fast nie, täglich mitzukopieren würde jede
Tagessicherung vervielfachen, ohne mehr Inhalt zu schützen.

Zwei Details fallen dabei günstig aus:

- Der Filter `--include 'helden-*.db'` unten **passt bereits** auf
  `helden-assets-JJJJ-MM-TT.db`. Am Auslagerungsskript ist nichts zu ändern,
  die Bilder fahren einfach siebenmal seltener mit.
- Die lokalen Aufräum-Regeln trennen sauber: jede Reihe hat ihr eigenes
  Namensmuster, `BACKUP_KEEP` fasst die Bilder nicht an und umgekehrt.

**Porträts sind mit umgezogen.** Beim ersten Start nach dem Update kopiert der
Server jedes Porträt aus `char_portraits` in die Bilddatenbank und schreibt eine
Zeile ins Journal. **Kopiert, nicht verschoben:** `char_portraits` bleibt
unangetastet stehen und dient weiter als Rückfallebene, falls die Bilddatenbank
fehlt oder ein Rücksprung auf einen älteren Stand nötig wird. Erst wenn eine
Ausgabe ohne Rücksprung vergangen ist, kann die alte Tabelle entfallen — bis
dahin nicht löschen. Der Lauf ist wiederholbar: er füllt nur Lücken.

```bash
journalctl -u helden-app | grep 'Porträt'
```

Derselbe wöchentliche Takt räumt außerdem verwaiste Bilder weg — solche, deren
Wiki-Seite oder Charakter gelöscht wurde. SQLite kann nicht über Dateigrenzen
kaskadieren, deshalb gibt es diesen Durchlauf zusätzlich zu den Lösch-Haken im
Code. Was er entfernt, steht im Journal:

```bash
journalctl -u helden-app | grep '\[assets\]'
```

**Wiederherstellen:**

```bash
sudo systemctl stop helden-app
sudo -u helden cp /srv/helden/backups/helden-2026-08-01.db /srv/helden/data/helden.db
sudo rm -f /srv/helden/data/helden.db-wal /srv/helden/data/helden.db-shm
sudo systemctl start helden-app
```

### Auslagerung nach OneDrive (täglich 00:00)

Die lokalen Sicherungen liegen auf derselben Platte wie das Original und schützen
daher nicht gegen deren Ausfall. Ein systemd-Timer kopiert sie deshalb nachts per
rclone weg.

**Wer den Job ausführt, ist eine Sicherheitsentscheidung.** Er läuft als `jonas`,
nicht als `helden`: Der OneDrive-Remote ist nicht auf einen Unterordner beschränkt,
das OAuth-Token gilt also für das **gesamte** Laufwerk. In `/home/jonas` liegt es
außerhalb der Reichweite des Dienstes — dessen Unit setzt `ProtectHome=true`, er
kann `/home` nicht einmal sehen. Läge das Token unter `/srv/helden/`, hätte ein
kompromittierter, aus dem Internet erreichbarer Dienst Vollzugriff auf die Cloud.
Ein `root_folder_id` am Remote hülfe dagegen nicht: Es begrenzt, was rclone
adressiert, nicht den OAuth-Scope.

Damit `jonas` die Sicherungen lesen darf (`/srv/helden` ist `chmod 750`):

```bash
sudo usermod -aG helden jonas      # danach einmal neu anmelden
id                                 # muss "…(helden)" enthalten
```

Das Skript:

```bash
sudo tee /usr/local/bin/helden-backup-onedrive >/dev/null <<'EOF'
#!/bin/bash
# Tägliche Auslagerung der Heldenverwaltungs-Sicherungen nach OneDrive.
set -euo pipefail

QUELLE=/srv/helden/backups
ZIEL="onedrive:Backups/zeitenfall-helden"
CONFIG=/home/jonas/.config/rclone/rclone.conf

echo "→ $QUELLE  →  $ZIEL"

# copy statt sync: lokal räumt der Server nach BACKUP_KEEP Ständen auf, auf
# OneDrive soll die längere Historie erhalten bleiben — sync würde sie mitlöschen.
#
# Der Filter nimmt nur fertige Tagessicherungen mit: Ein abgebrochener Lauf
# hinterlässt "…​.db.part", das nicht auf ".db" endet, ebenso die "-wal"/"-shm".
# Das Muster fasst beide Reihen: helden-JJJJ-MM-TT.db (täglich) und
# helden-assets-JJJJ-MM-TT.db (wöchentlich, die Bilder).
rclone copy "$QUELLE" "$ZIEL" \
    --config "$CONFIG" \
    --include 'helden-*.db' \
    --transfers 2 \
    --retries 3 \
    --log-level INFO

# Ausdünnen: copy räumt nie auf, sonst wächst OneDrive ewig weiter. Ältere
# Tagesstände als 60 Tage fallen weg, der Erste jedes Monats bleibt als
# Langzeit-Historie stehen. Die Wochensicherungen der Bilder sind davon nicht
# betroffen — sie tragen ein anderes Präfix.
rclone delete "$ZIEL" \
    --config "$CONFIG" \
    --include 'helden-????-??-??.db' \
    --exclude 'helden-????-??-01.db' \
    --min-age 60d

ANZAHL=$(rclone lsf "$ZIEL" --config "$CONFIG" | wc -l)
echo "✓ Fertig — $ANZAHL Sicherung(en) liegen auf OneDrive"
EOF

sudo chmod 755 /usr/local/bin/helden-backup-onedrive
/usr/local/bin/helden-backup-onedrive          # einmal von Hand testen
```

Service und Timer:

```bash
sudo tee /etc/systemd/system/helden-backup-onedrive.service >/dev/null <<'EOF'
[Unit]
Description=Heldenverwaltung: Sicherungen nach OneDrive auslagern
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=jonas
SupplementaryGroups=helden
ExecStart=/usr/local/bin/helden-backup-onedrive
EOF

sudo tee /etc/systemd/system/helden-backup-onedrive.timer >/dev/null <<'EOF'
[Unit]
Description=Taegliche Auslagerung der Heldenverwaltungs-Sicherungen

[Timer]
OnCalendar=*-*-* 00:00:00 Europe/Berlin
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now helden-backup-onedrive.timer
sudo systemctl start helden-backup-onedrive.service    # Testlauf unter systemd
sudo journalctl -u helden-backup-onedrive -n 20 --no-pager
```

Drei Details, die den Unterschied machen:

- **Zeitzone in der Unit statt im System.** Der Server läuft auf `Etc/UTC`; ein
  blankes `00:00:00` fiele auf 2 Uhr deutscher Sommerzeit. Mit dem Suffix
  `Europe/Berlin` stimmt es ganzjährig, die Zeitumstellung inbegriffen. In
  `list-timers` steht `NEXT` dann in UTC — im Sommer also `22:00`, das ist richtig.
- **`Persistent=true`** holt einen verpassten Lauf beim nächsten Start nach. Bei
  einer Maschine, die schon einmal monatelang stand, ist das der halbe Nutzen.
- **Der Testlauf über `systemctl start`** ist nicht dasselbe wie ein Aufruf in der
  eigenen Shell: systemd startet ohne Anmelde-Umgebung, unter `User=` und den
  zugewiesenen Gruppen. Erst wenn er dort läuft, läuft er auch nachts.

> **Auf OneDrive liegt die Sicherung unverschlüsselt** — inklusive der Porträts, die
> als BLOB in der Datenbank stecken. Wer das nicht will, legt einen
> `crypt`-Remote über den OneDrive-Remote und trägt ihn als `ZIEL` ein. Dann gehört
> die Ausgabe von `rclone config show <crypt-remote>` zwingend in einen
> Passwortmanager **außerhalb des Servers**: Der Schlüssel läge sonst auf genau der
> Platte, gegen deren Ausfall die Sicherung schützen soll.

## Fehlersuche

| Symptom | Ursache und Abhilfe |
|---|---|
| `npm ci` bricht mit `EBADENGINE` ab | Falsches Node im `PATH`. Der Befehl braucht `env PATH=/opt/node22/bin:…` davor. |
| Dienst startet nicht, `journalctl` zeigt `invalid ELF header` | `node_modules` von Windows mitkopiert. Ordner löschen, `npm ci` auf dem Server neu. |
| Anmeldung schlägt fehl, Cookie kommt nicht an | `SECURE_COOKIES=1` bei Zugriff über **`http://`**. Entweder HTTPS nutzen oder die Variable für lokale Tests entfernen. |
| Porträt-Upload endet mit 413 | `client_max_body_size` im Server-Block fehlt. |
| Weiße Seite, API antwortet aber | `client/dist` fehlt — `npm run build` im aktiven Release nachholen. |
| Nach IP-Wechsel nicht mehr erreichbar | DuckDNS-Aktualisierung prüfen (Router-DDNS oder eigener Timer). |
| `429` beim Anmelden | Ratenbegrenzung greift: 5 Versuche pro Minute und IP. Kurz warten. |

Laufende Beobachtung:

```bash
journalctl -u helden-app -f                       # Live-Log
systemctl status helden-app --no-pager            # Zustand, Speicher, Laufzeit
du -h /srv/helden/data/helden.db                  # Größe der Datenbank
```

## Offene Punkte für später
- **Eigene Domain** statt DuckDNS: A-Record auf die IP, `server_name` anpassen,
  `certbot --nginx -d neue.domain` erneut laufen lassen. Sonst ändert sich nichts.
- **Erreichbare Ports prüfen** — der Server hört auf `0.0.0.0` unter anderem auf
  6052, 8000, 8080, 10200 und 10300 (allesamt Docker-Container). Da Docker die
  `ufw`-Regeln umgeht, entscheidet allein die Portfreigabe des Routers darüber,
  ob sie aus dem Internet erreichbar sind. Paperless und Nextcloud werden ohnehin
  über `127.0.0.1` von Nginx angesprochen — eine Bindung `127.0.0.1:8080->80`
  statt `8080->80` in der jeweiligen Compose-Datei nähme sie folgenlos aus dem Netz.

- **Die App bindet an alle Schnittstellen** — `app.listen(port, …)` in
  `server/src/index.ts` bekommt keine Adresse, Node bindet daher an `0.0.0.0`
  bzw. `::`. Im LAN ist der Server also direkt unter `http://<ip>:3001` erreichbar,
  an Nginx und TLS vorbei. Anmelden lässt sich dort niemand (das `Secure`-Cookie
  greift über `http://` nicht), und der Router leitet den Port nicht weiter — sauber
  wäre es trotzdem. Einzeiler dafür: `const host = process.env.HOST ?? '0.0.0.0';`
  und `app.listen(port, host, …)`, dann `HOST=127.0.0.1` in `/etc/helden-app.env`.

- **`jonasvanhagen.duckdns.org` wird nicht gepflegt** — der DuckDNS-Container
  kennt diesen Namen nicht (Stand: nur `familievanhagen` und `zeitenfall`). Er
  zeigt derzeit auf die richtige Adresse, verwaist aber beim nächsten IP-Wechsel.
  Entweder mit in die `SUBDOMAINS` aufnehmen oder bewusst aufgeben.
