#!/bin/bash
# Install the operational files in this directory onto a server that already
# runs the Heldenverwaltung as described in DEPLOYMENT.md.
#
# Safe to run again at any time: every step either overwrites a file this
# script owns or is a no-op. It deliberately does NOT edit any existing
# configuration file and does NOT restart a running service — the two steps
# that need either are printed at the end for you to do by hand.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "install.sh muss als root laufen (sudo)" >&2; exit 1; }

HIER="$(cd "$(dirname "$0")" && pwd)"

# base directory : service user : application unit
INSTANZEN="helden:helden:helden-app.service helden-dev:heldendev:helden-app-dev.service"

echo "→ Voraussetzungen prüfen"
for eintrag in $INSTANZEN; do
    IFS=: read -r basis nutzer unit <<< "$eintrag"
    id "$nutzer" >/dev/null 2>&1 || { echo "✗ Dienstnutzer fehlt: $nutzer — erst DEPLOYMENT.md abarbeiten" >&2; exit 1; }
    [ -d "/srv/$basis" ]          || { echo "✗ Verzeichnis fehlt: /srv/$basis — erst DEPLOYMENT.md abarbeiten" >&2; exit 1; }
    systemctl cat "$unit" >/dev/null 2>&1 || { echo "✗ Unit fehlt: $unit — erst DEPLOYMENT.md abarbeiten" >&2; exit 1; }
done

echo "→ Deploy-Skripte nach /usr/local/bin"
# Keep one copy of whatever was there before. helden-deploy in particular is the
# script the nightly chain runs; a bad overwrite must stay undoable.
for skript in helden-deploy helden-deploy-trigger; do
    if [ -f "/usr/local/bin/$skript" ] && ! cmp -s "$HIER/$skript" "/usr/local/bin/$skript"; then
        cp -a "/usr/local/bin/$skript" "/usr/local/bin/$skript.bak"
        echo "  vorige Fassung gesichert: /usr/local/bin/$skript.bak"
    fi
    install -m 755 -o root -g root "$HIER/$skript" /usr/local/bin/
done

echo "→ systemd-Vorlagen nach /etc/systemd/system"
install -m 644 -o root -g root \
    "$HIER/systemd/helden-deploy-trigger@.path" \
    "$HIER/systemd/helden-deploy-trigger@.service" \
    /etc/systemd/system/

for eintrag in $INSTANZEN; do
    IFS=: read -r basis nutzer unit <<< "$eintrag"

    echo "→ [$basis] Steuerverzeichnis /srv/$basis/deploy"
    install -d -o "$nutzer" -g "$nutzer" -m 750 "/srv/$basis/deploy"

    echo "→ [$basis] Schreibrecht für $unit"
    install -d -m 755 "/etc/systemd/system/$unit.d"
    cat > "/etc/systemd/system/$unit.d/deploy-trigger.conf" <<EOF
# Angelegt von scripts/install.sh.
#
# ProtectSystem=strict macht alles schreibgeschützt, was nicht in ReadWritePaths
# steht — ohne diese Zeile könnte die App ihren Anstoß nicht hinterlegen. In
# einem Drop-in ergänzt ReadWritePaths die Liste der Unit, es ersetzt sie nicht.
[Service]
ReadWritePaths=/srv/$basis/deploy
EOF
done

echo "→ systemd neu einlesen und Path-Units scharfstellen"
systemctl daemon-reload
systemctl enable --now helden-deploy-trigger@helden.path helden-deploy-trigger@helden-dev.path

echo
echo "✓ Installiert. Zwei Schritte bleiben von Hand — sie fassen laufende Dienste an:"
echo
echo "  1. In /etc/helden-app.env ergänzen:      HELDEN_DEPLOY_DIR=/srv/helden/deploy"
echo "     In /etc/helden-app-dev.env ergänzen:  HELDEN_DEPLOY_DIR=/srv/helden-dev/deploy"
echo
echo "  2. Beide Dienste neu starten, damit Schreibrecht und Variable greifen:"
echo "     systemctl restart helden-app helden-app-dev"
echo
echo "Danach prüfen:  systemctl list-units 'helden-deploy-trigger@*' --all"
