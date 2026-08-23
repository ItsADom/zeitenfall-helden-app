// Der eine AudioContext der App.
//
// Einer, nicht mehrere: Browser begrenzen die Zahl gleichzeitiger Kontexte
// (Chrome auf sechs), und ein Kontext je Klang wäre schon nach ein paar
// Vorhör-Klicks aufgebraucht.
//
// Wichtiger noch ist die Autoplay-Sperre: ein Kontext, der ohne vorherige
// Nutzergeste entsteht, startet `suspended` und bleibt stumm. Das trifft genau
// den Fall, der hier zählt — Seite frisch geladen, Dock eingeklappt, und die
// Spielleitung fragt sofort eine Probe an. Deshalb hängt an der ersten
// Erzeugung ein Wecker auf die nächste Geste. Klappt das nicht, bleibt es
// stumm; die Benachrichtigung trägt dann der Puls und der Punkt am Reiter.

let kontext: AudioContext | null = null;

type AudioContextKlasse = typeof AudioContext;

function klasse(): AudioContextKlasse | null {
  const w = window as unknown as { AudioContext?: AudioContextKlasse; webkitAudioContext?: AudioContextKlasse };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Weckt den Kontext bei der nächsten Geste — und hängt sich erst wieder aus,
 * wenn er wirklich läuft. Ein einmaliges `{ once: true }` wäre zu wenig: die
 * erste Geste kann in einen Zustand fallen, in dem `resume()` noch nicht
 * durchgeht, und dann gäbe es keinen zweiten Versuch mehr.
 */
function weckeBeiGeste(c: AudioContext): void {
  const versuch = () => {
    void c
      .resume()
      .then(() => {
        if (c.state !== 'running') return;
        document.removeEventListener('pointerdown', versuch);
        document.removeEventListener('keydown', versuch);
      })
      .catch(() => {
        // Noch nicht erlaubt — die nächste Geste versucht es erneut.
      });
  };
  document.addEventListener('pointerdown', versuch);
  document.addEventListener('keydown', versuch);
  versuch(); // vielleicht ist es längst erlaubt
}

/** Der Kontext, oder null in einer Umgebung ohne Web Audio (alte Browser, Tests). */
export function audioKontext(): AudioContext | null {
  if (kontext) return kontext;
  const K = klasse();
  if (!K) return null;
  try {
    kontext = new K();
  } catch {
    return null;
  }
  weckeBeiGeste(kontext);
  return kontext;
}

/**
 * Aus einer echten Nutzergeste heraus aufrufen (Vorhören-Knopf, Dock-Reiter).
 * Ein Klick ist der einzige Moment, in dem `resume()` verlässlich durchgeht.
 */
export function entsperreAudio(): void {
  const c = audioKontext();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
}

/** Ob überhaupt Ton möglich ist — die Einstellungen sagen es sonst niemandem. */
export const audioMoeglich = (): boolean => klasse() !== null;
