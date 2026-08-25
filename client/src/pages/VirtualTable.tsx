import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoardSettings, BoardToken } from '@shared/boardProtocol';
import { BOARD_COVERS, BOARD_STATUSES } from '@shared/boardStatus';
import { cellKey, parseTileValue } from '@shared/board';
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

interface GroupMeta {
  group: { id: number; name: string; isTemp: boolean };
}
interface BoardSnapshotResponse {
  board: BoardSettings & { tilesJson: string; highlightsJson: string };
  tokens: BoardToken[];
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
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  scheduleUpdate('color', e.target.value);
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
  canCreateTokens,
  canEditToken,
  canMoveToken: canMoveTokenFn,
  canPaint,
  isGm,
}: {
  groupId: number;
  board: BoardSettings;
  tokens: BoardToken[];
  tiles: Record<string, string>;
  /** cellKey -> #rrggbb(aa) tint, GM-only layer above `tiles` — see paintHighlights. */
  highlights: Record<string, string>;
  /** Placing a brand-new marker has no owner yet to check against — board-wide only. */
  canCreateTokens: boolean;
  canEditToken: (t: BoardToken) => boolean;
  canMoveToken: (t: BoardToken) => boolean;
  canPaint: boolean;
  isGm: boolean;
}) {
  const { cols, rows } = board;
  const totalW = cols * CELL_PX;
  const totalH = rows * CELL_PX;
  const { createToken, moveToken, deleteToken, paintTiles, paintHighlights } = useDicePanel();
  const [camera, setCamera] = usePersistedState<Camera>(`vtt-camera:${groupId}`, { x: 0, y: 0, zoom: 1 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
  // Rechtsklick auf eine Marke — Bildschirmkoordinaten (nicht Brett-Zelle),
  // damit das Menü als normales HTML-Overlay position: fixed neben dem
  // Zeiger sitzt, unabhängig von Kamera/Zoom. Inhalt bewusst noch offen
  // (siehe TokenContextMenu) — hier steht erstmal nur das Gerüst.
  const [contextMenu, setContextMenu] = useState<{ token: BoardToken; x: number; y: number } | null>(null);
  // 'select': normales Verschieben/Anwählen von Marken + Verschieben der
  // Kamera. 'paint': derselbe Zeiger bemalt stattdessen Zellen — siehe
  // startPaint/onPaintPointerMove unten. 'highlight': dieselbe Mechanik, aber
  // auf der separaten Einfärbe-Ebene (highlights_json) statt tiles_json — GM-
  // only, siehe boardAccess.canHighlightTiles.
  const [tool, setTool] = useState<'select' | 'paint' | 'highlight'>('select');
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
    onPointerDown(e);
  };
  const onWrapPointerMove = (e: React.PointerEvent) => {
    if (paintDragRef.current) {
      onPaintPointerMove(e);
      return;
    }
    onPointerMove(e);
  };
  const onWrapPointerUp = () => {
    if (paintDragRef.current) {
      onPaintPointerUp();
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
  };
  const onTokenPointerUp = () => {
    const drag = tokenDragRef.current;
    tokenDragRef.current = null;
    if (!drag) return;
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

  const placeMarker = () => {
    // camera/viewW sind Board-Pixel (CELL_PX-skaliert) — durch CELL_PX
    // geteilt ergibt das die Zellen-Koordinate, in der token.x/y stehen.
    const centerX = Math.min(cols - 1, Math.max(0, (camera.x + viewW / 2) / CELL_PX - 0.5));
    const centerY = Math.min(rows - 1, Math.max(0, (camera.y + viewH / 2) / CELL_PX - 0.5));
    createToken({ kind: 'marker', name: 'Marker', color: DEFAULT_TOKEN_COLOR, x: centerX, y: centerY });
  };

  const selectedToken = tokens.find((t) => t.id === selectedTokenId) ?? null;

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
          🌫 Rauschkante
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
      <div
        className="vtt-map-wrap"
        ref={wrapRef}
        onPointerDown={onWrapPointerDown}
        onPointerMove={onWrapPointerMove}
        onPointerUp={onWrapPointerUp}
        onPointerCancel={onWrapPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: pipetteArmed ? 'copy' : tool === 'paint' || tool === 'highlight' ? 'crosshair' : undefined }}
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
                  style={{ cursor: canMoveTokenFn(t) ? 'grab' : 'pointer' }}
                  opacity={t.hidden ? 0.55 : 1}
                >
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
        <input
          type="color"
          value={customColor}
          onChange={(e) => {
            setCustomColor(e.target.value);
            onChange(withOpacity(e.target.value, opacity));
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
  const { myGroups, selectRoom, setHidden, boardTokens, boardSettings, boardTiles, boardHighlights, hydrateBoard } = useDicePanel();
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
        hydrateBoard(snap.board, snap.tokens, JSON.parse(snap.board.tilesJson || '{}'), JSON.parse(snap.board.highlightsJson || '{}')),
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
          canCreateTokens={canCreateTokens}
          canEditToken={canEditToken}
          canMoveToken={canMoveToken}
          canPaint={canPaint}
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
