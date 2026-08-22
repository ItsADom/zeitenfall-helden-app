import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AttrRowCode, ResourceKey } from '@shared/types';
import { ATTR_LABELS } from '@shared/types';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { depletionClass, overfilled } from '../components/energie';
import RequestGroupProbePicker from '../components/dice/RequestGroupProbePicker';
import RequestProbePicker from '../components/dice/RequestProbePicker';
import { Field } from '../components/inputs';
import { usePersistedState } from '../components/persist';

// Spielleiter-Übersicht: alle Charaktere einer Gruppe als Karten, ihre
// wichtigsten Kennwerte als Chips. Nur-Lesen (die Route dahinter ist requireGm).

interface Vital {
  key: string; // le | aus | ase | psyche
  aktuell: number;
  max: number;
}
interface CharTag {
  id: number;
  name: string;
}
interface OverviewChar {
  id: number;
  name: string;
  /** Empfänger einer „Probe anfordern"-Anfrage. */
  ownerUserId: number;
  ownerName: string;
  stufe: number;
  portrait: boolean;
  vitals: Vital[];
  thresholds: { wund: number; tod: number };
  attributes: { code: string; value: number }[];
  talents: { id: number; taw: number }[];
  tags: CharTag[];
  gmNotiz: string;
}
interface CatalogTalent {
  id: number;
  name: string;
  gruppe: string;
}
interface OverviewData {
  group: { id: number; name: string; isTemp: boolean };
  talentCatalog: CatalogTalent[];
  tagCatalog: CharTag[];
  characters: OverviewChar[];
}

// Kürzel wie in der Seitenleiste (RES_ABBR): LP/AUS/ASP, plus Psyche.
const VITAL_LABELS: Record<string, string> = { le: 'LP', aus: 'AUS', ase: 'ASP', psyche: 'Psyche', schicksalspunkte: '🍀 SP' };

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

// Freitext-GM-Notiz je Charakter: eigene, kleine Save-Debounce-Logik statt der
// TextInput/NumInput-Displaymode-Kopplung, weil das hier GM-only und außerhalb
// des normalen section-save-Wegs ist. `initial` wird nur beim ersten Rendern
// übernommen, damit ein stiller Poll währenddessen nicht mittippt.
function GmNoteField({ charId, initial }: { charId: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  const onChange = (v: string) => {
    setValue(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void apiPut(`/api/characters/${charId}/gm-notiz`, { notiz: v });
    }, 1200);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <textarea
      className="gm-note"
      placeholder="Notiz (nur für den Spielleiter)…"
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Bedient feste UND Event-Gruppen mit derselben Seite — der Server liefert für
// beide dasselbe Antwortformat inklusive group.isTemp, das entscheidet allein
// über die abweichenden Texte/Aktionen unten. Kein kind-Prop mehr nötig.
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

  // Merkmal-Zuweisung: optimistisch in `data` fortschreiben, sobald der Server
  // bestätigt hat — der nächste stille Poll bringt ohnehin denselben Stand.
  const addTag = (charId: number, tag: CharTag) => {
    void apiPost(`/api/characters/${charId}/tags`, { tagId: tag.id }).then(() => {
      setData((d) =>
        d ? { ...d, characters: d.characters.map((c) => (c.id === charId ? { ...c, tags: [...c.tags, tag] } : c)) } : d,
      );
    });
  };
  const removeTag = (charId: number, tagId: number) => {
    void apiDelete(`/api/characters/${charId}/tags/${tagId}`).then(() => {
      setData((d) =>
        d
          ? { ...d, characters: d.characters.map((c) => (c.id === charId ? { ...c, tags: c.tags.filter((t) => t.id !== tagId) } : c)) }
          : d,
      );
    });
  };

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
        {data.group.isTemp ? <Link to="/verwaltung">← Zur Verwaltung</Link> : <Link to={`/gruppe/${groupId}`}>← Zur Gruppe</Link>}
      </p>
      <h1>{data.group.isTemp ? `Event: ${data.group.name}` : `Übersicht: ${data.group.name}`}</h1>

      <div className="gm-overview-actions">
        <button
          className="small"
          title="Setzt die Schicksalspunkte aller Charaktere dieser Gruppe auf ihr jeweiliges Maximum zurück"
          onClick={() => void apiPost(`/api/groups/${groupId}/schicksalspunkte/reset`).then(() => loadOverview(true))}
        >
          🍀 Neuer Spieltag (Schicksalspunkte zurücksetzen)
        </button>
        {data.characters.length > 0 && <RequestGroupProbePicker groupId={groupId} anyCharId={data.characters[0].id} />}
      </div>

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
        <p className="muted">{data.group.isTemp ? 'Keine Charaktere in dieser Event-Gruppe.' : 'Keine Charaktere in dieser Gruppe.'}</p>
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
                <button
                  className="small gm-card-sp-reset"
                  title="Setzt die Schicksalspunkte dieses Charakters auf sein Maximum zurück"
                  onClick={() => void apiPost(`/api/characters/${c.id}/schicksalspunkte/reset`).then(() => loadOverview(true))}
                >
                  🍀
                </button>
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
                  <span
                    className="gm-chip gm-chip--attr"
                    key={a.code}
                    title={ATTR_LABELS[a.code as AttrRowCode] ?? a.code}
                  >
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

              <div className="gm-chips gm-chips--tags">
                {c.tags.map((t) => (
                  <span className="gm-chip gm-chip--tag" key={t.id}>
                    <span className="gm-chip-label">{t.name}</span>
                    <button onClick={() => removeTag(c.id, t.id)} title="Merkmal entfernen" aria-label={`${t.name} entfernen`}>
                      ✕
                    </button>
                  </span>
                ))}
                {(() => {
                  const assigned = new Set(c.tags.map((t) => t.id));
                  const options = data.tagCatalog.filter((t) => !assigned.has(t.id));
                  if (options.length === 0) {
                    // Bewusst sichtbar statt verschwindend: sonst liest sich ein
                    // erschöpfter Katalog (oder ein Katalog mit nur einem Eintrag)
                    // wie eine harte Ein-Merkmal-Grenze statt wie leerer Vorrat.
                    return (
                      <span className="muted gm-tag-add-hint">
                        {data.tagCatalog.length === 0 ? 'Noch keine Merkmale im Katalog' : 'Alle Merkmale bereits zugewiesen'}
                      </span>
                    );
                  }
                  return (
                    <select
                      className="gm-tag-add"
                      value=""
                      onChange={(e) => {
                        const tag = options.find((t) => t.id === Number(e.target.value));
                        if (tag) addTag(c.id, tag);
                      }}
                    >
                      <option value="">+ Merkmal…</option>
                      {options.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              <RequestProbePicker groupId={groupId} charId={c.id} targetUserId={c.ownerUserId} charName={c.name} />

              <GmNoteField key={c.id} charId={c.id} initial={c.gmNotiz} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
