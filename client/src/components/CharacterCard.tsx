import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ClickableCard from './ClickableCard';

// Karte, die auf einen Charakter verlinkt — ganzflächig klickbar, nicht nur der
// Name. Von /charaktere (Charaktere.tsx) UND der Gruppenseite (Group.tsx)
// geteilt, weil „einen Charakter aus einer Karte anwählen" dasselbe Verhalten
// ist, auch wenn die beiden Seiten unterschiedliche Felder zeigen (Porträt nur
// auf der Gruppenseite, ein Gruppen-Erbitten-Select nur auf /charaktere).
export default function CharacterCard({
  id,
  name,
  subtitle,
  portrait,
  extra,
}: {
  id: number;
  name: string;
  subtitle: ReactNode;
  /** Nur die Gruppenseite hat ein Porträt-Feld; weggelassen = die schlichte Kartenform ohne Porträtspalte. */
  portrait?: boolean;
  /** Zusätzlicher interaktiver Inhalt unterhalb (z. B. das Gruppen-Erbitten-Select) — klickt nicht die Karte an. */
  extra?: ReactNode;
}) {
  const to = `/charakter/${id}`;
  const hasPortrait = portrait !== undefined;

  return (
    <ClickableCard to={to} className={hasPortrait ? 'card--char' : undefined}>
      {hasPortrait &&
        (portrait ? (
          <img className="gm-card-portrait" src={`/api/characters/${id}/portrait`} alt="" />
        ) : (
          <div className="gm-card-portrait gm-card-portrait--empty" aria-hidden="true" />
        ))}
      <div className={hasPortrait ? 'card--char-ident' : undefined}>
        <h3>
          {/* Eigener Link im Namen, nicht bloß der Karten-Klick: Mittelklick/Strg-Klick
              zum Öffnen in einem neuen Tab funktioniert sonst nicht. */}
          <Link to={to} onClick={(e) => e.stopPropagation()}>
            {name}
          </Link>
        </h3>
        <span className="muted">{subtitle}</span>
        {extra && (
          <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
            {extra}
          </div>
        )}
      </div>
    </ClickableCard>
  );
}
