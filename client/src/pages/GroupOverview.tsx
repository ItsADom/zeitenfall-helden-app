import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ResourceKey } from '@shared/types';
import { apiGet } from '../api';
import { depletionClass, overfilled } from '../components/energie';
import { Field } from '../components/inputs';
import { usePersistedState } from '../components/persist';

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
  talents: { id: number; taw: number }[];
}
interface CatalogTalent {
  id: number;
  name: string;
  gruppe: string;
}
interface OverviewData {
  group: { id: number; name: string };
  talentCatalog: CatalogTalent[];
  characters: OverviewChar[];
}

// Kürzel wie in der Seitenleiste (RES_ABBR): LP/AUS/ASP, plus Psyche.
const VITAL_LABELS: Record<string, string> = { le: 'LP', aus: 'AUS', ase: 'ASP', psyche: 'Psyche' };

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

  // Talent-Abfrage: der Spielleiter tippt einen Talentnamen, angepinnte Talente
  // erscheinen als Spalte auf jeder Karte. Die Auswahl überlebt Reload/Poll und
  // ist je Gruppe gemerkt (client-seitig — reine Anzeigehilfe, kein Serverstand).
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = usePersistedState<number[]>(`gm-poll:${groupId}`, []);
  const pin = (tid: number) => {
    setPinned((p) => (p.includes(tid) ? p : [...p, tid]));
    setQuery('');
  };
  const unpin = (tid: number) => setPinned((p) => p.filter((x) => x !== tid));

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

  // Vorschläge aus dem GESAMTEN Katalog (auch Talente, die niemand kann → überall
  // „–"), Name oder Gruppe treffen, bereits Angepinntes ausgeblendet.
  const q = query.trim().toLowerCase();
  const matches = q
    ? data.talentCatalog
        .filter(
          (t) =>
            !pinned.includes(t.id) &&
            (t.name.toLowerCase().includes(q) || t.gruppe.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : [];
  // Angepinnte Talente in Anpinn-Reihenfolge; verwaiste IDs (Katalog geändert)
  // fallen still weg.
  const pinnedTalents = pinned
    .map((tid) => data.talentCatalog.find((t) => t.id === tid))
    .filter((t): t is CatalogTalent => t !== undefined);

  return (
    <>
      <p className="muted">
        <Link to={`/gruppe/${groupId}`}>← Zur Gruppe</Link>
      </p>
      <h1>Übersicht: {data.group.name}</h1>

      <div className="gm-poll">
        <div className="gm-poll-search">
          <Field label="Talent abfragen" className="notch-search" active={pinnedTalents.length > 0}>
            <input
              type="text"
              placeholder="Talentname…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) pin(matches[0].id);
                if (e.key === 'Escape') setQuery('');
              }}
            />
          </Field>
          {query && (
            <button className="small" onClick={() => setQuery('')} title="Suche zurücksetzen">
              ✕
            </button>
          )}
          {matches.length > 0 && (
            <ul className="gm-poll-results">
              {matches.map((t) => (
                <li key={t.id}>
                  <button onClick={() => pin(t.id)}>
                    {t.name}
                    {t.gruppe && <span className="muted"> · {t.gruppe}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {pinnedTalents.length > 0 && (
          <div className="gm-poll-pinned">
            {pinnedTalents.map((t) => (
              <span className="gm-poll-tag" key={t.id}>
                {t.name}
                <button onClick={() => unpin(t.id)} title="Aus der Abfrage nehmen" aria-label={`${t.name} entfernen`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

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
                {/* key ist der Chip-Schlüssel bzw. Name; Spezialenergien dürfen
                    Namen teilen, deshalb den Index anhängen. */}
                {c.vitals.map((v, i) => (
                  <span className={`gm-chip gm-chip--vital ${vitalClass(v.key, v.aktuell, v.max)}`} key={`${v.key}-${i}`}>
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

              {pinnedTalents.length > 0 &&
                (() => {
                  const taws = new Map(c.talents.map((t) => [t.id, t.taw]));
                  return (
                    <div className="gm-chips gm-chips--talent">
                      {pinnedTalents.map((t) => {
                        const taw = taws.get(t.id);
                        return (
                          <span
                            className={`gm-chip gm-chip--talent${taw === undefined ? ' gm-chip--empty' : ''}`}
                            key={t.id}
                            title={t.gruppe ? `${t.gruppe}: ${t.name}` : t.name}
                          >
                            <span className="gm-chip-label">{t.name}</span>
                            <span className="gm-chip-val">{taw ?? '–'}</span>
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
