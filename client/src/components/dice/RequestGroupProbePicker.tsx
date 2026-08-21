import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { useDicePanel } from './DicePanelProvider';
import { PROBE_KIND_LABEL, type RollableProbe } from './rollableProbes';

// „Probe von der ganzen Gruppe anfordern" — Gegenstück zu RequestProbePicker,
// aber ohne Charakter-Ziel: die Anfrage geht an JEDES gerade verbundene
// Gruppenmitglied auf einmal (server-seitig fan-out, siehe
// DicePanelProvider.requestGroupProbe/ws.ts's roll.group.request).
//
// Nur attribute/talent/sprache — deren Bedeutung ist katalogweit dieselbe
// (Attributscode bzw. Katalog-id), anders als ability/weapon, die an eigenen
// Zeilen EINES Charakters hängen und sich zwischen Mitgliedern gar nicht
// entsprechen würden. Die Liste wird deshalb bewusst von irgendeinem
// Mitglied geladen (`anyCharId`) — Katalog-Einträge sind für alle gleich,
// nur die TaW dahinter unterscheiden sich, und die zeigt diese Liste ohnehin
// nicht an.
const MAX_RESULTS = 12;

export default function RequestGroupProbePicker({ groupId, anyCharId }: { groupId: number; anyCharId: number }) {
  const { requestGroupProbe } = useDicePanel();
  const [open, setOpen] = useState(false);
  const [probes, setProbes] = useState<RollableProbe[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || probes) return;
    apiGet<RollableProbe[]>(`/api/characters/${anyCharId}/probes`)
      .then((all) => setProbes(all.filter((p) => p.kind === 'attribute' || p.kind === 'talent' || p.kind === 'sprache')))
      .catch(() => setProbes([]));
  }, [open, probes, anyCharId]);

  const q = query.trim().toLowerCase();
  const matches = q ? (probes ?? []).filter((p) => p.label.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : [];

  const pick = (p: RollableProbe) => {
    requestGroupProbe(groupId, p.source);
    setOpen(false);
    setQuery('');
  };

  if (!open) {
    return (
      <button className="small gm-request-open" onClick={() => setOpen(true)} title="Dieselbe Probe von jedem verbundenen Mitglied erbitten">
        🎲 Probe von der Gruppe anfordern
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
            if (e.key === 'Enter' && matches[0]) pick(matches[0]);
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
              <button onClick={() => pick(p)}>
                {p.label}
                <span className="muted"> · {PROBE_KIND_LABEL[p.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && probes && matches.length === 0 && <p className="muted gm-request-empty">Nichts gefunden.</p>}
    </div>
  );
}
