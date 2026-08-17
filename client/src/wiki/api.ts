// Typed wrappers over the shared fetch helpers. Nothing clever — just one place
// that knows the wiki's URL shapes, so a route rename is one edit.
import type { WikiLogEintrag, WikiSeiteInfo, WikiSeiteVoll } from '@shared/wikiTypen';
import { apiGet, apiPost, apiPut } from '../api';

export interface SeiteAntwort {
  seite: WikiSeiteVoll;
  /**
   * The page's real slug. Differs from the one in the URL when the address came
   * from the alias table after a rename — the caller then replaces the URL.
   */
  kanonisch: string;
}

export const ladeListe = () => apiGet<{ seiten: WikiSeiteInfo[] }>('/api/wiki/seiten');

export const ladeSeite = (slug: string) => apiGet<SeiteAntwort>(`/api/wiki/seiten/${encodeURIComponent(slug)}`);

/**
 * The editor's payload. Deliberately a different endpoint from ladeSeite: it
 * returns the source with a `[[gm:n]]` marker where a GM-only region stands, so
 * saving cannot delete a section the editor was never shown.
 */
export const ladeQuelle = (slug: string) =>
  apiGet<SeiteAntwort>(`/api/wiki/seiten/${encodeURIComponent(slug)}/quelle`);

export const ladeVerweise = (slug: string) =>
  apiGet<{ verweise: { slug: string; titel: string }[] }>(
    `/api/wiki/seiten/${encodeURIComponent(slug)}/verweise`,
  );

export const legeSeiteAn = (titel: string) => apiPost<{ slug: string }>('/api/wiki/seiten', { titel });

export interface SpeichernEingabe {
  titel: string;
  text: string;
  kommentar: string;
  tags: string;
  basisRev: number | null;
}

export const speichereSeite = (slug: string, eingabe: SpeichernEingabe) =>
  apiPut<SeiteAntwort>(`/api/wiki/seiten/${encodeURIComponent(slug)}`, eingabe);

export const ladeVerlauf = (slug: string) =>
  apiGet<{ titel: string; eintraege: WikiLogEintrag[] }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/verlauf`);

export const ladeFassung = (slug: string, rev: number) =>
  apiGet<{ text: string }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/fassung/${rev}`);

export const ladeAenderungen = (limit = 100) =>
  apiGet<{ eintraege: WikiLogEintrag[] }>(`/api/wiki/aenderungen?limit=${limit}`);
