import { useDicePanel } from './DicePanelProvider';

// Schicksalspunkte: erlauben eine komplette Probe neu zu würfeln, wenn die
// Spielleitung zustimmt. Reine Zählung, kein eigener Wurf-Mechanismus — die
// eigentliche Wiederholung ist einfach ein normaler Wurf über die üblichen
// Knöpfe. Lebt bewusst im Dock statt im Bogen — das ist, wo man während des
// Spielens ohnehin hinschaut.
//
// Ein Klee je Punkt (im Normalfall also genau einer — 1/Spieltag) statt eines
// Zählers mit Menü: der einzig sinnvolle Klick ist „ausgeben", das braucht
// keine eigene Fläche zum Aufklappen. Voll = verfügbar, blass = ausgegeben.
// Nur AUSGEBEN, nie gutschreiben: die Spielleitung erlaubt am Tisch, der
// Spieler klickt hier selbst herunter. Gutschriften/Maximum bleiben
// Spielleitungssache (Reset auf der Gruppen-Übersicht) — der Server erzwingt
// das ebenfalls (siehe routes.ts), diese Oberfläche bietet nur „Ausgeben" an.
export default function SchicksalspunkteControl({ aktuell, max }: { aktuell: number; max: number }) {
  const { setSchicksalspunkte } = useDicePanel();
  if (max <= 0) return null;

  return (
    <span className="sp-clovers" title="Schicksalspunkte">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < aktuell;
        return (
          <button
            key={i}
            className={`sp-clover${filled ? '' : ' sp-clover--spent'}`}
            disabled={!filled}
            title={filled ? 'Schicksalspunkt ausgeben (die Spielleitung muss zustimmen)' : 'Ausgegeben'}
            onClick={() => setSchicksalspunkte(aktuell - 1)}
          >
            🍀
          </button>
        );
      })}
    </span>
  );
}
