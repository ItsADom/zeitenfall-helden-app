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

import { CHANGELOG, changelogGroups, type ChangelogEntry } from 'shared';
import { db } from './db.js';

const WEBHOOK = (process.env.DISCORD_CHANGELOG_WEBHOOK ?? '').trim();
const DRYRUN = /^(1|true)$/i.test(process.env.DISCORD_CHANGELOG_DRYRUN ?? '');
const TEST = /^(1|true)$/i.test(process.env.DISCORD_CHANGELOG_TEST ?? '');

// Basis-URL der Live-Changelog-Seite. Jeder veröffentlichte Eintrag bekommt in
// Changelog.tsx ein `id="v<version>"` auf seinem Panel, daher kann direkt auf
// den Eintrag verlinkt werden statt nur auf die Seite.
const SITE_URL = (process.env.DISCORD_CHANGELOG_URL ?? 'https://zeitenfall.de/changelog').trim();

// Discord-Grenzen pro Embed und pro Nachricht (mehrere Embeds teilen sich das
// 6000-Zeichen-Gesamtbudget einer Nachricht) — siehe splitDescription unten.
const EMBED_DESC_LIMIT = 4096;
const MESSAGE_TOTAL_LIMIT = 6000;
const MAX_EMBEDS_PER_MESSAGE = 10;

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

// Zerlegt eine (potenziell zu lange) Beschreibung in Discord-taugliche Häppchen:
// nie mitten in einem Absatz/einer Aufzählung trennen, wenn vermeidbar. Ein
// einzelner Absatz, der selbst das Limit sprengt (praktisch nie), wird hart
// geschnitten statt die Nachricht scheitern zu lassen.
function splitDescription(description: string, maxLen = EMBED_DESC_LIMIT): string[] {
  if (description.length <= maxLen) return [description];
  const paragraphs = description.split('\n\n');
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    const piece = p.length > maxLen ? p.slice(0, maxLen) : p;
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildEmbeds(e: ChangelogEntry): Record<string, unknown>[] {
  const title = e.version ? `${e.title} — v${e.version}` : e.title;
  // Kategorisierte Einträge bekommen fette Abschnitts-Überschriften; die
  // ungegliederten Bestandseinträge (label leer) bleiben eine flache Liste.
  const renderGroups = (bullets: Parameters<typeof changelogGroups>[0]): string =>
    changelogGroups(bullets)
      .map((g) => (g.label ? `**${g.label}**\n` : '') + g.items.map((c) => `• ${c}`).join('\n'))
      .join('\n\n');
  // Bündelt der Eintrag mehrere große Funktionen (siehe `features`), bekommt
  // jede ihre eigene Markdown-Überschrift — sonst würden sie in Discord genau
  // in derselben Liste landen, die hier eigentlich vermieden werden soll.
  const description = e.features
    ? e.features.map((f) => `## ${f.title}\n${renderGroups(f)}`).join('\n\n')
    : renderGroups(e);
  const url = e.version ? `${SITE_URL}#v${e.version}` : SITE_URL;

  // Ein Eintrag, der 4096 Zeichen sprengt, wird auf mehrere Embeds derselben
  // Nachricht verteilt (Discord erlaubt bis zu 10, mit gemeinsamem 6000er-
  // Budget) statt stillschweigend am Limit abgeschnitten zu werden. Titel/Link
  // trägt nur das erste Embed, der Live-Link im Footer nur das letzte.
  let chunks = splitDescription(description).slice(0, MAX_EMBEDS_PER_MESSAGE);
  let total = chunks.reduce((n, c) => n + c.length, 0);
  while (total > MESSAGE_TOTAL_LIMIT && chunks.length > 1) {
    const dropped = chunks.pop();
    total -= dropped?.length ?? 0;
  }

  return chunks.map((desc, i) => ({
    ...(i === 0 ? { title: title.slice(0, 256), url } : {}),
    description: desc,
    color: EMBED_COLOR,
    // Discord zeigt diesen Zeitstempel in der lokalen Zeitzone des Betrachters
    // an — bewusst der tatsächliche Post-Zeitpunkt (JETZT), nicht `e.date`:
    // das Changelog-Datum hat keine Uhrzeit, wurde also immer als UTC-Mitternacht
    // interpretiert und erschien dadurch in deutscher Zeit fix um 2:00 Uhr.
    ...(i === chunks.length - 1 ? { timestamp: new Date().toISOString() } : {}),
    ...(i === chunks.length - 1
      ? { footer: { text: `Zeitenfall · Zeitenkompass · ${url.replace(/^https?:\/\//, '')}` } }
      : {}),
  }));
}

async function postEntry(e: ChangelogEntry): Promise<void> {
  const embeds = buildEmbeds(e);
  const payload: Record<string, unknown> = { username: USERNAME, embeds };
  if (AVATAR) payload.avatar_url = AVATAR;

  if (DRYRUN) {
    console.log(
      `[discord] DRYRUN — würde posten als „${USERNAME}" (${entryKey(e)}):\n` +
        JSON.stringify(embeds, null, 2),
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

  // Nur VERÖFFENTLICHTE Einträge werden gespiegelt: ein Eintrag ohne `version`
  // ist ein Entwurf und bleibt außen vor, bis er beim Release seine Nummer
  // bekommt. Damit kann ein Entwurf nie versehentlich nach Discord gelangen,
  // egal wann der Server startet — und der Wasserstand zeigt immer auf eine
  // stabile Versionskennung (`vX`), nie auf ein noch änderbares Datum+Titel.
  const released = CHANGELOG.filter((e) => e.version); // neueste zuerst (Reihenfolge bleibt)

  // Rauchtest: nur den neuesten (veröffentlichten) Eintrag senden, Wasserstand nicht anfassen.
  if (TEST) {
    const newest = released[0];
    if (!newest) return;
    console.log(`[discord] TEST — sende neuesten Eintrag ${entryKey(newest)} (Wasserstand bleibt).`);
    await postEntry(newest);
    return;
  }

  const wm = getWatermark();

  // Erststart: nur scharf stellen, Historie nicht nachposten.
  if (wm === null) {
    const newest = released[0];
    if (newest) setWatermark(entryKey(newest));
    console.log(
      `[discord] Changelog-Spiegel scharf gestellt bei ${newest ? entryKey(newest) : '(leer)'} — Historie wird nicht nachgepostet.`,
    );
    return;
  }

  // Neue Einträge = alles Veröffentlichte oberhalb des Wasserstands (neueste zuerst).
  const idx = released.findIndex((e) => entryKey(e) === wm);
  if (idx === -1) {
    // Wasserstand zeigt auf keinen bekannten Eintrag (z. B. Schlüssel geändert).
    // Zur Sicherheit NICHT fluten, sondern am neuesten Eintrag neu scharf stellen.
    const newest = released[0];
    if (newest) setWatermark(entryKey(newest));
    console.warn(
      `[discord] Wasserstand „${wm}" nicht gefunden — ohne Nachposten neu gesetzt auf ${newest ? entryKey(newest) : '(leer)'}.`,
    );
    return;
  }

  const fresh = released.slice(0, idx); // neuer als der Wasserstand, nur Veröffentlichtes
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
