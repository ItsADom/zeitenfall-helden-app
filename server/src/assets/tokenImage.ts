// A character's own token image for the virtual table — separate from the
// sheet portrait (see TODO.md "VTT token appearance" concept notes): a
// player's HeroForge top-down miniature render doesn't necessarily match
// what they use as their sheet portrait, so this is its own upload/slot
// rather than reusing `portraits.ts`'s ROLLE. Single size only, unlike the
// portrait's display/full/original trio — a token is always shown small, no
// enlarge view exists for it.
import { einzelAsset, loescheEinzelAsset, setzeEinzelAsset } from './store.js';

const ROLLE = 'token-image';

export interface MarkenBildDaten {
  mime: string;
  data: Buffer;
}

export function hatMarkenBild(charId: number): boolean {
  return !!einzelAsset('character', charId, ROLLE);
}

export function ladeMarkenBild(charId: number): MarkenBildDaten | undefined {
  const asset = einzelAsset('character', charId, ROLLE);
  return asset ? { mime: asset.mime, data: asset.data } : undefined;
}

export function speichereMarkenBild(charId: number, mime: string, data: Buffer): void {
  setzeEinzelAsset(ROLLE, { ownerType: 'character', ownerId: charId, titel: `Marken-Bild ${charId}`, mime, data });
}

export function loescheMarkenBild(charId: number): void {
  loescheEinzelAsset('character', charId, ROLLE);
}
