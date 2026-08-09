import { ATTR_CODES, ATTR_LABELS, RESOURCE_KEYS } from '@shared/types';
import type { ResourceKey } from '@shared/types';
import { computeResource, psycheProzent } from '@shared/rules';
import { useChar } from '../pages/Character';
import { AktuellFeld } from './AktuellFeld';
import { AlwaysEditable } from './displayMode';
import { useCollapsed } from './collapse';
import { depletionClass } from './energie';
import { gesamtDublonen } from './GeldPanel';

// Immer sichtbare Seitenleiste des Charakterbogens: die Werte, die im Spiel am
// häufigsten gebraucht werden, an einer Stelle, ohne den Reiter zu wechseln.
// Zwei Sorten Inhalt:
//   • laufende Pools (Energien, Psyche) — bearbeitbar auch im Nur-Lesen-Modus
//     (AlwaysEditable), weil man sie mitten im Kampf ändern will.
//   • Nachschlagewerte (Attribute, Geld) — nur zum Ablesen; gepflegt werden sie
//     weiter im Heldenbrief.
// Die Leiste ersetzt die frühere „Übersicht" als Reiter: der Heldenbrief zeigt
// weiterhin alles im Detail, die Leiste die stets sichtbare Teilmenge.

const de = (v: number) => v.toLocaleString('de-DE');

// Kurzformen für die enge Spalte — im Spiel ohnehin so gerufen.
const RES_ABBR: Record<ResourceKey, string> = { le: 'LP', aus: 'AUS', ase: 'ASP' };
const RES_FULL: Record<ResourceKey, string> = { le: 'Lebensenergie', aus: 'Ausdauer', ase: 'Astralenergie' };

export default function CharacterSidebar() {
  const [collapsed, toggle] = useCollapsed('sidebar');

  if (collapsed) {
    return (
      <aside className="char-sidebar collapsed">
        <button className="side-toggle" onClick={toggle} title="Seitenleiste ausklappen" aria-label="Seitenleiste ausklappen">
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="char-sidebar">
      <div className="side-head">
        <span className="side-title">Überblick</span>
        <button className="side-toggle" onClick={toggle} title="Seitenleiste einklappen" aria-label="Seitenleiste einklappen">
          ›
        </button>
      </div>

      <AlwaysEditable>
        <SidebarPools />
      </AlwaysEditable>

      <SidebarAttribute />
      <SidebarGeld />
    </aside>
  );
}

// Energien + Psyche — die laufenden Pools mit Schnell-Schaden/-Heilung.
function SidebarPools() {
  const { data, update } = useChar();
  const { attributes, resources, meta } = data;

  const psycheAkt = meta.psycheAkt ?? 0;
  const psycheMax = meta.psycheMax ?? 0;
  const psyche = psycheProzent(psycheAkt, psycheMax);

  const setAktuell = (key: ResourceKey, v: number) =>
    update('resources', { ...resources, [key]: { ...resources[key], aktuell: v } });
  const setMeta = (key: string, v: number) => update('meta', { ...meta, [key]: v });

  return (
    <div className="side-block">
      <h4>Energien</h4>
      <div className="side-pools">
        {RESOURCE_KEYS.map((key) => {
          const r = computeResource(attributes, key, resources[key]);
          const akt = resources[key].aktuell;
          const depl = depletionClass(key, akt, r.nutzbar);
          const prozent = r.nutzbar > 0 ? Math.round((akt / r.nutzbar) * 100) : null;
          return (
            <div className={`side-pool${depl ? ` ${depl}` : ''}`} key={key}>
              <div className="side-pool-head">
                <span className="side-pool-label" title={RES_FULL[key]}>
                  {RES_ABBR[key]}
                </span>
                <span className="muted side-pool-max">
                  / {de(r.nutzbar)}
                  {prozent != null && ` · ${prozent} %`}
                </span>
              </div>
              <AktuellFeld value={akt} max={r.nutzbar} onChange={(v) => setAktuell(key, v)} />
            </div>
          );
        })}

        <div className="side-pool">
          <div className="side-pool-head">
            <span className="side-pool-label">Psyche</span>
            <span className="muted side-pool-max">
              / {de(psycheMax)}
              {psyche != null && ` · ${Math.round(psyche)} %`}
            </span>
          </div>
          <AktuellFeld value={psycheAkt} max={psycheMax > 0 ? psycheMax : undefined} onChange={(v) => setMeta('psycheAkt', v)} />
        </div>
      </div>
    </div>
  );
}

// Attribute — reines Nachschlagen (für Proben ständig gebraucht). Bearbeitet
// werden sie im Heldenbrief; hier stehen nur die aktuellen Endwerte.
function SidebarAttribute() {
  const { data } = useChar();
  const { attributes } = data;
  return (
    <div className="side-block">
      <h4>Attribute</h4>
      <div className="side-attrs">
        {ATTR_CODES.map((code) => (
          <div className="side-attr" key={code} title={ATTR_LABELS[code]}>
            <span className="side-attr-code">{code}</span>
            <span className="side-attr-val">{attributes[code].akt + attributes[code].mod}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Geld — nur die Gesamtsumme in Dublonen. Die einzelnen Münzen werden im
// Heldenbrief gepflegt.
function SidebarGeld() {
  const { data } = useChar();
  return (
    <div className="side-block">
      <h4>Geld</h4>
      <div className="side-geld" title="Alle Münzen in Dublonen umgerechnet, inklusive Bank">
        <strong>{gesamtDublonen(data.meta).toLocaleString('de-DE', { maximumFractionDigits: 3 })} D</strong>
      </div>
    </div>
  );
}
