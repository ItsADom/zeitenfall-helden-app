import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ResourceKey } from '@shared/types';
import { apiGet } from '../api';
import { depletionClass, overfilled } from '../components/energie';

// Spielleiter-Übersicht: alle Charaktere einer Gruppe als Karten, ihre
// wichtigsten Kennwerte als Chips. Nur-Lesen (die Route dahinter ist requireGm).

interface Vital {
  key: string; // le | aus | ase | psyche
  aktuell: number;
  max: number;
}
interface OverviewChar {
  id: number;
  name: string;
  ownerName: string;
  stufe: number;
  portrait: boolean;
  vitals: Vital[];
  thresholds: { wund: number; tod: number };
  attributes: { code: string; value: number }[];
}
interface OverviewData {
  group: { id: number; name: string };
  characters: OverviewChar[];
}

const VITAL_LABELS: Record<string, string> = { le: 'LE', aus: 'AUS', ase: 'AsE', psyche: 'Psyche' };

// Takt der stillen Auto-Aktualisierung, solange die Übersicht sichtbar offen ist.
const POLL_MS = 15000;

// Färbung eines Vital-Chips: Überladung hat Vorrang, sonst Zehrung — aber
// Zehrung nur für die vitalen Pools (LE/AUS), wie im Heldenbrief. Psyche/AsE
// bekommen kein Dauer-Rot, nur die Überladungs-Färbung.
function vitalClass(key: string, aktuell: number, max: number): string {
  if (overfilled(aktuell, max)) return 'res-over';
  if (key === 'le' || key === 'aus') return depletionClass(key as ResourceKey, aktuell, max);
  return '';
}

export default function GroupOverviewPage() {
  const { id } = useParams();
  const groupId = Number(id);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');

  // quiet=true: stille Hintergrund-Aktualisierung, der bisherige Stand bleibt
  // stehen, bis neue Daten da sind (gleiches Muster wie die Gruppenseite).
  const loadOverview = useCallback(
    (quiet = false) => {
      if (!quiet) setData(null);
      return apiGet<OverviewData>(`/api/groups/${groupId}/overview`)
        .then(setData)
        .catch((e) => {
          if (!quiet) setError(e instanceof Error ? e.message : 'Fehler');
        });
    },
    [groupId],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Still folgen die Karten dem Spielgeschehen, ohne dass der Spielleiter neu
  // laden muss: bei Rückkehr auf Reiter/Fenster UND regelmäßig, solange die
  // Ansicht offen ist (der Spielleiter bleibt meist hier). Das Intervall ruht,
  // wenn der Reiter verborgen ist — kein Nachladen im Hintergrund.
  useEffect(() => {
    const reloadIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadOverview(true);
    };
    const timer = window.setInterval(reloadIfVisible, POLL_MS);
    window.addEventListener('focus', reloadIfVisible);
    document.addEventListener('visibilitychange', reloadIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reloadIfVisible);
      document.removeEventListener('visibilitychange', reloadIfVisible);
    };
  }, [loadOverview]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Lade…</p>;

  return (
    <>
      <p className="muted">
        <Link to={`/gruppe/${groupId}`}>← Zur Gruppe</Link>
      </p>
      <h1>Übersicht: {data.group.name}</h1>

      {data.characters.length === 0 ? (
        <p className="muted">Keine Charaktere in dieser Gruppe.</p>
      ) : (
        <div className="gm-cards">
          {data.characters.map((c) => (
            <div className="gm-card" key={c.id}>
              <div className="gm-card-head">
                {c.portrait ? (
                  <img className="gm-card-portrait" src={`/api/characters/${c.id}/portrait`} alt="" />
                ) : (
                  <div className="gm-card-portrait gm-card-portrait--empty" aria-hidden="true" />
                )}
                <div className="gm-card-ident">
                  <h3>
                    <Link to={`/charakter/${c.id}`}>{c.name}</Link>
                  </h3>
                  <span className="muted">{c.ownerName}</span>
                </div>
                <span className="gm-stufe" title="Stufe">
                  Stufe {c.stufe}
                </span>
              </div>

              <div className="gm-chips">
                {c.vitals.map((v) => (
                  <span className={`gm-chip gm-chip--vital ${vitalClass(v.key, v.aktuell, v.max)}`} key={v.key}>
                    <span className="gm-chip-label">{VITAL_LABELS[v.key] ?? v.key}</span>
                    <span className="gm-chip-val">
                      {v.aktuell}/{v.max}
                    </span>
                  </span>
                ))}
              </div>

              <div className="gm-chips">
                <span className="gm-chip" title="Wundschwelle">
                  <span className="gm-chip-label">Wund</span>
                  <span className="gm-chip-val">{c.thresholds.wund}</span>
                </span>
                <span className="gm-chip" title="Todesschwelle">
                  <span className="gm-chip-label">Tod</span>
                  <span className="gm-chip-val">{c.thresholds.tod}</span>
                </span>
              </div>

              <div className="gm-chips gm-chips--attr">
                {c.attributes.map((a) => (
                  <span className="gm-chip gm-chip--attr" key={a.code} title={a.code}>
                    <span className="gm-chip-label">{a.code}</span>
                    <span className="gm-chip-val">{a.value}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
