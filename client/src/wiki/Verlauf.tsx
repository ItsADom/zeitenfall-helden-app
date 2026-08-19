import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { WikiLogEintrag } from '@shared/wikiTypen';
import { ApiError } from '../api';
import WikiDiff from './Diff';
import { Bilanz, Feldwechsel, artText, zeitText } from './log';
import { ladeFassung, ladeVerlauf, stelleFassungHer } from './api';

// One page's history.
//
// Two revisions get picked and compared. The default pair is „this one against
// the one before it", because that is what somebody clicking an entry in the
// change log wants to see; ?rev=<id> from there preselects it.
//
// „Diese Fassung übernehmen" writes a NEW revision instead of rewinding, so the
// list only ever grows — an undo is a change like any other and belongs in the
// log next to the change it undoes.

interface Vergleich {
  alt: string;
  neu: string;
  altNr: number;
  neuNr: number;
}

export default function WikiVerlauf() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [titel, setTitel] = useState('');
  const [eintraege, setEintraege] = useState<WikiLogEintrag[] | null>(null);
  const [darfBearbeiten, setDarfBearbeiten] = useState(false);
  const [fehler, setFehler] = useState('');
  const [vergleich, setVergleich] = useState<Vergleich | null>(null);
  const [laedt, setLaedt] = useState(false);

  const laden = useCallback(() => {
    let aktuell = true;
    ladeVerlauf(slug)
      .then((d) => {
        if (!aktuell) return;
        setTitel(d.titel);
        setEintraege(d.eintraege);
        setDarfBearbeiten(d.darfBearbeiten);
      })
      .catch((e) => {
        if (!aktuell) return;
        setFehler(e instanceof ApiError && e.status === 404 ? 'Seite nicht gefunden' : 'Fehler beim Laden');
      });
    return () => {
      aktuell = false;
    };
  }, [slug]);

  useEffect(laden, [laden]);

  // Fetches both texts and shows the difference. The revision BEFORE `id` in
  // the list is the comparison partner — the oldest entry compares against the
  // empty page, which is exactly how it was written.
  const vergleiche = useCallback(
    async (id: number) => {
      if (!eintraege) return;
      const mitText = eintraege.filter((e) => e.hatText);
      const idx = mitText.findIndex((e) => e.id === id);
      if (idx === -1) return;
      const neu = mitText[idx];
      const alt = mitText[idx + 1] ?? null;
      setLaedt(true);
      setFehler('');
      try {
        const [neuText, altText] = await Promise.all([
          ladeFassung(slug, neu.id).then((d) => d.text),
          alt ? ladeFassung(slug, alt.id).then((d) => d.text) : Promise.resolve(''),
        ]);
        setVergleich({ alt: altText, neu: neuText, altNr: alt?.nr ?? 0, neuNr: neu.nr });
      } catch {
        setFehler('Die Fassungen konnten nicht geladen werden.');
      } finally {
        setLaedt(false);
      }
    },
    [eintraege, slug],
  );

  // Arriving from „Letzte Änderungen" with ?rev= — open that comparison at once.
  const revParam = params.get('rev');
  useEffect(() => {
    if (revParam && eintraege) void vergleiche(Number(revParam));
  }, [revParam, eintraege, vergleiche]);

  const uebernehmen = async (eintrag: WikiLogEintrag) => {
    setFehler('');
    try {
      await stelleFassungHer(slug, eintrag.id);
      setVergleich(null);
      setParams({}, { replace: true });
      laden();
    } catch (e) {
      setFehler(
        e instanceof ApiError && e.status === 403
          ? 'Diese Seite ist geschützt — nur die Spielleitung darf sie ändern.'
          : 'Die Fassung konnte nicht übernommen werden.',
      );
    }
  };

  if (fehler && !eintraege) return <p className="error">{fehler}</p>;
  if (!eintraege) return <p className="muted">Lade…</p>;

  // The newest content revision is the live text — restoring it would be a no-op.
  const aktuelleId = eintraege.find((e) => e.hatText)?.id ?? 0;

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Verlauf</h1>
          <p className="muted wiki-meta">
            <Link to={`/wiki/${slug}`}>{titel}</Link> · {eintraege.length}{' '}
            {eintraege.length === 1 ? 'Eintrag' : 'Einträge'}
          </p>
        </div>
        <div className="wiki-kopf-aktionen screen-only">
          <Link className="small" to="/wiki/aenderungen">
            Alle Änderungen
          </Link>
          <Link className="small" to={`/wiki/${slug}`}>
            Zur Seite
          </Link>
        </div>
      </div>

      {fehler && <p className="error">{fehler}</p>}

      {vergleich && (
        <div className="panel wiki-vergleich">
          <h3>
            {vergleich.altNr > 0 ? `Fassung ${vergleich.altNr} → ${vergleich.neuNr}` : `Fassung ${vergleich.neuNr}`}
            <button
              className="small screen-only"
              onClick={() => {
                setVergleich(null);
                setParams({}, { replace: true });
              }}
            >
              Schließen
            </button>
          </h3>
          <WikiDiff alt={vergleich.alt} neu={vergleich.neu} />
        </div>
      )}
      {laedt && <p className="muted">Lade Fassungen…</p>}

      <ul className="wiki-log">
        {eintraege.map((e) => (
          <li className="wiki-log-zeile" key={e.id}>
            <div className="wiki-log-kopf">
              <strong>{e.hatText ? `Fassung ${e.nr}` : artText(e.art)}</strong>
              <span className="muted">
                {e.hatText && e.art !== 'bearbeitet' && `${artText(e.art)} · `}
                {e.autorName || 'unbekannt'} · {zeitText(e.erstelltAm)}
              </span>
              <Bilanz eintrag={e} />
            </div>
            <Feldwechsel eintrag={e} />
            {e.kommentar && <div className="wiki-log-kommentar">„{e.kommentar}"</div>}
            {e.hatText && (
              <div className="wiki-log-aktionen screen-only">
                <button className="small" onClick={() => void vergleiche(e.id)}>
                  Unterschiede
                </button>
                {darfBearbeiten && e.id !== aktuelleId && (
                  <button className="small" onClick={() => void uebernehmen(e)}>
                    Diese Fassung übernehmen
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
