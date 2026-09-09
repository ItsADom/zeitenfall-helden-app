import { apiPost } from './api';

// Feuert-und-vergisst, an jedem der fünf Eier-Auslöser aufgerufen (App.tsx,
// FeedColumn.tsx, KonamiPartyOverlay.tsx). Der Server dedupliziert selbst
// (UNIQUE(egg_key, user_id), siehe routes.ts) — hier gibt es also nichts zu
// prüfen oder zu warten, ein Fehlschlag (z. B. offline) ist einfach ein Fund,
// der nicht ankam, keine Absturzursache.
export function reportEasterEggFound(key: string): void {
  apiPost(`/api/easter-eggs/${key}/found`).catch(() => {
    // Ein verlorener Fund ist kein Absturz wert.
  });
}
