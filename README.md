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

## Charakter aus Excel importieren

```bash
npm run import -- pfad/zu/Charakter.xlsx --owner <benutzername> --group <gruppenname>
```

- Fehlende Benutzer/Gruppen werden angelegt (Passwort wird ausgegeben).
- Der Importer prüft alle berechneten Zellen des Blatts gegen die Regelwerk-Engine
  und meldet Abweichungen („ABWEICHUNG …").

## Rollen & Rechte

- **Spielleiter** (`is_gm`): sieht und bearbeitet alles; legt Benutzer, Gruppen und Charaktere an.
- **Besitzer**: bearbeitet die eigenen Charaktere vollständig, steuert im Tab „Sichtbarkeit",
  welche Bereiche Gruppenmitglieder sehen.
- **Gruppenmitglieder**: sehen die Personenbeschreibung (Alter, Größe …) immer,
  freigegebene Bereiche als schreibgeschützte Zusammenfassung.
- Alle anderen: kein Zugriff (404).

## Bekannte Abweichungen zum Excel-Blatt

Der Import von Raskir.xlsx meldet zwei bewusste Abweichungen:

1. **Waffen!V7** (Drachenturmschild, Blocken-Probe): Die Blatt-Formel verwendet versehentlich
   das *Parade*-Ergebnis (9) statt des Blocken-Ergebnisses (20). Die App rechnet kanonisch
   mit dem Blocken-Ergebnis (40 statt 29).
2. **Waffen!T9** (Sühne, Angriffs-Probe): Im Blatt manuell auf 10 gesetzt (Nachteil
   „Schildträger: AT ist immer maximal 10"). Die App zeigt den ungedeckelten Wert (25);
   der Deckel steht als Nachteil im Heldenbrief.

## Tests

```bash
npm test    # Regelwerk-Engine gegen bekannte Werte aus Raskir.xlsx
```
