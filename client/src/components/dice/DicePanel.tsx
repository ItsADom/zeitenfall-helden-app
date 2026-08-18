import { useEffect, useRef, useState } from 'react';
import { usePersistedState } from '../persist';
import { useDicePanel } from './DicePanelProvider';
import FeedEntryView from './FeedEntryView';

// Größe frei ziehbar (Ecke oben links, siehe startResize) und je Gerät
// gemerkt — wie CharacterSidebar's Breiten-Ziehgriff, nur an zwei Achsen.
const MIN_W = 280;
const MAX_W = 640;
const DEFAULT_W = 340;
const MIN_H = 240;
const MAX_H = 800;
const DEFAULT_H = 420;
const clampW = (n: number): number => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
const clampH = (n: number): number => Math.min(MAX_H, Math.max(MIN_H, Math.round(n)));

// Fixed-position dock, mounted once at the App level (see App.tsx). Always
// visible unless a page explicitly suppresses it (DicePanelProvider's
// `hidden`) — which room is open no longer follows page navigation, see the
// room selector below.
export default function DicePanel() {
  const { groupId, myGroups, feed, connected, hasMore, loadingMore, collapsed, toggle, selectRoom, sendChat, loadMore } =
    useDicePanel();
  const activeRoom = myGroups.find((g) => g.id === groupId);
  const [draft, setDraft] = useState('');
  const [width, setWidth] = usePersistedState<number>('dice:w', DEFAULT_W);
  const [height, setHeight] = usePersistedState<number>('dice:h', DEFAULT_H);
  const w = clampW(width);
  const h = clampH(height);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<number | null>(null);

  useEffect(() => {
    const last = feed.length > 0 ? feed[feed.length - 1].id : null;
    if (last !== null && last !== lastIdRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    lastIdRef.current = last;
  }, [feed]);

  if (collapsed) {
    return (
      <button className="dice-dock-tab screen-only" onClick={toggle} title="Chat & Würfel öffnen">
        🎲 Chat
        {groupId !== null && !connected && <span className="dice-dock-offline" title="Verbindung wird aufgebaut…" aria-hidden />}
      </button>
    );
  }

  const send = () => {
    if (!draft.trim() || groupId === null) return;
    sendChat(draft);
    setDraft('');
  };

  // Ecke oben links ziehen vergrößert nach links UND oben, weil der Dock am
  // rechten/unteren Fensterrand verankert bleibt (fixed right/bottom).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = w;
    const startH = h;
    const onMove = (ev: PointerEvent) => {
      setWidth(clampW(startW + (startX - ev.clientX)));
      setHeight(clampH(startH + (startY - ev.clientY)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-dice');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('resizing-dice');
  };

  return (
    <div className="dice-dock screen-only" style={{ width: w, height: h }}>
      <div className="dice-resize" onPointerDown={startResize} role="separator" title="Größe ziehen" />
      <div className="dice-dock-head">
        {myGroups.length >= 2 ? (
          <select
            className="dice-dock-room"
            value={groupId ?? ''}
            onChange={(e) => selectRoom(Number(e.target.value))}
            title="Chatraum wählen"
          >
            {groupId === null && <option value="" disabled>Chatraum wählen…</option>}
            {myGroups.map((g) => (
              <option key={g.id} value={g.id}>
                🎲 {g.name}
              </option>
            ))}
          </select>
        ) : (
          <span>🎲 Chat &amp; Würfel</span>
        )}
        {groupId !== null && !connected && <span className="muted dice-dock-status">verbinde…</span>}
        <button className="dice-dock-collapse" onClick={toggle} title="Einklappen" aria-label="Einklappen">
          ▾
        </button>
      </div>
      <div className="dice-dock-feed" ref={scrollRef}>
        {groupId === null ? (
          <p className="muted dice-dock-empty">
            {myGroups.length === 0 ? 'Noch in keiner Gruppe.' : 'Wähle oben einen Chatraum.'}
          </p>
        ) : (
          <>
            {hasMore && (
              <button className="small dice-dock-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Lädt…' : 'Ältere Nachrichten laden'}
              </button>
            )}
            {feed.length === 0 && <p className="muted dice-dock-empty">Noch nichts los hier.</p>}
            {feed.map((entry) => (
              <FeedEntryView key={entry.id} entry={entry} />
            ))}
          </>
        )}
      </div>
      <div className="dice-dock-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={groupId === null}
          placeholder={activeRoom?.myCharacterName ? `Als ${activeRoom.myCharacterName}… (/me für Aktionen)` : 'Nachricht… (/me für Aktionen)'}
        />
        <button className="small" onClick={send} disabled={!draft.trim() || groupId === null}>
          Senden
        </button>
      </div>
    </div>
  );
}
