// Typed wrappers over the shared fetch helpers. Nothing clever — just one place
// that knows the wiki's URL shapes, so a route rename is one edit.
import type {
  WikiKategorie,
  WikiKategorieAnsicht,
  WikiLogEintrag,
  WikiSeiteInfo,
  WikiSeiteVoll,
  WikiTreffer,
} from '@shared/wikiTypen';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';

export interface SeiteAntwort {
  seite: WikiSeiteVoll;
  /**
   * The page's real slug. Differs from the one in the URL when the address came
   * from the alias table after a rename — the caller then replaces the URL.
   */
  kanonisch: string;
}

export const ladeListe = () => apiGet<{ seiten: WikiSeiteInfo[] }>('/api/wiki/seiten');

/**
 * `folgen: false` stops on a redirect page instead of being sent to its target
 * — the „(weitergeleitet von …)" note links here, and it is the only way to
 * reach a wrong signpost in order to fix it.
 */
export const ladeSeite = (slug: string, folgen = true) =>
  apiGet<SeiteAntwort>(`/api/wiki/seiten/${encodeURIComponent(slug)}${folgen ? '' : '?folgen=nein'}`);

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
  apiGet<{ titel: string; darfBearbeiten: boolean; eintraege: WikiLogEintrag[] }>(
    `/api/wiki/seiten/${encodeURIComponent(slug)}/verlauf`,
  );

export const ladeFassung = (slug: string, rev: number) =>
  apiGet<{ text: string }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/fassung/${rev}`);

/** „Diese Fassung übernehmen" — the server writes a new revision from an old text. */
export const stelleFassungHer = (slug: string, revisionId: number) =>
  apiPost<{ nr: number; slug: string }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/wiederherstellen`, {
    revisionId,
  });

export interface AenderungsFilter {
  autor?: string;
  seite?: string;
  von?: string;
  bis?: string;
  vor?: string;
  limit?: number;
}

export const ladeAenderungen = (filter: AenderungsFilter = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== '' && v != null) p.set(k, String(v));
  }
  return apiGet<{ eintraege: WikiLogEintrag[] }>(`/api/wiki/aenderungen?${p}`);
};

export interface WikiBildInfo {
  slug: string;
  titel: string;
  mime: string;
  bytes: number;
  breite: number;
  hoehe: number;
  pos: number;
  gmOnly: boolean;
  uploaderName: string;
  erstelltAm: string;
}

export const ladeBilder = (slug: string) =>
  apiGet<{ bilder: WikiBildInfo[] }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/bilder`);

export const loescheBild = (slug: string, bild: string) =>
  apiDelete<{ ok: true }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/bilder/${encodeURIComponent(bild)}`);

export const sucheSeiten = (q: string) =>
  apiGet<{ q: string; treffer: WikiTreffer[] }>(`/api/wiki/suche?q=${encodeURIComponent(q)}`);

export const ladeKategorien = () => apiGet<{ kategorien: WikiKategorie[] }>('/api/wiki/kategorien');

export const ladeKategorie = (tag: string) =>
  apiGet<WikiKategorieAnsicht>(`/api/wiki/kategorie/${encodeURIComponent(tag)}`);

// --- Nur Spielleitung ---

export const setzeFlags = (slug: string, flags: { gmOnly?: boolean; geschuetzt?: boolean }) =>
  apiPut<{ gmOnly: boolean; geschuetzt: boolean }>(`/api/wiki/seiten/${encodeURIComponent(slug)}/flags`, flags);

export const loescheSeite = (slug: string) =>
  apiDelete<{ ok: true }>(`/api/wiki/seiten/${encodeURIComponent(slug)}`);

export interface WikiPapierkorbEintrag {
  slug: string;
  titel: string;
  geloeschtAm: string;
  bilder: number;
}

export const ladePapierkorb = () => apiGet<{ seiten: WikiPapierkorbEintrag[] }>('/api/wiki/papierkorb');

export const holeZurueck = (slug: string) =>
  apiPost<{ slug: string }>(`/api/wiki/papierkorb/${encodeURIComponent(slug)}`);

export const loescheEndgueltig = (slug: string) =>
  apiDelete<{ ok: true }>(`/api/wiki/papierkorb/${encodeURIComponent(slug)}`);

export const neuIndizieren = () => apiPost<{ seiten: number }>('/api/wiki/neu-indizieren');

export const ladeAenderungsFilter = () =>
  apiGet<{ autoren: string[]; seiten: { slug: string; titel: string }[] }>('/api/wiki/aenderungen/filter');
