import { useRef, useState } from 'react';
import { CropEditor } from './CropEditor';

// Eigenes Bild fürs Brett (VTT-Marke), getrennt vom Bogen-Porträt (siehe
// TODO.md/Konzeptnotizen "VTT token appearance") — z. B. ein HeroForge-
// Top-down-Render der Miniatur, das nicht zwangsläufig zum Porträt passt.
// Strukturell wie components/Portrait.tsx, aber nur EINE Größe: der Token
// wird immer klein (rund) gezeigt, keine Vergrößerungs-Ansicht nötig, also
// auch kein Master-/Original-Bild wie beim Porträt — CropEditor liefert zwar
// zwei Blobs, hier wird nur die kleinere Anzeigegröße tatsächlich hochgeladen.
export function MarkenBild({ charId, initialHasImage }: { charId: number; initialHasImage: boolean }) {
  const [hasImage, setHasImage] = useState(initialHasImage);
  const [version, setVersion] = useState(0); // Cache-Buster nach Änderungen
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/characters/${charId}/token-image`;
  const src = `${base}?v=${version}`;

  const confirmCrop = async (display: Blob) => {
    setCropFile(null);
    setError('');
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: display,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error((msg as { error?: string }).error ?? 'Hochladen fehlgeschlagen');
      }
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
      const res = await fetch(base, { method: 'DELETE', credentials: 'same-origin' });
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
    <div className="marken-bild">
      {hasImage ? (
        <img className="marken-bild-img" src={src} alt="Marken-Bild" />
      ) : (
        <div className="marken-bild-img marken-bild-empty" aria-hidden>
          Kein Bild
        </div>
      )}
      <div className="marken-bild-actions">
        <button className="small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {hasImage ? 'Ändern' : 'Bild hochladen'}
        </button>
        {hasImage && (
          <button className="small" disabled={busy} onClick={remove}>
            Entfernen
          </button>
        )}
      </div>
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
      {error && <div className="error marken-bild-error">{error}</div>}
      {cropFile && <CropEditor file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(display) => confirmCrop(display)} />}
    </div>
  );
}
