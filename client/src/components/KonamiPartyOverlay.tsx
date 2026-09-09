// Geheimes Easter Egg (Schwester-Ei zu Chaos-Modus/Kopfüber-Modus/Würfelgott):
// der Konami-Code (↑↑↓↓←→←→BA) auf der Tastatur verwandelt den ganzen
// Bildschirm in eine absichtlich überdrehte Übernahme — eine Katze, die wie
// der klassische DVD-Bildschirmschoner an den Rändern abprallt, dazu
// fortlaufend zufällige Explosionen. Läuft, bis geklickt/Esc gedrückt oder
// neu geladen wird — bewusst KEIN automatisches Ende wie bei den anderen
// Effekten. Rein lokal: kein Server-Aufruf, keine Chat-Zeile, keine geteilte
// Ansage; nur bei der Person, die die Sequenz getippt hat.
//
// Die Bilder liegen NICHT im Repo (Copyright/Lizenz — ein bekanntes Meme-GIF
// ist nicht etwas, das hier eingebettet werden darf, egal wie oft es online
// geteilt wurde). Der Server-Owner legt sie von Hand in server/data/easter-eggs
// ab (siehe der Kommentar dort in server/src/index.ts) — fehlt eine Datei,
// zeigt der Browser einfach ein kaputtes Bild-Icon, nichts bricht dabei.
import { useEffect, useRef, useState } from 'react';
import { reportEasterEggFound } from '../easterEggs';

const KONAMI_ENABLED = false;
const KONAMI_SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

// Sehr großzügiger Not-Aus für den Fall, dass mal etwas hängen bleibt — die
// eigentlichen Ausgänge sind Klick und Escape (gleiches Prinzip wie
// WichtigerWurfOverlay.tsx: "kann niemandes Oberfläche je einsperren").
const SICHERHEITS_ABSCHALTUNG_MS = 10 * 60 * 1000;

const DVD_KATZE_SRC = '/easter-eggs/konami-cat.gif';
const EXPLOSION_SRCS = ['/easter-eggs/konami-explosion-1.gif', '/easter-eggs/konami-explosion-2.gif', '/easter-eggs/konami-explosion-3.gif'];
const DVD_KATZE_GROESSE = 160;
const EXPLOSION_GROESSE = 200;
const EXPLOSION_ANZEIGE_MS = 900;
const EXPLOSION_INTERVALL_MS = 700;

function bevorzugtRuhe(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function KonamiPartyOverlay() {
  const [lauf, setLauf] = useState<number | null>(null);
  const bufferRef = useRef<string[]>([]);

  useEffect(() => {
    if (!KONAMI_ENABLED) return;
    const onKey = (e: KeyboardEvent) => {
      // Nicht mitten in einem Eingabefeld — sonst würde jedes "b"/"a" beim
      // Chatten oder Formulare-Ausfüllen versehentlich zur Sequenz zählen.
      const ziel = e.target as HTMLElement | null;
      if (ziel && /^(input|textarea)$/i.test(ziel.tagName)) return;
      const taste = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const erwartet = KONAMI_SEQUENCE[bufferRef.current.length];
      if (taste === erwartet) {
        bufferRef.current = [...bufferRef.current, taste];
        if (bufferRef.current.length === KONAMI_SEQUENCE.length) {
          bufferRef.current = [];
          setLauf(Date.now());
          reportEasterEggFound('konami');
        }
      } else {
        // Möglicherweise der erste Tastendruck einer neuen Sequenz, nicht
        // einfach nur ein Fehlschlag.
        bufferRef.current = taste === KONAMI_SEQUENCE[0] ? [taste] : [];
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (lauf === null) return null;
  return <Party key={lauf} beenden={() => setLauf(null)} />;
}

function Party({ beenden }: { beenden: () => void }) {
  const [sichtbar, setSichtbar] = useState(false);
  const [ruhe] = useState(bevorzugtRuhe);

  useEffect(() => {
    // Erst mounten, dann im nächsten Frame die Sichtbarkeits-Klasse setzen,
    // damit die CSS-transition greift statt sofort im Endzustand zu starten.
    const raf = requestAnimationFrame(() => setSichtbar(true));
    const abschaltung = setTimeout(beenden, SICHERHEITS_ABSCHALTUNG_MS);
    const aufTaste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      beenden();
    };
    document.addEventListener('keydown', aufTaste, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(abschaltung);
      document.removeEventListener('keydown', aufTaste, true);
    };
  }, [beenden]);

  return (
    <div
      className={`konami-party screen-only${sichtbar ? ' konami-party--an' : ''}${ruhe ? ' konami-party--ruhe' : ''}`}
      role="alertdialog"
      aria-live="polite"
      aria-label="Eine geheime, absichtlich alberne Übernahme des Bildschirms"
      onClick={beenden}
    >
      <DvdKatze ruhe={ruhe} />
      {!ruhe && <ExplosionSchicht />}
      <p className="konami-party-hinweis">Klick oder Esc zum Beenden</p>
    </div>
  );
}

/**
 * Der klassische DVD-Bildschirmschoner: prallt an allen vier Rändern des
 * Viewports ab, wechselt bei jedem Abprall die Farbe (hue-rotate, wie das
 * Original) — rein per rAF statt CSS-Keyframes, weil die Flugbahn vom Zufall
 * (Startwinkel) abhängt und keine feste Schleife ist. Reduced motion: steht
 * still in der Mitte, kein rAF-Loop.
 */
function DvdKatze({ ruhe }: { ruhe: boolean }) {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (ruhe) return;
    const el = ref.current;
    if (!el) return;
    let x = Math.random() * Math.max(0, window.innerWidth - DVD_KATZE_GROESSE);
    let y = Math.random() * Math.max(0, window.innerHeight - DVD_KATZE_GROESSE);
    const winkel = Math.random() * Math.PI * 2;
    const TEMPO = 260; // px/s
    let vx = Math.cos(winkel) * TEMPO;
    let vy = Math.sin(winkel) * TEMPO;
    let farbton = 0;
    let letzterFrame = performance.now();
    let raf = 0;

    const tick = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - letzterFrame) / 1000);
      letzterFrame = jetzt;
      x += vx * dt;
      y += vy * dt;
      const maxX = window.innerWidth - DVD_KATZE_GROESSE;
      const maxY = window.innerHeight - DVD_KATZE_GROESSE;
      let geprallt = false;
      if (x <= 0 || x >= maxX) {
        vx = -vx;
        x = Math.min(Math.max(x, 0), Math.max(0, maxX));
        geprallt = true;
      }
      if (y <= 0 || y >= maxY) {
        vy = -vy;
        y = Math.min(Math.max(y, 0), Math.max(0, maxY));
        geprallt = true;
      }
      if (geprallt) farbton = (farbton + 47) % 360;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.filter = `hue-rotate(${farbton}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ruhe]);

  return (
    <img
      ref={ref}
      src={DVD_KATZE_SRC}
      alt=""
      aria-hidden
      className="konami-dvd-katze"
      style={{ width: DVD_KATZE_GROESSE, height: DVD_KATZE_GROESSE }}
      // Fehlt die Datei (noch nicht vom Server-Owner abgelegt), lieber
      // unsichtbar bleiben als als kaputtes Icon durchs Bild zu hüpfen.
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

/**
 * Explosionen an zufälligen Stellen, in laufendem Abstand nachgelegt, solange
 * die Party steht — kein fester Vorrat wie bei einer zeitlich begrenzten
 * Vorstellung, das Intervall endet erst mit der Komponente selbst.
 */
function ExplosionSchicht() {
  const [booms, setBooms] = useState<{ id: number; x: number; y: number; src: string }[]>([]);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    // Nur von DIESEM Effekt-Durchlauf erzeugte Explosionen — siehe die
    // Aufräumfunktion unten für den Grund.
    const meineIds = new Set<number>();
    const spawn = () => {
      const id = Date.now() + Math.random();
      meineIds.add(id);
      const x = Math.random() * Math.max(0, window.innerWidth - EXPLOSION_GROESSE);
      const y = Math.random() * Math.max(0, window.innerHeight - EXPLOSION_GROESSE);
      const src = EXPLOSION_SRCS[Math.floor(Math.random() * EXPLOSION_SRCS.length)];
      setBooms((b) => [...b, { id, x, y, src }]);
      timeouts.push(setTimeout(() => setBooms((b) => b.filter((e) => e.id !== id)), EXPLOSION_ANZEIGE_MS));
    };
    spawn();
    const intervall = setInterval(spawn, EXPLOSION_INTERVALL_MS);
    return () => {
      clearInterval(intervall);
      for (const t of timeouts) clearTimeout(t);
      // StrictMode ruft diese Aufräumfunktion zwischen den zwei
      // Entwicklungs-Mounts auf — VOR dem 900ms-Timeout des allerersten
      // spawn()-Aufrufs. clearTimeout oben verhindert dessen VERZÖGERTE
      // Entfernung, aber die Explosion selbst steht zu diesem Zeitpunkt
      // schon im (über den Mount-Wechsel hinweg erhaltenen) State — ohne
      // diese Zeile bliebe genau sie für immer auf dem Bildschirm stehen,
      // während jede spätere ganz normal nach ihrer Zeit verschwindet.
      setBooms((b) => b.filter((e) => !meineIds.has(e.id)));
    };
  }, []);

  return (
    <>
      {booms.map((b) => (
        <img
          key={b.id}
          src={b.src}
          alt=""
          aria-hidden
          className="konami-explosion"
          style={{ width: EXPLOSION_GROESSE, height: EXPLOSION_GROESSE, transform: `translate(${b.x}px, ${b.y}px)` }}
          // EXPLOSION_SRCS listet alle drei fest, unabhängig davon, ob der
          // Server-Owner schon alle drei Dateien abgelegt hat — eine fehlende
          // sofort wieder entfernen, statt sie als kaputtes Icon stehen zu
          // lassen, bis ihr eigener Timeout abläuft.
          onError={() => setBooms((cur) => cur.filter((e) => e.id !== b.id))}
        />
      ))}
    </>
  );
}
