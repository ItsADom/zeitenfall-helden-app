import type { FeedEntry } from '@shared/diceProtocol';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Roll rendering (kind==='roll') arrives in a later build-plan phase — this
// view only ever sees chat messages until then.
export default function FeedEntryView({ entry }: { entry: FeedEntry }) {
  if (entry.kind !== 'message') return null;
  return (
    <div className={`feed-entry feed-msg${entry.isMe ? ' feed-msg--me' : ''}`}>
      <span className="feed-time">{formatTime(entry.createdAt)}</span>
      {entry.isMe ? (
        <span className="feed-text">
          <strong>{entry.authorName}</strong> {entry.text}
        </span>
      ) : (
        <span className="feed-text">
          <strong>{entry.authorName}:</strong> {entry.text}
        </span>
      )}
    </div>
  );
}
