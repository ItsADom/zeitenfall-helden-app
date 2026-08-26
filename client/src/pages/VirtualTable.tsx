import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoardOverlay, BoardSettings, BoardToken, LabelOverlayData, MeasureOverlayData } from '@shared/boardProtocol';
import { BOARD_COVERS, BOARD_STATUSES } from '@shared/boardStatus';
import { cellKey, gridDistance, parseTileValue } from '@shared/board';
import { TILE_MATERIALS, TILE_MATERIAL_BY_KEY } from '@shared/boardTiles';
import { apiGet } from '../api';
import { useAuth } from '../App';
import { CharSheetProvider } from '../components/charSheet';
import CharacterSidebar from '../components/CharacterSidebar';
import { useCollapsed } from '../components/collapse';
import { useDicePanel } from '../components/dice/DicePanelProvider';
import FeedColumn from '../components/dice/FeedColumn';
import { usePersistedState } from '../components/persist';
import VttRoster from '../components/VttRoster';
import { generatedWaterTexture } from '../components/vttWater';

// Phase 4 (docs/concepts/virtual-table.md): der Seitenrahmen. Phase 5 fügt
// Token hinzu. Phase 6 fügt Bemalen hinzu — Farbe/Textur, Radierer, Delta-
// Schreiben. Noch kein Autotiling (weiche Übergänge kommen erst mit Phase 7),
// noch kein Nebel/Bilder/Initiative.

// Beschriftung bzw. Messform, ausgesondert aus BoardOverlay (der Vereinigung
// aus beiden kinds) — jede Seite des Rendercodes arbeitet mit dem für sie
// passenden, schon verengten Typ statt ständig neu zu prüfen.
type LabelOverlay = Extract<BoardOverlay, { kind: 'label' }>;
type MeasureOverlay = Extract<BoardOverlay, { kind: 'measure' }>;

// Kegel bleibt rein visuell (keine zellgenaue Abdeckung). Der Öffnungswinkel
// ist PRO FORM einstellbar (siehe measureConeSpread/MeasureEditor) statt
// eine feste Konstante — nicht jeder Effekt hat dasselbe Längen-Breiten-
// Verhältnis. Nur der VORSCHLAGSWERT für eine neu gezogene Form ist fix.
const CONE_SPREAD_DEFAULT = 60;
const MEASURE_KIND_LABEL: Record<MeasureOverlayData['kind'], string> = {
  ruler: 'Linie',
  circle: 'Kreis',
  rectangle: 'Rechteck',
  cone: 'Kegel',
};
// Eigene, gedämpfte Akzentfarbe statt einer der Terrain-/Einfärbe-Paletten —
// eine Messform ist Werkzeug-Feedback (Chrome), keine Kartenbemalung, siehe
// "Theming — the map is exempt" im Plan: nur die Chrome folgt dem Farbschema,
// nicht die Karte selbst. Feste Farbe statt Board-Einstellung, weil eine
// Messform kein bemaltes Terrain ist, sondern ein flüchtiges Hilfsmittel.
const MEASURE_FILL = 'rgba(77,163,255,0.28)';
const MEASURE_STROKE = 'rgba(30,110,220,0.9)';
// #rrggbb-Äquivalent von MEASURE_STROKE — Vorbelegung für den <input
// type="color">, der kein rgba() versteht.
const MEASURE_STROKE_DEFAULT = '#1e6edc';

/** Eigene Farbe je Form (optional) statt der gedämpften Standardfarbe — Deckkraft der Füllung bleibt an MEASURE_FILL angelehnt. */
function measureColors(data: MeasureOverlayData): { fill: string; stroke: string } {
  if (!data.color) return { fill: MEASURE_FILL, stroke: MEASURE_STROKE };
  const r = parseInt(data.color.slice(1, 3), 16);
  const g = parseInt(data.color.slice(3, 5), 16);
  const b = parseInt(data.color.slice(5, 7), 16);
  return { fill: `rgba(${r},${g},${b},0.28)`, stroke: data.color };
}

/**
 * Ein echter Kegel/Sektor — Ursprung, zwei gerade Kanten hinaus, dazwischen
 * ein BOGEN (kein gerader Abschluss wie ein Dreieck) — das ist die Form, die
 * ein Kegel-Effekt tatsächlich hat. Reine Pixel/Grad, ohne Zellbezug, damit
 * dieselbe Funktion sowohl das echte Brett-Rendern (conePath, Zellen×CELL_PX)
 * als auch das kleine Flyout-Icon (MEASURE_KIND_ICON.cone, feste Pixelwerte)
 * bedient — ein Dreieck-Icon hätte etwas anderes gezeigt als das, was auf dem
 * Brett entsteht.
 */
function wedgePath(cx: number, cy: number, r: number, angleDeg: number, spreadDeg: number): string {
  const half = (spreadDeg / 2) * (Math.PI / 180);
  const a = angleDeg * (Math.PI / 180);
  const x1 = cx + r * Math.cos(a - half);
  const y1 = cy + r * Math.sin(a - half);
  const x2 = cx + r * Math.cos(a + half);
  const y2 = cy + r * Math.sin(a + half);
  const largeArc = spreadDeg > 180 ? 1 : 0;
  return `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/** Kegel auf dem Brett — Ursprung/Länge in Zellen, siehe wedgePath. */
function conePath(origin: { x: number; y: number }, lengthCells: number, angleDeg: number, spreadDeg: number): string {
  return wedgePath(origin.x * CELL_PX, origin.y * CELL_PX, lengthCells * CELL_PX, angleDeg, spreadDeg);
}

/**
 * Aus zwei Zugpunkten die endgültigen Formdaten bauen — KEINE Rasterung auf
 * Zellen/Zellmitten mehr (settled with the developer: eine Messform folgt
 * dem Zug genauso frei wie eine Marke, springt nicht auf ein Gitter).
 * `coneSpread` kommt von außen (siehe measureConeSpread), weil er pro
 * gezogener Form gilt, nicht aus origin/current ableitbar ist.
 */
function buildMeasureData(
  kind: MeasureOverlayData['kind'],
  origin: { x: number; y: number },
  current: { x: number; y: number },
  coneSpread: number,
): MeasureOverlayData {
  if (kind === 'ruler') return { kind: 'ruler', from: origin, to: current };
  if (kind === 'rectangle') return { kind: 'rectangle', from: origin, to: current };
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  if (kind === 'circle') return { kind: 'circle', origin, radius: Math.hypot(dx, dy) };
  return { kind: 'cone', origin, angle: (Math.atan2(dy, dx) * 180) / Math.PI, length: Math.hypot(dx, dy), spread: coneSpread };
}

/** Eine bestehende Messform um (dx, dy) Zellen verschieben — durchweg kontinuierlich, keine Form ist mehr ans Gitter gebunden. */
function shiftMeasureData(base: MeasureOverlayData, dx: number, dy: number): MeasureOverlayData {
  // Immer von `base` spreaden statt die Form neu zu bauen — sonst gehen
  // optionale Felder (label/color) bei jedem Verschieben verloren.
  if (base.kind === 'ruler' || base.kind === 'rectangle') {
    return { ...base, from: { x: base.from.x + dx, y: base.from.y + dy }, to: { x: base.to.x + dx, y: base.to.y + dy } };
  }
  return { ...base, origin: { x: base.origin.x + dx, y: base.origin.y + dy } };
}

interface MeasureEls {
  pathEl?: SVGPathElement | null;
  lineEl?: SVGLineElement | null;
  textEl?: SVGTextElement | null;
  circleEl?: SVGCircleElement | null;
  rectEl?: SVGRectElement | null;
}

/** Direktes DOM-Schreiben der Geometrie — genutzt sowohl von der Zieh-Vorschau einer neuen Form als auch vom Verschieben einer bestehenden, kein setState in beiden Fällen (siehe measureDragRef/measureOverlayDragRef). */
function writeMeasureVisual(data: MeasureOverlayData, els: MeasureEls): void {
  if (data.kind === 'ruler') {
    els.lineEl?.setAttribute('x1', String(data.from.x * CELL_PX));
    els.lineEl?.setAttribute('y1', String(data.from.y * CELL_PX));
    els.lineEl?.setAttribute('x2', String(data.to.x * CELL_PX));
    els.lineEl?.setAttribute('y2', String(data.to.y * CELL_PX));
    if (els.textEl) {
      els.textEl.setAttribute('x', String(((data.from.x + data.to.x) / 2) * CELL_PX));
      els.textEl.setAttribute('y', String(((data.from.y + data.to.y) / 2) * CELL_PX));
      els.textEl.textContent = `${gridDistance(data.from, data.to).toFixed(1)} Schritt`;
    }
    return;
  }
  if (data.kind === 'circle') {
    els.circleEl?.setAttribute('cx', String(data.origin.x * CELL_PX));
    els.circleEl?.setAttribute('cy', String(data.origin.y * CELL_PX));
    els.circleEl?.setAttribute('r', String(data.radius * CELL_PX));
    return;
  }
  if (data.kind === 'rectangle') {
    const x0 = Math.min(data.from.x, data.to.x);
    const y0 = Math.min(data.from.y, data.to.y);
    els.rectEl?.setAttribute('x', String(x0 * CELL_PX));
    els.rectEl?.setAttribute('y', String(y0 * CELL_PX));
    els.rectEl?.setAttribute('width', String(Math.abs(data.to.x - data.from.x) * CELL_PX));
    els.rectEl?.setAttribute('height', String(Math.abs(data.to.y - data.from.y) * CELL_PX));
    return;
  }
  els.pathEl?.setAttribute('d', conePath(data.origin, data.length, data.angle, data.spread));
}

interface GroupMeta {
  group: { id: number; name: string; isTemp: boolean };
}
interface BoardSnapshotResponse {
  board: BoardSettings & { tilesJson: string; highlightsJson: string };
  tokens: BoardToken[];
  overlays: BoardOverlay[];
}

// Wie viele Zellen EIN Texturbild abdeckt — an den Brettkoordinaten verankert,
// nicht an der Zelle, damit eine nahtlose Textur über Zellgrenzen hinweg
// durchgehend bleibt (siehe "Repetition — anchored to the board, not the
// cell" im Plan). Maßstäblich auch richtig: die Vorlagen sind Aufnahmen von
// 2–4 m Boden, ein Feld ist ein Schritt.
const TEX_SPAN_CELLS = 3;

function textureHref(key: string): string {
  const mat = TILE_MATERIALS.find((m) => m.key === key);
  if (mat?.datei) return `/tiles/${mat.datei}`;
  return generatedWaterTexture(key === 'wasser-tief' ? 'wasser-tief' : 'wasser-seicht');
}

// Eine Zeile je Gitterlinie, zu EINEM <path> zusammengefasst — billiger als
// ein Knoten je Zelle, siehe der Prototyp (Texturen.html).
function gridLinesPath(cols: number, rows: number): string {
  let d = '';
  for (let x = 0; x <= cols; x++) d += `M${x * CELL_PX} 0V${rows * CELL_PX}`;
  for (let y = 0; y <= rows; y++) d += `M0 ${y * CELL_PX}H${cols * CELL_PX}`;
  return d;
}

const CELL_PX = 40;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
// Kürzer bewegt als das gilt als Klick (Marke auswählen), nicht als Ziehen —
// sonst würde ein bloßer Klick eine (winzige) Positionsänderung senden.
const CLICK_THRESHOLD_PX = 5;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// Zwei Buchstaben aus dem Namen, wie die Karten im Mockup — Portraits sind für
// später (siehe „Still open" in den Sitzungsnotizen zu Phase 5, falls es die gibt).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DEFAULT_TOKEN_COLOR = '#8b6a4a';

// Wie lange ein Text-/Farbfeld nach der letzten Änderung wartet, bevor es
// tatsächlich sendet — wie GmNoteField (gmRoster.tsx). NICHT nur Kosmetik:
// ein natives <input type="color"> feuert onChange bei JEDEM Zwischenschritt
// des Ziehens im Farbwähler, also ohne Drosselung ein board.token.update je
// Pixel Mausbewegung — das reißt die Ratenbegrenzung in ws.ts auf (die für
// board.token.move eine Ausnahme kennt, für gewöhnliche Bearbeitungen aber
// bewusst nicht, siehe dort) und der Chat zeigt „Zu viele Anfragen".
const FIELD_DEBOUNCE_MS = 350;

function TokenEditor({
  token,
  canEdit,
  isGm,
  onClose,
}: {
  token: BoardToken;
  canEdit: boolean;
  isGm: boolean;
  onClose: () => void;
}) {
  const { updateToken, deleteToken } = useDicePanel();
  const [name, setName] = useState(token.name);
  const [icon, setIcon] = useState(token.icon);
  const [color, setColor] = useState(token.color || DEFAULT_TOKEN_COLOR);
  const [radiusHex, setRadiusHex] = useState(token.radiusColor.slice(0, 7));
  const [radiusOpacity, setRadiusOpacity] = useState(
    token.radiusColor.length === 9 ? Math.round((parseInt(token.radiusColor.slice(7, 9), 16) / 255) * 100) : 100,
  );
  const timers = useRef<Partial<Record<'name' | 'icon' | 'color', ReturnType<typeof setTimeout>>>>({});

  // Beim Wechsel der ausgewählten Marke den Entwurf neu aus dem Server-Stand
  // ziehen — sonst zeigten die Felder noch die vorherige Marke. Bewusst NICHT
  // bei jeder token-Änderung: sonst würde eine fremde Live-Bearbeitung mitten
  // im eigenen Tippen den Entwurf überschreiben (gleiche Begründung wie bei
  // GmNoteField's `initial`).
  useEffect(() => {
    setName(token.name);
    setIcon(token.icon);
    setColor(token.color || DEFAULT_TOKEN_COLOR);
    setRadiusHex(token.radiusColor.slice(0, 7));
    setRadiusOpacity(token.radiusColor.length === 9 ? Math.round((parseInt(token.radiusColor.slice(7, 9), 16) / 255) * 100) : 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.id]);

  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  const scheduleUpdate = (key: 'name' | 'icon' | 'color', value: string) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => updateToken(token.id, { [key]: value }), FIELD_DEBOUNCE_MS);
  };

  const toggleStatus = (key: string) => {
    const has = token.statuses.includes(key);
    updateToken(token.id, { statuses: has ? token.statuses.filter((s) => s !== key) : [...token.statuses, key] });
  };

  return (
    <div className="vtt-token-editor">
      <div className="vtt-token-editor-head">
        {canEdit ? (
          <input
            className="vtt-token-editor-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              scheduleUpdate('name', e.target.value);
            }}
            maxLength={60}
          />
        ) : (
          <strong>{token.name}</strong>
        )}
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>

      {canEdit && (
        <>
          <div className="vtt-token-editor-row">
            <label>
              Icon{' '}
              <input
                value={icon}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 2);
                  setIcon(v);
                  scheduleUpdate('icon', v);
                }}
                maxLength={2}
                style={{ width: 40 }}
                placeholder="🗿"
              />
            </label>
            <label>
              Farbe{' '}
              <ColorSwatchInput
                value={color}
                onChange={(v) => {
                  setColor(v);
                  scheduleUpdate('color', v);
                }}
              />
            </label>
            <label>
              Größe{' '}
              <input
                type="number"
                min={1}
                max={6}
                value={token.size}
                onChange={(e) => updateToken(token.id, { size: Math.min(6, Math.max(1, Number(e.target.value) || 1)) })}
                style={{ width: 44 }}
              />
            </label>
          </div>
          <div className="vtt-token-editor-row">
            <label>
              Radius (Schritt){' '}
              <input
                type="number"
                min={0}
                max={50}
                value={token.radius}
                onChange={(e) => updateToken(token.id, { radius: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })}
                style={{ width: 52 }}
                title="Reichweiten-Ring um die Marke — 0 = kein Ring. Für Zauber-AOE, Fackel-/Sichtweite."
              />
            </label>
            <ColorSwatchInput
              value={radiusHex}
              onChange={(v) => {
                setRadiusHex(v);
                updateToken(token.id, { radiusColor: withOpacity(v, radiusOpacity) });
              }}
              title="Ring-Farbe"
            />
            <input
              type="range"
              min={5}
              max={100}
              value={radiusOpacity}
              onChange={(e) => {
                setRadiusOpacity(Number(e.target.value));
                updateToken(token.id, { radiusColor: withOpacity(radiusHex, Number(e.target.value)) });
              }}
              title="Ring-Deckkraft"
              style={{ width: 60 }}
            />
          </div>
          {isGm && (
            <label className="vtt-token-editor-row">
              <input type="checkbox" checked={token.hidden} onChange={(e) => updateToken(token.id, { hidden: e.target.checked })} />
              Verborgen (nur Spielleitung)
            </label>
          )}
        </>
      )}

      <div className="vtt-token-editor-statuses">
        {BOARD_STATUSES.map((s) => {
          const active = token.statuses.includes(s.key);
          return canEdit ? (
            <button
              key={s.key}
              className={`small${active ? ' active' : ''}`}
              onClick={() => toggleStatus(s.key)}
              title={s.label}
            >
              {s.emoji} {s.label}
            </button>
          ) : active ? (
            <span key={s.key} className="muted" title={s.label}>
              {s.emoji} {s.label}
            </span>
          ) : null;
        })}
      </div>

      {canEdit && (
        <div className="vtt-token-editor-row">
          <label>
            Zustand{' '}
            <select value={token.cover} onChange={(e) => updateToken(token.id, { cover: e.target.value })}>
              <option value="">— keiner —</option>
              {BOARD_COVERS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="small"
            onClick={() => {
              deleteToken(token.id);
              onClose();
            }}
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function MapCanvas({
  groupId,
  board,
  tokens,
  tiles,
  highlights,
  overlays,
  canCreateTokens,
  canEditToken,
  canMoveToken: canMoveTokenFn,
  canPaint,
  canLabel,
  isGm,
}: {
  groupId: number;
  board: BoardSettings;
  tokens: BoardToken[];
  tiles: Record<string, string>;
  /** cellKey -> #rrggbb(aa) tint, GM-only layer above `tiles` — see paintHighlights. */
  highlights: Record<string, string>;
  /** Persistent, movable text labels (board_overlays, kind 'label') — perm_labels-gated. */
  overlays: BoardOverlay[];
  /** Placing a brand-new marker has no owner yet to check against — board-wide only. */
  canCreateTokens: boolean;
  canEditToken: (t: BoardToken) => boolean;
  canMoveToken: (t: BoardToken) => boolean;
  canPaint: boolean;
  canLabel: boolean;
  isGm: boolean;
}) {
  const { cols, rows } = board;
  const totalW = cols * CELL_PX;
  const totalH = rows * CELL_PX;
  const { createToken, moveToken, deleteToken, paintTiles, paintHighlights, createOverlay, updateOverlay, deleteOverlay } = useDicePanel();
  const [camera, setCamera] = usePersistedState<Camera>(`vtt-camera:${groupId}`, { x: 0, y: 0, zoom: 1 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<number | null>(null);
  const [overlayDragPos, setOverlayDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
  // Rechtsklick auf eine Marke — Bildschirmkoordinaten (nicht Brett-Zelle),
  // damit das Menü als normales HTML-Overlay position: fixed neben dem
  // Zeiger sitzt, unabhängig von Kamera/Zoom. Inhalt bewusst noch offen
  // (siehe TokenContextMenu) — hier steht erstmal nur das Gerüst.
  const [contextMenu, setContextMenu] = useState<{ token: BoardToken; x: number; y: number } | null>(null);
  // 'select': normales Verschieben/Anwählen von Marken + Verschieben der
  // Kamera. 'paint': derselbe Zeiger bemalt stattdessen Zellen — siehe
  // startPaint/onPaintPointerMove unten. 'highlight': dieselbe Mechanik, aber
  // auf der separaten Einfärbe-Ebene (highlights_json) statt tiles_json — GM-
  // only, siehe boardAccess.canHighlightTiles. 'label': ein Klick auf leere
  // Fläche legt eine neue Beschriftung dort an (siehe onWrapPointerDown), das
  // Werkzeug wechselt danach NICHT automatisch zurück — mehrere Beschriftungen
  // hintereinander sind der häufigere Fall als eine einzelne. 'measure': ein
  // Ziehen von Punkt A nach B legt beim Loslassen eine Messform an (siehe
  // startMeasureDrag/onMeasurePointerMove unten) — welche Form, bestimmt
  // measureKind.
  const [tool, setTool] = useState<'select' | 'paint' | 'highlight' | 'label' | 'measure'>('select');
  // Messen ist IMMER für alle offen (siehe canMeasure() serverseitig, hart auf
  // true) — anders als Bemalen/Beschriften/Token gibt es dafür keinen
  // perm_*-Schalter und keine gesonderte canMeasure-Prop hier.
  const [measureKind, setMeasureKind] = usePersistedState<MeasureOverlayData['kind']>('vtt-measure-kind', 'ruler');
  // Vorschlagswert für eine NEU gezogene Kegel-Form — der Regler dazu sitzt
  // im selben Flyout wie die Form-Auswahl (siehe MeasureKindPicker), eine
  // bestehende Form behält ihren eigenen, unabhängig editierbaren Wert
  // (siehe MeasureEditor).
  const [measureConeSpread, setMeasureConeSpread] = usePersistedState<number>('vtt-measure-cone-spread', CONE_SPREAD_DEFAULT);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Pipette: der nächste Klick aufs Brett übernimmt die Farbe der getroffenen
  // Zelle statt zu malen/einzufärben, dann schaltet sich das Werkzeug selbst
  // wieder ab — ein Klick, keine eigene Dauer-Betriebsart. Trägt die Ebene,
  // damit ein Klick weiß, ob er aus `tiles` oder `highlights` liest.
  const [pipetteArmed, setPipetteArmed] = useState<'tile' | 'highlight' | null>(null);
  // '' = Radierer, sonst ein getaggter Wert (siehe parseTileValue) — Vorgabe
  // Gras, weil das die häufigste erste Wahl beim Kartenbau ist. Nur noch
  // Texturen: reine Farbe lebt seit der Einfärbe-Ebene ausschließlich dort.
  const [paintValue, setPaintValue] = usePersistedState<string>('vtt-paint-value', 't:gras');
  // Vorgabe: ein sichtbares, halbtransparentes Gelb — eine vernünftige erste
  // Markierungsfarbe, kein Zufallswert (siehe Kommentar an TilePicker).
  const [highlightValue, setHighlightValue] = usePersistedState<string>('vtt-highlight-value', '#ffcc0080');
  // Während eines Bemal-/Einfärbe-Zugs lokal sichtbar (siehe onPaintPointerMove),
  // bevor EIN Delta beim Loslassen gesendet wird — dieselbe „lokal rendern,
  // beim Loslassen synchronisieren"-Form wie beim Verschieben einer Marke. Je
  // eine pro Ebene, damit ein Strich auf der einen die andere nicht überlagert.
  const [pendingPaint, setPendingPaint] = useState<Record<string, string> | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<Record<string, string> | null>(null);
  // Eigene, clientseitige Einstellung (keine Board-Einstellung — jeder sieht
  // sie unabhängig) — Fluchtluke für den teuersten Teil des Autotile-Filters
  // (feTurbulence + feDisplacementMap je Material), falls das auf einer
  // großen, dicht bemalten Karte zu langsam wird. Aus lässt die billige Hälfte
  // (Weichzeichnen + Schwelle, ausgestellt+rund) unangetastet — nur die
  // Rauschkante selbst schaltet ab. Siehe "Risk, stated up front" im Plan.
  const [rauschkante, setRauschkante] = usePersistedState<boolean>('vtt-rauschkante', true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number; moved: number } | null>(null);
  const tokenDragRef = useRef<{
    id: number;
    el: SVGGElement;
    size: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: number;
  } | null>(null);
  const paintDragRef = useRef<{ layer: 'tile' | 'highlight'; value: string; touched: Record<string, string> } | null>(null);
  // Dieselbe Versatz-erhaltende Zug-Mechanik wie bei einer Marke (siehe
  // tokenDragRef/onTokenPointerMove) — direktes transform-Schreiben ohne
  // React dazwischen, EINE Netz-Nachricht erst beim Loslassen.
  const overlayDragRef = useRef<{
    id: number;
    el: SVGGElement;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: number;
  } | null>(null);
  // Neue Messform ziehen: 'kind' + 'origin' stehen ab Zugbeginn fest,
  // 'current' wird bei jedem pointermove aktualisiert und direkt in die
  // schon gemountete Vorschau geschrieben (siehe die Elementrefs unten) —
  // kein setState während des Zugs, gleiches Muster wie tokenDragRef/
  // overlayDragRef, um denselben Nachzieh-Effekt zu vermeiden.
  const measureDragRef = useRef<
    | ({
        kind: MeasureOverlayData['kind'];
        origin: { x: number; y: number };
        current: { x: number; y: number };
      } & MeasureEls)
    | null
  >(null);
  // Nur EINMAL bei Zugbeginn gesetzt (mountet die Vorschau-<g>), nicht bei
  // jeder Zeigerbewegung — siehe measureDragRef.
  const [measureDraftKind, setMeasureDraftKind] = useState<MeasureOverlayData['kind'] | null>(null);
  // Bestehende Messform verschieben: dieselbe Versatz-Mechanik wie
  // overlayDragRef, aber auf ALLE Punktfelder der Form angewandt statt auf
  // ein einzelnes x/y — siehe applyMeasureShift.
  const measureOverlayDragRef = useRef<{
    id: number;
    base: MeasureOverlayData;
    startClientX: number;
    startClientY: number;
    lastData: MeasureOverlayData;
    moved: number;
  } | null>(null);
  // Kurzes, optimistisches Zwischenergebnis nach dem Loslassen — dasselbe
  // Muster wie dragPos/overlayDragPos, damit die Form nicht einen Frame lang
  // zur alten Position zurückspringt, bevor das Server-Echo eintrifft.
  const [measureOverlayDraft, setMeasureOverlayDraft] = useState<{ id: number; data: MeasureOverlayData } | null>(null);
  // Elementrefs je bestehender Messform (nicht Zustand — dieselbe Direkt-DOM-
  // Begründung wie überall in diesem Zug-Code), damit onMeasureOverlayPointerMove
  // ihre Geometrie umschreiben kann, ohne die Form über ihre id neu suchen zu müssen.
  const measureElsRef = useRef(new Map<number, MeasureEls>());

  const viewW = totalW / camera.zoom;
  const viewH = totalH / camera.zoom;

  // Maßstab UND Leerraum des <svg> innerhalb von .vtt-map-wrap — NICHT einfach
  // viewW/wrap.clientWidth. Die Standard-preserveAspectRatio ("xMidYMid meet")
  // staucht die Karte auf die ENGERE Achse, sobald das Seitenverhältnis des
  // Containers vom Brett abweicht (praktisch immer), und zentriert sie darin:
  // auf der weiteren Achse bleibt beidseitig Leerraum stehen (Letterboxing).
  // Für eine reine SKALIERUNG (Kamera ziehen, Marke ziehen — beides rechnet
  // mit der DIFFERENZ zweier Zeigerpositionen) kürzt sich der Leerraum
  // heraus und scale allein reichte. Für eine ABSOLUTE Zeigerposition — welche
  // Zelle liegt genau hier — tut es das nicht: ohne den Versatz zeigte jeder
  // Bemal-Klick auf eine andere Zelle, als der Zeiger tatsächlich stand.
  const mapMetrics = useCallback(
    (wrap: HTMLDivElement) => {
      const scaleX = wrap.clientWidth / viewW;
      const scaleY = wrap.clientHeight / viewH;
      const renderScale = Math.min(scaleX, scaleY);
      return {
        /** Board-Pixel je Bildschirmpixel. */
        scale: 1 / renderScale,
        /** Leerraum links/oben zwischen .vtt-map-wrap und dem tatsächlich gerenderten <svg>-Inhalt, in Bildschirmpixeln. */
        offsetX: (wrap.clientWidth - viewW * renderScale) / 2,
        offsetY: (wrap.clientHeight - viewH * renderScale) / 2,
      };
    },
    [viewW, viewH],
  );
  const boardScale = useCallback((wrap: HTMLDivElement) => mapMetrics(wrap).scale, [mapMetrics]);

  const clampCamera = useCallback(
    (x: number, y: number, zoom: number): Camera => {
      const vw = totalW / zoom;
      const vh = totalH / zoom;
      const maxX = Math.max(0, totalW - vw);
      const maxY = Math.max(0, totalH - vh);
      return {
        zoom,
        x: maxX === 0 ? (totalW - vw) / 2 : Math.min(maxX, Math.max(0, x)),
        y: maxY === 0 ? (totalH - vh) / 2 : Math.min(maxY, Math.max(0, y)),
      };
    },
    [totalW, totalH],
  );

  const zoomBy = (factor: number) => {
    setCamera((prev) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom * factor));
      const centerX = prev.x + totalW / prev.zoom / 2;
      const centerY = prev.y + totalH / prev.zoom / 2;
      const nextVw = totalW / nextZoom;
      const nextVh = totalH / nextZoom;
      return clampCamera(centerX - nextVw / 2, centerY - nextVh / 2, nextZoom);
    });
  };

  const resetCamera = () => setCamera(clampCamera(0, 0, 1));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startX: camera.x, startY: camera.y, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.startClientX) + Math.abs(e.clientY - drag.startClientY));
    const scale = boardScale(wrap);
    const dx = (e.clientX - drag.startClientX) * scale;
    const dy = (e.clientY - drag.startClientY) * scale;
    setCamera(clampCamera(drag.startX - dx, drag.startY - dy, camera.zoom));
  };
  const onPointerUp = () => {
    // Ein Klick auf leere Fläche (kein Ziehen — dieselbe Schwelle wie beim
    // Marken-Klick, siehe CLICK_THRESHOLD_PX) schließt eine offene Marken-
    // Bearbeitung. Ein Klick AUF einer Marke kommt hier nie an: startTokenDrag
    // ruft stopPropagation, dragRef.current bleibt dann null.
    if (dragRef.current && dragRef.current.moved < CLICK_THRESHOLD_PX) setSelectedTokenId(null);
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  // Welche Brett-Zelle unter diesem Zeiger liegt, oder null außerhalb des
  // Bretts. Absolute Position statt Versatz (Bemalen kennt keinen "Griff"-
  // Punkt wie eine Marke) — braucht deshalb den Letterbox-Versatz aus
  // mapMetrics, nicht nur dessen Maßstab (siehe Kommentar dort).
  const cellAt = useCallback(
    (e: { clientX: number; clientY: number }, wrap: HTMLDivElement): { x: number; y: number } | null => {
      const rect = wrap.getBoundingClientRect();
      const { scale, offsetX, offsetY } = mapMetrics(wrap);
      const bx = camera.x + (e.clientX - rect.left - offsetX) * scale;
      const by = camera.y + (e.clientY - rect.top - offsetY) * scale;
      const cx = Math.floor(bx / CELL_PX);
      const cy = Math.floor(by / CELL_PX);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
      return { x: cx, y: cy };
    },
    [mapMetrics, camera.x, camera.y, cols, rows],
  );

  // Wie cellAt, aber KONTINUIERLICH (nicht auf die Zelle abgerundet) und ans
  // Brett geklemmt statt außerhalb null zu liefern — für Messformen, deren
  // Radius/Länge/Mittelpunkt keine Zellauflösung braucht (dieselbe Klemmung
  // wie measurePoint() serverseitig in ws.ts, damit Vorschau und
  // Server-Validierung sich nicht widersprechen).
  const pointAt = useCallback(
    (e: { clientX: number; clientY: number }, wrap: HTMLDivElement): { x: number; y: number } => {
      const rect = wrap.getBoundingClientRect();
      const { scale, offsetX, offsetY } = mapMetrics(wrap);
      const bx = camera.x + (e.clientX - rect.left - offsetX) * scale;
      const by = camera.y + (e.clientY - rect.top - offsetY) * scale;
      return { x: Math.min(cols, Math.max(0, bx / CELL_PX)), y: Math.min(rows, Math.max(0, by / CELL_PX)) };
    },
    [mapMetrics, camera.x, camera.y, cols, rows],
  );

  const applyPaintCell = (cell: { x: number; y: number }) => {
    const drag = paintDragRef.current;
    if (!drag) return;
    const key = cellKey(cell.x, cell.y);
    if (key in drag.touched) return;
    drag.touched[key] = drag.value;
    const setPending = drag.layer === 'tile' ? setPendingPaint : setPendingHighlight;
    setPending((prev) => ({ ...(prev ?? {}), [key]: drag.value }));
  };
  const startPaint = (e: React.PointerEvent, layer: 'tile' | 'highlight') => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cell = cellAt(e, wrap);
    if (!cell) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    paintDragRef.current = { layer, value: layer === 'tile' ? paintValue : highlightValue, touched: {} };
    applyPaintCell(cell);
  };
  // Nur wenn sich die getroffene ZELLE ändert, nicht bei jedem rohen
  // pointermove — das hält die Update-Rate weit unter dem, was beim Ziehen
  // einer Marke zum sichtbaren Nachziehen führte (siehe dortiger Kommentar),
  // ohne dafür auf React-Rendern verzichten zu müssen: ein Feld dauert immer
  // mehrere Zeigerereignisse.
  const onPaintPointerMove = (e: React.PointerEvent) => {
    const drag = paintDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const cell = cellAt(e, wrap);
    if (!cell) return;
    applyPaintCell(cell);
  };
  const onPaintPointerUp = () => {
    const drag = paintDragRef.current;
    paintDragRef.current = null;
    if (!drag || Object.keys(drag.touched).length === 0) return;
    // Eine Nachricht für den ganzen Strich/Pinsel — wie bei einer Marke
    // (siehe onTokenPointerUp) sendet nur das ENDE, nie die Zwischenschritte.
    const action = drag.layer === 'tile' ? paintTiles : paintHighlights;
    action(drag.touched);
    // Den eigenen Entwurf für GENAU diese Zellen kurz behalten, bis boardTiles/
    // boardHighlights den Server-Stand nachträgt (dasselbe Muster wie
    // onTokenPointerUp) — sonst blitzten die gerade bemalten Zellen beim
    // Loslassen kurz auf ihren alten Stand zurück, bevor das Echo eintrifft.
    // Gezielt nur diese Zellen entfernen statt pauschal auf null, falls
    // inzwischen schon ein neuer Strich begonnen hat.
    const setPending = drag.layer === 'tile' ? setPendingPaint : setPendingHighlight;
    const touchedKeys = Object.keys(drag.touched);
    setTimeout(() => {
      setPending((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        for (const k of touchedKeys) delete next[k];
        return Object.keys(next).length > 0 ? next : null;
      });
    }, 200);
  };

  const startMeasureDrag = (e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const origin = pointAt(e, wrap);
    (e.target as Element).setPointerCapture(e.pointerId);
    measureDragRef.current = { kind: measureKind, origin, current: origin };
    setMeasureDraftKind(measureKind);
  };
  const onMeasurePointerMove = (e: React.PointerEvent) => {
    const drag = measureDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    drag.current = pointAt(e, wrap);
    writeMeasureVisual(buildMeasureData(drag.kind, drag.origin, drag.current, measureConeSpread), drag);
  };
  const onMeasurePointerUp = () => {
    const drag = measureDragRef.current;
    measureDragRef.current = null;
    setMeasureDraftKind(null);
    if (!drag) return;
    const data = buildMeasureData(drag.kind, drag.origin, drag.current, measureConeSpread);
    // Ein bloßer Klick (kein Zug) ergäbe eine unsichtbare Form ohne
    // Ausdehnung — seit Messformen nicht mehr aufs Gitter rasten (siehe
    // buildMeasureData), gilt das jetzt auch fürs Rechteck: from===to wäre
    // eine 0×0-Fläche, anders als früher, wo die Zellrundung immer
    // mindestens ein Feld ergab.
    if (data.kind === 'circle' && data.radius < 0.15) return;
    if (data.kind === 'cone' && data.length < 0.15) return;
    if (data.kind === 'ruler' && gridDistance(data.from, data.to) < 0.15) return;
    if (data.kind === 'rectangle' && Math.hypot(data.to.x - data.from.x, data.to.y - data.from.y) < 0.15) return;
    createOverlay('measure', data);
  };

  const startMeasureOverlayDrag = (e: React.PointerEvent, overlay: MeasureOverlay) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    measureOverlayDragRef.current = {
      id: overlay.id,
      base: overlay.data,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastData: overlay.data,
      moved: 0,
    };
  };
  const onMeasureOverlayPointerMove = (e: React.PointerEvent) => {
    const drag = measureOverlayDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const scale = boardScale(wrap) / CELL_PX;
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    drag.moved = Math.max(drag.moved, Math.abs(dxClient) + Math.abs(dyClient));
    const shifted = shiftMeasureData(drag.base, dxClient * scale, dyClient * scale);
    drag.lastData = shifted;
    const els = measureElsRef.current.get(drag.id);
    if (els) writeMeasureVisual(shifted, els);
  };
  const onMeasureOverlayPointerUp = () => {
    const drag = measureOverlayDragRef.current;
    measureOverlayDragRef.current = null;
    if (!drag) return;
    if (drag.moved < CLICK_THRESHOLD_PX) {
      setSelectedOverlayId(drag.id);
      return;
    }
    setMeasureOverlayDraft({ id: drag.id, data: drag.lastData });
    updateOverlay(drag.id, drag.lastData);
    setTimeout(() => setMeasureOverlayDraft((prev) => (prev?.id === drag.id ? null : prev)), 200);
  };

  const onWrapPointerDown = (e: React.PointerEvent) => {
    // Die rechte Maustaste verschiebt die Kamera IMMER, unabhängig vom
    // Werkzeug — sonst gibt es beim Bemalen (linke Taste ist ja belegt)
    // keine Möglichkeit mehr, sich über die Karte zu bewegen, ohne erst das
    // Werkzeug zu wechseln. Siehe auch onContextMenu unten (kein Menü nach
    // dem Loslassen).
    if (e.button === 2) {
      e.preventDefault();
      onPointerDown(e);
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'paint' && pipetteArmed === 'tile' && canPaint) {
      const wrap = wrapRef.current;
      const cell = wrap ? cellAt(e, wrap) : null;
      const raw = cell ? tiles[cellKey(cell.x, cell.y)] : undefined;
      const parsed = raw ? parseTileValue(raw) : null;
      if (parsed?.kind === 'color') setPaintValue(parsed.hex);
      setPipetteArmed(null);
      return;
    }
    if (tool === 'highlight' && pipetteArmed === 'highlight' && isGm) {
      const wrap = wrapRef.current;
      const cell = wrap ? cellAt(e, wrap) : null;
      const raw = cell ? highlights[cellKey(cell.x, cell.y)] : undefined;
      const parsed = raw ? parseTileValue(raw) : null;
      if (parsed?.kind === 'color') setHighlightValue(parsed.hex);
      setPipetteArmed(null);
      return;
    }
    if (tool === 'paint' && canPaint) {
      startPaint(e, 'tile');
      return;
    }
    if (tool === 'highlight' && isGm) {
      startPaint(e, 'highlight');
      return;
    }
    if (tool === 'label' && canLabel) {
      const wrap = wrapRef.current;
      const cell = wrap ? cellAt(e, wrap) : null;
      // Zellmitte statt Zellecke — eine Beschriftung ist ein Punkt, kein
      // Feld, „Klick auf dieses Feld" soll dort auch mittig landen.
      if (cell) createOverlay('label', { x: cell.x + 0.5, y: cell.y + 0.5, text: 'Text' });
      return;
    }
    if (tool === 'measure') {
      startMeasureDrag(e);
      return;
    }
    onPointerDown(e);
  };
  const onWrapPointerMove = (e: React.PointerEvent) => {
    if (paintDragRef.current) {
      onPaintPointerMove(e);
      return;
    }
    if (measureDragRef.current) {
      onMeasurePointerMove(e);
      return;
    }
    onPointerMove(e);
  };
  const onWrapPointerUp = () => {
    if (paintDragRef.current) {
      onPaintPointerUp();
      return;
    }
    if (measureDragRef.current) {
      onMeasurePointerUp();
      return;
    }
    onPointerUp();
  };

  const startTokenDrag = (e: React.PointerEvent, token: BoardToken) => {
    e.stopPropagation();
    // Rechtsklick verschiebt/wählt nicht — der öffnet stattdessen das
    // Kontextmenü (siehe onContextMenu am selben <g> unten). stopPropagation
    // oben bleibt trotzdem nötig, sonst startete der Wrap darunter sein
    // eigenes Rechtsklick-Kamera-Ziehen (onWrapPointerDown).
    if (e.button !== 0) return;
    if (!canMoveTokenFn(token)) {
      setSelectedTokenId(token.id);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    tokenDragRef.current = {
      id: token.id,
      el: e.currentTarget as SVGGElement,
      size: token.size,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: token.x,
      startY: token.y,
      lastX: token.x,
      lastY: token.y,
      moved: 0,
    };
  };
  // Rein lokal während des Ziehens — kein Netz beteiligt, also keine Latenz,
  // die hinterherhinken könnte. Andere sehen die Marke erst, wenn sie beim
  // Loslassen einmal ihre Endposition sendet (siehe onTokenPointerUp); bis
  // dahin bleibt sie für alle anderen am alten Platz stehen. Verschoben wird
  // relativ zum Klickpunkt (Versatz zwischen Zeiger und Marke bei
  // Zugbeginn bleibt über den ganzen Zug erhalten), nicht die Marke unter den
  // Zeiger gesprungen — ein Klick nicht exakt in der Mitte soll die Marke
  // nicht ruckartig verschieben.
  //
  // Bewusst KEIN setState hier, auch nicht rein lokal: React verarbeitet
  // pointermove schneller, als eine Zustandsänderung + Neu-Rendern der ganzen
  // Karte samt aller anderen Marken hinterherkommt, und genau DAS erzeugte
  // den sichtbaren Nachzieh-Effekt beim Ziehenden selbst — Netz oder nicht.
  // Stattdessen wird das `transform` des gezogenen `<g>` direkt geschrieben,
  // ohne React dazwischen; erst beim Loslassen übernimmt React wieder (siehe
  // onTokenPointerUp), an genau der Stelle, an der die Marke schon steht.
  const onTokenPointerMove = (e: React.PointerEvent) => {
    const drag = tokenDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const scale = boardScale(wrap) / CELL_PX;
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    drag.moved = Math.max(drag.moved, Math.abs(dxClient) + Math.abs(dyClient));
    const x = Math.min(cols - drag.size, Math.max(0, drag.startX + dxClient * scale));
    const y = Math.min(rows - drag.size, Math.max(0, drag.startY + dyClient * scale));
    drag.lastX = x;
    drag.lastY = y;
    const cx = (x + drag.size / 2) * CELL_PX;
    const cy = (y + drag.size / 2) * CELL_PX;
    drag.el.setAttribute('transform', `translate(${cx}, ${cy})`);
    // Erst ab der Klick-Schwelle: darunter ist es (noch) ein Klick, kein Zug
    // — der Zeiger soll bis dahin der normale Finger bleiben, nicht schon bei
    // der kleinsten Bewegung auf die Verschiebe-Pfeile springen.
    if (drag.moved >= CLICK_THRESHOLD_PX) drag.el.style.cursor = 'move';
  };
  const onTokenPointerUp = () => {
    const drag = tokenDragRef.current;
    tokenDragRef.current = null;
    if (!drag) return;
    drag.el.style.cursor = '';
    if (drag.moved < CLICK_THRESHOLD_PX) {
      setSelectedTokenId(drag.id);
      return;
    }
    // Jetzt erst übernimmt React die Position (siehe Kommentar oben) — exakt
    // der Stand, den das direkt geschriebene transform schon zeigt, damit es
    // beim Rückwechsel auf React-Rendering keinen sichtbaren Sprung gibt.
    setDragPos({ id: drag.id, x: drag.lastX, y: drag.lastY });
    // Die einzige Netz-Nachricht des ganzen Zugs — andere sehen die Marke erst
    // jetzt springen, nicht währenddessen mitwandern (siehe oben).
    moveToken(drag.id, drag.lastX, drag.lastY, true);
    // Kurz die eigene, optimistische Position behalten — bis boardTokens den
    // Server-Stand nachträgt, sonst springt die Marke einen Frame lang zurück
    // zur alten Position, bevor die Antwort da ist.
    setTimeout(() => setDragPos((prev) => (prev?.id === drag.id ? null : prev)), 200);
  };

  const startOverlayDrag = (e: React.PointerEvent, overlay: LabelOverlay) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (!canLabel) {
      setSelectedOverlayId(overlay.id);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    overlayDragRef.current = {
      id: overlay.id,
      el: e.currentTarget as SVGGElement,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: overlay.data.x,
      startY: overlay.data.y,
      lastX: overlay.data.x,
      lastY: overlay.data.y,
      moved: 0,
    };
  };
  // Gleiches Muster wie onTokenPointerMove — direktes transform-Schreiben,
  // kein setState während des Zugs (siehe dortiger Kommentar). Kein `size`,
  // deshalb kein Abzug bei der Begrenzung.
  const onOverlayPointerMove = (e: React.PointerEvent) => {
    const drag = overlayDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const scale = boardScale(wrap) / CELL_PX;
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    drag.moved = Math.max(drag.moved, Math.abs(dxClient) + Math.abs(dyClient));
    const x = Math.min(cols, Math.max(0, drag.startX + dxClient * scale));
    const y = Math.min(rows, Math.max(0, drag.startY + dyClient * scale));
    drag.lastX = x;
    drag.lastY = y;
    drag.el.setAttribute('transform', `translate(${x * CELL_PX}, ${y * CELL_PX})`);
  };
  const onOverlayPointerUp = () => {
    const drag = overlayDragRef.current;
    overlayDragRef.current = null;
    if (!drag) return;
    if (drag.moved < CLICK_THRESHOLD_PX) {
      setSelectedOverlayId(drag.id);
      return;
    }
    setOverlayDragPos({ id: drag.id, x: drag.lastX, y: drag.lastY });
    updateOverlay(drag.id, { x: drag.lastX, y: drag.lastY });
    setTimeout(() => setOverlayDragPos((prev) => (prev?.id === drag.id ? null : prev)), 200);
  };

  const placeMarker = () => {
    // camera/viewW sind Board-Pixel (CELL_PX-skaliert) — durch CELL_PX
    // geteilt ergibt das die Zellen-Koordinate, in der token.x/y stehen.
    const centerX = Math.min(cols - 1, Math.max(0, (camera.x + viewW / 2) / CELL_PX - 0.5));
    const centerY = Math.min(rows - 1, Math.max(0, (camera.y + viewH / 2) / CELL_PX - 0.5));
    createToken({ kind: 'marker', name: 'Marker', color: DEFAULT_TOKEN_COLOR, x: centerX, y: centerY });
  };

  const selectedToken = tokens.find((t) => t.id === selectedTokenId) ?? null;
  const selectedOverlay = overlays.find((o): o is LabelOverlay => o.kind === 'label' && o.id === selectedOverlayId) ?? null;
  const selectedMeasure = overlays.find((o): o is MeasureOverlay => o.kind === 'measure' && o.id === selectedOverlayId) ?? null;

  // Eigener lokaler Entwurf während eines Strichs überlagert den Server-Stand
  // (siehe onPaintPointerMove/-Up) — sonst identisch mit `tiles`/`highlights`.
  const paintedTiles = pendingPaint ? { ...tiles, ...pendingPaint } : tiles;
  const paintedHighlights = pendingHighlight ? { ...highlights, ...pendingHighlight } : highlights;
  // Farbe direkt als Pfad (unverändert) — Textur bekommt seit Phase 7 eine
  // eigene, nach Material gruppierte Maske statt eines einfachen Pfads, siehe
  // materialCells/usedMaterialKeys unten und "Autotiling ohne Kantenkunst" im
  // Plan. EIN <path> pro Farbe hält die Knotenzahl bei großflächig bemalten
  // Bereichen klein.
  const colorFillGroups = new Map<string, string[]>();
  // Zellschlüssel ("x,y", roh) je Material — die Masken-/Filter-Ebene rechnet
  // komplett in Zell-Einheiten (siehe die skalierte <g> unten), nicht in
  // Brett-Pixeln wie der Rest der Karte.
  const materialCells = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(paintedTiles)) {
    const parsed = parseTileValue(value);
    if (!parsed) continue;
    if (parsed.kind === 'color') {
      const [xs, ys] = key.split(',');
      const x = Number(xs) * CELL_PX;
      const y = Number(ys) * CELL_PX;
      const seg = `M${x} ${y}h${CELL_PX}v${CELL_PX}h${-CELL_PX}Z`;
      const list = colorFillGroups.get(parsed.hex);
      if (list) list.push(seg);
      else colorFillGroups.set(parsed.hex, [seg]);
    } else if (parsed.kind === 'texture') {
      let set = materialCells.get(parsed.key);
      if (!set) {
        set = new Set();
        materialCells.set(parsed.key, set);
      }
      set.add(key);
    }
  }
  // Von niedrig nach hoch gerendert — höhere Priorität überdeckt die
  // Übergangszone dort, wo zwei Materialien aufeinandertreffen (siehe
  // TILE_MATERIAL_BY_KEY.prio und "Autotiling ohne Kantenkunst" im Plan).
  const usedMaterialKeys = [...materialCells.keys()].sort(
    (a, b) => (TILE_MATERIAL_BY_KEY[a]?.prio ?? 0) - (TILE_MATERIAL_BY_KEY[b]?.prio ?? 0),
  );
  // Gleiche Gruppierung für die Einfärbe-Ebene — nur Farbwerte, kein
  // Texturfall, sonst dieselbe Form. Eigene Map, weil sie in einer eigenen
  // <g> ÜBER fillGroups/Gitterlinien gerendert wird (siehe unten).
  const highlightGroups = new Map<string, string[]>();
  for (const [key, value] of Object.entries(paintedHighlights)) {
    const parsed = parseTileValue(value);
    if (parsed?.kind !== 'color') continue;
    const [xs, ys] = key.split(',');
    const x = Number(xs) * CELL_PX;
    const y = Number(ys) * CELL_PX;
    const seg = `M${x} ${y}h${CELL_PX}v${CELL_PX}h${-CELL_PX}Z`;
    const list = highlightGroups.get(parsed.hex);
    if (list) list.push(seg);
    else highlightGroups.set(parsed.hex, [seg]);
  }

  return (
    <div className="vtt-map-col">
      <div className="vtt-toolbar">
        {canCreateTokens && (
          <button className="small" onClick={placeMarker} title="Marker auf dem Tisch platzieren">
            + Marker
          </button>
        )}
        {canPaint && (
          <>
            {/* Solange „Bemalen" aktiv ist, schaltet dieser Knopf nur noch
                die Farb-/Texturauswahl ein/aus, statt das Werkzeug selbst zu
                verlassen — sonst konnte man beim Zuklappen der Auswahl (um
                mehr von der Karte zu sehen) aus Versehen auch das Bemalen
                selbst beenden. Verlassen geschieht jetzt ausdrücklich über
                „Fertig" daneben. */}
            <button
              className={`small${tool === 'paint' ? ' active' : ''}`}
              onClick={() => {
                if (tool !== 'paint') {
                  setTool('paint');
                  setPickerOpen(true);
                } else {
                  setPickerOpen((v) => !v);
                }
              }}
              title="Kacheln bemalen"
            >
              🖌 Bemalen
            </button>
            {tool === 'paint' && (
              <button
                className="small"
                onClick={() => {
                  setTool('select');
                  setPickerOpen(false);
                  setPipetteArmed(null);
                }}
                title="Bemalen beenden"
              >
                Fertig
              </button>
            )}
          </>
        )}
        {isGm && (
          <>
            {/* Eigenes Werkzeug statt Teil von „Bemalen": die Einfärbe-Ebene
                ist GM-only fest verdrahtet (siehe canHighlightTiles), anders
                als Bemalen selbst, das je nach perm_tiles auch Spielern
                offenstehen kann — Farbfelder in derselben Auswahl hätten dort
                ohne erkennbaren Grund abgelehnt werden können. */}
            <button
              className={`small${tool === 'highlight' ? ' active' : ''}`}
              onClick={() => {
                if (tool !== 'highlight') {
                  setTool('highlight');
                  setPickerOpen(true);
                } else {
                  setPickerOpen((v) => !v);
                }
              }}
              title="Felder einfärben — die Kachel darunter bleibt unverändert"
            >
              🖍 Hervorheben
            </button>
            {tool === 'highlight' && (
              <button
                className="small"
                onClick={() => {
                  setTool('select');
                  setPickerOpen(false);
                  setPipetteArmed(null);
                }}
                title="Hervorheben beenden"
              >
                Fertig
              </button>
            )}
          </>
        )}
        {canLabel && (
          <button
            className={`small${tool === 'label' ? ' active' : ''}`}
            onClick={() => setTool((v) => (v === 'label' ? 'select' : 'label'))}
            title="Beschriftung setzen — Klick aufs Brett legt eine neue an, mehrere hintereinander möglich"
          >
            🏷 Beschriftung
          </button>
        )}
        {/* Messen ist immer für alle offen (siehe canMeasure() serverseitig)
            — kein perm_*-Schalter, also kein Gate hier wie bei den anderen
            Werkzeugen. Ein Ziehen von A nach B legt beim Loslassen die Form
            an (siehe startMeasureDrag). Die Form-Auswahl ist ein Flyout wie
            TilePicker/HighlightPicker (siehe pickerOpen), nicht eine
            eigene Reihe inline im Werkzeugkasten — TODO.md hat dazu eine
            allgemeine Stilregel für neue VTT-Werkzeuge festgehalten. */}
        <button
          className={`small${tool === 'measure' ? ' active' : ''}`}
          onClick={() => {
            if (tool !== 'measure') {
              setTool('measure');
              setPickerOpen(true);
            } else {
              setPickerOpen((v) => !v);
            }
          }}
          title="Messen — von einem Punkt zum anderen ziehen legt eine Messform an"
        >
          📏 Messen
        </button>
        {tool === 'measure' && (
          <button
            className="small"
            onClick={() => {
              setTool('select');
              setPickerOpen(false);
            }}
            title="Messen beenden"
          >
            Fertig
          </button>
        )}
        <span className="muted">
          {cols} × {rows} Felder
        </span>
        <div className="vtt-toolbar-spacer" />
        <button className="small" onClick={() => zoomBy(1 / 1.15)} title="Verkleinern">
          −
        </button>
        {/* Bei MIN_ZOOM ist das ganze Brett schon sichtbar — dann gibt es
            nirgendwohin mehr zu verschieben, auch wenn das Ziehen selbst
            einwandfrei funktioniert. Ohne diese Anzeige liest sich das leicht
            als kaputtes Verschieben statt als "schon ganz herausgezoomt". */}
        <span className="muted vtt-zoom-level" title="Aktueller Zoomstand">
          {Math.round(camera.zoom * 100)} %
        </span>
        <button className="small" onClick={() => zoomBy(1.15)} title="Vergrößern">
          +
        </button>
        <button className="small" onClick={resetCamera} title="Ansicht zurücksetzen">
          Zurücksetzen
        </button>
        {isGm && (
          <button className="small" onClick={() => setSettingsOpen((v) => !v)} title="Karten-Rechte">
            Karten-Rechte
          </button>
        )}
        {/* Rein clientseitig, keine Board-Einstellung — jede Ansicht sieht ihre
            eigene Wahl. Fluchtluke für den teuersten Teil des Autotile-Filters,
            falls das auf einer großen, dicht bemalten Karte zu langsam wird. */}
        <button
          className={`small${rauschkante ? ' active' : ''}`}
          onClick={() => setRauschkante((v) => !v)}
          title="Ausgefranste Kanten an Material-Übergängen (kostet Leistung auf großen, dicht bemalten Karten — bei Bedarf abschalten)"
        >
          Raue Kanten
        </button>
      </div>
      {isGm && settingsOpen && <BoardSettingsPopover board={board} onClose={() => setSettingsOpen(false)} />}
      {tool === 'paint' && pickerOpen && (
        <TilePicker
          value={paintValue}
          onChange={setPaintValue}
          onClose={() => setPickerOpen(false)}
          pipetteActive={pipetteArmed === 'tile'}
          onPipetteToggle={() => setPipetteArmed((v) => (v === 'tile' ? null : 'tile'))}
        />
      )}
      {tool === 'highlight' && pickerOpen && (
        <HighlightPicker
          value={highlightValue}
          onChange={setHighlightValue}
          onClose={() => setPickerOpen(false)}
          pipetteActive={pipetteArmed === 'highlight'}
          onPipetteToggle={() => setPipetteArmed((v) => (v === 'highlight' ? null : 'highlight'))}
        />
      )}
      {tool === 'measure' && pickerOpen && (
        <MeasureKindPicker
          value={measureKind}
          onChange={setMeasureKind}
          coneSpread={measureConeSpread}
          onConeSpreadChange={setMeasureConeSpread}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div
        className="vtt-map-wrap"
        ref={wrapRef}
        onPointerDown={onWrapPointerDown}
        onPointerMove={onWrapPointerMove}
        onPointerUp={onWrapPointerUp}
        onPointerCancel={onWrapPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: pipetteArmed ? 'copy' : tool === 'paint' || tool === 'highlight' || tool === 'measure' ? 'crosshair' : undefined }}
      >
        <svg viewBox={`${camera.x} ${camera.y} ${viewW} ${viewH}`} className="vtt-map-svg" shapeRendering="geometricPrecision">
          <defs>
            <pattern id="vtt-grid" width={CELL_PX} height={CELL_PX} patternUnits="userSpaceOnUse">
              <rect width={CELL_PX} height={CELL_PX} fill="var(--map-outer, var(--surface-sunken))" />
            </pattern>
            {/* Texturen hängen an Zell-Einheiten, nicht Brett-Pixeln — sie
                werden nur innerhalb der skalierten <g> unten referenziert
                (patternUnits="userSpaceOnUse" wertet im Koordinatensystem der
                VERWENDUNG aus, nicht der Definition), wo 1 Einheit = 1 Zelle
                gilt. */}
            {usedMaterialKeys.map((key) => (
              <pattern key={key} id={`tile-tex-${key}`} width={TEX_SPAN_CELLS} height={TEX_SPAN_CELLS} patternUnits="userSpaceOnUse">
                <image href={textureHref(key)} width={TEX_SPAN_CELLS} height={TEX_SPAN_CELLS} preserveAspectRatio="none" />
              </pattern>
            ))}
            {/* Je Material eine Maske: Weichzeichnen + harte Alpha-Schwelle
                stellt die Zellform aus und rundet ihre Ecken — daraus fallen
                Außen-/Innenecken, Einzelfeld-Inseln und Diagonalberührungen
                von selbst, ohne dass irgendwer Kantenkunst zeichnet (siehe
                "Autotiling ohne Kantenkunst" im Plan). `kante: 'hart'`
                überspringt den Filter komplett und rendert pixelgleich zur
                reinen Gitterkante. Bei `natuerlich` sitzt zusätzlich eine
                Turbulenz+Verschiebung dazwischen — abschaltbar über
                `rauschkante` (siehe dortiger Kommentar), dann bleibt nur die
                billige Weichzeichnen+Schwelle-Ausstellung. Am Ende wird die
                bearbeitete Maske mit den Original-Zellen VEREINIGT
                (feComposite operator="over"), sonst könnte die Verschiebung
                die Maske stellenweise nach innen ziehen und der Hintergrund
                bliebe als Lücke sichtbar, wo zwei Materialien sich beide
                zurückziehen — mit der Vereinigung wandert die Kante nur nach
                außen, nie nach innen. */}
            {usedMaterialKeys.map((key) => {
              const kante = TILE_MATERIAL_BY_KEY[key]?.kante ?? 'hart';
              const natuerlich = kante === 'natuerlich' && rauschkante;
              return (
                kante !== 'hart' && (
                  <filter
                    key={key}
                    id={`tile-filter-${key}`}
                    x="-25%"
                    y="-25%"
                    width="150%"
                    height="150%"
                    colorInterpolationFilters="sRGB"
                  >
                    <feGaussianBlur in="SourceGraphic" stdDeviation="0.19" result="b" />
                    {natuerlich && (
                      <>
                        <feTurbulence
                          type="fractalNoise"
                          baseFrequency="0.9"
                          numOctaves={3}
                          seed={(board.seed * 31 + key.length * 7) % 100}
                          result="n"
                        />
                        <feDisplacementMap in="b" in2="n" scale="0.34" xChannelSelector="R" yChannelSelector="G" result="b" />
                      </>
                    )}
                    <feComponentTransfer in="b" result="gewachsen">
                      <feFuncA type="linear" slope={12} intercept={-5.2} />
                    </feComponentTransfer>
                    <feComposite in="gewachsen" in2="SourceGraphic" operator="over" />
                  </filter>
                )
              );
            })}
            {usedMaterialKeys.map((key) => {
              const kante = TILE_MATERIAL_BY_KEY[key]?.kante ?? 'hart';
              const cellPath = [...(materialCells.get(key) ?? [])]
                .map((c) => {
                  const [x, y] = c.split(',');
                  return `M${x} ${y}h1v1h-1Z`;
                })
                .join('');
              return (
                <mask key={key} id={`tile-mask-${key}`} maskUnits="userSpaceOnUse" x={-1} y={-1} width={cols + 2} height={rows + 2} style={{ maskType: 'alpha' }}>
                  <g filter={kante === 'hart' ? undefined : `url(#tile-filter-${key})`}>
                    <path d={cellPath} fill="#fff" />
                  </g>
                </mask>
              );
            })}
            {/* Grobe, brettweite Rauschwolke (multiply-Verblendung) — hat mit
                den Zellen nichts zu tun und bricht deshalb genau das, was von
                der Musterwiederholung übrig bleibt: den Eindruck
                gleichmäßiger Helligkeit über die Fläche. */}
            <filter id="tile-wolke" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves={4} seed={board.seed % 100} />
              <feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  .8 .8 .8 0 -.35" />
            </filter>
          </defs>
          <rect x={0} y={0} width={totalW} height={totalH} fill="url(#vtt-grid)" />

          {/* Zell-Einheiten-Raum: 1 lokale Einheit wird zu CELL_PX Brett-
              Pixeln — genau das Koordinatensystem, in dem der Prototyp
              (Texturen.html) seine Filter-Konstanten kalibriert hat, ohne sie
              umrechnen zu müssen. Kamera/Zoom/Marken bleiben unangetastet in
              Brett-Pixeln, außerhalb dieser <g>. */}
          <g transform={`scale(${CELL_PX})`}>
            {usedMaterialKeys.map((key) => (
              <g key={key} mask={`url(#tile-mask-${key})`}>
                <rect x={-1} y={-1} width={cols + 2} height={rows + 2} fill={`url(#tile-tex-${key})`} />
              </g>
            ))}
            {usedMaterialKeys.length > 0 && (
              <rect x={0} y={0} width={cols} height={rows} filter="url(#tile-wolke)" style={{ mixBlendMode: 'multiply' }} opacity={0.55} />
            )}
          </g>

          {[...colorFillGroups].map(([fill, segs]) => (
            <path key={fill} d={segs.join('')} fill={fill} />
          ))}

          {/* Gitterlinien als EIN Pfad über der Bemalung, wie im Plan
              vorgesehen (Kachelebenen -> Gitterlinien -> …) — bewusst dünner
              als die Zellgröße, damit sie über Texturen noch lesbar bleiben,
              ohne die Fläche selbst zu verdunkeln. */}
          <path d={gridLinesPath(cols, rows)} stroke="var(--map-line, var(--border))" strokeWidth={1 / camera.zoom} fill="none" />

          {/* Einfärbe-Ebene: ÜBER Kacheln+Gitter (bei 100 % Deckkraft deckt sie
              beides sichtbar zu, siehe Spaltenkommentar an highlights_json in
              db.ts), aber UNTER den Marken — eine Marke auf einem eingefärbten
              Feld soll nicht darunter verschwinden. */}
          {[...highlightGroups].map(([fill, segs]) => (
            <path key={fill} d={segs.join('')} fill={fill} />
          ))}

          {/* Messformen: eigene, gedämpfte Akzentfarbe statt Terrain-/
              Einfärbefarben (siehe MEASURE_FILL/-STROKE) — Werkzeug-Feedback,
              kein bemaltes Terrain. Ein Klick wählt/öffnet den Editor, ein
              Zug verschiebt die ganze Form (siehe startMeasureOverlayDrag). */}
          {overlays
            .filter((o): o is MeasureOverlay => o.kind === 'measure')
            .map((o) => {
              const data = measureOverlayDraft?.id === o.id ? measureOverlayDraft.data : o.data;
              const { fill, stroke } = measureColors(data);
              // Halo-Textstil wie bei Beschriftung/Marken-Name — über jeder
              // Kachel/Textur lesbar. Nicht gerendert, wenn kein label
              // gesetzt ist (die meisten Formen bleiben unbenannt).
              const labelEl = data.label ? (
                <text
                  x={
                    data.kind === 'rectangle'
                      ? ((data.from.x + data.to.x) / 2) * CELL_PX
                      : data.kind === 'ruler'
                        ? ((data.from.x + data.to.x) / 2) * CELL_PX
                        : data.origin.x * CELL_PX
                  }
                  y={
                    data.kind === 'rectangle'
                      ? ((data.from.y + data.to.y) / 2) * CELL_PX
                      : data.kind === 'ruler'
                        ? ((data.from.y + data.to.y) / 2) * CELL_PX - 14
                        : data.kind === 'circle'
                          ? data.origin.y * CELL_PX - data.radius * CELL_PX - 8
                          : data.origin.y * CELL_PX - 8
                  }
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={700}
                  fill="var(--text)"
                  stroke="var(--panel)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {data.label}
                </text>
              ) : null;
              return (
                <g
                  key={o.id}
                  onPointerDown={(e) => startMeasureOverlayDrag(e, o)}
                  onPointerMove={onMeasureOverlayPointerMove}
                  onPointerUp={onMeasureOverlayPointerUp}
                  onPointerCancel={onMeasureOverlayPointerUp}
                  style={{ cursor: 'grab' }}
                >
                  {data.kind === 'ruler' ? (
                    <>
                      <line
                        ref={(el) => {
                          const els = measureElsRef.current.get(o.id) ?? {};
                          els.lineEl = el;
                          measureElsRef.current.set(o.id, els);
                        }}
                        x1={data.from.x * CELL_PX}
                        y1={data.from.y * CELL_PX}
                        x2={data.to.x * CELL_PX}
                        y2={data.to.y * CELL_PX}
                        stroke={stroke}
                        strokeWidth={2}
                      />
                      <text
                        ref={(el) => {
                          const els = measureElsRef.current.get(o.id) ?? {};
                          els.textEl = el;
                          measureElsRef.current.set(o.id, els);
                        }}
                        x={((data.from.x + data.to.x) / 2) * CELL_PX}
                        y={((data.from.y + data.to.y) / 2) * CELL_PX}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={12}
                        fontWeight={700}
                        fill="var(--text)"
                        stroke="var(--panel)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {gridDistance(data.from, data.to).toFixed(1)} Schritt
                      </text>
                      {labelEl}
                    </>
                  ) : data.kind === 'circle' ? (
                    <>
                      <circle
                        ref={(el) => {
                          const els = measureElsRef.current.get(o.id) ?? {};
                          els.circleEl = el;
                          measureElsRef.current.set(o.id, els);
                        }}
                        cx={data.origin.x * CELL_PX}
                        cy={data.origin.y * CELL_PX}
                        r={data.radius * CELL_PX}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={1.5}
                      />
                      {labelEl}
                    </>
                  ) : data.kind === 'rectangle' ? (
                    <>
                      <rect
                        ref={(el) => {
                          const els = measureElsRef.current.get(o.id) ?? {};
                          els.rectEl = el;
                          measureElsRef.current.set(o.id, els);
                        }}
                        x={Math.min(data.from.x, data.to.x) * CELL_PX}
                        y={Math.min(data.from.y, data.to.y) * CELL_PX}
                        width={Math.abs(data.to.x - data.from.x) * CELL_PX}
                        height={Math.abs(data.to.y - data.from.y) * CELL_PX}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={1.5}
                      />
                      {labelEl}
                    </>
                  ) : (
                    <>
                      <path
                        ref={(el) => {
                          const els = measureElsRef.current.get(o.id) ?? {};
                          els.pathEl = el;
                          measureElsRef.current.set(o.id, els);
                        }}
                        d={conePath(data.origin, data.length, data.angle, data.spread)}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={1.5}
                      />
                      {labelEl}
                    </>
                  )}
                </g>
              );
            })}

          {/* Neue Messform im Entstehen — dieselbe Farbe wie eine fertige,
              nur beim Ziehen sichtbar (siehe measureDraftKind/measureDragRef).
              pointerEvents="none": der Zeiger bleibt beim Wrap, nicht bei der
              gerade wachsenden Form. */}
          {measureDraftKind && measureDragRef.current && (
            <g pointerEvents="none">
              {measureDraftKind === 'ruler' ? (
                <>
                  <line
                    ref={(el) => {
                      if (measureDragRef.current) measureDragRef.current.lineEl = el;
                    }}
                    x1={measureDragRef.current.origin.x * CELL_PX}
                    y1={measureDragRef.current.origin.y * CELL_PX}
                    x2={measureDragRef.current.origin.x * CELL_PX}
                    y2={measureDragRef.current.origin.y * CELL_PX}
                    stroke={MEASURE_STROKE}
                    strokeWidth={2}
                  />
                  <text
                    ref={(el) => {
                      if (measureDragRef.current) measureDragRef.current.textEl = el;
                    }}
                    x={measureDragRef.current.origin.x * CELL_PX}
                    y={measureDragRef.current.origin.y * CELL_PX}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--text)"
                    stroke="var(--panel)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    0 Schritt
                  </text>
                </>
              ) : measureDraftKind === 'circle' ? (
                <circle
                  ref={(el) => {
                    if (measureDragRef.current) measureDragRef.current.circleEl = el;
                  }}
                  cx={measureDragRef.current.origin.x * CELL_PX}
                  cy={measureDragRef.current.origin.y * CELL_PX}
                  r={0}
                  fill={MEASURE_FILL}
                  stroke={MEASURE_STROKE}
                  strokeWidth={1.5}
                />
              ) : measureDraftKind === 'rectangle' ? (
                <rect
                  ref={(el) => {
                    if (measureDragRef.current) measureDragRef.current.rectEl = el;
                  }}
                  x={measureDragRef.current.origin.x * CELL_PX}
                  y={measureDragRef.current.origin.y * CELL_PX}
                  width={0}
                  height={0}
                  fill={MEASURE_FILL}
                  stroke={MEASURE_STROKE}
                  strokeWidth={1.5}
                />
              ) : (
                <path
                  ref={(el) => {
                    if (measureDragRef.current) measureDragRef.current.pathEl = el;
                  }}
                  d=""
                  fill={MEASURE_FILL}
                  stroke={MEASURE_STROKE}
                  strokeWidth={1.5}
                />
              )}
            </g>
          )}

          {/* Beschriftungen: UNTER den Marken (siehe Ebenenreihenfolge im
              Plan) — eine Marke auf einer beschrifteten Stelle soll die
              Beschriftung überdecken, nicht umgekehrt. Selber Halo-Trick wie
              beim Marken-Namen (Konturstrich statt Hintergrund-Box), damit es
              über jeder Kachel/Textur lesbar bleibt. */}
          {overlays
            .filter((o): o is LabelOverlay => o.kind === 'label')
            .map((o) => {
            const pos = overlayDragPos?.id === o.id ? overlayDragPos : o.data;
            return (
              <g
                key={o.id}
                transform={`translate(${pos.x * CELL_PX}, ${pos.y * CELL_PX})`}
                onPointerDown={(e) => startOverlayDrag(e, o)}
                onPointerMove={onOverlayPointerMove}
                onPointerUp={onOverlayPointerUp}
                onPointerCancel={onOverlayPointerUp}
                style={{ cursor: canLabel ? 'grab' : 'pointer' }}
              >
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={16}
                  fontWeight={700}
                  fill="var(--text)"
                  stroke="var(--panel)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {o.data.text}
                </text>
              </g>
            );
          })}

          {tokens
            .filter((t) => !t.hidden || isGm)
            .map((t) => {
              const pos = dragPos?.id === t.id ? dragPos : t;
              const cx = (pos.x + t.size / 2) * CELL_PX;
              const cy = (pos.y + t.size / 2) * CELL_PX;
              const r = (t.size * CELL_PX) / 2 - 3;
              return (
                <g
                  key={t.id}
                  transform={`translate(${cx}, ${cy})`}
                  onPointerDown={(e) => startTokenDrag(e, t)}
                  onPointerMove={onTokenPointerMove}
                  onPointerUp={onTokenPointerUp}
                  onPointerCancel={onTokenPointerUp}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ token: t, x: e.clientX, y: e.clientY });
                  }}
                  style={{ cursor: 'pointer' }}
                  opacity={t.hidden ? 0.55 : 1}
                >
                  {/* Reichweiten-Ring: VOR dem Marken-Kreis, damit dieser sichtbar
                      obendrauf bleibt. Bewegt sich mit, weil er im selben
                      transform-<g> sitzt wie die Marke selbst — kein eigener
                      Zustand nötig. pointerEvents="none", sonst würde ein Klick
                      irgendwo im (viel größeren) Ring statt auf der Marke selbst
                      landen. */}
                  {t.radius > 0 && <circle r={t.radius * CELL_PX} fill={t.radiusColor} stroke={t.radiusColor} strokeWidth={1.5} pointerEvents="none" />}
                  <circle r={r} fill={t.color || DEFAULT_TOKEN_COLOR} stroke="var(--panel)" strokeWidth={2} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.7} fontWeight={700} fill="#fff">
                    {t.icon || initials(t.name)}
                  </text>
                  {t.cover && (
                    <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.3} opacity={0.75}>
                      💀
                    </text>
                  )}
                  {t.statuses.length > 0 && (
                    <text y={r + 12} textAnchor="middle" fontSize={13}>
                      {t.statuses.map((s) => BOARD_STATUSES.find((b) => b.key === s)?.emoji ?? '').join('')}
                    </text>
                  )}
                  <text y={r + 24} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)" stroke="var(--panel)" strokeWidth={3} paintOrder="stroke">
                    {t.name}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
      {selectedToken && (
        <TokenEditor token={selectedToken} canEdit={canEditToken(selectedToken)} isGm={isGm} onClose={() => setSelectedTokenId(null)} />
      )}
      {contextMenu && (
        <TokenContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={canEditToken(contextMenu.token)}
          onEdit={() => {
            setSelectedTokenId(contextMenu.token.id);
            setContextMenu(null);
          }}
          onDelete={() => {
            deleteToken(contextMenu.token.id);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
      {selectedOverlay && (
        <LabelEditor
          overlay={selectedOverlay}
          canEdit={canLabel}
          onChange={(patch) => updateOverlay(selectedOverlay.id, patch)}
          onDelete={() => {
            deleteOverlay(selectedOverlay.id);
            setSelectedOverlayId(null);
          }}
          onClose={() => setSelectedOverlayId(null)}
        />
      )}
      {selectedMeasure && (
        <MeasureEditor
          overlay={selectedMeasure}
          onChange={(patch) => updateOverlay(selectedMeasure.id, { ...selectedMeasure.data, ...patch })}
          onDelete={() => {
            deleteOverlay(selectedMeasure.id);
            setSelectedOverlayId(null);
          }}
          onClose={() => setSelectedOverlayId(null)}
        />
      )}
    </div>
  );
}

// Gerüst für ein Rechtsklick-Menü auf einer Marke — der Inhalt ist bewusst
// noch nicht entschieden (siehe Konzeptgespräch: z. B. „Zu Kampf hinzufügen"
// für Monster braucht erst die Initiative aus Phase 11). Vorbelegt mit den
// beiden Aktionen, die es heute schon per Klick auf die Marke gibt —
// zukünftige Einträge kommen einfach als weitere <button> in dieselbe Liste.
function TokenContextMenu({
  x,
  y,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="vtt-context-menu-backdrop" onPointerDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="vtt-context-menu" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={onEdit}>Bearbeiten</button>
        {canEdit && (
          <button onClick={onDelete} className="vtt-context-menu-danger">
            Löschen
          </button>
        )}
      </div>
    </>
  );
}

function LabelEditor({
  overlay,
  canEdit,
  onChange,
  onDelete,
  onClose,
}: {
  overlay: LabelOverlay;
  canEdit: boolean;
  onChange: (patch: Partial<LabelOverlayData>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(overlay.data.text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gleiches Muster wie TokenEditor: beim Wechsel der ausgewählten
  // Beschriftung den Entwurf neu aus dem Server-Stand ziehen, aber nicht bei
  // jeder Änderung — sonst würde eine fremde Live-Bearbeitung das eigene
  // Tippen überschreiben.
  useEffect(() => {
    setText(overlay.data.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.id]);

  useEffect(() => () => clearTimeout(timerRef.current ?? undefined), []);

  return (
    <div className="vtt-token-editor">
      <div className="vtt-token-editor-head">
        {canEdit ? (
          <input
            className="vtt-token-editor-name"
            value={text}
            onChange={(e) => {
              const v = e.target.value.slice(0, 80);
              setText(v);
              clearTimeout(timerRef.current ?? undefined);
              timerRef.current = setTimeout(() => onChange({ text: v }), FIELD_DEBOUNCE_MS);
            }}
            maxLength={80}
          />
        ) : (
          <strong>{overlay.data.text}</strong>
        )}
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>
      {canEdit && (
        <div className="vtt-token-editor-row">
          <button className="small" onClick={onDelete}>
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

// Messen ist immer für alle offen (canMeasure() serverseitig hart auf true,
// siehe boardAccess.ts) — kein canEdit-Feld nötig, jeder darf löschen. Kegel
// bekommt zusätzlich seinen eigenen Öffnungswinkel-Regler (spread lebt PRO
// Form in data, siehe MeasureOverlayData), alle anderen nur die Kennzahl-
// Anzeige + Löschen. Verschieben geschieht direkt auf der Karte (siehe
// startMeasureOverlayDrag); Größe-Ändern per Ziehpunkt bleibt bewusst noch
// nicht gebaut — siehe Plan, "still to build".
/** Was MeasureEditor an updateOverlay meldet — immer gemergt mit dem aktuellen `data`, nie als eigenständiges Objekt (Messform-Updates ersetzen `data` ganz, siehe boardProtocol.ts). */
type MeasurePatch = { label?: string; color?: string; spread?: number };

function MeasureEditor({
  overlay,
  onChange,
  onDelete,
  onClose,
}: {
  overlay: MeasureOverlay;
  onChange: (patch: MeasurePatch) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { data } = overlay;
  const [label, setLabel] = useState(data.label ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gleiches Muster wie LabelEditor: beim Wechsel der ausgewählten Form den
  // Entwurf neu aus dem Server-Stand ziehen, nicht bei jeder Änderung.
  useEffect(() => {
    setLabel(data.label ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.id]);
  useEffect(() => () => clearTimeout(timerRef.current ?? undefined), []);

  const summary =
    data.kind === 'ruler'
      ? `${gridDistance(data.from, data.to).toFixed(1)} Schritt`
      : data.kind === 'circle'
        ? `Radius ${data.radius.toFixed(1)} Schritt`
        : data.kind === 'rectangle'
          ? `${Math.abs(data.to.x - data.from.x).toFixed(1)} × ${Math.abs(data.to.y - data.from.y).toFixed(1)} Schritt`
          : `Länge ${data.length.toFixed(1)} Schritt, ${data.spread}°`;
  return (
    <div className="vtt-token-editor">
      <div className="vtt-token-editor-head">
        <strong>
          {MEASURE_KIND_LABEL[data.kind]} — {summary}
        </strong>
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>
      {/* Optional, je Form — nicht jede Messform braucht einen Namen, aber
          mehrere gleichzeitig auf dem Brett (z. B. zwei Kegel verschiedener
          Angreifer) sind sonst nicht auseinanderzuhalten. */}
      <div className="vtt-token-editor-row">
        <input
          className="vtt-token-editor-name"
          value={label}
          placeholder="Beschriftung (optional)"
          onChange={(e) => {
            const v = e.target.value.slice(0, 60);
            setLabel(v);
            clearTimeout(timerRef.current ?? undefined);
            timerRef.current = setTimeout(() => onChange({ label: v }), FIELD_DEBOUNCE_MS);
          }}
          maxLength={60}
        />
        <ColorSwatchInput value={data.color ?? MEASURE_STROKE_DEFAULT} onChange={(v) => onChange({ color: v })} title="Farbe" />
      </div>
      {data.kind === 'cone' && (
        <div className="vtt-tile-picker-row vtt-tile-picker-opacity-row">
          <input
            type="range"
            min={5}
            max={180}
            step={5}
            value={data.spread}
            onChange={(e) => onChange({ spread: Number(e.target.value) })}
            title="Öffnungswinkel"
            className="vtt-tile-picker-opacity"
          />
          <span className="muted vtt-tile-picker-opacity-pct">{data.spread}°</span>
        </div>
      )}
      <div className="vtt-token-editor-row">
        <button className="small" onClick={onDelete}>
          Löschen
        </button>
      </div>
    </div>
  );
}

// Kleine Strichzeichnungen statt Text allein — je Form dieselbe Geometrie,
// die die Form später auch auf dem Brett zeigt, nur als Icon fürs Flyout.
// currentColor, damit sie mit dem Button-Text mitfärben (Ruhezustand vs.
// aktiv, hell/dunkel — kein eigener Farbwert nötig).
const MEASURE_KIND_ICON: Record<MeasureOverlayData['kind'], ReactNode> = {
  ruler: (
    <svg viewBox="0 0 40 40" width={32} height={32} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <line x1="8" y1="30" x2="32" y2="10" />
    </svg>
  ),
  rectangle: (
    <svg viewBox="0 0 40 40" width={32} height={32} fill="none" stroke="currentColor" strokeWidth={2.5}>
      <rect x="6" y="12" width="28" height="16" rx="1" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 40 40" width={32} height={32} fill="none" stroke="currentColor" strokeWidth={2.5}>
      <circle cx="20" cy="20" r="11" />
    </svg>
  ),
  cone: (
    <svg viewBox="0 0 40 40" width={32} height={32} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round">
      <path d={wedgePath(9, 31, 24, -40, 55)} />
    </svg>
  ),
};

// Flyout statt Inline-Reihe im Werkzeugkasten (siehe TODO.md, "dropdowns/
// flyouts over inline button sprawl") — ein 2×2-Kachelraster mit Icon +
// Beschriftung je Form statt einer reinen Textknopf-Reihe (Design mit dem
// Entwickler abgestimmt), sonst dieselbe .vtt-tile-picker-Position wie
// TilePicker/HighlightPicker, damit immer nur EIN Flyout unter dem
// Werkzeugkasten sitzt, egal welches der drei Werkzeuge gerade aktiv ist.
function MeasureKindPicker({
  value,
  onChange,
  coneSpread,
  onConeSpreadChange,
  onClose,
}: {
  value: MeasureOverlayData['kind'];
  onChange: (v: MeasureOverlayData['kind']) => void;
  coneSpread: number;
  onConeSpreadChange: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="vtt-tile-picker">
      <div className="vtt-token-editor-head">
        <strong>Messen</strong>
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="vtt-measure-kind-grid">
        {(Object.keys(MEASURE_KIND_LABEL) as MeasureOverlayData['kind'][]).map((k) => (
          <button key={k} className={`vtt-measure-kind-tile${value === k ? ' active' : ''}`} onClick={() => onChange(k)}>
            {MEASURE_KIND_ICON[k]}
            <span>{MEASURE_KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
      {/* Nur relevant für eine NEU gezogene Kegel-Form — eine bestehende
          behält ihren eigenen Wert, editierbar über MeasureEditor. */}
      {value === 'cone' && (
        <div className="vtt-tile-picker-row vtt-tile-picker-opacity-row">
          <input
            type="range"
            min={5}
            max={180}
            step={5}
            value={coneSpread}
            onChange={(e) => onConeSpreadChange(Number(e.target.value))}
            title="Öffnungswinkel"
            className="vtt-tile-picker-opacity"
          />
          <span className="muted vtt-tile-picker-opacity-pct">{coneSpread}°</span>
        </div>
      )}
    </div>
  );
}

// Farbe + Deckkraft zu einem Wert zusammenfassen — #rrggbb bei 100 %, sonst
// #rrggbbaa (siehe parseTileValue: beide sind ein gültiger Farbwert, ein
// direkt aufs SVG-<path> anwendbarer CSS-Farbstring, keine eigene Deckkraft
// nötig).
function withOpacity(hex: string, opacityPct: number): string {
  if (opacityPct >= 100) return hex.slice(0, 7);
  const alphaHex = Math.round((opacityPct / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${alphaHex}`;
}

/**
 * A plain <input type="color"> reopens the browser's native colour dialog on
 * every click — including a SECOND click meant to close the one already
 * open, which reads as a bug ("I click it again and it just reopens"). There
 * is no DOM property to ask "is the picker open", so this tracks it itself:
 * a mousedown while we believe it's already open force-closes it via
 * `blur()` instead of letting the browser reopen it. Used everywhere a plain
 * colour swatch appears on this page (token colour/ring, tile/highlight
 * picker, measure-shape colour), so the fix lands once, not four times.
 */
function ColorSwatchInput({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  return (
    <input
      type="color"
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      // A self-tracked "is it open" ref drifts out of sync with reality —
      // Chromium doesn't reliably blur the input when its native popup
      // closes by other means (Escape, picking a colour), so a remembered
      // flag can end up blocking the NEXT legitimate open. `activeElement`
      // asks the browser directly instead: this input keeps DOM focus for
      // as long as its popup is showing (the same reason blur() can close
      // it), so it's already true exactly when a second mousedown means
      // "close it", never stale.
      onMouseDown={(e) => {
        if (document.activeElement === e.currentTarget) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Der Farbe/Deckkraft/Pipette/Radierer-Block ist identisch für die
// Kachel-Ebene (TilePicker, plus Texturen) und die Einfärbe-Ebene
// (HighlightPicker, keine Texturen) — nur Titel/Beschriftungen unterscheiden
// sich, siehe die beiden Aufrufer unten.
function ColorOpacityFields({
  value,
  onChange,
  onClose,
  pipetteActive,
  onPipetteToggle,
  title,
  applyLabel,
  pipetteTitle,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  pipetteActive: boolean;
  onPipetteToggle: () => void;
  title: string;
  applyLabel: string;
  pipetteTitle: string;
}) {
  // Vorbelegt mit dem zuletzt verwendeten Wert, falls das schon eine Farbe
  // war (auch mit Deckkraft-Anteil) — sonst ein vernünftiger Vorschlag, kein
  // Zufallswert.
  const isColorValue = value.startsWith('#');
  const [customColor, setCustomColor] = useState(isColorValue ? value.slice(0, 7) : '#8b6a4a');
  const [opacity, setOpacity] = useState(isColorValue && value.length === 9 ? Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100) : 100);
  // Von der Pipette übernommene Farbe schlägt sich hier nieder, auch wenn sie
  // aus einem anderen Zug stammt als der zuletzt hier eingestellte Wert.
  useEffect(() => {
    if (!value.startsWith('#')) return;
    setCustomColor(value.slice(0, 7));
    setOpacity(value.length === 9 ? Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100) : 100);
  }, [value]);
  const combined = withOpacity(customColor, opacity);

  return (
    <>
      <div className="vtt-token-editor-head">
        <strong>{title}</strong>
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="vtt-tile-picker-row">
        <button className={`small${value === '' ? ' active' : ''}`} onClick={() => onChange('')}>
          Radierer
        </button>
        <button className={`small${pipetteActive ? ' active' : ''}`} onClick={onPipetteToggle} title={pipetteTitle}>
          💧 Pipette
        </button>
      </div>
      <div className="vtt-tile-picker-row">
        <ColorSwatchInput
          value={customColor}
          onChange={(v) => {
            setCustomColor(v);
            onChange(withOpacity(v, opacity));
          }}
          title="Eigene Farbe"
        />
        <button className={`small${value === combined ? ' active' : ''}`} onClick={() => onChange(combined)}>
          {applyLabel}
        </button>
      </div>
      <div className="vtt-tile-picker-row vtt-tile-picker-opacity-row">
        <input
          type="range"
          min={5}
          max={100}
          value={opacity}
          onChange={(e) => {
            setOpacity(Number(e.target.value));
            onChange(withOpacity(customColor, Number(e.target.value)));
          }}
          title="Deckkraft"
          className="vtt-tile-picker-opacity"
        />
        <span className="muted vtt-tile-picker-opacity-pct">{opacity} %</span>
      </div>
    </>
  );
}

function TilePicker({
  value,
  onChange,
  onClose,
  pipetteActive,
  onPipetteToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  pipetteActive: boolean;
  onPipetteToggle: () => void;
}) {
  const groups = new Map<string, typeof TILE_MATERIALS>();
  for (const m of TILE_MATERIALS) {
    const list = groups.get(m.gruppe);
    if (list) list.push(m);
    else groups.set(m.gruppe, [m]);
  }

  return (
    <div className="vtt-tile-picker">
      <ColorOpacityFields
        value={value}
        onChange={onChange}
        onClose={onClose}
        pipetteActive={pipetteActive}
        onPipetteToggle={onPipetteToggle}
        title="Bemalen"
        applyLabel="In Farbe malen"
        pipetteTitle="Farbe von einer bemalten Zelle übernehmen"
      />
      {[...groups].map(([gruppe, mats]) => (
        <div className="vtt-tile-picker-group" key={gruppe}>
          <div className="muted vtt-tile-picker-groupname">{gruppe}</div>
          <div className="vtt-tile-picker-swatches">
            {mats.map((m) => (
              <button
                key={m.key}
                className={`vtt-tile-swatch${value === `t:${m.key}` ? ' active' : ''}`}
                title={m.label}
                style={{ backgroundImage: `url(${textureHref(m.key)})` }}
                onClick={() => onChange(`t:${m.key}`)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// GM-only Einfärben: derselbe Farbe/Deckkraft/Pipette/Radierer-Block wie
// TilePicker, aber ohne Texturen — die Ebene kennt nur Farbwerte (siehe
// board.highlights.paint in ws.ts, das alles andere ablehnt).
function HighlightPicker({
  value,
  onChange,
  onClose,
  pipetteActive,
  onPipetteToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  pipetteActive: boolean;
  onPipetteToggle: () => void;
}) {
  return (
    <div className="vtt-tile-picker">
      <ColorOpacityFields
        value={value}
        onChange={onChange}
        onClose={onClose}
        pipetteActive={pipetteActive}
        onPipetteToggle={onPipetteToggle}
        title="Hervorheben"
        applyLabel="Einfärben"
        pipetteTitle="Farbe von einem eingefärbten Feld übernehmen"
      />
    </div>
  );
}

function BoardSettingsPopover({ board, onClose }: { board: BoardSettings; onClose: () => void }) {
  const { updateBoardSettings } = useDicePanel();
  const rows: { key: keyof BoardSettings; label: string }[] = [
    { key: 'permTokens', label: 'Marken anlegen/bearbeiten' },
    { key: 'permMove', label: 'Marken verschieben' },
    { key: 'permTiles', label: 'Kacheln bemalen' },
    { key: 'permLabels', label: 'Beschriftungen' },
    { key: 'permImages', label: 'Bilder' },
  ];
  return (
    <div className="vtt-settings-pop">
      <div className="vtt-token-editor-head">
        <strong>Karten-Rechte dieser Gruppe</strong>
        <button className="small" onClick={onClose} title="Schließen" aria-label="Schließen">
          ✕
        </button>
      </div>
      {rows.map((r) => {
        const value = board[r.key] as 'gm' | 'all';
        return (
          <div className="vtt-settings-row" key={r.key}>
            <span>{r.label}</span>
            <span className="seg">
              <button className={value === 'gm' ? 'active' : ''} onClick={() => updateBoardSettings({ [r.key]: 'gm' })}>
                Spielleitung
              </button>
              <button className={value === 'all' ? 'active' : ''} onClick={() => updateBoardSettings({ [r.key]: 'all' })}>
                Alle
              </button>
            </span>
          </div>
        );
      })}
      <p className="muted vtt-settings-fixed">Messen: immer alle · Nebel: nur Spielleitung</p>
    </div>
  );
}

export default function VirtualTable() {
  const { id } = useParams();
  const groupId = Number(id);
  const { user } = useAuth();
  const { myGroups, selectRoom, setHidden, boardTokens, boardSettings, boardTiles, boardHighlights, boardOverlays, hydrateBoard } =
    useDicePanel();
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [error, setError] = useState('');
  const [chatCollapsed, toggleChat] = useCollapsed('vtt-chat');
  const [chatWidth, setChatWidth] = usePersistedState<number>('vtt-chat-w', 300);
  const chatW = Math.min(520, Math.max(260, Math.round(chatWidth)));

  useEffect(() => {
    apiGet<GroupMeta>(`/api/groups/${groupId}`)
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
    apiGet<BoardSnapshotResponse>(`/api/groups/${groupId}/board`)
      .then((snap) =>
        hydrateBoard(
          snap.board,
          snap.tokens,
          JSON.parse(snap.board.tilesJson || '{}'),
          JSON.parse(snap.board.highlightsJson || '{}'),
          snap.overlays,
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
    // hydrateBoard ist stabil (useCallback ohne Abhängigkeiten in DicePanelProvider) — nicht in die Dep-Liste, sonst liefe der Fetch bei jeder Board-Änderung erneut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Der Chat-Dock verschwindet zugunsten der festen Spalte hier — genau wofür
  // DicePanelProvider.hidden gedacht ist. Der Raum wird erzwungen, sobald die
  // Raumliste geladen ist (myGroups kommt asynchron nach).
  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, [setHidden]);
  useEffect(() => {
    if (myGroups.some((g) => g.id === groupId)) selectRoom(groupId);
  }, [groupId, myGroups, selectRoom]);

  const startChatResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatW;
    const onMove = (ev: PointerEvent) => setChatWidth(Math.min(520, Math.max(260, Math.round(startW + (startX - ev.clientX)))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-col');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('resizing-col');
  };

  if (error) return <p className="error">{error}</p>;
  if (!meta || !boardSettings) return <p className="muted">Lade…</p>;

  const myCharId = myGroups.find((g) => g.id === groupId)?.myCharacterId ?? null;
  const backHref = meta.group.isTemp ? `/event/${groupId}` : `/gruppe/${groupId}`;
  const canCreateTokens = user.isGm || boardSettings.permTokens === 'all';
  // Die Besitzerin eines Charakters hat auf DESSEN Marke immer die volle
  // Kontrolle (Farbe, Zustände, Verschieben) — unabhängig von perm_tokens/
  // perm_move, genau wie die Spielleitung sie immer hat. Bei Marker-Marken
  // (ownerUserId === null) gilt weiterhin nur die Board-Einstellung.
  const canEditToken = (t: BoardToken) => user.isGm || boardSettings.permTokens === 'all' || t.ownerUserId === user.id;
  const canMoveToken = (t: BoardToken) => user.isGm || boardSettings.permMove === 'all' || t.ownerUserId === user.id;
  const canPaint = user.isGm || boardSettings.permTiles === 'all';
  const canLabel = user.isGm || boardSettings.permLabels === 'all';

  return (
    <div className="vtt-page">
      <div className="vtt-crumb">
        <Link to={backHref}>← {meta.group.isTemp ? 'Zum Event' : 'Zur Gruppe'}</Link>
        <h1 className="vtt-room-name">{meta.group.name} · Tisch</h1>
      </div>
      <div className="vtt-cols">
        {user.isGm ? (
          <VttRoster groupId={groupId} cols={boardSettings.cols} rows={boardSettings.rows} />
        ) : myCharId != null ? (
          <CharSheetProvider charId={myCharId}>
            <CharacterSidebar />
          </CharSheetProvider>
        ) : (
          <p className="muted">Kein eigener Charakter in dieser Gruppe.</p>
        )}

        <MapCanvas
          groupId={groupId}
          board={boardSettings}
          tokens={boardTokens}
          tiles={boardTiles}
          highlights={boardHighlights}
          overlays={boardOverlays}
          canCreateTokens={canCreateTokens}
          canEditToken={canEditToken}
          canMoveToken={canMoveToken}
          canPaint={canPaint}
          canLabel={canLabel}
          isGm={user.isGm}
        />

        {chatCollapsed ? (
          <aside className="char-sidebar collapsed">
            <button className="side-expand" onClick={toggleChat} title="Chat ausklappen" aria-label="Chat ausklappen">
              <span className="side-expand-chev" aria-hidden>
                ‹
              </span>
              <span className="side-expand-label" aria-hidden>
                Chat
              </span>
            </button>
          </aside>
        ) : (
          <aside className="char-sidebar" style={{ '--sidebar-w': `${chatW}px` } as React.CSSProperties}>
            <div
              className="side-resize"
              onPointerDown={startChatResize}
              role="separator"
              aria-orientation="vertical"
              title="Breite ziehen"
            />
            <div className="vtt-chat-body">
              <div className="side-head">
                <span className="side-title">Chat</span>
                <button className="side-toggle" onClick={toggleChat} title="Chat einklappen" aria-label="Chat einklappen">
                  ›
                </button>
              </div>
              <FeedColumn />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
