import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WikiSeiteVoll } from '@shared/wikiTypen';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { loescheSeite, setzeFlags } from './api';

// The GM's controls on a page: visibility, protection — plus delete, which
// WikiLoeschAktion below also renders standalone for a plain player. Deletion
// isn't GM-exclusive: anyone who may edit a page may also delete it
// (darfBearbeiten in zugriff.ts) — only a protected page restricts it to the
// GM, same rule as editing.
//
// Deliberately a strip on the page rather than a settings dialog somewhere
// else. These switches are read far more often than they are flipped —
// „is this one still secret?" is a question you ask while looking at the page,
// and an answer that requires opening a dialog is an answer nobody checks.
//
// Both toggles write a metadata row into the change log, so „since when is
// this protected, and who did that?" has an answer.

/** The delete control alone — used both here (for the GM) and standalone for
 * a player who may edit an unprotected page (see Seite.tsx). */
export function WikiLoeschAktion({ seite }: { seite: WikiSeiteVoll }) {
  const navigate = useNavigate();
  const [fehler, setFehler] = useState('');

  if (seite.unloeschbar) {
    return <p className="muted">Diese Systemseite kann nicht gelöscht werden. Sie soll immer da sein, wenn jemand sie braucht.</p>;
  }

  const loeschen = async () => {
    setFehler('');
    try {
      await loescheSeite(seite.slug);
      navigate('/wiki');
    } catch {
      setFehler('Die Seite konnte nicht gelöscht werden.');
    }
  };

  return (
    <>
      <ConfirmDeleteButton className="small" title={`„${seite.titel}" in den Papierkorb legen`} onConfirm={() => void loeschen()}>
        In den Papierkorb
      </ConfirmDeleteButton>
      {fehler && <span className="error">{fehler}</span>}
    </>
  );
}

export default function WikiSeitenrechte({
  seite,
  onGeaendert,
}: {
  seite: WikiSeiteVoll;
  onGeaendert: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');

  const umschalten = async (flags: { gmOnly?: boolean; geschuetzt?: boolean }) => {
    setBusy(true);
    setFehler('');
    try {
      await setzeFlags(seite.slug, flags);
      onGeaendert();
    } catch {
      setFehler('Die Einstellung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wiki-rechte screen-only">
      <label>
        <input
          type="checkbox"
          checked={seite.gmOnly}
          disabled={busy}
          onChange={(e) => void umschalten({ gmOnly: e.target.checked })}
        />
        <span>Nur Spielleitung — für Spieler existiert die Seite nicht</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={seite.geschuetzt}
          disabled={busy}
          onChange={(e) => void umschalten({ geschuetzt: e.target.checked })}
        />
        <span>Geschützt — sichtbar, aber nur die Spielleitung darf bearbeiten</span>
      </label>
      <WikiLoeschAktion seite={seite} />
      {fehler && <span className="error">{fehler}</span>}
    </div>
  );
}
