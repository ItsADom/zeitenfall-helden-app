import { useEffect, useRef, useState } from 'react';
import { useDicePanel } from './DicePanelProvider';
import FeedEntryView from './FeedEntryView';

// Fixed-position dock, mounted once at the App level (see App.tsx) so the
// same connection/feed survives navigating between a group's pages and a
// character on it. Gated on groupId != null by the caller.
export default function DicePanel() {
  const { feed, connected, hasMore, loadingMore, collapsed, toggle, sendChat, loadMore } = useDicePanel();
  const [draft, setDraft] = useState('');
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
        {!connected && <span className="dice-dock-offline" title="Verbindung wird aufgebaut…" aria-hidden />}
      </button>
    );
  }

  const send = () => {
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft('');
  };

  return (
    <div className="dice-dock screen-only">
      <div className="dice-dock-head">
        <span>🎲 Chat &amp; Würfel</span>
        {!connected && <span className="muted dice-dock-status">verbinde…</span>}
        <button className="dice-dock-collapse" onClick={toggle} title="Einklappen" aria-label="Einklappen">
          ▾
        </button>
      </div>
      <div className="dice-dock-feed" ref={scrollRef}>
        {hasMore && (
          <button className="small dice-dock-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Lädt…' : 'Ältere Nachrichten laden'}
          </button>
        )}
        {feed.length === 0 && <p className="muted dice-dock-empty">Noch nichts los hier.</p>}
        {feed.map((entry) => (
          <FeedEntryView key={entry.id} entry={entry} />
        ))}
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
          placeholder="Nachricht… (/me für Aktionen)"
        />
        <button className="small" onClick={send} disabled={!draft.trim()}>
          Senden
        </button>
      </div>
    </div>
  );
}
