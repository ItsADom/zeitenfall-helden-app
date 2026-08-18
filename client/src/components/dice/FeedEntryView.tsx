import type { DieConfirmation } from '@shared/dice';
import type { FeedEntry, RollFeedEntry, RollVisibility } from '@shared/diceProtocol';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function exprText(e: { count: number; sides: number; modifier: number }): string {
  const mod = e.modifier === 0 ? '' : e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`;
  return `${e.count}w${e.sides}${mod}`;
}

// „Verborgen" bzw. „SL + Spieler" sichtbar markieren — wer den Eintrag sieht,
// soll wissen, dass die anderen ihn NICHT sehen.
function VisibilityTag({ visibility }: { visibility: RollVisibility }) {
  if (visibility === 'public') return null;
  const label = visibility === 'hidden' ? '🔒 nur für dich' : '🔒 SL + Spieler';
  return <span className="feed-vis-tag">{label}</span>;
}

// Ein Würfel; natürliche 20/1 stechen hervor, weil sie eine Bestätigung auslösen.
function Die({ value, sides }: { value: number; sides: number }) {
  const crit = sides === 20 && (value === 20 || value === 1);
  return <span className={`feed-die${crit ? (value === 20 ? ' feed-die--20' : ' feed-die--1') : ''}`}>{value}</span>;
}

// Bestätigungswürfe: je natürlicher 20/1 ein eigener Wurf. Bei der 20 heißt
// ≥10 „bestätigt" (Patzer), <10 wird stattdessen addiert; die 1 wird immer
// abgezogen. Siehe shared/src/dice.ts.
function Confirmations({ confirmations }: { confirmations: DieConfirmation[] }) {
  if (confirmations.length === 0) return null;
  return (
    <div className="feed-confirms">
      {confirmations.map((c, i) => (
        <span key={i} className="feed-confirm">
          {c.trigger === 20 ? (
            <>
              20 → <strong>{c.value}</strong> {c.confirmed ? '· bestätigt (Patzer)' : `· nicht bestätigt (+${c.value})`}
            </>
          ) : (
            <>
              1 → <strong>{c.value}</strong> · −{c.value}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

function RollView({ entry }: { entry: RollFeedEntry }) {
  const { roll } = entry;
  const isProbe = roll.mode === 'probe';
  // Ein bestätigter Patzer schlägt den Zahlenvergleich; sonst entscheidet die
  // bereinigte Summe gegen die Probe-Zahl (nur bei Proben).
  const outcome = isProbe ? (roll.criticalFailure ? 'crit' : roll.success ? 'success' : 'fail') : roll.flagged ? 'flagged' : '';
  const title = isProbe ? roll.label : roll.label || exprText(roll.expression);

  return (
    <div className={`feed-entry feed-roll${outcome ? ` feed-roll--${outcome}` : ''}`}>
      <div className="feed-roll-head">
        <span className="feed-time">{formatTime(entry.createdAt)}</span>
        <strong>{entry.authorName}</strong>
        <span className="feed-roll-title">{title}</span>
        <VisibilityTag visibility={entry.visibility} />
      </div>
      <div className="feed-roll-body">
        <span className="feed-dice">
          {roll.dice.map((d, i) => (
            <Die key={i} value={d} sides={isProbe ? 20 : roll.expression.sides} />
          ))}
        </span>
        <span className="feed-roll-sum">
          = <strong>{roll.adjustedSum}</strong>
          {isProbe && <span className="muted"> / {roll.probeZahl}</span>}
        </span>
        {isProbe && (
          <span className="feed-roll-outcome">
            {roll.criticalFailure
              ? roll.criticalFailureCount > 1
                ? `Patzer ×${roll.criticalFailureCount}`
                : 'Patzer'
              : roll.success
                ? 'Gelungen'
                : 'Misslungen'}
          </span>
        )}
      </div>
      <Confirmations confirmations={roll.confirmations} />
    </div>
  );
}

export default function FeedEntryView({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'roll') return <RollView entry={entry} />;
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
