// Extrahiert Talent- und Sprachkataloge sowie charakterspezifische Werte
// aus einem Arbeitsbuch im Raskir-Template.
import type { Sheet } from './xlsx.js';
import { cellStr, cellNum, rowHasAny } from './xlsx.js';

const ATTRS = new Set(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);

export interface CatalogTalent {
  kategorie: string;
  gruppe: string;
  name: string;
  klasse: string;
  probe: string; // "MU/GE/KK" oder ''
  ableiten: string;
  sort: number;
}

export interface TalentValues {
  name: string;
  kategorie: string;
  taw: number;
  at: number;
  pa: number;
  bl: number;
  billiger: string;
  spezialisierung: string;
  waffenmeister: string;
  berufsbonus: string;
  // Erwartete Werte aus dem Blatt für den Abgleich
  expectedProbeZahl: number | null;
}

function parseNameKlasse(raw: string): { name: string; klasse: string } {
  const m = /^(.*?)\s*\(([A-F])\)\s*$/.exec(raw.trim());
  if (m) return { name: m[1].trim(), klasse: m[2] };
  return { name: raw.trim(), klasse: '' };
}

function validProbe(raw: string): string {
  const parts = raw.split('/').map((p) => p.trim().toUpperCase());
  if (parts.length === 3 && parts.every((p) => ATTRS.has(p))) return parts.join('/');
  return '';
}

// Bereiche der Talentkategorien im Blatt "Talente"
const TALENT_RANGES: { kategorie: string; from: number; to: number; klasse: string }[] = [
  { kategorie: 'koerper', from: 67, to: 84, klasse: 'D' },
  { kategorie: 'gesellschaft', from: 88, to: 97, klasse: 'B' },
  { kategorie: 'natur', from: 101, to: 107, klasse: 'B' },
  { kategorie: 'wissen', from: 111, to: 134, klasse: 'B' },
  { kategorie: 'handwerk', from: 138, to: 184, klasse: 'B' },
  { kategorie: 'gaben', from: 188, to: 196, klasse: 'F' },
];

const KAMPF_FROM = 7;
const KAMPF_TO = 62;

export function extractTalentCatalog(talente: Sheet): CatalogTalent[] {
  const out: CatalogTalent[] = [];
  let sort = 0;
  let gruppe = '';
  for (let r = KAMPF_FROM; r <= KAMPF_TO; r++) {
    const a = cellStr(talente, `A${r}`);
    if (!a) continue;
    const isTalent = rowHasAny(talente, r, ['C', 'E', 'F', 'G', 'H', 'I', 'K', 'M']);
    if (!isTalent) {
      gruppe = a;
      continue;
    }
    const { name, klasse } = parseNameKlasse(a);
    out.push({ kategorie: 'kampf', gruppe, name, klasse, probe: '', ableiten: cellStr(talente, `M${r}`), sort: sort++ });
  }
  for (const range of TALENT_RANGES) {
    for (let r = range.from; r <= range.to; r++) {
      const a = cellStr(talente, `A${r}`);
      if (!a) continue;
      const { name, klasse } = parseNameKlasse(a);
      out.push({
        kategorie: range.kategorie,
        gruppe: '',
        name,
        klasse: klasse || range.klasse,
        probe: validProbe(cellStr(talente, `C${r}`)),
        ableiten: cellStr(talente, `N${r}`),
        sort: sort++,
      });
    }
  }
  // Ritualkenntnis (I188-191) und Liturgiekenntnis (M188-189)
  for (let r = 188; r <= 191; r++) {
    const name = cellStr(talente, `I${r}`);
    if (name) out.push({ kategorie: 'gaben', gruppe: 'Ritualkenntnis', name, klasse: '', probe: '', ableiten: '', sort: sort++ });
  }
  for (let r = 188; r <= 189; r++) {
    const name = cellStr(talente, `M${r}`);
    if (name) {
      out.push({
        kategorie: 'gaben',
        gruppe: 'Liturgiekenntnis',
        name,
        klasse: '',
        probe: validProbe(cellStr(talente, `N${r}`)),
        ableiten: '',
        sort: sort++,
      });
    }
  }
  return out;
}

export function extractTalentValues(talente: Sheet): TalentValues[] {
  const out: TalentValues[] = [];
  let gruppe = '';
  for (let r = KAMPF_FROM; r <= KAMPF_TO; r++) {
    const a = cellStr(talente, `A${r}`);
    if (!a) continue;
    if (!rowHasAny(talente, r, ['C', 'E', 'F', 'G', 'H', 'I', 'K', 'M'])) {
      gruppe = a;
      continue;
    }
    const { name } = parseNameKlasse(a);
    const taw = cellNum(talente, `C${r}`);
    const at = cellNum(talente, `E${r}`);
    const pa = cellNum(talente, `F${r}`);
    const bl = cellNum(talente, `G${r}`);
    const billiger = cellStr(talente, `H${r}`);
    const spez = cellStr(talente, `I${r}`);
    const wm = cellStr(talente, `K${r}`);
    if (taw || at || pa || bl || billiger || spez || wm) {
      out.push({
        name,
        kategorie: 'kampf',
        taw,
        at,
        pa,
        bl,
        billiger,
        spezialisierung: spez,
        waffenmeister: wm,
        berufsbonus: '',
        expectedProbeZahl: null,
      });
    }
  }
  for (const range of TALENT_RANGES) {
    for (let r = range.from; r <= range.to; r++) {
      const a = cellStr(talente, `A${r}`);
      if (!a) continue;
      const { name } = parseNameKlasse(a);
      const taw = cellNum(talente, `E${r}`);
      const spez = cellStr(talente, `H${r}`);
      const beruf = cellStr(talente, `J${r}`);
      if (taw || spez || beruf) {
        out.push({
          name,
          kategorie: range.kategorie,
          taw,
          at: 0,
          pa: 0,
          bl: 0,
          billiger: '',
          spezialisierung: spez,
          waffenmeister: '',
          berufsbonus: beruf,
          expectedProbeZahl: cellStr(talente, `D${r}`) !== '' ? cellNum(talente, `D${r}`) : null,
        });
      }
    }
  }
  // RkW / LkW
  for (let r = 188; r <= 191; r++) {
    const name = cellStr(talente, `I${r}`);
    const taw = cellNum(talente, `K${r}`);
    if (name && taw) {
      out.push({ name, kategorie: 'gaben', taw, at: 0, pa: 0, bl: 0, billiger: '', spezialisierung: '', waffenmeister: '', berufsbonus: '', expectedProbeZahl: null });
    }
  }
  for (let r = 188; r <= 189; r++) {
    const name = cellStr(talente, `M${r}`);
    const taw = cellNum(talente, `O${r}`);
    if (name && taw) {
      out.push({ name, kategorie: 'gaben', taw, at: 0, pa: 0, bl: 0, billiger: '', spezialisierung: '', waffenmeister: '', berufsbonus: '', expectedProbeZahl: null });
    }
  }
  return out;
}

// --- Sprachen ---

export interface CatalogLanguage {
  kind: 'sprache' | 'schrift';
  familie: string;
  name: string;
  komplexitaet: string;
  sort: number;
}

export interface LanguageValue {
  kind: 'sprache' | 'schrift';
  familie: string;
  name: string;
  taw: number;
  muttersprache: boolean;
}

const SPRACHEN_FROM = 7;
const SPRACHEN_TO = 70;

export function extractLanguages(sprachen: Sheet): { catalog: CatalogLanguage[]; values: LanguageValue[] } {
  const catalog: CatalogLanguage[] = [];
  const values: LanguageValue[] = [];
  const scriptSeen = new Set<string>();
  let familie = '';
  let sort = 0;
  for (let r = SPRACHEN_FROM; r <= SPRACHEN_TO; r++) {
    const a = cellStr(sprachen, `A${r}`);
    const h = cellStr(sprachen, `H${r}`);
    const iTaw = cellNum(sprachen, `I${r}`);
    const j = cellStr(sprachen, `J${r}`);
    const o = cellStr(sprachen, `O${r}`);
    const qTaw = cellNum(sprachen, `Q${r}`);
    const g = cellStr(sprachen, `G${r}`);

    const isHeader = a !== '' && h === '' && j === '' && !iTaw && !qTaw && o === '';
    if (isHeader) {
      familie = a;
      continue;
    }
    if (familie === 'Geheimschriften') {
      // Hier: A = Schriftname, J = Komplexität
      if (a && !scriptSeen.has(a)) {
        scriptSeen.add(a);
        catalog.push({ kind: 'schrift', familie, name: a, komplexitaet: j, sort: sort++ });
      }
      continue;
    }
    if (a) {
      catalog.push({ kind: 'sprache', familie, name: a, komplexitaet: h, sort: sort++ });
      if (iTaw || g.toUpperCase() === 'X') {
        values.push({ kind: 'sprache', familie, name: a, taw: iTaw, muttersprache: g.toUpperCase() === 'X' });
      }
    }
    if (j && !scriptSeen.has(j)) {
      scriptSeen.add(j);
      catalog.push({ kind: 'schrift', familie: 'Schriften', name: j, komplexitaet: o, sort: 1000 + sort++ });
    }
    if (j && qTaw) {
      const existing = values.find((v) => v.kind === 'schrift' && v.name === j);
      if (!existing) values.push({ kind: 'schrift', familie: 'Schriften', name: j, taw: qTaw, muttersprache: false });
    }
  }
  return { catalog, values };
}
