import { ATTR_CODES, ATTR_LABELS, RESOURCE_KEYS } from '@shared/types';
import type { ResourceKey } from '@shared/types';
import { computeResource, psycheMax, psycheProzent } from '@shared/rules';
import { pouchUeberfuellt } from '@shared/currency';
import { BOARD_STATUS_BY_KEY } from '@shared/boardStatus';
import { useChar } from '../pages/Character';
import { AktuellFeld } from './AktuellFeld';
import { useDicePanel } from './dice/DicePanelProvider';
import { TextInput } from './inputs';
import { AlwaysEditable } from './displayMode';
import { useCollapsed } from './collapse';
import { overfilled, poolClass } from './energie';
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
    // Die ganze schmale Leiste ist der Aufklapp-Knopf — ein größeres Ziel als
    // ein einzelnes Zeichen. Der sonst leere senkrechte Platz trägt „Überblick"
    // als aufrecht gestapelte Schrift, damit klar ist, was sich hier verbirgt.
    return (
      <aside className="char-sidebar collapsed">
        <button className="side-expand" onClick={toggle} title="Seitenleiste ausklappen" aria-label="Seitenleiste ausklappen">
          <span className="side-expand-chev" aria-hidden>
            ‹
          </span>
          <span className="side-expand-label" aria-hidden>
            Überblick
          </span>
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
        <SidebarZustaende />
        <SidebarGeld />

        <AlwaysEditable>
          <SidebarNotiz />
        </AlwaysEditable>
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
  const { attributes, resources, special, meta } = data;

  const psycheAkt = meta.psycheAkt ?? 0;
  const psycheMaxWert = psycheMax(attributes, meta.psycheBase ?? 0, meta.psycheBonus ?? 0);
  const psyche = psycheProzent(psycheAkt, psycheMaxWert);

  const setAktuell = (key: ResourceKey, v: number) =>
    update('resources', { ...resources, [key]: { ...resources[key], aktuell: v } });
  const setMeta = (key: string, v: number) => update('meta', { ...meta, [key]: v });
  const setSpecialAkt = (i: number, v: number) =>
    update('special', special.map((s, j) => (j === i ? { ...s, aktuell: v } : s)));

  return (
    <div className="side-block">
      <h4>Energien</h4>
      <div className="side-pools">
        {RESOURCE_KEYS.map((key) => {
          const r = computeResource(attributes, key, resources[key]);
          const akt = resources[key].aktuell;
          const cls = poolClass(key, akt, r.nutzbar);
          const prozent = r.nutzbar > 0 ? Math.round((akt / r.nutzbar) * 100) : null;
          return (
            <div className={`side-pool${cls ? ` ${cls}` : ''}`} key={key}>
              <PoolHead label={RES_ABBR[key]} title={RES_FULL[key]} prozent={prozent} />
              <AktuellFeld value={akt} max={r.nutzbar} onChange={(v) => setAktuell(key, v)} />
            </div>
          );
        })}

        <div className={`side-pool${overfilled(psycheAkt, psycheMaxWert) ? ' res-over' : ''}`}>
          <PoolHead label="Psyche" prozent={psyche != null ? Math.round(psyche) : null} />
          <AktuellFeld value={psycheAkt} max={psycheMaxWert > 0 ? psycheMaxWert : undefined} onChange={(v) => setMeta('psycheAkt', v)} />
        </div>

        {/* Spezialenergien reihen sich als weitere Schnell-Pools ein. Namenlose
            (noch unfertige) Einträge werden ausgelassen — der volle Editor steht
            im Heldenbrief. Der Name dient als Beschriftung UND Tooltip. */}
        {special.map((s, i) =>
          s.name.trim() === '' ? null : (
            <div className={`side-pool${overfilled(s.aktuell, s.max) ? ' res-over' : ''}`} key={i}>
              <PoolHead
                label={s.name}
                title={s.name}
                prozent={s.max > 0 ? Math.round((s.aktuell / s.max) * 100) : null}
              />
              <AktuellFeld value={s.aktuell} max={s.max > 0 ? s.max : undefined} onChange={(v) => setSpecialAkt(i, v)} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// Attribute — reines Nachschlagen (für Proben ständig gebraucht). Bearbeitet
// werden sie im Heldenbrief; hier stehen nur die aktuellen Endwerte.
// Die Kacheln sind zugleich der Würfel-Knopf für die Eigenschaftsprobe: hier
// ist kein Platz für Knopf + Sichtbarkeits-Menü, und im Spiel will man genau
// einen Klick. Deshalb bewusst NUR öffentlich — wer verborgen würfeln will,
// nimmt die Attributs-Tabelle im Heldenbrief (dort sitzt die volle Auswahl).
function SidebarAttribute() {
  const { data, rollCtx } = useChar();
  const { rollProbe } = useDicePanel();
  const { attributes } = data;
  return (
    <div className="side-block">
      <h4>Attribute</h4>
      <div className="side-attrs">
        {ATTR_CODES.map((code) => {
          const inner = (
            <>
              <span className="side-attr-code">{code}</span>
              <span className="side-attr-val">{attributes[code].akt + attributes[code].mod}</span>
            </>
          );
          if (!rollCtx) {
            return (
              <div className="side-attr" key={code} title={ATTR_LABELS[code]}>
                {inner}
              </div>
            );
          }
          return (
            <button
              type="button"
              className="side-attr side-attr--roll"
              key={code}
              title={`${ATTR_LABELS[code]} würfeln (öffentlich)`}
              onClick={() => rollProbe(rollCtx.groupId, rollCtx.charId, { kind: 'attribute', attr: code }, 'public')}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Zustände des eigenen Tisch-Tokens, ausgeschrieben statt nur als winzige
// Marke auf dem Feld — siehe docs/concepts/virtual-table.md, "Settled for the
// real Phase 4 build". Rein lesend: gesetzt wird ein Zustand über die
// Token-Marke selbst (VirtualTable.tsx), nicht von hier aus. Auf jeder Seite
// AUSSER dem virtuellen Tisch ist boardTokens leer (DicePanelProvider füllt
// es erst nach hydrateBoard), die Sektion bleibt dort also unsichtbar, ohne
// eine eigene "nur auf der VTT-Seite"-Bedingung zu brauchen.
function SidebarZustaende() {
  const { charId } = useChar();
  const { boardTokens } = useDicePanel();
  const token = boardTokens.find((t) => t.characterId === charId);
  if (!token || token.statuses.length === 0) return null;
  return (
    <div className="side-block">
      <h4>Zustände</h4>
      <div className="side-status-list">
        {token.statuses.map((key) => {
          const status = BOARD_STATUS_BY_KEY[key];
          if (!status) return null;
          return (
            <div className="side-status-line" key={key}>
              <span aria-hidden>{status.emoji}</span> {status.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Freies Notizfeld — ein privater Notizzettel für den schnellen Griff im Spiel.
// Volle Breite, wächst mit dem Inhalt (auto-wachsendes Textfeld). Liegt in
// char_bio (sidebarNotiz) und wird bewusst NICHT im Heldenbrief oder in der
// Gruppen-Zusammenfassung gezeigt.
function SidebarNotiz() {
  const { data, update } = useChar();
  const value = String(data.bio.sidebarNotiz ?? '');
  return (
    <div className="side-block side-note">
      <h4>Notizen</h4>
      <TextInput value={value} onChange={(v) => update('bio', { ...data.bio, sidebarNotiz: v })} />
    </div>
  );
}

// Geld — kein Gesamtvermögen mehr (Geld-Umbau: mehrere Währungen lassen sich
// nicht sinnvoll zu einer Zahl zusammenrechnen). Die Seitenleiste zeigt hier
// nur eine Warnung, wenn ein Beutel über seiner Kapazität ist — Münzen selbst
// werden im Heldenbrief gepflegt.
function SidebarGeld() {
  const { data } = useChar();
  const overfilledPouches = data.pouches.filter((p) => pouchUeberfuellt(p));
  if (overfilledPouches.length === 0) return null;
  return (
    <div className="side-block">
      <h4>Geld</h4>
      <div className="side-geld res-over" title={overfilledPouches.map((p) => p.name).join(', ')}>
        {overfilledPouches.length === 1 ? `„${overfilledPouches[0].name}" übervoll` : `${overfilledPouches.length} Beutel übervoll`}
      </div>
    </div>
  );
}
