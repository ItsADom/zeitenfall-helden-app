// Minimaler XLSX-Leser (Zip + SpreadsheetML) ohne Abhängigkeiten.
// Liest Zellwerte (berechnete Werte) und Formeln.
import fs from 'node:fs';
import zlib from 'node:zlib';

export interface Cell {
  v: string;
  f?: string;
}
export type Sheet = Map<string, Cell>;

function readZip(file: string): Map<string, Buffer> {
  const buf = fs.readFileSync(file);
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Keine gültige XLSX-Datei (Zip-Ende nicht gefunden)');
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const entries = new Map<string, Buffer>();
  for (let e = 0; e < count; e++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
    out.push(decodeXml(texts.join('')));
  }
  return out;
}

function parseSheet(xml: string, sharedStrings: string[]): Sheet {
  const sheet: Sheet = new Map();
  for (const cm of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cm[1];
    const inner = cm[2] ?? '';
    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const type = /t="(\w+)"/.exec(attrs)?.[1];
    const fM = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner);
    const hasF = fM || /<f[^>]*\/>/.test(inner);
    const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
    let v = vM ? vM[1] : '';
    if (type === 's' && vM) v = sharedStrings[parseInt(v, 10)] ?? '';
    else v = decodeXml(v);
    if (v === '' && !hasF) continue;
    const cell: Cell = { v };
    if (fM) cell.f = decodeXml(fM[1]);
    else if (hasF) cell.f = '(shared)';
    sheet.set(ref, cell);
  }
  return sheet;
}

// Zellkommentare eines Blatts: ref -> Text (Autor-Präfix wie "Olaf:" entfernt)
function parseComments(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<comment ref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
    const texts = [...m[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    let text = texts.join('').trim();
    text = text.replace(/^[^\n:]{1,40}:\s*\n/, '').trim();
    if (text) out.set(m[1], text);
  }
  return out;
}

export interface Workbook {
  sheets: Map<string, Sheet>;
  comments: Map<string, Map<string, string>>; // Blattname -> (ref -> Kommentar)
}

export function readXlsxFull(file: string): Workbook {
  const zip = readZip(file);
  const sharedStrings = parseSharedStrings(zip.get('xl/sharedStrings.xml')?.toString('utf8') ?? '');
  const workbookXml = zip.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const relsXml = zip.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship ([^>]+)>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relTargets.set(id, target);
  }
  const sheets = new Map<string, Sheet>();
  const comments = new Map<string, Map<string, string>>();
  for (const m of workbookXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relTargets.get(m[2]);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = zip.get(path)?.toString('utf8');
    if (!xml) continue;
    const name = decodeXml(m[1]);
    sheets.set(name, parseSheet(xml, sharedStrings));
    // Kommentare über die Blatt-Beziehungen auflösen (xl/worksheets/_rels/sheetN.xml.rels)
    const base = path.split('/').pop()!;
    const sheetRels = zip.get(`xl/worksheets/_rels/${base}.rels`)?.toString('utf8');
    if (sheetRels) {
      const cm = /Target="([^"]*comments\d*\.xml)"/.exec(sheetRels);
      if (cm) {
        const commentPath = cm[1].replace(/^\.\.\//, 'xl/');
        const commentXml = zip.get(commentPath)?.toString('utf8');
        if (commentXml) comments.set(name, parseComments(commentXml));
      }
    }
  }
  return { sheets, comments };
}

export function readXlsx(file: string): Map<string, Sheet> {
  return readXlsxFull(file).sheets;
}

// --- Zugriffshelfer ---

export function cellStr(sheet: Sheet | undefined, ref: string): string {
  return sheet?.get(ref)?.v?.trim() ?? '';
}

export function cellNum(sheet: Sheet | undefined, ref: string): number {
  const v = cellStr(sheet, ref).replace(',', '.');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function cellFormula(sheet: Sheet | undefined, ref: string): string | undefined {
  return sheet?.get(ref)?.f;
}

export function rowHasAny(sheet: Sheet, row: number, cols: string[]): boolean {
  return cols.some((c) => cellStr(sheet, `${c}${row}`) !== '');
}
