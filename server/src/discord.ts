// Spiegelt neue Changelog-Einträge in einen Discord-Kanal (per Webhook).
//
// Ablauf beim Serverstart (mirrorChangelog):
//   • Ohne DISCORD_CHANGELOG_WEBHOOK ist die Funktion komplett aus — nichts geht raus.
//   • Erststart (noch kein Wasserstand): der Spiegel wird nur „scharf gestellt" —
//     der Wasserstand rückt auf den neuesten Eintrag, es wird NICHTS nachgepostet.
//     So flutet ein frisch angeschlossener Webhook nie die ganze Historie.
//   • Danach: alle Einträge, die NEUER sind als der Wasserstand, werden gepostet
//     (ältester zuerst, damit der Kanal chronologisch bleibt). Der Wasserstand
//     wird nach JEDEM erfolgreichen Post fortgeschrieben → abbruchsicher.
//
// Testen ohne den echten Kanal zu fluten:
//   DISCORD_CHANGELOG_WEBHOOK=<TEST-Webhook>   → auf einen Wegwerf-Kanal zeigen
//   DISCORD_CHANGELOG_DRYRUN=1                 → nur ins Log schreiben, nichts senden,
//                                                Wasserstand bleibt unberührt
//   DISCORD_CHANGELOG_TEST=1                   → einmalig NUR den neuesten Eintrag
//                                                senden (Wasserstand unberührt) —
//                                                Rauchtest fürs Format
//
// Zum Scharfstellen der Produktion: einmal mit dem echten Webhook (ohne TEST/DRYRUN)
// starten → der Spiegel merkt sich den aktuellen Stand, ohne die Historie zu posten.
// Ab dem nächsten neuen Eintrag landet dieser automatisch im Kanal.

import { CHANGELOG, type ChangelogEntry } from 'shared';
import { db } from './db.js';

const WEBHOOK = (process.env.DISCORD_CHANGELOG_WEBHOOK ?? '').trim();
const DRYRUN = /^(1|true)$/i.test(process.env.DISCORD_CHANGELOG_DRYRUN ?? '');
const TEST = /^(1|true)$/i.test(process.env.DISCORD_CHANGELOG_TEST ?? '');

const WATERMARK_KEY = 'changelog_watermark';
const EMBED_COLOR = 0xb08d57; // Bronze — passt zum Standard-Thema (Gareth)

// Auftritt des Posters. Name kommt aus dem Code (garantiert, ohne Abhängigkeit);
// das Profilbild am einfachsten in den Discord-Webhook-Einstellungen hochladen
// (dann AVATAR leer lassen). AVATAR nur setzen, wenn ein ÖFFENTLICH erreichbares
// Bild pro Nachricht überschreiben soll — Discord lädt die URL selbst.
const USERNAME = (process.env.DISCORD_CHANGELOG_USERNAME ?? 'Hüter des Wissens').trim();
const AVATAR = (process.env.DISCORD_CHANGELOG_AVATAR ?? '').trim();

// Stabile Kennung eines Eintrags. Version ist eindeutig genug; ohne Version
// (noch nie vorgekommen, aber der Typ erlaubt es) auf Datum+Titel ausweichen.
const entryKey = (e: ChangelogEntry): string =>
  e.version ? `v${e.version}` : `${e.date}::${e.title}`;

const getWatermark = (): string | null => {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(WATERMARK_KEY) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
};

const setWatermark = (v: string): void => {
  db.prepare(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(WATERMARK_KEY, v);
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function buildEmbed(e: ChangelogEntry): Record<string, unknown> {
  const title = e.version ? `${e.title} — v${e.version}` : e.title;
  const description = e.changes.map((c) => `• ${c}`).join('\n');
  const ts = new Date(e.date);
  return {
    title: title.slice(0, 256),
    description: description.slice(0, 4096),
    color: EMBED_COLOR,
    ...(Number.isNaN(ts.getTime()) ? {} : { timestamp: ts.toISOString() }),
    footer: { text: 'Zeitenfall · Heldenverwaltung' },
  };
}

async function postEntry(e: ChangelogEntry): Promise<void> {
  const embed = buildEmbed(e);
  const payload: Record<string, unknown> = { username: USERNAME, embeds: [embed] };
  if (AVATAR) payload.avatar_url = AVATAR;

  if (DRYRUN) {
    console.log(
      `[discord] DRYRUN — würde posten als „${USERNAME}" (${entryKey(e)}):\n` +
        JSON.stringify(embed, null, 2),
    );
    return;
  }

  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Discord-Ratenlimit: bei 429 einmal die angegebene Wartezeit abwarten und erneut.
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.ceil((body.retry_after ?? 1) * 1000) + 250;
    console.warn(`[discord] Ratenlimit — warte ${waitMs} ms und versuche erneut.`);
    await sleep(waitMs);
    return postEntry(e);
  }
  if (!res.ok) {
    throw new Error(`Discord-Webhook antwortete ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

export async function mirrorChangelog(): Promise<void> {
  if (!WEBHOOK) return; // Feature aus, solange kein Webhook gesetzt ist

  // Rauchtest: nur den neuesten Eintrag senden, Wasserstand nicht anfassen.
  if (TEST) {
    const newest = CHANGELOG[0];
    if (!newest) return;
    console.log(`[discord] TEST — sende neuesten Eintrag ${entryKey(newest)} (Wasserstand bleibt).`);
    await postEntry(newest);
    return;
  }

  const wm = getWatermark();

  // Erststart: nur scharf stellen, Historie nicht nachposten.
  if (wm === null) {
    const newest = CHANGELOG[0];
    if (newest) setWatermark(entryKey(newest));
    console.log(
      `[discord] Changelog-Spiegel scharf gestellt bei ${newest ? entryKey(newest) : '(leer)'} — Historie wird nicht nachgepostet.`,
    );
    return;
  }

  // Neue Einträge = alles oberhalb des Wasserstands (Array: neueste zuerst).
  const idx = CHANGELOG.findIndex((e) => entryKey(e) === wm);
  if (idx === -1) {
    // Wasserstand zeigt auf keinen bekannten Eintrag (z. B. Schlüssel geändert).
    // Zur Sicherheit NICHT fluten, sondern am neuesten Eintrag neu scharf stellen.
    const newest = CHANGELOG[0];
    if (newest) setWatermark(entryKey(newest));
    console.warn(
      `[discord] Wasserstand „${wm}" nicht gefunden — ohne Nachposten neu gesetzt auf ${newest ? entryKey(newest) : '(leer)'}.`,
    );
    return;
  }

  const fresh = CHANGELOG.slice(0, idx); // neuer als der Wasserstand
  if (fresh.length === 0) return;

  // Ältester zuerst, damit die Reihenfolge im Kanal chronologisch ist.
  for (const e of [...fresh].reverse()) {
    await postEntry(e);
    if (!DRYRUN) {
      setWatermark(entryKey(e)); // nach jedem Erfolg fortschreiben (abbruchsicher)
      await sleep(700); // Discord-Ratenlimit schonen
    }
  }
  console.log(`[discord] ${fresh.length} Changelog-Eintrag/e nach Discord gespiegelt.`);
}
