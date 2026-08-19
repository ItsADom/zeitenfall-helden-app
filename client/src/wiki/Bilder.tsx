import { useCallback, useEffect, useRef, useState } from 'react';
import { CollapsiblePanel } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import type { WikiBildInfo } from './api';
import { ladeBilder, loescheBild } from './api';
import { ladeBildHoch, skaliereBild } from './bildUpload';

// The editor's image panel: upload, then click to drop `[[bild:slug]]` into the
// text at the cursor.
//
// Uploading and embedding are two steps on purpose. An image belongs to the
// page as soon as it is uploaded — that is what puts it in helden-assets.db and
// on the weekly backup cycle — but where it appears in the text is a writing
// decision, and it may appear twice or not at all.

export default function WikiBilder({
  slug,
  istGm,
  onEinfuegen,
}: {
  slug: string;
  istGm: boolean;
  /** Inserts the markup at the caret — the editor owns the textarea. */
  onEinfuegen: (markup: string) => void;
}) {
  const [bilder, setBilder] = useState<WikiBildInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const [nurSl, setNurSl] = useState(false);
  const dateiRef = useRef<HTMLInputElement>(null);

  const laden = useCallback(() => {
    ladeBilder(slug)
      .then((d) => setBilder(d.bilder))
      .catch(() => setBilder([]));
  }, [slug]);

  useEffect(laden, [laden]);

  const hochladen = async (datei: File) => {
    setFehler('');
    setBusy(true);
    try {
      const skaliert = await skaliereBild(datei);
      // Der Dateiname ohne Endung ist die naheliegendste Beschriftung — und
      // besser als „Bild 3", weil ihn jemand bewusst vergeben hat.
      const titel = datei.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Bild';
      await ladeBildHoch(slug, skaliert, titel, nurSl);
      laden();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Hochladen fehlgeschlagen');
    } finally {
      setBusy(false);
      if (dateiRef.current) dateiRef.current.value = '';
    }
  };

  const entfernen = async (bild: WikiBildInfo) => {
    setFehler('');
    try {
      await loescheBild(slug, bild.slug);
      laden();
    } catch {
      setFehler('Das Bild konnte nicht entfernt werden.');
    }
  };

  return (
    <CollapsiblePanel collapseKey="wiki-bilder" title="Bilder" rows={bilder.length}>
      <div className="wiki-bild-aktionen screen-only">
        <button className="small" disabled={busy} onClick={() => dateiRef.current?.click()}>
          {busy ? 'Lade hoch…' : '+ Bild hochladen'}
        </button>
        {istGm && (
          <label className="wiki-bild-nursl">
            <input type="checkbox" checked={nurSl} onChange={(e) => setNurSl(e.target.checked)} />
            <span>Neue Bilder nur für die Spielleitung</span>
          </label>
        )}
        <input
          ref={dateiRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void hochladen(f);
          }}
        />
      </div>

      {fehler && <p className="error">{fehler}</p>}

      {bilder.length === 0 ? (
        <p className="muted">Noch keine Bilder auf dieser Seite.</p>
      ) : (
        <ul className="wiki-bildliste">
          {bilder.map((b) => (
            <li key={b.slug}>
              <img src={`/api/wiki/bilder/${b.slug}`} alt={b.titel} loading="lazy" />
              <div className="wiki-bildliste-text">
                <strong>{b.titel}</strong>
                {b.gmOnly && <span className="wiki-marke">nur SL</span>}
                <span className="muted">
                  {b.breite}×{b.hoehe} · {Math.round(b.bytes / 1024)} kB
                </span>
              </div>
              <div className="wiki-bildliste-aktionen screen-only">
                <button className="small" onClick={() => onEinfuegen(`[[bild:${b.slug}|${b.titel}]]`)}>
                  In den Text
                </button>
                <ConfirmDeleteButton title="Bild löschen" onConfirm={() => void entfernen(b)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {istGm && bilder.some((b) => b.gmOnly) && (
        <p className="muted wiki-bild-hinweis">
          Nur-SL-Bilder liefert der Server niemandem außer der Spielleitung aus — auch nicht über die direkte
          Adresse. Setze sie trotzdem in einen <code>```gm</code>-Abschnitt, sonst steht auf der Seite eine leere
          Stelle.
        </p>
      )}
    </CollapsiblePanel>
  );
}
