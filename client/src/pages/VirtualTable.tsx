import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoardSettings, BoardToken } from '@shared/boardProtocol';
import { BOARD_COVERS, BOARD_STATUSES } from '@shared/boardStatus';
import { apiGet } from '../api';
import { useAuth } from '../App';
import { CharSheetProvider } from '../components/charSheet';
import CharacterSidebar from '../components/CharacterSidebar';
import { useCollapsed } from '../components/collapse';
import { useDicePanel } from '../components/dice/DicePanelProvider';
import FeedColumn from '../components/dice/FeedColumn';
import { usePersistedState } from '../components/persist';
import VttRoster from '../components/VttRoster';

// Phase 4 (docs/concepts/virtual-table.md): der Seitenrahmen. Phase 5 fügt
// Token hinzu — anlegen/verschieben/löschen, Status-Marken und Cover, GM-
// Rechte-Panel. Noch kein Bemalen/Nebel/Bilder/Initiative, das kommt später.

interface GroupMeta {
  group: { id: number; name: string; isTemp: boolean };
}
interface BoardSnapshotResponse {
  board: BoardSettings;
  tokens: BoardToken[];
}

const CELL_PX = 40;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
// Wie oft eine laufende Ziehbewegung höchstens gesendet wird — der Server
// nimmt board.token.move ohnehin von der Ratenbegrenzung aus, aber ohne
// Drosselung wäre jedes einzelne pointermove-Ereignis eine eigene Nachricht.
const MOVE_THROTTLE_MS = 50;
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
            value={token.name}
            onChange={(e) => updateToken(token.id, { name: e.target.value })}
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
                value={token.icon}
                onChange={(e) => updateToken(token.id, { icon: e.target.value.slice(0, 2) })}
                maxLength={2}
                style={{ width: 40 }}
                placeholder="🗿"
              />
            </label>
            <label>
              Farbe{' '}
              <input type="color" value={token.color || DEFAULT_TOKEN_COLOR} onChange={(e) => updateToken(token.id, { color: e.target.value })} />
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
  canEditTokens,
  canMoveTokens,
  isGm,
}: {
  groupId: number;
  board: BoardSettings;
  tokens: BoardToken[];
  canEditTokens: boolean;
  canMoveTokens: boolean;
  isGm: boolean;
}) {
  const { cols, rows } = board;
  const totalW = cols * CELL_PX;
  const totalH = rows * CELL_PX;
  const { createToken, moveToken } = useDicePanel();
  const [camera, setCamera] = usePersistedState<Camera>(`vtt-camera:${groupId}`, { x: 0, y: 0, zoom: 1 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const tokenDragRef = useRef<{
    id: number;
    size: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastSent: number;
    moved: number;
  } | null>(null);

  const viewW = totalW / camera.zoom;
  const viewH = totalH / camera.zoom;

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

  const startTokenDrag = (e: React.PointerEvent, token: BoardToken) => {
    e.stopPropagation();
    if (!canMoveTokens) {
      setSelectedTokenId(token.id);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    tokenDragRef.current = {
      id: token.id,
      size: token.size,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: token.x,
      startY: token.y,
      lastX: token.x,
      lastY: token.y,
      lastSent: 0,
      moved: 0,
    };
  };
  const onTokenPointerMove = (e: React.PointerEvent) => {
    const drag = tokenDragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    // viewW/wrap.clientWidth ist Pixel-je-Bildschirmpixel im SVG-Koordinaten-
    // raum (== Board-Pixel, siehe CELL_PX) — token.x/y stehen aber in ZELLEN
    // (shared/src/board.ts), deshalb hier zusätzlich durch CELL_PX teilen.
    const scale = viewW / wrap.clientWidth / CELL_PX;
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    drag.moved = Math.max(drag.moved, Math.abs(dxClient) + Math.abs(dyClient));
    const x = Math.min(cols - drag.size, Math.max(0, drag.startX + dxClient * scale));
    const y = Math.min(rows - drag.size, Math.max(0, drag.startY + dyClient * scale));
    drag.lastX = x;
    drag.lastY = y;
    setDragPos({ id: drag.id, x, y });
    const now = performance.now();
    if (now - drag.lastSent >= MOVE_THROTTLE_MS) {
      drag.lastSent = now;
      moveToken(drag.id, x, y, false);
    }
  };
  const onTokenPointerUp = () => {
    const drag = tokenDragRef.current;
    tokenDragRef.current = null;
    if (!drag) return;
    if (drag.moved < CLICK_THRESHOLD_PX) {
      setDragPos(null);
      setSelectedTokenId(drag.id);
      return;
    }
    moveToken(drag.id, drag.lastX, drag.lastY, true);
    // Kurz die eigene, optimistische Position behalten — der endgültige
    // board.token.updated (final:true umgeht die Server-Drossel) trifft fast
    // augenblicklich ein und überschreibt boardTokens; ohne die kurze
    // Verzögerung würde die Marke einen Frame lang zur letzten gedrosselten
    // Position zurückspringen, bevor die finale Antwort da ist.
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

  return (
    <div className="vtt-map-col">
      <div className="vtt-toolbar">
        {canEditTokens && (
          <button className="small" onClick={placeMarker} title="Marker auf dem Tisch platzieren">
            + Marker
          </button>
        )}
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
        {isGm && (
          <button className="small" onClick={() => setSettingsOpen((v) => !v)} title="Karten-Rechte">
            Karten-Rechte
          </button>
        )}
      </div>
      {isGm && settingsOpen && <BoardSettingsPopover board={board} onClose={() => setSettingsOpen(false)} />}
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
                  style={{ cursor: canMoveTokens ? 'grab' : 'pointer' }}
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
        <TokenEditor token={selectedToken} canEdit={canEditTokens} isGm={isGm} onClose={() => setSelectedTokenId(null)} />
      )}
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
  const { myGroups, selectRoom, setHidden, boardTokens, boardSettings, hydrateBoard } = useDicePanel();
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
      .then((snap) => hydrateBoard(snap.board, snap.tokens))
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
  const canEditTokens = user.isGm || boardSettings.permTokens === 'all';
  const canMoveTokens = user.isGm || boardSettings.permMove === 'all';

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
          canEditTokens={canEditTokens}
          canMoveTokens={canMoveTokens}
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
