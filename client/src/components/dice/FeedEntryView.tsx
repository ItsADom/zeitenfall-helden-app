import type { DiceExpression, DieConfirmation, PendingConfirmation } from '@shared/dice';
import { diceSidesForExpression } from '@shared/dice';
import type { FeedEntry, RollFeedEntry, RollVisibility } from '@shared/diceProtocol';
import { useAuth } from '../../App';
import { useDicePanel } from './DicePanelProvider';
import Die from './Die';
// Sämtliche Wortlaute stehen in labels.ts — hier wird nur ausgewählt, welcher.
import { CONFIRM, OUTCOME, PENDING, VISIBILITY } from './labels';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Probe-Notation (immer W20) UND ein echter, ggf. gemischter DiceExpression —
// beide haben Gruppen + einen flachen Modifikator gemeinsam. `code` ist reine
// Anzeige-Vorliebe (`/dicecode`, siehe DicePanelProvider) — „w" und „d" bleiben
// als EINGABE immer beide gültig, das hier bestimmt nur, was ausgegeben wird.
function exprText(e: DiceExpression, code: 'w' | 'd'): string {
  const groupsText = e.groups.map((g) => `${g.count}${code}${g.sides}`).join('+');
  const mod = e.modifier === 0 ? '' : e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`;
  return `${groupsText}${mod}`;
}

// „Verborgen" bzw. „SL + Spieler" sichtbar markieren — wer den Eintrag sieht,
// soll wissen, dass die anderen ihn NICHT sehen.
function VisibilityTag({ visibility }: { visibility: RollVisibility }) {
  if (visibility === 'public') return null;
  return <span className="feed-vis-tag">{visibility === 'hidden' ? VISIBILITY.hidden : VISIBILITY.gmPlayer}</span>;
}

// Nie unauffällig lassen, welcher Wurf von der Spielleitung ausgelöst wurde,
// nicht von der Person selbst — siehe roll.pending.force in ws.ts.
function ForcedTag() {
  return (
    <span className="feed-forced-tag" title="Die Spielleitung hat diesen Wurf ausgelöst, ohne auf die Person zu warten">
      🎯 erzwungen
    </span>
  );
}

// Bestätigungswürfe: je natürlicher 20/1 ein eigener Wurf, dieselbe ≥10-
// Schwelle für beide, nur gegensätzlich gedeutet — bei der 20 heißt ≥10
// „bestätigt" (Patzer), bei der 1 heißt ≥10 „bestätigt" (krit. Erfolg). Der
// Bestätigungswert wirkt immer auf die Summe (20 addiert, 1 zieht ab),
// unabhängig davon, ob er bestätigt. Siehe shared/src/dice.ts.
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
              1 → <strong>{c.value}</strong>{' '}
              {c.confirmed
                ? c.cancelled
                  ? CONFIRM.cancelledConfirmedOne(c.value as number)
                  : CONFIRM.confirmedOne(c.value as number)
                : `${CONFIRM.unconfirmedOne(c.value as number)}${c.cancelled ? ` ${CONFIRM.cancelled}` : ''}`}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

// Offene Bestätigungen, nur beim Werfer selbst. Bei genau EINEM ausstehenden
// Würfel ein eigener Knopf wie bisher; bei 2+ (mehrere Patzer/Krits in einer
// Probe) EIN gemeinsames Knopfpaar für alle — alles-oder-nichts per Design,
// kein Mischen aus Bestätigen und Ohne. „Ohne" ist für Würfe, die gar keine
// Patzer kennen (Glückswurf, Zufallstabelle): der Auslöser wird wirkungslos
// abgehakt.
function PendingConfirmations({ entryId, pending, mine }: { entryId: number; pending: PendingConfirmation[]; mine: boolean }) {
  const { confirmDie, diceCode } = useDicePanel();
  if (pending.length === 0) return null;
  if (!mine) {
    return <div className="feed-pending muted">{PENDING.waiting(pending.length)}</div>;
  }
  if (pending.length > 1) {
    return (
      <div className="feed-pending">
        <span className="feed-pending-row">
          {pending.map((p) => (
            <Die key={p.dieIndex} value={p.trigger} sides={20} code={diceCode} />
          ))}
          <button className="small" onClick={() => pending.forEach((p) => confirmDie(entryId, p.dieIndex))}>
            {PENDING.rollAll}
          </button>
          <button
            className="small feed-pending-skip"
            title={PENDING.skipAllHint}
            onClick={() => pending.forEach((p) => confirmDie(entryId, p.dieIndex, true))}
          >
            {PENDING.skipAll}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="feed-pending">
      {pending.map((p) => (
        <span key={p.dieIndex} className="feed-pending-row">
          <Die value={p.trigger} sides={20} code={diceCode} />
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

function RollView({ entry, grouped }: { entry: RollFeedEntry; grouped?: boolean }) {
  const { user } = useAuth();
  const { diceCode } = useDicePanel();
  const { roll } = entry;
  const isProbe = roll.mode === 'probe';
  const mine = entry.authorUserId === user.id;
  // Ein erzwungener Wurf (siehe ForcedTag/roll.pending.force) hat nie einen
  // wartenden Werfer, der bestätigen könnte — die Spielleitung darf hier
  // einspringen (server erlaubt es serverseitig genauso, siehe roll.confirm
  // in ws.ts).
  const canConfirm = mine || (user.isGm && isProbe && !!roll.forcedByGm);
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
  const notation = isProbe
    ? exprText({ groups: [{ count: roll.n, sides: 20 }], modifier: 0 }, diceCode)
    : exprText(roll.expression, diceCode);
  // Pro Würfel der passende Seitenzahl — bei einem gemischten Ausdruck
  // (z. B. „1w6+1w20") ist das NICHT für alle Würfel dasselbe.
  const diceSides = isProbe ? roll.dice.map(() => 20) : diceSidesForExpression(roll.expression);

  // Innerhalb eines Gruppenwurf-Blocks (siehe FeedEntryView unten) trägt EIN
  // neutraler Rand den ganzen Block als Klammer — bewusst nicht eingefärbt,
  // sonst ließe sich die Klammer selbst leicht mit einer Erfolg/Fehlschlag-
  // Farbe verwechseln (rot/grün-Themes!). Die Erfolgsfarbe pro Zeile bleibt
  // trotzdem: sie steckt in derselben feed-roll--{outcome}-Klasse wie sonst
  // auch (Text UND — von feed-roll--grouped überschrieben — Randfarbe).
  const outcomeClass = outcome ? `feed-roll--${outcome}` : '';
  const rollClass = grouped ? `${outcomeClass} feed-roll--grouped`.trim() : outcomeClass;
  return (
    <div className={`feed-entry feed-roll${rollClass ? ` ${rollClass}` : ''}`}>
      <div className="feed-roll-head">
        <span className="feed-time">{formatTime(entry.createdAt)}</span>
        <strong>{entry.authorName}</strong>
        {title && <span className="feed-roll-title">{title}</span>}
        <span className="feed-roll-notation muted">({notation})</span>
        {isProbe && roll.forcedByGm && <ForcedTag />}
        <VisibilityTag visibility={entry.visibility} />
      </div>
      <div className="feed-roll-body">
        <span className="feed-dice">
          {roll.dice.map((d, i) => (
            <Die
              key={i}
              value={d}
              sides={diceSides[i]}
              code={diceCode}
              attr={isProbe ? roll.attrParts?.[i] : undefined}
            />
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
        {/* Waffen-Schaden-Wurf: die RD der Waffe steht direkt neben dem
            Ergebnis, damit sie niemand von Hand nachtragen muss. */}
        {!isProbe && roll.rd && (
          <span className="feed-roll-rd muted" title="Rüstungsdurchdringung">
            RD {roll.rd}
          </span>
        )}
      </div>
      <Confirmations confirmations={roll.confirmations} />
      <PendingConfirmations entryId={entry.id} pending={roll.pending} mine={canConfirm} />
    </div>
  );
}

// Kanonischer Text, den DicePanel für „---"/„/line" sendet — egal wie viele
// Bindestriche getippt wurden, gespeichert wird immer derselbe Marker.
const DIVIDER_TEXT = /^-{3,}$/;

export default function FeedEntryView({ entry, grouped }: { entry: FeedEntry; grouped?: boolean }) {
  if (entry.kind === 'roll') return <RollView entry={entry} grouped={grouped} />;
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
      )}{' '}
      <VisibilityTag visibility={entry.visibility} />
    </div>
  );
}
