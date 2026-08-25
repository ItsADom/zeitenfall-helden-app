import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api';
import { useCollapsed } from './collapse';
import RequestProbePicker from './dice/RequestProbePicker';
import { GmNoteField, VITAL_LABELS, vitalClass } from './gmRoster';
import { usePersistedState } from './persist';

// Die Spielleiter-Seitenleiste des virtuellen Tisches: dieselben Daten wie
// GroupOverview.tsx, aber eine schmale Spalte statt einer eigenen Seite — die
// Spielleitung hat am Tisch keinen eigenen Charakterbogen, braucht also den
// Rundblick über die Gruppe statt einer Heldenbrief-Seitenleiste. Bewusst
// NICHT die volle Übersichtsseite eingebettet: Portrait, Stufe, der SP-Reset-
// Knopf, Attribut- und angepinnte Talent-Chips bleiben der großen Seite
// vorbehalten (siehe docs/concepts/virtual-table.md, "Settled for the real
// Phase 4 build") — hier zählt nur, was man WÄHREND des Spiels am Tisch
// braucht: Vitalwerte, Schwellen, Merkmale, die GM-Notiz und „Probe anfordern".

interface RosterChar {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  vitals: { key: string; aktuell: number; max: number }[];
  thresholds: { wund: number; tod: number };
  tags: { id: number; name: string }[];
  gmNotiz: string;
}
interface RosterData {
  group: { id: number; name: string; isTemp: boolean };
  characters: RosterChar[];
}

const MIN_W = 240;
const MAX_W = 460;
const DEFAULT_W = 280;
const clampW = (n: number): number => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));

export default function VttRoster({ groupId }: { groupId: number }) {
  const [collapsed, toggle] = useCollapsed('vtt-roster');
  const [width, setWidth] = usePersistedState<number>('vtt-roster-w', DEFAULT_W);
  const w = clampW(width);
  const [data, setData] = useState<RosterData | null>(null);

  const load = useCallback(() => {
    apiGet<RosterData>(`/api/groups/${groupId}/overview`)
      .then(setData)
      .catch(() => {});
  }, [groupId]);

  useEffect(() => void load(), [load]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = w;
    const onMove = (ev: PointerEvent) => setWidth(clampW(startW + (startX - ev.clientX)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-col');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('resizing-col');
  };

  if (collapsed) {
    return (
      <aside className="char-sidebar collapsed">
        <button className="side-expand" onClick={toggle} title="Gruppenübersicht ausklappen" aria-label="Gruppenübersicht ausklappen">
          <span className="side-expand-chev" aria-hidden>
            ›
          </span>
          <span className="side-expand-label" aria-hidden>
            Gruppe
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="char-sidebar" style={{ '--sidebar-w': `${w}px` } as React.CSSProperties}>
      <div className="side-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" title="Breite ziehen" />
      <div className="side-scroll">
        <div className="side-head">
          <span className="side-title">Gruppenübersicht</span>
          <button className="side-toggle" onClick={toggle} title="Einklappen" aria-label="Gruppenübersicht einklappen">
            ‹
          </button>
        </div>

        {!data && <p className="muted">Lädt…</p>}
        {data?.characters.length === 0 && <p className="muted">Keine Charaktere in dieser Gruppe.</p>}
        {data?.characters.map((c) => (
          <div className="gm-card" key={c.id}>
            <div className="gm-card-head">
              <div className="gm-card-ident">
                <h3>{c.name}</h3>
                <span className="muted">{c.ownerName}</span>
              </div>
            </div>

            <div className="gm-chips">
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

            {c.tags.length > 0 && (
              <div className="gm-chips gm-chips--tags">
                {c.tags.map((t) => (
                  <span className="gm-chip gm-chip--tag" key={t.id}>
                    <span className="gm-chip-label">{t.name}</span>
                  </span>
                ))}
              </div>
            )}

            <RequestProbePicker groupId={groupId} charId={c.id} targetUserId={c.ownerUserId} charName={c.name} />

            <GmNoteField key={c.id} charId={c.id} initial={c.gmNotiz} />
          </div>
        ))}
      </div>
    </aside>
  );
}
