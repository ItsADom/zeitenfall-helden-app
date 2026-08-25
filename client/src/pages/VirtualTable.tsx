import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../api';
import { useAuth } from '../App';
import { CharSheetProvider } from '../components/charSheet';
import CharacterSidebar from '../components/CharacterSidebar';
import { useCollapsed } from '../components/collapse';
import { useDicePanel } from '../components/dice/DicePanelProvider';
import FeedColumn from '../components/dice/FeedColumn';
import { usePersistedState } from '../components/persist';
import VttRoster from '../components/VttRoster';

// Phase 4 (docs/concepts/virtual-table.md): der Seitenrahmen — Route, Layout,
// Kamera (Verschieben/Zoomen) über ein leeres Gitter, die feste Chat-Spalte,
// die Schnellübersicht. Noch keine Token, noch kein Bemalen — das kommt mit
// den nächsten Phasen, sobald es etwas zu zeichnen gibt.

interface GroupMeta {
  group: { id: number; name: string; isTemp: boolean };
}
interface BoardMeta {
  board: { cols: number; rows: number };
}

const CELL_PX = 40;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function MapCanvas({ groupId, cols, rows }: { groupId: number; cols: number; rows: number }) {
  const totalW = cols * CELL_PX;
  const totalH = rows * CELL_PX;
  const [camera, setCamera] = usePersistedState<Camera>(`vtt-camera:${groupId}`, { x: 0, y: 0, zoom: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);

  const viewW = totalW / camera.zoom;
  const viewH = totalH / camera.zoom;

  const clampCamera = useCallback(
    (x: number, y: number, zoom: number): Camera => {
      const vw = totalW / zoom;
      const vh = totalH / zoom;
      // Passt das Gitter nicht mehr ganz hinein (weit herausgezoomt), lieber
      // zentrieren als an einer beliebigen Ecke kleben zu bleiben.
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
      // Zur Mitte des aktuellen Ausschnitts zoomen, nicht zur Ecke oben links.
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
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startX: camera.x, startY: camera.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const scale = viewW / wrap.clientWidth;
    const dx = (e.clientX - drag.startClientX) * scale;
    const dy = (e.clientY - drag.startClientY) * scale;
    setCamera(clampCamera(drag.startX - dx, drag.startY - dy, camera.zoom));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  return (
    <div className="vtt-map-col">
      <div className="vtt-toolbar">
        <span className="muted">
          {cols} × {rows} Felder
        </span>
        <div className="vtt-toolbar-spacer" />
        <button className="small" onClick={() => zoomBy(1 / 1.15)} title="Verkleinern">
          −
        </button>
        <button className="small" onClick={() => zoomBy(1.15)} title="Vergrößern">
          +
        </button>
        <button className="small" onClick={resetCamera} title="Ansicht zurücksetzen">
          Zurücksetzen
        </button>
      </div>
      <div
        className="vtt-map-wrap"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <svg viewBox={`${camera.x} ${camera.y} ${viewW} ${viewH}`} className="vtt-map-svg">
          <defs>
            <pattern id="vtt-grid" width={CELL_PX} height={CELL_PX} patternUnits="userSpaceOnUse">
              <rect width={CELL_PX} height={CELL_PX} fill="var(--map-outer, var(--surface-sunken))" />
              <path
                d={`M ${CELL_PX} 0 L 0 0 0 ${CELL_PX}`}
                fill="none"
                stroke="var(--map-line, var(--border))"
                strokeWidth={1 / camera.zoom}
              />
            </pattern>
          </defs>
          <rect x={0} y={0} width={totalW} height={totalH} fill="url(#vtt-grid)" />
        </svg>
      </div>
    </div>
  );
}

export default function VirtualTable() {
  const { id } = useParams();
  const groupId = Number(id);
  const { user } = useAuth();
  const { myGroups, selectRoom, setHidden } = useDicePanel();
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [board, setBoard] = useState<BoardMeta | null>(null);
  const [error, setError] = useState('');
  const [chatCollapsed, toggleChat] = useCollapsed('vtt-chat');
  const [chatWidth, setChatWidth] = usePersistedState<number>('vtt-chat-w', 300);
  const chatW = Math.min(520, Math.max(260, Math.round(chatWidth)));

  useEffect(() => {
    apiGet<GroupMeta>(`/api/groups/${groupId}`)
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
    apiGet<BoardMeta>(`/api/groups/${groupId}/board`)
      .then(setBoard)
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
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
  if (!meta || !board) return <p className="muted">Lade…</p>;

  const myCharId = myGroups.find((g) => g.id === groupId)?.myCharacterId ?? null;
  const backHref = meta.group.isTemp ? `/event/${groupId}` : `/gruppe/${groupId}`;

  return (
    <div className="vtt-page">
      <div className="vtt-crumb">
        <Link to={backHref}>← {meta.group.isTemp ? 'Zum Event' : 'Zur Gruppe'}</Link>
        <h1 className="vtt-room-name">{meta.group.name} · Tisch</h1>
      </div>
      <div className="vtt-cols">
        {user.isGm ? <VttRoster groupId={groupId} /> : myCharId != null ? (
          <CharSheetProvider charId={myCharId}>
            <CharacterSidebar />
          </CharSheetProvider>
        ) : (
          <p className="muted">Kein eigener Charakter in dieser Gruppe.</p>
        )}

        <MapCanvas groupId={groupId} cols={board.board.cols} rows={board.board.rows} />

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
