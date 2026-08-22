// Waiting-screen state machine for an admin-triggered redeploy.
//
// This lives in `shared` rather than `client` or `server` for the same reason
// accessGate.ts does: `shared` is the only workspace with a test runner. It is
// also the code in this feature whose bugs are the least visible — a wrong
// transition does not crash anything, it strands somebody on a screen that
// never goes away.
//
// The one rule everything else follows from: **only a changed boot id means the
// server came back.** A phase never does. `helden-deploy` writes `fertig` four
// seconds after `systemctl restart`, so depending on timing that phase can be
// read from either the old or the new process — and an HTTP 200 during the
// build comes from the old one, which is still happily serving. Checking the
// boot id makes the question of who answered irrelevant.

/** The phases helden-deploy and helden-deploy-trigger write into status.json. */
export type DeployPhase = 'pruefe' | 'baue' | 'starte' | 'fertig' | 'aktuell' | 'fehlgeschlagen';

/** The body of GET /api/admin/deploy/status, minus the boot id. */
export interface DeployStatus {
  phase: DeployPhase;
  /** Unix seconds — when the phase was written, not when it was read. */
  zeit: number;
  /** Only ever set while phase is 'fehlgeschlagen' (see fehler.txt). */
  fehler?: string;
}

/**
 * One poll result. `stumm` covers every way a request can fail to produce an
 * answer — connection refused mid-restart, a timeout, a 5xx from nginx while
 * the upstream is down. From the browser they are indistinguishable, and they
 * all mean the same thing.
 */
export type DeployBeobachtung =
  | { art: 'status'; boot: string; status: DeployStatus | null }
  // `wartung` is the one bit /api/health adds beyond liveness: is a run in
  // flight at all. Clients other than the one that pressed the button learn of
  // a deploy from the announcement, which necessarily goes out BEFORE anyone
  // knows whether there is anything to deploy. Without this bit, a run that
  // ends in "already up to date" would leave every other browser waiting for a
  // restart that never comes.
  | { art: 'gesund'; boot: string; wartung: boolean }
  | { art: 'stumm' };

export type DeployAnsicht =
  | { zustand: 'laeuft'; phase: DeployPhase; langsam: boolean }
  | { zustand: 'wartetAufNeustart'; langsam: boolean }
  | { zustand: 'zurueck' }
  | { zustand: 'aktuell' }
  | { zustand: 'fehlgeschlagen'; fehler: string };

/**
 * After this long the screen adds "this is taking longer than usual" — but it
 * does NOT give up. The systemd unit allows thirty minutes; a browser that
 * declared failure at ten would be lying about a deploy that is still working.
 */
export const DEPLOY_LANGSAM_MS = 10 * 60_000;

export const DEPLOY_ANFANG: DeployAnsicht = { zustand: 'laeuft', phase: 'pruefe', langsam: false };

const ENDZUSTAENDE: ReadonlySet<DeployAnsicht['zustand']> = new Set(['zurueck', 'aktuell', 'fehlgeschlagen']);

export function istEndzustand(ansicht: DeployAnsicht): boolean {
  return ENDZUSTAENDE.has(ansicht.zustand);
}

/** Human-readable German for each phase — the waiting screen shows these. */
export const DEPLOY_PHASEN_TEXT: Record<DeployPhase, string> = {
  pruefe: 'Stand wird geprüft …',
  baue: 'Neue Ausgabe wird gebaut …',
  starte: 'Dienst wird neu gestartet …',
  fertig: 'Gebaut — warte auf den neuen Stand …',
  aktuell: 'Bereits auf dem neuesten Stand.',
  fehlgeschlagen: 'Der Deploy ist fehlgeschlagen.',
};

/**
 * Folds one observation into the current view.
 *
 * `bootVorher` is the boot id that came back in the 202 from POST /api/admin/deploy.
 * It deliberately comes from that same response: fetched separately, the fetch
 * could race the restart and return the NEW id, and the screen would then wait
 * forever for a change that had already happened.
 */
export function naechsteAnsicht(
  vorher: DeployAnsicht,
  beobachtung: DeployBeobachtung,
  ctx: { bootVorher: string; laufzeitMs: number },
): DeployAnsicht {
  // Terminal states absorb everything. Polling stops there anyway, but a late
  // answer already in flight must not reopen a screen that has been resolved.
  if (istEndzustand(vorher)) return vorher;

  const langsam = ctx.laufzeitMs > DEPLOY_LANGSAM_MS;

  // Before anything else: did the process change? This is the only evidence
  // that the restart happened, and it outranks whatever the phase claims.
  if (beobachtung.art !== 'stumm' && beobachtung.boot !== ctx.bootVorher) {
    return { zustand: 'zurueck' };
  }

  // No answer at all — the app is down. That is expected, and brief.
  if (beobachtung.art === 'stumm') return { zustand: 'wartetAufNeustart', langsam };

  // /api/health answered with the SAME id: the old process is still serving.
  if (beobachtung.art === 'gesund') {
    // …and it reports no run in flight. Either the deploy found nothing to do,
    // or it is already over — either way no restart is coming, so stop waiting
    // for one. 'aktuell' is the terminal state that simply dismisses.
    if (!beobachtung.wartung) return { zustand: 'aktuell' };
    return { zustand: 'wartetAufNeustart', langsam };
  }

  // The status file may not exist yet in the first second after the request.
  if (!beobachtung.status) return { zustand: 'laeuft', phase: 'pruefe', langsam };

  switch (beobachtung.status.phase) {
    case 'aktuell':
      return { zustand: 'aktuell' };
    case 'fehlgeschlagen':
      return {
        zustand: 'fehlgeschlagen',
        fehler: beobachtung.status.fehler?.trim() || 'Der Deploy wurde abgebrochen. Näheres steht im Journal des Servers.',
      };
    case 'fertig':
      // Finished, but the id says we are still talking to the old process.
      // Only reachable in a narrow race; waiting is the honest answer.
      return { zustand: 'wartetAufNeustart', langsam };
    default:
      return { zustand: 'laeuft', phase: beobachtung.status.phase, langsam };
  }
}
