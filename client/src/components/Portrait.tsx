import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CropEditor } from './CropEditor';
import { useReadOnly } from './displayMode';

// Porträt eines Charakters oder einer Gruppe. `kind`+`id` statt eines festen
// Pfads: beide teilen sich dieselbe Auf-/Abbau-Fläche, nur die URL
// (`/api/characters/:id/portrait` bzw. `/api/groups/:id/portrait`)
// unterscheidet sich.
//
// Der Ausschnitt wird interaktiv gewählt (CropEditor) statt automatisch auf
// die Mitte zugeschnitten — daraus entstehen ZWEI JPEGs: die 512px-
// Anzeigegröße hier, plus ein größeres Master-Bild unter `/portrait/full`,
// das nur die Vergrößerungs-Ansicht (Klick aufs Bild) lädt.
export function Portrait({
  kind = 'character',
  id,
  initialHasImage,
  sheetId,
}: {
  kind?: 'character' | 'group';
  id: number;
  initialHasImage: boolean;
  /** Mehrere Bögen: das Porträt gehört zum Bogen. Ohne Angabe der aktive. */
  sheetId?: number;
}) {
  const readOnly = useReadOnly();
  const [hasImage, setHasImage] = useState(initialHasImage);
  const [version, setVersion] = useState(0); // Cache-Buster nach Änderungen
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/${kind === 'group' ? 'groups' : 'characters'}/${id}/portrait`;
  const sq = kind === 'character' && sheetId ? `?sheet=${sheetId}` : '';
  const src = `${base}?v=${version}${sq ? `&sheet=${sheetId}` : ''}`;
  const fullSrc = `${base}/full?v=${version}${sq ? `&sheet=${sheetId}` : ''}`;

  const putBlob = async (path: string, blob: Blob, contentType = 'image/jpeg') => {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      throw new Error((msg as { error?: string }).error ?? 'Hochladen fehlgeschlagen');
    }
  };

  const confirmCrop = async (display: Blob, full: Blob) => {
    const original = cropFile;
    setCropFile(null);
    setError('');
    setBusy(true);
    try {
      await putBlob(`${base}${sq}`, display);
      await putBlob(`${base}/full${sq}`, full);
      // Unbeschnittenes Original für die Vergrößerungs-Ansicht — best effort:
      // ein Fehler hier soll den bereits erfolgreichen Anzeige-/Master-Upload
      // nicht als Ganzes fehlschlagen lassen.
      if (original) await putBlob(`${base}/original${sq}`, original, original.type || 'image/jpeg').catch(() => {});
      setHasImage(true);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${base}${sq}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Entfernen fehlgeschlagen');
      setHasImage(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portrait">
      {hasImage ? (
        <button
          type="button"
          className="portrait-img-btn"
          onClick={() => setEnlarged(true)}
          title="Vergrößern"
        >
          <img className="portrait-img" src={src} alt="Porträt" />
        </button>
      ) : (
        <div className="portrait-empty" aria-hidden>
          Kein Bild
        </div>
      )}
      {!readOnly && (
        <div className="portrait-actions">
          <button className="small" disabled={busy} onClick={() => fileRef.current?.click()}>
            {hasImage ? 'Ändern' : 'Bild hochladen'}
          </button>
          {hasImage && (
            <button className="small" disabled={busy} onClick={remove}>
              Entfernen
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCropFile(f);
          e.target.value = '';
        }}
      />
      {error && <div className="error portrait-error">{error}</div>}
      {cropFile && <CropEditor file={cropFile} onCancel={() => setCropFile(null)} onConfirm={confirmCrop} />}
      {enlarged &&
        // Portal, wie in PortraitView.tsx (siehe dortiger Kommentar): eine
        // `position: fixed`-Lightbox als DOM-Nachfahre eines Elements mit
        // `:hover`-Transform (z. B. `.card`) bricht auf dessen Box um statt
        // den Viewport zu füllen und flackert bei Hover in einer Schleife.
        createPortal(
          <div className="portrait-lightbox" onClick={() => setEnlarged(false)}>
            <img className="portrait-lightbox-img" src={fullSrc} alt="Porträt (vergrößert)" />
          </div>,
          document.body,
        )}
    </div>
  );
}
