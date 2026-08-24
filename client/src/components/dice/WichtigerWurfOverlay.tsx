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
import {
  PHASES,
  REDUCED_HOLD_MS,
  SAFETY_TIMEOUT_MS,
  effectTriggers,
  hasSurvivingCrit,
  totalDuration,
} from '@shared/diceCinematic';
import { diceSidesForExpression } from '@shared/dice';
import { spielePuffer, wichtigPuffer } from './chimes';
import { preloadCinematic } from './cinematic/preload';
// From kontrast.ts, NOT faces.ts: faces.ts imports three, and a static import
// of it here would put the whole renderer in the main bundle (see preload.ts).
import { tinteFuer } from './cinematic/kontrast';
import { useDicePanel } from './DicePanelProvider';
import { WICHTIG } from './labels';

/**
 * The die pigments the feed already uses, so a die looks the same tumbling
 * across the screen as it does in the chat entry two seconds later.
 *
 * The d20 deliberately has no pigment of its own — it keeps the neutral border
 * colour precisely so that a red 20 and a blue 1 read unambiguously (see the
 * token block in styles.css).
 */
function koerperFarbe(stil: CSSStyleDeclaration, sides: number): string {
  const eigen = stil.getPropertyValue(`--die-w${sides}`).trim();
  return eigen || stil.getPropertyValue('--border-strong').trim() || '#8a8a8a';
}

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
  const [ohneBuehne, setOhneBuehne] = useState(false);
  const [patzer, setPatzer] = useState(false);
  const leinwandRef = useRef<HTMLCanvasElement | null>(null);
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
    let zeitgeberPatzer: ReturnType<typeof setTimeout> | null = null;
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

    // --- the stage --------------------------------------------------------
    // Loaded only now, and only if there is something to look at. The dim is
    // already fading and nothing MOVES until t = 700 ms, which is exactly what
    // hides the 30-80 ms of WebGL context creation — that ordering is
    // load-bearing rather than decorative (see PHASES).
    let buehne: { render(t: number): void; dispose(): void } | null = null;
    let raf = 0;
    const beginn = performance.now();

    if (!ruhe && !unbeachtet) {
      void preloadCinematic()
        .then(({ createStage }) => {
          const leinwand = leinwandRef.current;
          if (abgebrochen || fertigRef.current || !leinwand) return;

          const stil = getComputedStyle(document.documentElement);
          const tinteHell = stil.getPropertyValue('--panel').trim() || '#ffffff';
          const tinteDunkel = stil.getPropertyValue('--text').trim() || '#222222';
          const seiten = roll.mode === 'expr' ? diceSidesForExpression(roll.expression) : roll.dice.map(() => 20);

          buehne = createStage(leinwand, {
            seed: auftrag.seed,
            hasCrit: mitKrit,
            saugZielPx: dockPunkt(),
            // The same tokens the feed uses for a crit, so the burst and the
            // chat entry two seconds later are recognisably the same event.
            effektFarben: {
              gold: stil.getPropertyValue('--mastery').trim() || '#c8871a',
              glueck: stil.getPropertyValue('--over-line').trim() || '#2f5db0',
              patzer: stil.getPropertyValue('--crit-line').trim() || '#9a2f22',
            },
            wuerfel: roll.dice.map((wert, i) => {
              const koerper = koerperFarbe(stil, seiten[i] ?? 20);
              return { sides: seiten[i] ?? 20, value: wert, koerper, tinte: tinteFuer(koerper, tinteHell, tinteDunkel) };
            }),
          });

          const zeichne = () => {
            if (fertigRef.current || !buehne) return;
            buehne.render(performance.now() - beginn);
            raf = requestAnimationFrame(zeichne);
          };
          raf = requestAnimationFrame(zeichne);
        })
        .catch(() => {
          // A missing chunk (most likely a stale hash after a redeploy, since
          // tabs survive deploys by design) or a refused WebGL context. The
          // announcement still happens, just as the still card.
          if (!abgebrochen) setOhneBuehne(true);
        });
    }

    // A surviving natural 20 also darkens the whole screen. That belongs in CSS
    // rather than in the scene: it colours everything, it is one fixed div, and
    // its reduced-motion override then sits right next to it in the stylesheet.
    if (!ruhe && !unbeachtet && effectTriggers(roll.dice, sides).some((a) => a.trigger === 20)) {
      zeitgeberPatzer = setTimeout(() => setPatzer(true), PHASES.effect.start);
    }

    const zeitgeber: ReturnType<typeof setTimeout>[] = [];
    const beenden = () => {
      if (fertigRef.current) return; // timeout, click and natural end must not overtake each other
      fertigRef.current = true;
      for (const t of zeitgeber) clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      if (zeitgeberPatzer) clearTimeout(zeitgeberPatzer);
      buehne?.dispose();
      buehne = null;
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
      // StrictMode runs this between the two development mounts: without a full
      // teardown here the first mount's WebGL context would leak, and Chrome
      // allows only a handful before it starts dropping them.
      if (raf) cancelAnimationFrame(raf);
      buehne?.dispose();
      buehne = null;
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
      className={`dice-kino screen-only${abblenden ? ' dice-kino--aus' : ''}${patzer ? ' dice-kino--patzer' : ''}`}
      role="alertdialog"
      aria-live="polite"
      aria-label={WICHTIG.overlayLabel(entry.authorName)}
      onClick={() => beendenRef.current()}
    >
      <canvas className="dice-kino-buehne" ref={leinwandRef} aria-hidden />
      {ohneBuehne && <ErgebnisKarte entry={entry} />}
      <p className="dice-kino-hinweis">{WICHTIG.ueberspringen}</p>
    </div>
  );
}

/**
 * Where the dice are pulled at the end: the chat dock, wherever this viewer
 * keeps it.
 *
 * One selector covers both of its states — `.dice-dock` when open and
 * `.dice-dock-tab` when collapsed are mutually exclusive, and both are
 * position: fixed, so their viewport rect needs no scroll compensation. If the
 * dock is hidden entirely the stage falls back to the bottom-right corner.
 */
function dockPunkt(): { x: number; y: number } | null {
  const el = document.querySelector('.dice-dock, .dice-dock-tab');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The still card: what a reduced-motion viewer sees, and the fallback when the
 * stage cannot be built at all.
 *
 * Reduced motion removes the MOTION, never the INFORMATION — the whole point of
 * „/i" is that this roll gets announced, so it still is. This is a third branch,
 * not the skip path.
 */
function ErgebnisKarte({ entry }: { entry: import('@shared/diceProtocol').RollFeedEntry }) {
  const roll = entry.roll;
  return (
    <div className="dice-kino-karte">
      <h2>{WICHTIG.karteTitel}</h2>
      <p className="dice-kino-karte-wer">{entry.authorName}</p>
      <p className="dice-kino-karte-wuerfel">
        {roll.dice.map((w, i) => (
          <span className="dice-kino-karte-zahl" key={i}>
            {w}
          </span>
        ))}
      </p>
      <p className="dice-kino-karte-summe">= {roll.adjustedSum}</p>
    </div>
  );
}
