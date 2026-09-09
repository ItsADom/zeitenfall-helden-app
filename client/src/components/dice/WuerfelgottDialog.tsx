import { Dialog } from '../Dialog';

// Geheimes Easter Egg (Schwester-Ei zu Chaos-Modus/Kopfüber-Modus, App.tsx):
// „würfelgott" irgendwo in einer Chat-Nachricht öffnet dies, nur lokal bei
// der schreibenden Person (FeedColumn.tsx's send()). Das Bild liegt NICHT im
// Repo — server/data/easter-eggs/wuerfelgott.jpg wird vom Server-Owner von
// Hand abgelegt (siehe server/src/index.ts) und unter /easter-eggs/ ausgeliefert.
export default function WuerfelgottDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Der Würfelgott erhört dich"
      footer={
        <button type="button" className="small" onClick={onClose}>
          Schließen
        </button>
      }
    >
      <img
        src="/easter-eggs/wuerfelgott.jpg"
        alt="Der Würfelgott"
        style={{ display: 'block', maxWidth: '100%', borderRadius: 'var(--radius-panel)' }}
      />
    </Dialog>
  );
}
