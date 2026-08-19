// Line diff between two revisions of a page.
//
// Plain LCS over a dynamic-programming table, not Myers. Myers is
// asymptotically better and materially harder to write correctly and to read;
// page bodies here are hundreds of lines, so the table costs microseconds.
// Optimise for whoever next has to convince themselves this is right.
//
// The +n/-m summary is computed once at save time and STORED on the revision,
// so the change log never has to diff anything to render a list.

export type DiffArt = 'gleich' | 'plus' | 'minus';

export interface DiffZeile {
  art: DiffArt;
  text: string;
  /** Line number in the old text; absent for an inserted line. */
  nrAlt?: number;
  /** Line number in the new text; absent for a deleted line. */
  nrNeu?: number;
}

/**
 * Beyond this many table cells the diff degrades to "everything replaced".
 * Cheap insurance against somebody pasting a novel into a page.
 */
const MAX_ZELLEN = 4_000_000;

interface RohZeile {
  art: DiffArt;
  text: string;
}

function lcsDiff(a: string[], b: string[]): RohZeile[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ art: 'plus' as const, text }));
  if (m === 0) return a.map((text) => ({ art: 'minus' as const, text }));

  // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  // Uint16Array is safe because both sides are capped at ZEILEN_MAX (5000).
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const out: RohZeile[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ art: 'gleich', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ art: 'minus', text: a[i] });
      i += 1;
    } else {
      out.push({ art: 'plus', text: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ art: 'minus', text: a[i++] });
  while (j < m) out.push({ art: 'plus', text: b[j++] });
  return out;
}

export function zeilenDiff(alt: string, neu: string): DiffZeile[] {
  const a = (alt ?? '').split('\n');
  const b = (neu ?? '').split('\n');

  // Trim the common head and tail first: a typo fix in a 400-line page collapses
  // to a handful of lines, which is the overwhelmingly common case.
  let kopf = 0;
  while (kopf < a.length && kopf < b.length && a[kopf] === b[kopf]) kopf += 1;
  let endeA = a.length;
  let endeB = b.length;
  while (endeA > kopf && endeB > kopf && a[endeA - 1] === b[endeB - 1]) {
    endeA -= 1;
    endeB -= 1;
  }

  const mitteA = a.slice(kopf, endeA);
  const mitteB = b.slice(kopf, endeB);
  const mitte: RohZeile[] =
    mitteA.length * mitteB.length > MAX_ZELLEN
      ? [
          ...mitteA.map((text) => ({ art: 'minus' as const, text })),
          ...mitteB.map((text) => ({ art: 'plus' as const, text })),
        ]
      : lcsDiff(mitteA, mitteB);

  const roh: RohZeile[] = [
    ...a.slice(0, kopf).map((text) => ({ art: 'gleich' as const, text })),
    ...mitte,
    ...a.slice(endeA).map((text) => ({ art: 'gleich' as const, text })),
  ];

  // Numbering in one final pass, so the three segments above stay simple.
  let nrAlt = 0;
  let nrNeu = 0;
  return roh.map((z) => {
    if (z.art === 'gleich') return { ...z, nrAlt: ++nrAlt, nrNeu: ++nrNeu };
    if (z.art === 'minus') return { ...z, nrAlt: ++nrAlt };
    return { ...z, nrNeu: ++nrNeu };
  });
}

export function diffZusammenfassung(zeilen: DiffZeile[]): { plus: number; minus: number } {
  let plus = 0;
  let minus = 0;
  for (const z of zeilen) {
    if (z.art === 'plus') plus += 1;
    else if (z.art === 'minus') minus += 1;
  }
  return { plus, minus };
}

/** Convenience for the save path, which only wants the two counts. */
export function zeilenBilanz(alt: string, neu: string): { plus: number; minus: number } {
  return diffZusammenfassung(zeilenDiff(alt, neu));
}

/**
 * Groups changed regions with `kontext` unchanged lines around them. Without
 * this, approving a one-word fix means scrolling past 400 identical lines.
 */
export function diffAbschnitte(zeilen: DiffZeile[], kontext = 3): DiffZeile[][] {
  const wichtig = zeilen.map((z) => z.art !== 'gleich');
  const behalten = zeilen.map((_, i) => {
    for (let d = -kontext; d <= kontext; d++) {
      if (wichtig[i + d]) return true;
    }
    return false;
  });

  const out: DiffZeile[][] = [];
  let aktuell: DiffZeile[] | null = null;
  for (let i = 0; i < zeilen.length; i++) {
    if (!behalten[i]) {
      aktuell = null;
      continue;
    }
    if (!aktuell) {
      aktuell = [];
      out.push(aktuell);
    }
    aktuell.push(zeilen[i]);
  }
  return out;
}
