// Downscaling in the browser, before anything is sent.
//
// Same trick as the character portrait, and for the same reason: a phone photo
// is four megabytes of detail nobody will ever look at on a wiki page. Shrinking
// it here means no image library on the server, a smaller helden-assets.db, and
// an upload that fits comfortably under the 3 MB body limit.
//
// Unlike the portrait this does NOT crop: a map, a coat of arms and a sketch
// have no common aspect ratio, so only the long edge is capped.

const MAX_KANTE = 1600;
const QUALITAET = 0.85;

export interface SkaliertesBild {
  blob: Blob;
  breite: number;
  hoehe: number;
}

export function skaliereBild(file: File): Promise<SkaliertesBild> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: bw, naturalHeight: bh } = img;
      if (!bw || !bh) {
        reject(new Error('Bild konnte nicht gelesen werden'));
        return;
      }
      // Kleine Bilder werden NICHT vergrößert — Hochskalieren erfindet nur
      // Pixel und macht die Datei größer, ohne dass man mehr sieht.
      const faktor = Math.min(1, MAX_KANTE / Math.max(bw, bh));
      const breite = Math.round(bw * faktor);
      const hoehe = Math.round(bh * faktor);

      const canvas = document.createElement('canvas');
      canvas.width = breite;
      canvas.height = hoehe;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas nicht verfügbar'));
        return;
      }
      ctx.drawImage(img, 0, 0, breite, hoehe);
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, breite, hoehe }) : reject(new Error('Bild konnte nicht erzeugt werden'))),
        'image/jpeg',
        QUALITAET,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kein gültiges Bild'));
    };
    img.src = url;
  });
}

/** Raw PUT, like the portrait route: the body IS the image. */
export async function ladeBildHoch(
  slug: string,
  bild: SkaliertesBild,
  titel: string,
  nurSl: boolean,
): Promise<string> {
  const p = new URLSearchParams({ titel });
  if (nurSl) p.set('nurSl', '1');
  const res = await fetch(`/api/wiki/seiten/${encodeURIComponent(slug)}/bilder?${p}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bild.blob,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const koerper = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(koerper.error ?? 'Hochladen fehlgeschlagen');
  }
  const daten = (await res.json()) as { slug: string };
  return daten.slug;
}
