import { useState } from 'react';
import { createPortal } from 'react-dom';

// Read-only Gegenstück zu Portrait.tsx: klickbar/vergrößerbar, aber ohne
// Upload/Entfernen-UI — für Stellen, die ein fremdes Porträt nur ANZEIGEN
// (Gruppenkarte, GM-Übersicht, VTT-Initiative, Gruppen-Zusammenfassung). Die
// Vergrößerung zeigt automatisch das unbeschnittene Original, falls
// vorhanden — das entscheidet allein der Server (`/portrait/full`).
//
// Die Lightbox wird per createPortal an document.body gehängt, NICHT inline
// im Baum belassen: auf der Gruppenkarte steckt dieser Button in einem
// `.card` (ClickableCard), und `.card:hover` setzt `transform`, was JEDEN
// `position: fixed`-Nachfahren auf die Box der Karte statt den Viewport
// bezieht (CSS-Containing-Block-Regel). Die Lightbox schrumpfte dadurch auf
// die Kartengröße UND rutschte hinter die sticky Tab-Leiste — und weil
// „Maus über der Lightbox" per CSS immer auch „.card gehovert" bedeutet
// (Hover gilt für alle Vorfahren im DOM, unabhängig davon, wo ein fixed
// positioniertes Kind tatsächlich zu liegen kommt), kippte der Transform bei
// jeder Positionsänderung erneut um — eine sich selbst antreibende Hover-
// Fixed-Schleife, sichtbar als Flackern, sobald die Maus nicht exakt auf dem
// (falsch positionierten) Bild ruhte. Ein Portal löst die Lightbox aus dem
// Karten-DOM heraus, damit sie nie ein Nachfahre von `.card` ist.
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
      {enlarged &&
        createPortal(
          <div
            className="portrait-lightbox"
            onClick={(e) => {
              e.stopPropagation();
              setEnlarged(false);
            }}
          >
            <img className="portrait-lightbox-img" src={`${base}/full`} alt={`${alt} (vergrößert)`} />
          </div>,
          document.body,
        )}
    </>
  );
}
