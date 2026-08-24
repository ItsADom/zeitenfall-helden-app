// Bettet die Kacheltexturen aus client/public/tiles/ als Data-URI in
// Texturen.html ein und schreibt die Datei an Ort und Stelle zurück.
//
// Warum überhaupt: Die Seite lief zuerst über relative Pfade auf die echten
// Dateien. Das funktioniert nur, solange man die HTML direkt von der Platte
// öffnet — eine Vorschau, die die Seite als Schnappschuss lädt, und eine
// veröffentlichte Fassung haben keine Nachbardateien. Sichtbar wurde das
// daran, dass nur Wasser erschien: das einzige Material, das erzeugt und
// nicht geladen wird.
//
// Aufruf:  node einbetten.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const ziel = path.join(hier, 'Texturen.html');
const kacheln = path.resolve(hier, '../../../client/public/tiles');

const daten = {};
for (const f of fs.readdirSync(kacheln).filter((f) => f.endsWith('.jpg')).sort()) {
  daten[f] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(kacheln, f)).toString('base64');
}

const ANFANG = '/* TEXTUREN:ANFANG';
const ENDE = '/* TEXTUREN:ENDE */';
const html = fs.readFileSync(ziel, 'utf8');
const a = html.indexOf(ANFANG);
const e = html.indexOf(ENDE);
if (a < 0 || e < 0) { console.error('Marker TEXTUREN:ANFANG/ENDE fehlen in Texturen.html'); process.exit(1); }

const block = ANFANG + ' — von einbetten.mjs erzeugt, nicht von Hand ändern */\n'
  + 'const TILE_DATA = ' + JSON.stringify(daten) + ';\n' + ENDE;

fs.writeFileSync(ziel, html.slice(0, a) + block + html.slice(e + ENDE.length));
const kb = (fs.statSync(ziel).size / 1024) | 0;
console.log(Object.keys(daten).length + ' Texturen eingebettet, Datei jetzt ' + kb + ' KB');
