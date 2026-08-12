import { Link } from 'react-router-dom';

// Einheitlicher Zurück-Link im Kopf charakterbezogener Seiten (Verwaltung,
// Einstellungen): führt zurück auf den Charakterbogen — optional direkt auf den
// Reiter, von dem man kam. Ein gemeinsames Muster, damit man nicht über die
// Kopfleiste zurücknavigieren muss.
export function BackToSheet({ charId, tab, name }: { charId: number; tab?: string; name?: string }) {
  const to = tab ? `/charakter/${charId}?tab=${encodeURIComponent(tab)}` : `/charakter/${charId}`;
  return (
    <Link className="muted back-to-sheet" to={to}>
      ← {name || 'Zum Charakterbogen'}
    </Link>
  );
}
