import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';

// Interaktiver quadratischer Bildausschnitt: der Nutzer zieht das Bild unter
// einem festen Rahmen hindurch und zoomt per Regler, statt sich (wie bisher)
// mit einem automatischen Mittenausschnitt abzufinden. Liefert am Ende ZWEI
// JPEGs aus demselben Ausschnitt — eine kleine Anzeigegröße und ein größeres
// Master-Bild für die Vergrößerungs-Ansicht (siehe assets/portraits.ts auf dem
// Server, wo beide unter eigenen Rollen abgelegt werden). Reines Canvas, keine
// Bildbibliothek — der Server hat nie eine gehabt und soll auch keine brauchen.
const VIEWPORT = 280; // CSS-Pixel des quadratischen Rahmens im Dialog
const DISPLAY_SIZE = 512;
const FULL_MAX = 1600;
const QUALITY = 0.85;
const MAX_ZOOM = 4;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kein gültiges Bild'));
    img.src = url;
  });
}

function cropToJpeg(img: HTMLImageElement, cropX: number, cropY: number, cropSide: number, outSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas nicht verfügbar'));
      return;
    }
    ctx.drawImage(img, cropX, cropY, cropSide, cropSide, 0, 0, outSize, outSize);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', QUALITY);
  });
}

export function CropEditor({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (display: Blob, full: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // `pos`: CSS-Offset der oberen linken Bildecke relativ zum Rahmen (meist
  // negativ — das Bild ist größer als der Rahmen und ragt darüber hinaus).
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);

  useEffect(() => {
    let aktuell = true;
    const url = URL.createObjectURL(file);
    loadImage(url)
      .then((i) => {
        if (aktuell) setImg(i);
      })
      .catch((e) => aktuell && setError(e instanceof Error ? e.message : 'Fehler'));
    return () => {
      aktuell = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // minScale: die Skalierung, bei der die KLEINERE Bildkante den Rahmen exakt
  // füllt — das Bild darf nie kleiner als der Rahmen dargestellt werden, sonst
  // gäbe es Lücken am Rand.
  const minScale = img ? VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = minScale * zoom;
  const dispW = img ? img.naturalWidth * scale : VIEWPORT;
  const dispH = img ? img.naturalHeight * scale : VIEWPORT;

  const clamp = (p: { x: number; y: number }, w: number, h: number) => ({
    x: Math.min(0, Math.max(VIEWPORT - w, p.x)),
    y: Math.min(0, Math.max(VIEWPORT - h, p.y)),
  });

  // Zoom ändert die Bildgröße unter derselben Rahmenmitte — sonst „springt"
  // das Bild beim Ziehen des Reglers sichtbar aus der Mitte.
  const setZoomClamped = (nextZoom: number) => {
    if (!img) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
    const nextScale = minScale * z;
    const cx = VIEWPORT / 2 - pos.x;
    const cy = VIEWPORT / 2 - pos.y;
    const ratio = nextScale / scale;
    const nextPos = { x: VIEWPORT / 2 - cx * ratio, y: VIEWPORT / 2 - cy * ratio };
    setZoom(z);
    setPos(clamp(nextPos, img.naturalWidth * nextScale, img.naturalHeight * nextScale));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: pos };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !img) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clamp({ x: dragRef.current.startPos.x + dx, y: dragRef.current.startPos.y + dy }, dispW, dispH));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    setError('');
    try {
      // Zurück in Original-Bildkoordinaten: der Rahmen zeigt gerade das
      // Rechteck [-pos.x, -pos.y, VIEWPORT, VIEWPORT] im skalierten Bild —
      // durch `scale` geteilt landet man wieder bei den echten Pixeln.
      const cropX = -pos.x / scale;
      const cropY = -pos.y / scale;
      const cropSide = VIEWPORT / scale;
      const fullSize = Math.min(FULL_MAX, Math.round(cropSide));
      const [display, full] = await Promise.all([
        cropToJpeg(img, cropX, cropY, cropSide, DISPLAY_SIZE),
        cropToJpeg(img, cropX, cropY, cropSide, fullSize),
      ]);
      onConfirm(display, full);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Bildausschnitt wählen"
      footer={
        <>
          <button className="small" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
          <button className="small" onClick={confirm} disabled={!img || busy}>
            {busy ? 'Speichert…' : 'Übernehmen'}
          </button>
        </>
      }
    >
      <p className="crop-hint muted">Ziehen zum Verschieben, Regler zum Zoomen.</p>
      <div
        className="crop-viewport"
        style={{ width: VIEWPORT, height: VIEWPORT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {img && (
          <img
            className="crop-img"
            src={img.src}
            alt=""
            draggable={false}
            style={{ width: dispW, height: dispH, transform: `translate(${pos.x}px, ${pos.y}px)` }}
          />
        )}
      </div>
      <input
        type="range"
        className="crop-zoom"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(e) => setZoomClamped(Number(e.target.value))}
        disabled={!img}
      />
      {error && <p className="error crop-error">{error}</p>}
    </Dialog>
  );
}
