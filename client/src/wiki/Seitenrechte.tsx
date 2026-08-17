import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WikiSeiteVoll } from '@shared/wikiTypen';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { loescheSeite, setzeFlags } from './api';

// The GM's controls on a page: visibility, protection, delete.
//
// Deliberately a strip on the page rather than a settings dialog somewhere
// else. These three switches are read far more often than they are flipped —
// „is this one still secret?" is a question you ask while looking at the page,
// and an answer that requires opening a dialog is an answer nobody checks.
//
// Both switches write a metadata row into the change log, so „since when is
// this protected, and who did that?" has an answer.

export default function WikiSeitenrechte({
  seite,
  onGeaendert,
}: {
  seite: WikiSeiteVoll;
  onGeaendert: () => void;
}) {
  const navigate = useNavigate();
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
      <ConfirmDeleteButton
        className="small"
        title={`„${seite.titel}" in den Papierkorb legen`}
        onConfirm={() => void loeschen()}
      >
        In den Papierkorb
      </ConfirmDeleteButton>
      {fehler && <span className="error">{fehler}</span>}
    </div>
  );
}
