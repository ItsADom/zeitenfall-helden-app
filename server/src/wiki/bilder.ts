// Wiki images: who may fetch which picture, and the wiki's half of the
// cross-database bookkeeping.
//
// The store in assets/ knows nothing about visibility — it stores bytes under
// an owner. The rule lives here, because it is a wiki rule:
//
//   an image is readable if its page is readable, AND it is not flagged
//   „nur Spielleiter" (or the reader is the GM).
//
// Two layers, on purpose. The flag covers a picture that belongs inside a
// ```gm section; the page check covers everything on a GM-only page. On top of
// both, an image slug carries six random characters, so the address cannot be
// derived from the title — the URL is a capability, handed only to somebody
// who was already allowed to receive the page it sits on.
import { ladeAsset, legeAssetAn, loescheAsset, assetsFuer, setzeAssetGmOnly } from '../assets/store.js';
import type { AssetDaten, AssetInfo } from '../assets/store.js';
import type { WikiLeser, WikiSeiteRow } from './zugriff.js';
import { seiteFuerId } from './zugriff.js';

/** Metadata for one page's images. The bytes stay where they are. */
export function bilderFuerSeite(seite: WikiSeiteRow): AssetInfo[] {
  return assetsFuer('wiki', seite.id);
}

/**
 * The image this reader may fetch under `slug`, or null → 404. Never 403: the
 * same rule as everywhere else in the wiki, „not yours" and „does not exist"
 * must be indistinguishable.
 */
export function bildFuer(user: WikiLeser, slug: string): AssetDaten | null {
  const asset = ladeAsset(slug);
  if (!asset || asset.ownerType !== 'wiki') return null;
  if (asset.gmOnly && !user.isGm) return null;
  // The owning page decides the rest — including soft deletion, so a picture
  // does not outlive the page it belongs to.
  if (!seiteFuerId(user, asset.ownerId)) return null;
  return asset;
}

export interface BildEingabe {
  titel: string;
  mime: string;
  data: Buffer;
  gmOnly: boolean;
  hochgeladenVon: { id: number; name: string };
}

export function legeBildAn(seite: WikiSeiteRow, eingabe: BildEingabe): string | null {
  return legeAssetAn({
    ownerType: 'wiki',
    ownerId: seite.id,
    titel: eingabe.titel,
    mime: eingabe.mime,
    data: eingabe.data,
    gmOnly: eingabe.gmOnly,
    uploaderUserId: eingabe.hochgeladenVon.id,
    uploaderName: eingabe.hochgeladenVon.name,
  });
}

/** Deleting an image is only allowed from the page that owns it. */
export function loescheBild(seite: WikiSeiteRow, slug: string): boolean {
  const asset = ladeAsset(slug);
  if (!asset || asset.ownerType !== 'wiki' || asset.ownerId !== seite.id) return false;
  return loescheAsset(slug);
}

export function markiereBildGmOnly(seite: WikiSeiteRow, slug: string, gmOnly: boolean): boolean {
  const asset = ladeAsset(slug);
  if (!asset || asset.ownerType !== 'wiki' || asset.ownerId !== seite.id) return false;
  return setzeAssetGmOnly(slug, gmOnly);
}
