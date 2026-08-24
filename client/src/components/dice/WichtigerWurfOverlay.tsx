// „Der große Wurf" (/i): the full-screen announcement every connected screen in
// the room shows before the roll reaches the chat.
//
// PLACEHOLDER STAGE. The dimming, the timing and the one-way exit below are
// final; the 3D dice, the fanfare and the crit effects arrive in later phases
// and replace only what is marked.
//
// Two structural properties are the whole reason this component is shaped the
// way it is, and neither should be simplified away:
//
//   1. THERE IS EXACTLY ONE EXIT. A natural end, Escape, a click, the safety
//      timeout and any thrown error all route through `beenden()`. That is what
//      makes "this can never lock somebody's UI" true rather than hoped-for —
//      and the timeout is armed before anything expensive is even attempted.
//   2. THE ENTRY IS HANDED BACK, ALWAYS. Whatever ends the performance, the
//      held-back roll goes into the feed (see KinoAuftrag.entry). Skipping must
//      cost the viewer the animation, never the result.
//
// Mounted at App.tsx level, outside <main>, and keyed by `lauf` so a second
// announcement remounts rather than reconciles — see KinoLauf.
import { useEffect, useRef, useState } from 'react';
import { REDUCED_HOLD_MS, SAFETY_TIMEOUT_MS, totalDuration, hasSurvivingCrit } from '@shared/diceCinematic';
import { diceSidesForExpression } from '@shared/dice';
import { spielePuffer, wichtigPuffer } from './chimes';
import { useDicePanel } from './DicePanelProvider';
import { WICHTIG } from './labels';

/**
 * How long the dim takes to lift at the end. Must match the CSS transition on
 * .dice-kino--aus, or the overlay unmounts mid-fade.
 */
const ABBLEND_MS = 400;

/** Reduced motion drops the MOTION, never the information — see styles.css. */
function bevorzugtRuhe(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function WichtigerWurfOverlay() {
  const { kino, kinoBeenden, ton, lautstaerke } = useDicePanel();
  if (!kino) return null;
  return (
    <Vorstellung
      key={kino.lauf}
      auftrag={kino.auftrag}
      beendenAn={kinoBeenden}
      // „/mute" means mute: someone who switched the chat sound off does not
      // want a fanfare either. They still get the whole visual performance.
      stumm={ton === 'aus' || lautstaerke <= 0}
      lautstaerke={lautstaerke}
    />
  );
}

function Vorstellung({
  auftrag,
  beendenAn,
  stumm,
  lautstaerke,
}: {
  auftrag: import('@shared/diceProtocol').KinoAuftrag;
  beendenAn: (entryId: number) => void;
  stumm: boolean;
  lautstaerke: number;
}) {
  const { entry } = auftrag;
  const [abblenden, setAbblenden] = useState(false);
  const fertigRef = useRef(false);
  const beendenAnRef = useRef(beendenAn);
  beendenAnRef.current = beendenAn;
  // The one exit, reachable from the click handler as well as from the effect's
  // own timers and key listener. Assigned by the effect below.
  const beendenRef = useRef<() => void>(() => {});

  useEffect(() => {
    const roll = entry.roll;
    const sides = roll.mode === 'expr' ? diceSidesForExpression(roll.expression) : 20;
    const mitKrit = hasSurvivingCrit(roll.dice, sides);
    const ruhe = bevorzugtRuhe();
    // A tab nobody is looking at gets no performance: rAF is throttled to
    // nothing there anyway, and a fanfare firing into a background tab is a
    // jump-scare when its owner comes back.
    const unbeachtet = typeof document !== 'undefined' && document.hidden;
    const dauer = unbeachtet ? 0 : ruhe ? REDUCED_HOLD_MS : totalDuration(mitKrit);

    // Played straight from the buffer rather than through spieleTon(): that
    // picks the player's CHOSEN chime, and its SPERRE_MS lock is shared with
    // notifications, so a „/i" fired shortly after a request chime would be
    // silent. Bypassing both is deliberate.
    //
    // The visuals never wait for the audio. If the buffer is not rendered yet
    // the fanfare simply starts a few milliseconds late.
    let fanfare: AudioBufferSourceNode | null = null;
    let abgebrochen = false;
    if (!stumm && !unbeachtet) {
      void wichtigPuffer()
        .then((puffer) => {
          if (abgebrochen || fertigRef.current) return;
          fanfare = spielePuffer(puffer, lautstaerke);
        })
        .catch(() => {
          // A silent announcement is still an announcement.
        });
    }

    const zeitgeber: ReturnType<typeof setTimeout>[] = [];
    const beenden = () => {
      if (fertigRef.current) return; // timeout, click and natural end must not overtake each other
      fertigRef.current = true;
      for (const t of zeitgeber) clearTimeout(t);
      // A skip cuts the fanfare short too — it would otherwise keep playing
      // over a page that has already moved on.
      try {
        fanfare?.stop();
      } catch {
        // Already finished; nothing to stop.
      }
      // Appending the entry clears `kino`, which unmounts this component in the
      // same tick. Any fading therefore has to have happened ALREADY — see the
      // reveal timer below — and a skip is deliberately abrupt: someone who
      // pressed Escape asked to be out of here, not to watch a fade.
      beendenAnRef.current(entry.id);
    };
    beendenRef.current = beenden;

    // Armed FIRST, before anything that could fail. Once the later phases load
    // three.js here, a 404 chunk or a refused WebGL context still ends with the
    // roll in the chat.
    zeitgeber.push(setTimeout(beenden, SAFETY_TIMEOUT_MS));
    zeitgeber.push(setTimeout(beenden, dauer));
    // The dim lifts over the closing stretch, so the page is back before the
    // roll drops into the chat rather than both happening at once.
    const abblendenAb = Math.max(0, dauer - ABBLEND_MS);
    if (dauer > 0) zeitgeber.push(setTimeout(() => setAbblenden(true), abblendenAb));

    // Escape in the CAPTURE phase: for these seconds it means "skip", full
    // stop. Without capture it collides with the dock input's own Escape
    // handler, which dismisses the suggestion list.
    const aufTaste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      beenden();
    };
    document.addEventListener('keydown', aufTaste, true);
    return () => {
      abgebrochen = true;
      document.removeEventListener('keydown', aufTaste, true);
      for (const t of zeitgeber) clearTimeout(t);
      // StrictMode runs this between the two development mounts; without it the
      // fanfare would play twice, a beat apart.
      try {
        fanfare?.stop();
      } catch {
        // Already finished.
      }
      // Deliberately NOT calling beenden() here. In StrictMode this cleanup runs
      // between the two development mounts; ending the performance would make it
      // finish before it began. The safety timeout covers a real unmount.
    };
  }, [entry, stumm, lautstaerke]);

  return (
    <div
      className={`dice-kino screen-only${abblenden ? ' dice-kino--aus' : ''}`}
      role="alertdialog"
      aria-live="polite"
      aria-label={WICHTIG.overlayLabel(entry.authorName)}
      onClick={() => beendenRef.current()}
    >
      {/* PLACEHOLDER — the 3D stage replaces this element, not the wrapper. */}
      <div className="dice-kino-buehne">
        <p className="dice-kino-platzhalter">KINO</p>
      </div>
      <p className="dice-kino-hinweis">{WICHTIG.ueberspringen}</p>
    </div>
  );
}
