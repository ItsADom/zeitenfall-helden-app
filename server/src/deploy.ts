// Admin-triggered redeploy — the application's half of the chain.
//
// This process may not restart itself: helden-app.service runs with
// NoNewPrivileges=true, which makes the setuid bit on sudo inert for it and
// everything it spawns. So it does not try. It leaves a note in a directory it
// owns, a systemd path unit picks it up, and root decides what the note is
// worth. See scripts/README.md and docs/concepts/admin-triggered-redeploy.md.
//
// Nothing here can choose WHAT gets deployed. The branch comes from the unit
// instance on the server side; the request carries no branch at all.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DeployPhase, DeployStatus } from 'shared';

/**
 * Changes on every process start, and is the only evidence the browser accepts
 * that the restart actually happened. An HTTP 200 proves nothing during a
 * deploy: the symlink swap and restart are the last thing helden-deploy does,
 * so the old process keeps answering for the whole build.
 */
export const BOOT_ID = randomUUID();

/**
 * Unset on a developer machine, and that is the point — without it the feature
 * reports itself unavailable and the button never appears. A local `npm run
 * dev` must not offer a switch that writes into nothing.
 */
const DEPLOY_DIR = process.env.HELDEN_DEPLOY_DIR?.trim() || null;

const ANSTOSS = DEPLOY_DIR && path.join(DEPLOY_DIR, 'anstoss.json');
const STATUS = DEPLOY_DIR && path.join(DEPLOY_DIR, 'status.json');
const FEHLER = DEPLOY_DIR && path.join(DEPLOY_DIR, 'fehler.txt');

const PHASEN: ReadonlySet<string> = new Set([
  'pruefe',
  'baue',
  'starte',
  'fertig',
  'aktuell',
  'fehlgeschlagen',
]);

/** Phases during which a further request would only queue up behind this one. */
const LAEUFT_NOCH: ReadonlySet<DeployPhase> = new Set(['pruefe', 'baue', 'starte']);

export function deployVerfuegbar(): boolean {
  return DEPLOY_DIR !== null && fs.existsSync(DEPLOY_DIR);
}

/**
 * Reads status.json. Everything about it is untrusted input as far as this
 * function is concerned — a missing file, a half-written one, an unknown phase
 * from a newer script all resolve to null rather than throwing. The waiting
 * screen treats null as "no news yet", which is the right answer for all three.
 */
export function leseDeployStatus(): DeployStatus | null {
  if (!STATUS) return null;
  let roh: string;
  try {
    roh = fs.readFileSync(STATUS, 'utf8');
  } catch {
    return null; // not written yet, or nothing has ever run
  }

  let daten: unknown;
  try {
    daten = JSON.parse(roh);
  } catch {
    return null;
  }
  if (!daten || typeof daten !== 'object') return null;

  const { phase, zeit } = daten as { phase?: unknown; zeit?: unknown };
  if (typeof phase !== 'string' || !PHASEN.has(phase)) return null;

  const status: DeployStatus = {
    phase: phase as DeployPhase,
    zeit: typeof zeit === 'number' && Number.isFinite(zeit) ? zeit : 0,
  };

  // The error text lives in its own file because hand-rolling JSON string
  // escaping in bash is how quoting bugs ship. It is only meaningful for a
  // failed run — otherwise it may be a leftover from an earlier one.
  if (status.phase === 'fehlgeschlagen' && FEHLER) {
    try {
      const text = fs.readFileSync(FEHLER, 'utf8').trim();
      if (text) status.fehler = text.slice(0, 4000);
    } catch {
      // No text is fine; the client substitutes a usable sentence.
    }
  }
  return status;
}

export function deployLaeuft(): boolean {
  if (ANSTOSS && fs.existsSync(ANSTOSS)) return true; // requested, not yet picked up
  const status = leseDeployStatus();
  return status !== null && LAEUFT_NOCH.has(status.phase);
}

/**
 * Drops the request where the path unit is watching. Written under a temporary
 * name and renamed, because the unit fires the moment the watched name appears
 * — creating it directly would race the reader against a half-written file.
 */
export function stossDeployAn(user: { id: number; username: string }): void {
  if (!ANSTOSS) throw new Error('HELDEN_DEPLOY_DIR ist nicht gesetzt');
  const vorlaeufig = `${ANSTOSS}.neu`;
  const inhalt = JSON.stringify({ user: user.username, id: user.id, zeit: Math.floor(Date.now() / 1000) });
  fs.writeFileSync(vorlaeufig, `${inhalt}\n`, { mode: 0o640 });
  fs.renameSync(vorlaeufig, ANSTOSS);
}
