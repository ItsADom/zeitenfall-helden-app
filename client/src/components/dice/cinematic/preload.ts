// The seam that keeps three.js out of the main bundle.
//
// STRUCTURAL RULE: only this file and the overlay's effect may reference
// ./stage, and only ever through import(). A single static
// `import { createStage } from './cinematic/stage'` anywhere reachable from
// App.tsx puts all ~131 KB (gzipped) of three into the chunk that every page
// load fetches from a home connection — silently, with nothing failing to warn
// you. Rollup splits dynamic imports on its own, so there is no manualChunks
// config to keep in step; the only thing holding the split together is this
// rule.
import { wichtigVorbereiten } from '../chimes';

type StageModul = typeof import('./stage');

let laufend: Promise<StageModul> | null = null;

/**
 * Fetch the stage chunk and render the fanfare, before either is needed.
 *
 * Idempotent and safe to call repeatedly — it caches its own promise, which also
 * makes a StrictMode double-invoke free. Errors are swallowed: a failed preload
 * only means the real load pays for itself later, and if that fails too the
 * overlay falls back to the static card.
 */
export function preloadCinematic(): Promise<StageModul> {
  if (!laufend) {
    laufend = import('./stage');
    laufend.catch(() => {
      // Let the next attempt try again rather than caching the failure — a
      // stale chunk after a redeploy is the likely cause, and a reload fixes it.
      laufend = null;
    });
  }
  wichtigVorbereiten();
  return laufend;
}
