// Der eigene Benachrichtigungston eines Nutzers, in helden-assets.db.
//
// Aufgebaut wie portraits.ts, nur kürzer: Töne haben keine Altlast, also keine
// Rückfalltabelle und keinen Umzug — es gab sie vorher schlicht nicht.
//
// Ein Ton je Konto, deshalb `setzeEinzelAsset` („genau eines in dieser Rolle")
// statt `legeAssetAn`. Der MIME-Typ steht hier fest und wird NICHT vom Aufrufer
// übernommen: die Bytes sind immer das, was wavEncode.ts im Browser erzeugt hat
// (16-Bit-PCM-Mono-WAV), und der Server liefert genau diesen Typ wieder aus.
import { einzelAsset, einzelAssetInfo, loescheEinzelAsset, setzeEinzelAsset, type OwnerTyp } from './store.js';

const BESITZER: OwnerTyp = 'user';
const ROLLE = 'chime';
const MIME = 'audio/wav';

export interface ChimeDaten {
  mime: string;
  data: Buffer;
}

export function ladeChime(userId: number): ChimeDaten | undefined {
  const asset = einzelAsset(BESITZER, userId, ROLLE);
  return asset ? { mime: asset.mime, data: asset.data } : undefined;
}

/**
 * „Gibt es einen, und wie groß ist er" — ohne die Bytes selbst zu laden.
 *
 * `einzelAsset` würde den ganzen Klang aus der Datenbank holen, nur um seine
 * Länge zu melden.
 */
export function chimeInfo(userId: number): { vorhanden: boolean; bytes: number } {
  const info = einzelAssetInfo(BESITZER, userId, ROLLE);
  return { vorhanden: !!info, bytes: info?.bytes ?? 0 };
}

/** true, wenn gespeichert wurde — false nur, wenn die Bilddatenbank fehlt. */
export function speichereChime(userId: number, data: Buffer): boolean {
  return (
    setzeEinzelAsset(ROLLE, {
      ownerType: BESITZER,
      ownerId: userId,
      titel: `Benachrichtigungston ${userId}`,
      mime: MIME,
      data,
    }) !== null
  );
}

export function loescheChime(userId: number): void {
  loescheEinzelAsset(BESITZER, userId, ROLLE);
}
