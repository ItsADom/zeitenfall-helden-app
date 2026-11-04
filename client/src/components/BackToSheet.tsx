import { Link } from 'react-router-dom';

// Einheitlicher Zurück-Link im Kopf charakterbezogener Seiten (Verwaltung,
// Einstellungen): führt zurück auf den Charakterbogen — optional direkt auf den
// Reiter, von dem man kam. Ein gemeinsames Muster, damit man nicht über die
// Kopfleiste zurücknavigieren muss.
// `sheet`: bei mehreren Bögen der Bogen, von dem man kam (sonst landet man auf dem aktiven).
export function BackToSheet({ charId, tab, name, sheet }: { charId: number; tab?: string; name?: string; sheet?: number | null }) {
  const q = new URLSearchParams();
  if (tab) q.set('tab', tab);
  if (sheet) q.set('sheet', String(sheet));
  const to = q.size ? `/charakter/${charId}?${q}` : `/charakter/${charId}`;
  return (
    <Link className="muted back-to-sheet" to={to}>
      ← {name || 'Zum Charakterbogen'}
    </Link>
  );
}
