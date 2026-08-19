import type { DiceExpression, DieConfirmation, PendingConfirmation } from '@shared/dice';
import { diceSidesForExpression } from '@shared/dice';
import type { FeedEntry, RollFeedEntry, RollVisibility } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
// Sämtliche Wortlaute stehen in labels.ts — hier wird nur ausgewählt, welcher.
import { CONFIRM, OUTCOME, PENDING, VISIBILITY } from './labels';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Probe-Notation (immer W20) UND ein echter, ggf. gemischter DiceExpression —
// beide haben Gruppen + einen flachen Modifikator gemeinsam.
function exprText(e: DiceExpression): string {
  const groupsText = e.groups.map((g) => `${g.count}w${g.sides}`).join('+');
  const mod = e.modifier === 0 ? '' : e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`;
  return `${groupsText}${mod}`;
}

// „Verborgen" bzw. „SL + Spieler" sichtbar markieren — wer den Eintrag sieht,
// soll wissen, dass die anderen ihn NICHT sehen.
function VisibilityTag({ visibility }: { visibility: RollVisibility }) {
  if (visibility === 'public') return null;
  return <span className="feed-vis-tag">{visibility === 'hidden' ? VISIBILITY.hidden : VISIBILITY.gmPlayer}</span>;
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
        <span key={i} className={`feed-confirm${c.cancelled ? ' feed-confirm--cancelled' : ''}`}>
          {c.skipped ? (
            <>
              {c.trigger} → <em>{CONFIRM.skipped}</em>
            </>
          ) : c.trigger === 20 ? (
            <>
              20 → <strong>{c.value}</strong>{' '}
              {/* Aufgehoben heißt: kein Patzer/kein Krit — der Wert wirkt trotzdem. */}
              {c.confirmed
                ? c.cancelled
                  ? CONFIRM.cancelledConfirmed
                  : CONFIRM.confirmed
                : `${CONFIRM.unconfirmed(c.value as number)}${c.cancelled ? ` ${CONFIRM.cancelled}` : ''}`}
            </>
          ) : (
            <>
              1 → <strong>{c.value}</strong> {CONFIRM.subtracted(c.value as number)}
              {c.cancelled && ` ${CONFIRM.cancelled}`}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

// Offene Bestätigungen — je Würfel ein eigener Knopf, und nur beim Werfer
// selbst. „Ohne" ist für Würfe, die gar keine Patzer kennen (Glückswurf,
// Zufallstabelle): der Auslöser wird wirkungslos abgehakt.
function PendingConfirmations({ entryId, pending, mine }: { entryId: number; pending: PendingConfirmation[]; mine: boolean }) {
  const { confirmDie } = useDicePanel();
  if (pending.length === 0) return null;
  if (!mine) {
    return <div className="feed-pending muted">{PENDING.waiting(pending.length)}</div>;
  }
  return (
    <div className="feed-pending">
      {pending.map((p) => (
        <span key={p.dieIndex} className="feed-pending-row">
          <span className={`feed-die feed-die--${p.trigger === 20 ? '20' : '1'}`}>{p.trigger}</span>
          <button className="small" onClick={() => confirmDie(entryId, p.dieIndex)}>
            {PENDING.roll}
          </button>
          <button className="small feed-pending-skip" title={PENDING.skipHint} onClick={() => confirmDie(entryId, p.dieIndex, true)}>
            {PENDING.skip}
          </button>
        </span>
      ))}
    </div>
  );
}

function RollView({ entry }: { entry: RollFeedEntry }) {
  const { user } = useAuth();
  const { roll } = entry;
  const isProbe = roll.mode === 'probe';
  const mine = entry.authorUserId === user.id;
  // Solange Bestätigungen offen sind, steht das Ergebnis bewusst noch nicht
  // fest — eine ausstehende 20 könnte den Wurf ohnehin zum Patzer machen.
  const outcome = !roll.resolved
    ? 'open'
    : isProbe
      ? roll.criticalFailure
        ? 'crit'
        : roll.criticalSuccess
          ? 'critsuccess'
          : roll.success
            ? roll.narrow
              ? 'narrow'
              : 'success'
            : 'fail'
      : roll.flagged
        ? 'flagged'
        : '';
  const title = roll.label;
  // Welche Würfel überhaupt geworfen wurden, ist sonst reine Ratesache am
  // Ergebnis — ein Titel/Favorit verdeckt den Ausdruck ja gerade. Bei einer
  // Probe zählt nur Anzahl/Seiten (immer W20), der Erleichterung/Erschwernis-
  // Modifikator steht schon separat daneben.
  const notation = isProbe ? exprText({ groups: [{ count: roll.n, sides: 20 }], modifier: 0 }) : exprText(roll.expression);
  // Pro Würfel der passende Seitenzahl — bei einem gemischten Ausdruck
  // (z. B. „1w6+1w20") ist das NICHT für alle Würfel dasselbe.
  const diceSides = isProbe ? roll.dice.map(() => 20) : diceSidesForExpression(roll.expression);

  return (
    <div className={`feed-entry feed-roll${outcome ? ` feed-roll--${outcome}` : ''}`}>
      <div className="feed-roll-head">
        <span className="feed-time">{formatTime(entry.createdAt)}</span>
        <strong>{entry.authorName}</strong>
        {title && <span className="feed-roll-title">{title}</span>}
        <span className="feed-roll-notation muted">({notation})</span>
        <VisibilityTag visibility={entry.visibility} />
      </div>
      <div className="feed-roll-body">
        <span className="feed-dice">
          {roll.dice.map((d, i) => (
            <Die key={i} value={d} sides={diceSides[i]} />
          ))}
        </span>
        <span className="feed-roll-sum">
          = <strong>{roll.adjustedSum}</strong>
          {/* Der Zielwert verrät den Attributs-/Talentwert dahinter — nur der
              Werfer selbst und die Spielleitung sehen ihn, andere Spieler nur
              Würfel, Summe und Erfolg/Misserfolg. */}
          {isProbe && (mine || user.isGm) && <span className="muted"> / {roll.probeZahl}</span>}
          {/* Modifikator immer sichtbar, wenn gesetzt — sonst wäre eine
              Erleichterung/Erschwernis für alle anderen unsichtbar angewendet. */}
          {isProbe && roll.modifier !== 0 && (
            <span className="feed-roll-mod" title="Erleichterung/Erschwernis der Spielleitung">
              {' '}
              ({roll.modifier > 0 ? '+' : ''}
              {roll.modifier})
            </span>
          )}
        </span>
        {isProbe && roll.resolved && (
          <span className="feed-roll-outcome">
            {roll.criticalFailure
              ? OUTCOME.criticalFailure
              : roll.criticalSuccess
                ? OUTCOME.criticalSuccess
                : roll.success
                  ? roll.narrow
                    ? OUTCOME.narrow
                    : OUTCOME.success
                  : OUTCOME.failure}
          </span>
        )}
        {/* „/master"/„/wild": derselbe Platz, den eine Probe für Erfolg/
            Fehlschlag nutzt, mit dem serverseitig nachgeschlagenen Text. */}
        {!isProbe && roll.outcomeLabel && <span className="feed-roll-outcome">{roll.outcomeLabel}</span>}
      </div>
      <Confirmations confirmations={roll.confirmations} />
      <PendingConfirmations entryId={entry.id} pending={roll.pending} mine={mine} />
    </div>
  );
}

// Kanonischer Text, den DicePanel für „---"/„/line" sendet — egal wie viele
// Bindestriche getippt wurden, gespeichert wird immer derselbe Marker.
const DIVIDER_TEXT = /^-{3,}$/;

export default function FeedEntryView({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'roll') return <RollView entry={entry} />;
  if (DIVIDER_TEXT.test(entry.text.trim())) {
    return <hr className="feed-divider" />;
  }
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
