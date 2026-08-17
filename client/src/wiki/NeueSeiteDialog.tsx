import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { legeSeiteAn } from './api';

// Creating a page. Same shape as the inventory's fill-first dialogs: local
// state per field, reset on close, commit guarded by a non-empty name, Enter
// commits, footer is Abbrechen + a primary verb.

export default function NeueSeiteDialog({
  open,
  onClose,
  onAngelegt,
  titelVorgabe = '',
}: {
  open: boolean;
  onClose: () => void;
  onAngelegt: (slug: string) => void;
  /** Pre-filled when the dialog was reached from a red link. */
  titelVorgabe?: string;
}) {
  const [titel, setTitel] = useState(titelVorgabe);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (open) {
      setTitel(titelVorgabe);
      setFehler('');
      setLaeuft(false);
    }
  }, [open, titelVorgabe]);

  const anlegen = async () => {
    const name = titel.trim();
    if (!name || laeuft) return;
    setLaeuft(true);
    setFehler('');
    try {
      const { slug } = await legeSeiteAn(name);
      onClose();
      onAngelegt(slug);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen');
      setLaeuft(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Neue Seite"
      footer={
        <>
          <button className="small" onClick={onClose}>
            Abbrechen
          </button>
          <button className="primary" onClick={() => void anlegen()} disabled={!titel.trim() || laeuft}>
            Seite anlegen
          </button>
        </>
      }
    >
      <div className="dlg-field">
        <label>Titel</label>
        <input
          autoFocus
          value={titel}
          onChange={(e) => setTitel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void anlegen();
          }}
          placeholder="z. B. Die Straße nach Gareth"
        />
      </div>
      {fehler && <p className="error">{fehler}</p>}
    </Dialog>
  );
}
