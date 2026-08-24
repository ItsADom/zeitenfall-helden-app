// Baut Tisch.html: den Seitenrahmen-Prototyp (Phase 4) aus einer Vorlage plus
// den bereits eingebetteten Texturen aus Texturen.html. Getrennt gehalten,
// weil die Texturdaten (289 KB) nicht von Hand in eine Vorlage gehören.
//
// Aufruf: node tisch-bauen.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const hier = path.dirname(fileURLToPath(import.meta.url));

const texturenSrc = fs.readFileSync(path.join(hier, 'Texturen.html'), 'utf8');
const a = texturenSrc.indexOf('const TILE_DATA = {');
const b = texturenSrc.indexOf('};', a) + 1;
const tileDataJs = texturenSrc.slice(a, b);

const vorlage = fs.readFileSync(path.join(hier, 'tisch-vorlage.html'), 'utf8');
const out = vorlage.replace('/* TEXTUREN:EINFUEGEN */', tileDataJs);

fs.writeFileSync(path.join(hier, 'Tisch.html'), out);
console.log('Tisch.html geschrieben, ' + ((out.length / 1024) | 0) + ' KB');
