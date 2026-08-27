import { useState } from 'react';

// Read-only Gegenstück zu Portrait.tsx: klickbar/vergrößerbar, aber ohne
// Upload/Entfernen-UI — für Stellen, die ein fremdes Porträt nur ANZEIGEN
// (Gruppenkarte, GM-Übersicht, VTT-Initiative, Gruppen-Zusammenfassung). Die
// Vergrößerung zeigt automatisch das unbeschnittene Original, falls
// vorhanden — das entscheidet allein der Server (`/portrait/full`).
export function PortraitView({
  kind = 'character',
  id,
  className,
  alt = 'Porträt',
}: {
  kind?: 'character' | 'group';
  id: number;
  /** Klassenname des `<img>` — steuert Größe/Form am Einsatzort (z. B. `gm-card-portrait`). */
  className: string;
  alt?: string;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const base = `/api/${kind === 'group' ? 'groups' : 'characters'}/${id}/portrait`;

  return (
    <>
      <button
        type="button"
        className="portrait-img-btn"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setEnlarged(true);
        }}
        title="Vergrößern"
      >
        <img className={className} src={base} alt={alt} />
      </button>
      {enlarged && (
        <div
          className="portrait-lightbox"
          onClick={(e) => {
            e.stopPropagation();
            setEnlarged(false);
          }}
        >
          <img className="portrait-lightbox-img" src={`${base}/full`} alt={`${alt} (vergrößert)`} />
        </div>
      )}
    </>
  );
}
