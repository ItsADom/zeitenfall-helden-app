import { useEffect, useState } from 'react';
import { apiGet } from '../../api';
import { useDicePanel } from './DicePanelProvider';
import { PROBE_KIND_LABEL, type RollableProbe } from './rollableProbes';

// „Probe anfordern" auf der Spielleiter-Übersicht: der einzige Weg, eine Probe
// von einem Spieler zu erbitten, ohne dessen Bogen zu öffnen — genau dafür
// gedacht, wenn am Tisch jemand „würfel mal Sinnesschärfe" hört.
//
// Die Liste kommt erst beim Öffnen vom Server (sie ist lang und wird selten
// gebraucht) und wird wie die Talent-Abfrage daneben durchsucht.

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
  // Situative Erleichterung(-)/Erschwernis(+), von der Spielleitung schon bei
  // der Anfrage vorgegeben — ersetzt beim Annehmen den eigenen Modifikator
  // des Spielers vollständig (siehe PendingRollRequest.modifier). Wie
  // ModifierPicker gilt sie nur für DIESE eine Anfrage, deshalb zurück auf 0
  // nach dem Senden.
  const [modifier, setModifier] = useState(0);
  const pick = (source: RollableProbe['source']) => {
    requestProbe(groupId, targetUserId, charId, source, modifier || undefined);
    setOpen(false);
    setQuery('');
    setModifier(0);
  };

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
      <button
        className="small gm-request-open"
        // probes zurücksetzen statt nur öffnen: sonst zeigt ein erneutes
        // Öffnen den Stand vom letzten Mal (z. B. eine inzwischen entfernte
        // Waffe), und das Anfordern endet nur in einer Fehlermeldung, weil
        // die Probe serverseitig längst nicht mehr existiert.
        onClick={() => {
          setProbes(null);
          setOpen(true);
        }}
        title={`Eine Probe von ${charName} erbitten`}
      >
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
            if (e.key === 'Enter' && matches[0]) pick(matches[0].source);
          }}
        />
        <label className="gm-request-mod" title="Erleichterung (−) oder Erschwernis (+) für diese Anfrage — ersetzt beim Annehmen den eigenen Modifikator des Spielers">
          Mod.
          <input
            type="number"
            value={modifier}
            onChange={(e) => setModifier(Math.trunc(Number(e.target.value)) || 0)}
          />
        </label>
        <button className="small" onClick={() => setOpen(false)} title="Schließen">
          ✕
        </button>
      </div>
      {matches.length > 0 && (
        <ul className="gm-request-results">
          {matches.map((p, i) => (
            <li key={i}>
              <button onClick={() => pick(p.source)}>
                {p.label}
                <span className="muted"> · {PROBE_KIND_LABEL[p.kind]} · {p.probeZahl}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q && probes && matches.length === 0 && <p className="muted gm-request-empty">Nichts gefunden.</p>}
    </div>
  );
}
