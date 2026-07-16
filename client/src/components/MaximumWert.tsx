// Anzeige des Maximums einer Energie. Liegt die Rohsumme über der
// Ausbaugrenze, zählt nur der gekappte Wert — die Rohsumme wird aber
// daneben durchgestrichen mitgezeigt, statt sie zu verschlucken: sie steht
// in der Datenbank und der Spieler soll sehen, dass ein Teil verfällt.
// Eine Stelle für Heldenbrief, Übersicht und Zusammenfassung.
export function MaximumWert({
  nutzbar,
  roh,
  gekappt,
  format = String,
}: {
  nutzbar: number;
  roh: number;
  gekappt: boolean;
  format?: (n: number) => string;
}) {
  if (!gekappt) return <>{format(nutzbar)}</>;
  return (
    <span
      className="gekappt"
      title={`Rechnerisch ${format(roh)} — die Ausbaugrenze kappt auf ${format(nutzbar)}`}
    >
      {format(nutzbar)}
      <s className="gekappt-roh">{format(roh)}</s>
    </span>
  );
}
