// Einmalige Katalog-Extraktion: schreibt server/data/talents.json und languages.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readXlsx } from './xlsx.js';
import { extractLanguages, extractTalentCatalog } from './extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, '..', '..', '..', 'Raskir.xlsx');
const outDir = path.join(here, '..', '..', 'server', 'data');
fs.mkdirSync(outDir, { recursive: true });

const wb = readXlsx(file);
const talente = wb.get('Talente');
const sprachen = wb.get('Sprachen');
if (!talente || !sprachen) throw new Error('Blätter "Talente"/"Sprachen" nicht gefunden');

const talents = extractTalentCatalog(talente);
const languages = extractLanguages(sprachen).catalog;

fs.writeFileSync(path.join(outDir, 'talents.json'), JSON.stringify(talents, null, 2));
fs.writeFileSync(path.join(outDir, 'languages.json'), JSON.stringify(languages, null, 2));
console.log(`Talente: ${talents.length} Einträge, Sprachen/Schriften: ${languages.length} Einträge`);
for (const kat of ['kampf', 'koerper', 'gesellschaft', 'natur', 'wissen', 'handwerk', 'gaben']) {
  console.log(`  ${kat}: ${talents.filter((t) => t.kategorie === kat).length}`);
}
