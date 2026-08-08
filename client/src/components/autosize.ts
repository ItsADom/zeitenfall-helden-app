// Höhe der automatisch mitwachsenden Textfelder.
//
// Ein solches Feld hat keine eigene Höhe — sie wird gemessen und gesetzt. Bisher
// geschah das nur bei geändertem Inhalt. Ändert sich aber die *Breite*, ändert
// sich auch die Zahl der Zeilen: nach dem Verbreitern einer Spalte passt der
// Text plötzlich in eine Zeile und die alte, für zwei Zeilen berechnete Höhe
// lässt eine leere Zeile stehen; nach dem Verschmälern reicht die Höhe nicht
// mehr und der Text wird abgeschnitten (das Feld trägt overflow: hidden).
// Beides trifft nicht nur das Verstellen von Spalten, sondern auch das
// Verkleinern des Fensters.
//
// Zwei Dinge lösen deshalb eine Messung aus: geänderter Inhalt (meldet die
// Komponente) und geänderte Breite (meldet ein gemeinsamer ResizeObserver).
// Beide Wege laufen über dieselbe Sammelstelle.

// +2 für die 1px-Ränder oben und unten (box-sizing: border-box), damit die
// letzte Zeile nicht angeschnitten wird.
const BORDER_PX = 2;

// Zuletzt beobachtete Breite je Feld. Die Höhe setzen wir selbst; darauf erneut
// zu reagieren wäre eine Schleife, also zählt nur die Breite als Anlass.
const lastWidth = new WeakMap<HTMLTextAreaElement, number>();

const pending = new Set<HTMLTextAreaElement>();
let scheduled = false;

// Misst und setzt gebündelt: erst alle Höhen freigeben, dann alle messen, dann
// alle setzen. Einzeln nacheinander wäre jedes Feld ein erzwungener Neuaufbau
// des Seitenlayouts — beim Öffnen des Talente-Tabs mit seinen ~300 Feldern also
// 300 Stück vor dem ersten Bild, und beim Ziehen an einer Spalte 300 je
// Mausbewegung. So ist es einer.
function fitAll(els: HTMLTextAreaElement[]): void {
  for (const el of els) el.style.height = 'auto';
  // Erst jetzt lesen: der erste Zugriff auf scrollHeight erzwingt die
  // Neuberechnung des Layouts, die folgenden laufen aus demselben Ergebnis.
  const heights = els.map((el) => el.scrollHeight);
  els.forEach((el, i) => {
    // Höhe 0 heißt: das Feld hat gerade keine Layout-Box (ausgeblendeter
    // Teilbaum). Dann steht keine brauchbare Messung zur Verfügung — eine Höhe
    // zu schreiben hieße, sie auf die Randbreite einzufrieren. Lieber 'auto'
    // stehen lassen, bis das Feld wirklich sichtbar ist.
    if (heights[i] > 0) el.style.height = `${heights[i] + BORDER_PX}px`;
  });
}

function flush(): void {
  scheduled = false;
  const els = [...pending].filter((el) => el.isConnected);
  pending.clear();
  if (els.length > 0) fitAll(els);
}

// Der Mikrotask ist hier der Kern und kein Beiwerk:
//
// - Er bündelt alles, was im selben Durchgang anfällt — ein React-Commit mit
//   300 neuen Feldern wird zu einer einzigen Messung.
// - Er läuft noch vor dem Zeichnen, das Feld erscheint also nie kurz in
//   falscher Höhe (ein requestAnimationFrame käme dafür zu spät).
// - Er holt die Schreibvorgänge aus dem Zustellungslauf des ResizeObservers
//   heraus. Setzt man die Höhe direkt im Rückruf, ändert sich die Größe eines
//   gerade beobachteten Elements noch im selben Lauf; der Browser vermerkt das
//   als übergangene Beobachtung und meldet „ResizeObserver loop completed with
//   undelivered notifications" — bei jedem Bild, das man zieht.
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

export function fitSoon(el: HTMLTextAreaElement): void {
  pending.add(el);
  schedule();
}

const observer =
  typeof ResizeObserver === 'undefined' ?
    null
  : new ResizeObserver((entries) => {
      let any = false;
      for (const entry of entries) {
        const el = entry.target as HTMLTextAreaElement;
        // contentRect statt clientWidth: der Wert liegt bereits vor, ein
        // Zugriff auf das Element würde hier eine Layout-Berechnung erzwingen.
        const width = entry.contentRect.width;
        if (lastWidth.get(el) === width) continue;
        lastWidth.set(el, width);
        pending.add(el);
        any = true;
      }
      if (any) schedule();
    });

// Meldet ein Feld an und gibt die passende Abmeldung zurück.
export function observeAutosize(el: HTMLTextAreaElement): () => void {
  if (!observer) return () => {};
  observer.observe(el);
  return () => {
    observer.unobserve(el);
    pending.delete(el);
    lastWidth.delete(el);
  };
}
