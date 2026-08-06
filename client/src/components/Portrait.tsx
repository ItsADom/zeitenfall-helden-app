import { useRef, useState } from 'react';

// Porträt eines Charakters. Das Bild wird vor dem Hochladen im Browser auf ein
// quadratisches Format zugeschnitten (mittiger Ausschnitt) und auf eine feste
// Kantenlänge als JPEG verkleinert — so bleibt die Ablage klein und das Format
// einheitlich, ohne Server-Bildbibliothek. Übertragen wird der fertige Blob roh.
const SIZE = 512;
const QUALITY = 0.85;

// Mittiger quadratischer Ausschnitt, auf SIZE skaliert, als JPEG-Blob.
function centerCropToJpeg(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) {
        reject(new Error('Bild konnte nicht gelesen werden'));
        return;
      }
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas nicht verfügbar'));
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kein gültiges Bild'));
    };
    img.src = url;
  });
}

export function Portrait({ charId, initialHasImage }: { charId: number; initialHasImage: boolean }) {
  const [hasImage, setHasImage] = useState(initialHasImage);
  const [version, setVersion] = useState(0); // Cache-Buster nach Änderungen
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const src = `/api/characters/${charId}/portrait?v=${version}`;

  const upload = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const blob = await centerCropToJpeg(file);
      const res = await fetch(`/api/characters/${charId}/portrait`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
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
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/characters/${charId}/portrait`, { method: 'DELETE', credentials: 'same-origin' });
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
        <img className="portrait-img" src={src} alt="Porträt" />
      ) : (
        <div className="portrait-empty" aria-hidden>
          Kein Bild
        </div>
      )}
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      {error && <div className="error portrait-error">{error}</div>}
    </div>
  );
}
