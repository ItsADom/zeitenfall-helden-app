import { useEffect, useState } from 'react';
import type { ProbeSource } from '@shared/diceProtocol';
import { apiGet } from '../../api';
import { useDicePanel } from './DicePanelProvider';

// „Probe anfordern" auf der Spielleiter-Übersicht: der einzige Weg, eine Probe
// von einem Spieler zu erbitten, ohne dessen Bogen zu öffnen — genau dafür
// gedacht, wenn am Tisch jemand „würfel mal Sinnesschärfe" hört.
//
// Die Liste kommt erst beim Öffnen vom Server (sie ist lang und wird selten
// gebraucht) und wird wie die Talent-Abfrage daneben durchsucht.

interface RollableProbe {
  source: ProbeSource;
  label: string;
  n: number;
  probeZahl: number;
  kind: 'attribute' | 'talent' | 'ability' | 'sprache' | 'weapon';
}

const KIND_LABEL: Record<RollableProbe['kind'], string> = {
  attribute: 'Eigenschaft',
  talent: 'Talent',
  ability: 'Zauber/Fähigkeit',
  sprache: 'Sprache',
  weapon: 'Waffe',
};

const MAX_RESULTS = 12;

export default function RequestProbePicker({
  groupId,
  charId,
  targetUserId,
  charName,
}: {
  groupId: number;
  charId: number;
  targetUserId: number;
  charName: string;
}) {
  const { requestProbe } = useDicePanel();
  const [open, setOpen] = useState(false);
  const [probes, setProbes] = useState<RollableProbe[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || probes) return;
    apiGet<RollableProbe[]>(`/api/characters/${charId}/probes`)
      .then(setProbes)
      .catch(() => setProbes([]));
  }, [open, probes, charId]);

  const q = query.trim().toLowerCase();
  const matches = q ? (probes ?? []).filter((p) => p.label.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];

  if (!open) {
    return (
      <button className="small gm-request-open" onClick={() => setOpen(true)} title={`Eine Probe von ${charName} erbitten`}>
        🎲 Probe anfordern
      </button>
    );
  }

  return (
    <div className="gm-request">
      <div className="gm-request-row">
        <input
          autoFocus
          type="text"
          placeholder={probes ? 'Probe suchen…' : 'Lädt…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && matches[0]) {
              requestProbe(groupId, targetUserId, charId, matches[0].source);
              setOpen(false);
              setQuery('');
            }
          }}
        />
        <button className="small" onClick={() => setOpen(false)} title="Schließen">
          ✕
        </button>
      </div>
      {matches.length > 0 && (
        <ul className="gm-request-results">
          {matches.map((p, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  requestProbe(groupId, targetUserId, charId, p.source);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {p.label}
                <span className="muted"> · {KIND_LABEL[p.kind]} · {p.probeZahl}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && probes && matches.length === 0 && <p className="muted gm-request-empty">Nichts gefunden.</p>}
    </div>
  );
}
