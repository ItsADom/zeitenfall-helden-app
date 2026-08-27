import { useEffect, useRef } from 'react';
import { useDicePanel } from './DicePanelProvider';
import { entsperreAudio } from './audioContext';
import { usePersistedState } from '../persist';
import FeedColumn, { type FeedColumnHandle } from './FeedColumn';
import RoomPicker from './RoomPicker';

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
//
// The feed+input body lives in FeedColumn.tsx (extracted so the virtual
// table page can embed the identical chat UI fixed in its own column instead
// of floating — see docs/concepts/virtual-table.md's "Chat column"). This
// component is now just the floating chrome: drag-resize, the collapsible
// head with the room picker, and the tab button shown while collapsed.
export default function DicePanel() {
  const { groupId, myGroups, connected, collapsed, toggle, ungelesen, pulsiert } = useDicePanel();
  const activeRoom = myGroups.find((g) => g.id === groupId);
  const [width, setWidth] = usePersistedState<number>('dice:w', DEFAULT_W);
  const [height, setHeight] = usePersistedState<number>('dice:h', DEFAULT_H);
  const w = clampW(width);
  const h = clampH(height);
  const feedRef = useRef<FeedColumnHandle>(null);

  // Verkleinern zieht die Ecke oben links — der Dock bleibt unten/rechts
  // verankert, also wächst der alte scrollTop plötzlich über den neuen
  // sichtbaren Bereich hinaus und der jüngste Eintrag rutscht aus dem Feld.
  // Beim Ausklappen erledigt sich das von selbst (FeedColumn mountet frisch
  // und scrollt beim ersten Render selbst ans Ende), nur eine reine
  // Größenänderung braucht diesen expliziten Anstoß.
  useEffect(() => {
    feedRef.current?.scrollToBottom();
  }, [h]);

  if (collapsed) {
    return (
      <button
        className={`dice-dock-tab screen-only${pulsiert ? ' puls' : ''}`}
        // Der Klick ist zugleich die Nutzergeste, die den AudioContext
        // freischaltet — siehe audioContext.ts.
        onClick={() => {
          entsperreAudio();
          toggle();
        }}
        title={ungelesen ? 'Neues im Chat — öffnen' : 'Chat & Würfel öffnen'}
      >
        🎲 Chat
        {ungelesen && <span className="dice-dock-neu" title="Neues im Chat" aria-hidden />}
        {groupId !== null && !connected && <span className="dice-dock-offline" title="Verbindung wird aufgebaut…" aria-hidden />}
      </button>
    );
  }

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
      {/* Die ganze Kopfzeile klappt ein — nur der Raum-Wähler ist ausgenommen
          (siehe stopPropagation), damit eine Raumwahl nicht nebenbei zuklappt.
          Gleiches Muster wie CollapsiblePanel's Überschrift. */}
      <div
        className="dice-dock-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title="Einklappen"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <RoomPicker />
        {/* Reiner Text, keine eigene Klickfläche — bewusst kein stopPropagation
            wie beim RoomPicker, damit ein Klick hier ganz normal weiter
            einklappt. */}
        {activeRoom?.myCharacterName && <span className="muted dice-dock-char">als {activeRoom.myCharacterName}</span>}
        {groupId !== null && !connected && <span className="muted dice-dock-status">verbinde…</span>}
        {/* Füllt den Rest der Zeile — gehört mit zur Klappfläche. */}
        <span className="dice-dock-head-fill" aria-hidden />
        <span className="chev" aria-hidden>
          ▾
        </span>
      </div>
      <FeedColumn ref={feedRef} />
    </div>
  );
}
