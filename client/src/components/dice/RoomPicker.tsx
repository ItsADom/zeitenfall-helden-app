import { useHoverFlyout } from '../useHoverFlyout';
import { useDicePanel } from './DicePanelProvider';

// Gruppennamen am AUSLÖSER kürzen: an den ersten Zeichen erkennt man seine
// Gruppe, und die Kopfzeile ist in erster Linie die Klappfläche. In der
// geöffneten Liste stehen die vollen Namen — dort wird ausgewählt, da muss
// nichts geraten werden. (Genau deshalb kein <select>: dessen zugeklappter
// Zustand zeigt zwangsläufig denselben Text wie der Listeneintrag.)
const ROOM_NAME_MAX = 18;
const shortRoomName = (name: string): string =>
  name.length > ROOM_NAME_MAX ? `${name.slice(0, ROOM_NAME_MAX - 1).trimEnd()}…` : name;

export default function RoomPicker() {
  const { groupId, myGroups, selectRoom } = useDicePanel();
  const { open, wrapRef, openNow, closeNow } = useHoverFlyout<HTMLSpanElement>();
  const active = myGroups.find((g) => g.id === groupId);

  // Mit höchstens einem Raum gibt es nichts zu wählen.
  if (myGroups.length < 2) return <span className="dice-dock-title">🎲 Chat &amp; Würfel</span>;

  return (
    // Klicks hier drin dürfen die Kopfzeile nicht zuklappen.
    <span className="dice-flyout-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        className="dice-dock-room"
        title={active ? `Chatraum: ${active.name}` : 'Chatraum wählen'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? closeNow() : openNow())}
      >
        🎲 {active ? shortRoomName(active.name) : 'Chatraum wählen…'}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <span className="dice-flyout dice-flyout--rooms" role="menu">
          {myGroups.map((g) => (
            <button
              key={g.id}
              className={`dice-flyout-item${g.id === groupId ? ' active' : ''}`}
              role="menuitem"
              onClick={() => {
                selectRoom(g.id);
                closeNow();
              }}
            >
              {g.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
