import { ATTR_CODES, ATTR_LABELS, RESOURCE_KEYS } from '@shared/types';
import type { ResourceKey } from '@shared/types';
import { computeResource, psycheProzent } from '@shared/rules';
import { useChar } from '../pages/Character';
import { AktuellFeld } from './AktuellFeld';
import { AlwaysEditable } from './displayMode';
import { useCollapsed } from './collapse';
import { depletionClass } from './energie';
import { gesamtDublonen } from './GeldPanel';
import { usePersistedState } from './persist';

// Immer sichtbare Seitenleiste des Charakterbogens: die Werte, die im Spiel am
// häufigsten gebraucht werden, an einer Stelle, ohne den Reiter zu wechseln.
// Zwei Sorten Inhalt:
//   • laufende Pools (Energien, Psyche) — bearbeitbar auch im Nur-Lesen-Modus
//     (AlwaysEditable), weil man sie mitten im Kampf ändern will.
//   • Nachschlagewerte (Attribute, Geld) — nur zum Ablesen; gepflegt werden sie
//     weiter im Heldenbrief.
// Die Leiste ersetzt die frühere „Übersicht" als Reiter: der Heldenbrief zeigt
// weiterhin alles im Detail, die Leiste die stets sichtbare Teilmenge.

// Kurzformen für die enge Spalte — im Spiel ohnehin so gerufen.
const RES_ABBR: Record<ResourceKey, string> = { le: 'LP', aus: 'AUS', ase: 'ASP' };
const RES_FULL: Record<ResourceKey, string> = { le: 'Lebensenergie', aus: 'Ausdauer', ase: 'Astralenergie' };

// Die Breite ist frei einstellbar, aber gedeckelt: zu schmal zerdrückt die
// Stepper, zu breit frisst den Inhalt. Der gemerkte Wert wird beim Lesen und
// beim Ziehen auf diese Grenzen gezogen, damit nie etwas seltsam rendert.
const MIN_W = 240;
const MAX_W = 520;
const DEFAULT_W = 300;
const clampW = (n: number): number => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));

export default function CharacterSidebar() {
  const [collapsed, toggle] = useCollapsed('sidebar');
  const [width, setWidth] = usePersistedState<number>('sidebar-w', DEFAULT_W);
  const w = clampW(width);

  // Ziehen am linken Rand. Die Leiste sitzt rechts, also vergrößert ein Zug
  // nach LINKS (kleineres clientX) die Breite. Grenzen via clampW.
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
        <button className="side-toggle" onClick={toggle} title="Seitenleiste ausklappen" aria-label="Seitenleiste ausklappen">
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="char-sidebar" style={{ '--sidebar-w': `${w}px` } as React.CSSProperties}>
      <div
        className="side-resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        title="Breite ziehen"
      />
      <div className="side-scroll">
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
      </div>
    </aside>
  );
}

// Kopfzeile eines Pools: eine zentrierte Zeile „KÜRZEL · X %". Kein Maximum mehr
// daneben — der aktuelle Wert steht im Stepper darunter, der Prozentsatz sagt
// das Wesentliche, und die Zeile bleibt kurz und ruhig.
function PoolHead({ label, title, prozent }: { label: string; title?: string; prozent: number | null }) {
  return (
    <div className="side-pool-head">
      <span className="side-pool-key" title={title}>
        {label}
      </span>
      {prozent != null && <span className="side-pool-pct"> · {prozent} %</span>}
    </div>
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
              <PoolHead label={RES_ABBR[key]} title={RES_FULL[key]} prozent={prozent} />
              <AktuellFeld value={akt} max={r.nutzbar} onChange={(v) => setAktuell(key, v)} />
            </div>
          );
        })}

        <div className="side-pool">
          <PoolHead label="Psyche" prozent={psyche != null ? Math.round(psyche) : null} />
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
