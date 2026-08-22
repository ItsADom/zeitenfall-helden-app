# Betriebsdateien für den Server

Was hier liegt, gehört nicht in die Anwendung, sondern auf die Maschine, die sie
betreibt: das Deploy-Skript und die Kette, über die ein angemeldeter Admin aus
der Weboberfläche heraus einen Deploy auslösen kann.

Diese Dateien werden **nicht** durch einen Deploy verteilt. Der packt ein
`git archive` aus und fasst `/etc` und `/usr/local/bin` nie an. Wer sie
aktualisiert, ruft `install.sh` auf — sonst laufen Repo und Maschine
auseinander, ohne dass es jemandem auffällt.

Sprache ist hier Deutsch, wie in `DEPLOYMENT.md`, weil beide dasselbe Publikum
haben: die Person, die vor dem Server sitzt.

## Was die Dateien tun

| Datei | Ziel auf dem Server | Zweck |
|---|---|---|
| `helden-deploy` | `/usr/local/bin/` | Rollt einen Branch aus. Kennt `prod` und `dev`. Das Arbeitspferd, auch für die nächtliche Kette. |
| `helden-deploy-trigger` | `/usr/local/bin/` | Läuft als root, nimmt die Anforderung der App entgegen und ruft `helden-deploy` auf. |
| `systemd/helden-deploy-trigger@.path` | `/etc/systemd/system/` | Horcht auf die Anforderungsdatei. Eine Vorlage für beide Instanzen. |
| `systemd/helden-deploy-trigger@.service` | `/etc/systemd/system/` | Was passiert, wenn sie auftaucht. |
| `install.sh` | — | Legt alles davon an. Mehrfach aufrufbar. |

Der Hintergrund — warum es diesen Umweg über eine Datei gibt und nicht einfach
`sudo` — steht in [`docs/concepts/admin-triggered-redeploy.md`](../docs/concepts/admin-triggered-redeploy.md).
Die Kurzfassung: `helden-app.service` läuft mit `NoNewPrivileges=true`, und
damit ist das setuid-Bit von `sudo` für diesen Prozess wirkungslos. Ein
`sudoers`-Eintrag würde schlicht nicht greifen.

## Voraussetzungen

`install.sh` setzt einen Server voraus, auf dem die Heldenverwaltung bereits
läuft — also alles, was `DEPLOYMENT.md` beschreibt. Konkret geprüft wird:

- die Dienstnutzer `helden` und `heldendev`
- die Verzeichnisse `/srv/helden` und `/srv/helden-dev`
- die Units `helden-app.service` und `helden-app-dev.service`

Fehlt eines davon, bricht das Skript ab und sagt welches. Es baut **keinen**
Server auf; das bleibt Aufgabe von `DEPLOYMENT.md`.

## Einrichten

Auf dem Server, im ausgecheckten Repo (oder in einer hochgeladenen Kopie
dieses Verzeichnisses):

```bash
sudo ./scripts/install.sh
```

Das Skript legt die Steuerverzeichnisse an, installiert Skripte und Units,
ergänzt per Drop-in das nötige Schreibrecht und stellt die Path-Units scharf.
Eine vorhandene, abweichende Fassung von `helden-deploy` sichert es vorher als
`helden-deploy.bak`.

Es fasst dabei **keine laufende Anwendung** an und **ändert keine bestehende
Konfigurationsdatei**. Die beiden Schritte, die genau das täten, bleiben von
Hand — das Skript nennt sie zum Schluss noch einmal:

**1. Die Variable in beiden Umgebungsdateien ergänzen.** Ohne sie bietet die App
die Funktion gar nicht erst an (und das ist auch richtig so: auf einem
Entwicklungsrechner soll der Knopf nicht erscheinen).

```
# /etc/helden-app.env
HELDEN_DEPLOY_DIR=/srv/helden/deploy

# /etc/helden-app-dev.env
HELDEN_DEPLOY_DIR=/srv/helden-dev/deploy
```

**2. Beide Dienste neu starten**, damit das Schreibrecht aus dem Drop-in und die
Variable wirken:

```bash
sudo systemctl restart helden-app helden-app-dev
```

## Nachsehen, ob es steht

```bash
systemctl list-units 'helden-deploy-trigger@*' --all --no-pager
sudo ls -ld /srv/helden/deploy /srv/helden-dev/deploy
```

Erwartet: beide Path-Units `active (waiting)`, beide Verzeichnisse `drwxr-x---`
mit dem jeweiligen Dienstnutzer als Eigentümer.

Und die nächtliche Kette muss unverändert sein — `helden-deploy` wurde ja
ersetzt:

```bash
systemctl show helden-backup-onedrive.service -p ExecStartPost | tr ';' '\n' | grep -o '/usr/local/bin/helden-deploy [a-z]*'
```

Erwartet: `prod`, dann `dev`.

## Die Kette von Hand prüfen

Man braucht dafür keine App. Ein Zettel im Steuerverzeichnis reicht — genau das
tut die Anwendung später auch.

**Der harmlose Fall.** Steht die Instanz schon auf dem neuesten Commit, muss die
Kette zum Schluss „nichts zu tun" kommen und den Dienst **nicht** anfassen:

```bash
systemctl show helden-app-dev -p ActiveEnterTimestamp --value    # vorher merken
sudo -u heldendev tee /srv/helden-dev/deploy/anstoss.json >/dev/null <<'EOF'
{"user":"handtest","id":0,"zeit":0}
EOF
sleep 12
sudo cat /srv/helden-dev/deploy/status.json
journalctl -u helden-deploy-trigger@helden-dev.service -n 25 --no-pager
systemctl show helden-app-dev -p ActiveEnterTimestamp --value    # muss identisch sein
```

Erwartet: `{"phase":"aktuell",…}`, kein Neustart, `anstoss.json` verschwunden,
die Path-Unit wieder `active`.

**Der Fehlerfall.** Sperre halten und gleichzeitig anstoßen:

```bash
sudo sh -c 'flock /run/helden-deploy.lock sleep 25 &
sleep 1
runuser -u heldendev -- tee /srv/helden-dev/deploy/anstoss.json >/dev/null <<EOF
{"user":"handtest-sperre","id":0,"zeit":0}
EOF
sleep 10
cat /srv/helden-dev/deploy/status.json
cat /srv/helden-dev/deploy/fehler.txt
systemctl show helden-deploy-trigger@helden-dev.service -p Result --value
wait'
```

Erwartet: Phase `fehlgeschlagen`, ein lesbarer Satz in `fehler.txt`, und
`Result=success` — ein gescheiterter Deploy soll **keine** Unit in
`systemctl --failed` zurücklassen.

## Dinge, die sonst Zeit kosten

**`TimeoutStartSec=1800` in der Service-Vorlage ist keine Zierde.** `npm ci`
plus Vite-Build dauert Minuten, systemd räumt einem `oneshot` per Vorgabe aber
nur 90 Sekunden ein. Ohne die Zeile wird der Deploy mitten im Bau abgeschossen
und hinterlässt ein halb ausgepacktes Release.

**Zeilenenden.** Die Dateien hier sind über `.gitattributes` auf LF festgenagelt.
Auf einem Windows-Arbeitsplatz mit `core.autocrlf=true` würden sie beim nächsten
Auschecken auf CRLF umgestellt — und ein Shell-Skript mit CRLF stirbt auf dem
Server mit `bad interpreter: /bin/bash^M`. Wer die Dateien anders als über git
auf den Server bringt, prüft das lieber einmal nach.

**Der nächtliche Lauf bleibt unberührt.** `helden-deploy` meldet seinen
Fortschritt nur, wenn `HELDEN_DEPLOY_STATUS` gesetzt ist, und das setzt allein
`helden-deploy-trigger`. Ruft die Nachtkette das Skript direkt auf, verhält es
sich exakt wie vorher.

**`status.json` gehört root, nicht der App.** Das ist Absicht: die Anwendung
darf ihren eigenen Fortschritt lesen, aber nicht erfinden. Wer die Datei
„aufräumt" und ihr den Dienstnutzer gibt, gibt diese Eigenschaft auf.

## Rückbau

```bash
sudo systemctl disable --now helden-deploy-trigger@helden.path helden-deploy-trigger@helden-dev.path
sudo rm -f /etc/systemd/system/helden-deploy-trigger@.path /etc/systemd/system/helden-deploy-trigger@.service
sudo rm -f /etc/systemd/system/helden-app.service.d/deploy-trigger.conf
sudo rm -f /etc/systemd/system/helden-app-dev.service.d/deploy-trigger.conf
sudo systemctl daemon-reload
```

`HELDEN_DEPLOY_DIR` aus beiden Umgebungsdateien nehmen und die Dienste neu
starten; danach bietet die App die Funktion nicht mehr an. Die
Steuerverzeichnisse und `helden-deploy` selbst können stehen bleiben — Letzteres
wird von der nächtlichen Kette weiterhin gebraucht.
