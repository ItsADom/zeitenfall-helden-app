// Bilder für den Wiki-Demo-Seed, im Code gezeichnet statt als Datei beigelegt.
//
// Der Grund ist derselbe, aus dem es serverseitig keine Bildbibliothek gibt:
// eine Handvoll Beispielbilder ist es nicht wert, Binärdateien ins Repository
// zu legen, die niemand mehr wiedererkennt und die bei jedem Klon mitkommen.
// PNG lässt sich ohne Hilfsmittel schreiben — Signatur, drei Blöcke, fertig —
// und `zlib` liegt in Node ohnehin bereit.
//
// Bewusst flächige, kräftige Formen: Diese Bilder müssen als 180 Pixel breites
// „klein" noch etwas darstellen, sie müssen nicht schön sein.
import { deflateSync } from 'node:zlib';

type Farbe = readonly [number, number, number];

// --- PNG ---

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(typ: string, daten: Buffer): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const inhalt = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(inhalt));
  return Buffer.concat([laenge, inhalt, pruef]);
}

/**
 * Malt ein Bild Pixel für Pixel. `farbe` bekommt die Koordinaten und gibt RGB
 * zurück — jedes Motiv unten ist damit eine reine Funktion und braucht weder
 * Zeichenkontext noch Zustand.
 */
function zeichne(breite: number, hoehe: number, farbe: (x: number, y: number) => Farbe): Buffer {
  // Jede Bildzeile beginnt mit ihrem Filter-Byte (0 = keiner), dann RGB.
  const roh = Buffer.alloc(hoehe * (1 + breite * 3));
  let i = 0;
  for (let y = 0; y < hoehe; y++) {
    roh[i++] = 0;
    for (let x = 0; x < breite; x++) {
      const [r, g, b] = farbe(x, y);
      roh[i++] = r;
      roh[i++] = g;
      roh[i++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 2; // Farbtyp 2 = RGB
  // 10..12 bleiben 0: Kompression, Filter, kein Interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', ihdr),
    block('IDAT', deflateSync(roh, { level: 9 })),
    block('IEND', Buffer.alloc(0)),
  ]);
}

// --- Werkzeug fürs Motiv ---

const mischen = (a: Farbe, b: Farbe, t: number): Farbe => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * Grobes Rauschen aus den Koordinaten — bewusst ohne Math.random, damit zwei
 * Läufe dasselbe Bild ergeben und der Seed wirklich idempotent bleibt.
 */
const koernung = (x: number, y: number, staerke: number): number =>
  ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000 * staerke;

const klemme = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

const koerne = (f: Farbe, x: number, y: number, staerke = 14): Farbe => {
  const d = koernung(x, y, staerke) - staerke / 2;
  return [klemme(f[0] + d), klemme(f[1] + d), klemme(f[2] + d)];
};

const PERGAMENT: Farbe = [232, 219, 192];
const TINTE: Farbe = [58, 47, 38];
const WALD: Farbe = [96, 122, 78];
const WASSER: Farbe = [92, 126, 154];
const STEIN: Farbe = [150, 143, 130];
const GOLD: Farbe = [193, 156, 68];
const PURPUR: Farbe = [104, 62, 92];
const DUNKEL: Farbe = [38, 34, 44];

export interface DemoBild {
  titel: string;
  data: Buffer;
}

/** Landkarte: Wald, ein Fluss, die Stadt am Knick, zwei Straßen darauf zu. */
export function karteGareth(): DemoBild {
  const B = 720;
  const H = 460;
  const stadtX = 470;
  const stadtY = 210;
  const data = zeichne(B, H, (x, y) => {
    if (x < 8 || y < 8 || x >= B - 8 || y >= H - 8) return TINTE;

    const flussX = 250 + Math.sin(y / 70) * 60 + y * 0.35;
    if (Math.abs(x - flussX) < 14) return koerne(WASSER, x, y, 18);

    const dx = x - stadtX;
    const dy = y - stadtY;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 46) {
      if (r > 40) return TINTE;
      return (Math.floor(x / 9) + Math.floor(y / 9)) % 2 === 0 ? STEIN : koerne([124, 116, 104], x, y, 8);
    }

    if (x > stadtX && Math.abs(dy - dx * 0.45) < 4) return koerne([176, 152, 112], x, y, 10);
    if (x < stadtX && Math.abs(dy + dx * 0.8) < 4) return koerne([176, 152, 112], x, y, 10);

    const w = koernung(Math.floor(x / 11), Math.floor(y / 11), 1);
    if (w > 0.62 && x > 40 && y > 40 && x < B - 40 && y < H - 40) return koerne(WALD, x, y, 20);
    return koerne(PERGAMENT, x, y, 12);
  });
  return { titel: 'Karte der Umgebung von Gareth', data };
}

/** Wappen: geviertelter Schild mit goldenem Bord und einem Stern. */
export function wappenGareth(): DemoBild {
  const B = 340;
  const H = 400;
  const data = zeichne(B, H, (x, y) => {
    const mx = B / 2;
    const t = y / H;
    const halb = y < H * 0.55 ? B * 0.42 : B * 0.42 * (1 - Math.pow((t - 0.55) / 0.45, 1.6));
    const innen = Math.abs(x - mx) < halb && y > 18 && y < H - 12;
    if (!innen) return koerne(PERGAMENT, x, y, 10);
    if (Math.abs(x - mx) > halb - 10) return GOLD;

    const feld = (x < mx) === (y < H * 0.46) ? PURPUR : DUNKEL;
    const sx = mx - halb * 0.45;
    const sy = H * 0.26;
    const d = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2);
    const winkel = Math.atan2(y - sy, x - sx);
    if (d < 34 + Math.cos(winkel * 5) * 16) return GOLD;
    return koerne(feld, x, y, 8);
  });
  return { titel: 'Wappen der Stadt Gareth', data };
}

/** Porträt: Schulterstück vor einfarbigem Grund. */
export function portraitAlrik(): DemoBild {
  const B = 360;
  const H = 440;
  const data = zeichne(B, H, (x, y) => {
    const mx = B / 2;
    const schulter = ((x - mx) / 190) ** 2 + ((y - H * 1.12) / (H * 0.55)) ** 2;
    const kopf = ((x - mx) / 84) ** 2 + ((y - H * 0.38) / 104) ** 2;
    if (kopf < 1) {
      if (y < H * 0.31 || Math.abs(x - mx) > 66) return koerne([74, 54, 42], x, y, 10);
      return koerne([214, 178, 150], x, y, 8);
    }
    if (schulter < 1) return koerne(PURPUR, x, y, 10);
    return koerne(mischen(PERGAMENT, STEIN, y / H), x, y, 10);
  });
  return { titel: 'Alrik von Gareth', data };
}

/** Breites Banner: gestaffelte Bergkämme gegen einen Abendhimmel. */
export function bannerGrauenstein(): DemoBild {
  const B = 1000;
  const H = 280;
  const kaemme = [
    { basis: 250, hoehe: 96, zacken: 260, ton: 0.45 },
    { basis: 270, hoehe: 140, zacken: 190, ton: 0.2 },
    { basis: 285, hoehe: 190, zacken: 150, ton: 0 },
  ];
  const data = zeichne(B, H, (x, y) => {
    const himmel = mischen([238, 196, 148], [92, 84, 122], y / H);
    for (const k of kaemme) {
      const s = Math.abs(((x % k.zacken) / k.zacken) * 2 - 1);
      if (y > k.basis - k.hoehe * (1 - s)) {
        return koerne(mischen(DUNKEL, himmel, k.ton), x, y, 10);
      }
    }
    return koerne(himmel, x, y, 8);
  });
  return { titel: 'Die Kämme über Grauenstein', data };
}

/** Nur für die Spielleitung: Kellerskizze mit einer Markierung. */
export function geheimskizze(): DemoBild {
  const B = 520;
  const H = 340;
  const data = zeichne(B, H, (x, y) => {
    if (x < 6 || y < 6 || x >= B - 6 || y >= H - 6) return TINTE;
    if (x % 90 < 8 || y % 84 < 8) return koerne([120, 110, 96], x, y, 10);
    const cx = 320;
    const cy = 210;
    if (Math.abs(Math.abs(x - cx) - Math.abs(y - cy)) < 7 && Math.abs(x - cx) < 34) return [168, 58, 52];
    return koerne(mischen(PERGAMENT, [206, 194, 170], (y % 84) / 84), x, y, 12);
  });
  return { titel: 'Skizze der Kellergewölbe', data };
}
