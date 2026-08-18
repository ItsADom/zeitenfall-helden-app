// Bildmaße aus den Bytes lesen.
//
// Gebraucht, weil sie sonst nirgends herkommen: Der Upload-Weg schickt nur
// Titel und Bytes, und die Bilderliste im Editor zeigte deshalb bei jedem Bild
// „0×0". Dem Client die Maße mitschicken zu lassen wäre der kürzere Weg und der
// schlechtere — der Seed lädt ohne Browser hoch, und geglaubte Zahlen wären
// ohnehin nur so verlässlich wie ihr Absender.
//
// Nur die Kopfdaten werden gelesen, nie das Bild dekodiert: das sind ein paar
// Dutzend Bytes und keine Bildbibliothek.

export interface Masse {
  breite: number;
  hoehe: number;
}

const KEINE: Masse = { breite: 0, hoehe: 0 };

/** PNG: IHDR ist immer der erste Block, Breite und Höhe stehen an fester Stelle. */
function png(d: Buffer): Masse {
  if (d.length < 24) return KEINE;
  return { breite: d.readUInt32BE(16), hoehe: d.readUInt32BE(20) };
}

/**
 * JPEG: durch die Marker laufen, bis ein SOF-Block kommt — der trägt die Maße.
 * Die Länge steht in jedem Block, also lässt sich jeder andere überspringen,
 * ohne zu wissen, was er bedeutet.
 */
function jpeg(d: Buffer): Masse {
  let i = 2; // hinter SOI
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) {
      i++; // Füllbyte oder Müll — vorsichtig weitertasten
      continue;
    }
    const marker = d[i + 1];
    // Start-of-Frame in allen Spielarten, außer den dreien, die keine sind
    // (DHT 0xC4, JPG 0xC8, DAC 0xCC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { breite: d.readUInt16BE(i + 7), hoehe: d.readUInt16BE(i + 5) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // Blöcke ohne Längenangabe
      continue;
    }
    const laenge = d.readUInt16BE(i + 2);
    if (laenge < 2) return KEINE;
    i += 2 + laenge;
  }
  return KEINE;
}

/** WebP in seinen drei Spielarten — jede legt die Maße woanders ab. */
function webp(d: Buffer): Masse {
  if (d.length < 30 || d.toString('ascii', 8, 12) !== 'WEBP') return KEINE;
  const art = d.toString('ascii', 12, 16);
  if (art === 'VP8X') {
    // 24 Bit, jeweils um eins vermindert.
    return { breite: (d.readUIntLE(24, 3) & 0xffffff) + 1, hoehe: (d.readUIntLE(27, 3) & 0xffffff) + 1 };
  }
  if (art === 'VP8 ') {
    return { breite: d.readUInt16LE(26) & 0x3fff, hoehe: d.readUInt16LE(28) & 0x3fff };
  }
  if (art === 'VP8L') {
    // 14 Bit Breite, 14 Bit Höhe, dicht gepackt hinter dem Signaturbyte.
    const bits = d.readUInt32LE(21);
    return { breite: (bits & 0x3fff) + 1, hoehe: ((bits >> 14) & 0x3fff) + 1 };
  }
  return KEINE;
}

/**
 * Maße eines Bildes, oder 0×0, wenn das Format nicht erkannt wird. Bewusst
 * ohne Ausnahme: ein unbekanntes Bild soll sich speichern lassen und nur ohne
 * Maßangabe dastehen — die ist Beiwerk, nicht Inhalt.
 */
export function bildMasse(data: Buffer, mime = ''): Masse {
  if (!Buffer.isBuffer(data) || data.length < 16) return KEINE;
  try {
    // Nach den Bytes entschieden, nicht nach dem gemeldeten Typ: der kommt aus
    // einem Header und kann schlicht falsch sein.
    if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return png(data);
    if (data[0] === 0xff && data[1] === 0xd8) return jpeg(data);
    if (data.toString('ascii', 0, 4) === 'RIFF') return webp(data);
    // Letzter Versuch über den gemeldeten Typ, falls die Signatur fehlt.
    if (mime.includes('png')) return png(data);
    if (mime.includes('jpeg') || mime.includes('jpg')) return jpeg(data);
    return KEINE;
  } catch {
    // Abgeschnittene Datei: lieber ohne Maße als ein Upload, der 500 wirft.
    return KEINE;
  }
}
