import { Link } from 'react-router-dom';
import type { WikiLogEintrag } from '@shared/wikiTypen';

// Shared vocabulary for the two change-log surfaces: one page's history and the
// wiki-wide feed. Both render the same row, so both read the same labels — a
// second copy would drift the day somebody adds an event kind.

/**
 * SQLite writes `datetime('now')`, which is UTC without a zone marker. Handing
 * that string to `new Date()` makes the browser read it as LOCAL time, so an
 * evening edit shows up two hours early. The Z is not optional.
 */
export function alsDatum(s: string): Date {
  return new Date(`${s.replace(' ', 'T')}Z`);
}

export function zeitText(s: string): string {
  const d = alsDatum(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ART_TEXT: Record<WikiLogEintrag['art'], string> = {
  angelegt: 'angelegt',
  bearbeitet: 'bearbeitet',
  umbenannt: 'umbenannt',
  geloescht: 'gelöscht',
  wiederhergestellt: 'wiederhergestellt',
  sichtbarkeit: 'Sichtbarkeit geändert',
  geschuetzt: 'Schutz geändert',
};

export const artText = (art: WikiLogEintrag['art']): string => ART_TEXT[art] ?? art;

/** +n/−m, but only where there is something to show. */
export function Bilanz({ eintrag }: { eintrag: WikiLogEintrag }) {
  if (eintrag.zeilenPlus === 0 && eintrag.zeilenMinus === 0) return null;
  return (
    <span className="wiki-bilanz">
      {eintrag.zeilenPlus > 0 && <span className="wiki-bilanz-plus">+{eintrag.zeilenPlus}</span>}
      {eintrag.zeilenMinus > 0 && <span className="wiki-bilanz-minus">−{eintrag.zeilenMinus}</span>}
    </span>
  );
}

/** The „Titel: alt → neu" line a metadata row carries instead of a text. */
export function Feldwechsel({ eintrag }: { eintrag: WikiLogEintrag }) {
  if (!eintrag.feld) return null;
  return (
    <span className="muted wiki-log-feld">
      {eintrag.altWert || '—'} → {eintrag.neuWert || '—'}
    </span>
  );
}

/**
 * One row of the wiki-wide feed. The page's own history renders its rows
 * itself, because there the page title is redundant and the comparison
 * checkboxes are not.
 */
export function LogZeile({ eintrag }: { eintrag: WikiLogEintrag }) {
  return (
    <li className="wiki-log-zeile">
      <div className="wiki-log-kopf">
        <Link to={`/wiki/${eintrag.slug}`}>{eintrag.titel}</Link>
        <span className="muted">
          {artText(eintrag.art)} · {eintrag.autorName || 'unbekannt'} · {zeitText(eintrag.erstelltAm)}
        </span>
        <Bilanz eintrag={eintrag} />
      </div>
      <Feldwechsel eintrag={eintrag} />
      {eintrag.kommentar && <div className="wiki-log-kommentar">„{eintrag.kommentar}"</div>}
      {eintrag.hatText && (
        <Link className="small wiki-log-link" to={`/wiki/${eintrag.slug}/verlauf?rev=${eintrag.id}`}>
          Unterschiede
        </Link>
      )}
    </li>
  );
}
