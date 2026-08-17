// Wiki categories.
//
// Tags rather than a page tree: a tree forces one true home per page, and
// „Gareth" is a Stadt AND an Ort in Garetien AND a Schauplatz. Tags also need
// one table and one index instead of parent pointers, ordering, move UI and
// cycle prevention.
//
// Normalised here so the server can clean input and echo the cleaned value back
// — the same normalise-and-echo shape as normalizeTabOrder / normalizeWidths.
import { faltDeutsch } from './wikiSlug.js';
import { WIKI_LIMITS } from './wikiTypen.js';

export interface WikiTag {
  /** Spelling as entered — this is what gets shown. */
  tag: string;
  /** Folded, for comparison: „NPCs", „npcs" and „NPCS" are one category. */
  key: string;
}

export function wikiTagKey(tag: string): string {
  return faltDeutsch(tag).toLowerCase().trim();
}

/**
 * Accepts either an array or the comma-separated string the editor's field
 * produces. Trims, drops empties, deduplicates by folded key keeping the first
 * spelling, and caps both count and length.
 */
export function normalizeWikiTags(roh: unknown): WikiTag[] {
  const werte: unknown[] = Array.isArray(roh)
    ? roh
    : typeof roh === 'string'
      ? roh.split(',')
      : [];

  const out: WikiTag[] = [];
  const gesehen = new Set<string>();
  for (const wert of werte) {
    if (typeof wert !== 'string') continue;
    const tag = wert.trim().slice(0, WIKI_LIMITS.TAG_MAX);
    if (!tag) continue;
    const key = wikiTagKey(tag);
    if (!key || gesehen.has(key)) continue;
    gesehen.add(key);
    out.push({ tag, key });
    if (out.length >= WIKI_LIMITS.TAGS_MAX) break;
  }
  return out;
}

/** Back to the editor field's format. */
export function wikiTagsAlsText(tags: readonly WikiTag[]): string {
  return tags.map((t) => t.tag).join(', ');
}
