import { ATTR_LABELS, type AttrRowCode } from '@shared/types';

// Ein einzelner Würfel im Feed. Die Silhouette kommt als Inline-SVG, die Augenzahl
// bleibt echter HTML-Text darüber — so behält sie Tabellenziffern, Schriftglättung
// und Markierbarkeit, und ein mehrstelliger Wert sprengt keine feste SVG-Textbreite.
// Inline statt .svg-Datei, weil das Projekt weder svgr noch eine Icon-Bibliothek
// hat; gleiche Machart wie die Kompassrose in pages/Home.tsx.

interface DieShape {
  // Steuert die CSS-Klasse (feed-die--triangle …) und ist bewusst nach der FORM
  // benannt, nicht nach der Seitenzahl: feed-die--20 heißt schon „natürliche 20".
  name: string;
  d: string;
}

// Nur echte Polyeder-Würfel bekommen eine Form; alles andere (w2, w3, w7, w100 …)
// fällt auf den neutralen Kasten zurück. Nützlicher Nebeneffekt dieser Regel: ein
// geformter Würfel zeigt nie mehr als zwei Ziffern, denn zweistellig wird es erst
// ab w10 — und das sind gerade die breitbauchigen Formen.
// Alle Pfade auf viewBox „0 0 26 24"; die Tinte ist 1,5 Einheiten eingerückt, damit
// die runden Ecken der Kontur nicht angeschnitten werden. Die Anzeigegröße steht in
// styles.css (.feed-die-shape) und ist GRÖSSER als die viewBox — das SVG skaliert
// gleichmäßig mit, eine Einheit ist also etwas mehr als ein CSS-Pixel. Wer die Größe
// ändern will, fasst deshalb nur die CSS-Regel an, nicht diese Pfade.
const SHAPES: Record<number, DieShape> = {
  // Dreieck, Spitze oben. Minimal stumpfer als gleichseitig — das kauft Innenbreite.
  4: { name: 'triangle', d: 'M13 1.5 24.5 21.5 1.5 21.5 Z' },
  // Abgerundetes Quadrat, r=4: stroke-linejoin allein ergäbe bei 1 px Kontur nur
  // 0,5 px Radius — zu scharf neben den weichen Ecken der übrigen Oberfläche.
  6: {
    name: 'square',
    d: 'M7.5 2.5 H18.5 A4 4 0 0 1 22.5 6.5 V17.5 A4 4 0 0 1 18.5 21.5 H7.5 A4 4 0 0 1 3.5 17.5 V6.5 A4 4 0 0 1 7.5 2.5 Z',
  },
  // Raute.
  8: { name: 'rhombus', d: 'M13 1.5 23.5 12 13 22.5 2.5 12 Z' },
  // „Kristall": Sechseck mit Spitze oben und senkrechten Flanken. Die echte
  // Trapezoeder-Silhouette (Drachenviereck) läuft zu beiden Spitzen zu schmal zu —
  // für eine zweistellige „10" müsste sie rund 34 px breit werden.
  10: { name: 'crystal', d: 'M13 1.5 23.5 7.5 23.5 16.5 13 22.5 2.5 16.5 2.5 7.5 Z' },
  // Fünfeck, Spitze oben — formverwandt mit dem Amethyst-Sigel (--sigil in
  // styles.css), hier aber als Kontur mit eigener Einrückung neu gezeichnet.
  12: { name: 'pentagon', d: 'M13 1.5 24 9 20.5 21.5 5.5 21.5 2 9 Z' },
  // Sechseck mit langer flacher Ober- und Unterkante, bewusst gestaucht: ein
  // regelmäßiges Sechseck verjüngt sich zu schnell und ließe der fetten „20" keinen
  // Rand. Höhe war hier ohnehin übrig, Breite nicht.
  20: { name: 'hexagon', d: 'M24.5 12 20 2.5 6 2.5 1.5 12 6 21.5 20 21.5 Z' },
};

// Die Form allein sagt niemandem, dass ein Sechseck „W20" heißt — der Ausdruck
// darüber (feed-roll-notation) tut das schon, und der Tooltip liefert es je Würfel
// nach. Was die Formen wirklich leisten, ist das Gruppieren: bei „1w6+1w20" sieht
// man sofort, welcher Wert von welcher Sorte kommt.
// `code` steuert nur den Tooltip („W20: 17" bzw. „D20: 17") und folgt damit der
// /dicecode-Vorliebe. Bewusst als Prop statt useDicePanel() hier drin, damit die
// Komponente rein bleibt — an beiden Aufrufstellen liegt diceCode schon vor.
// `attr` (nur bei Proben bekannt, siehe attrParts) zeigt zusätzlich, welches
// Attribut den Würfel gestellt hat — sonst ist bei einer 3-Würfel-Probe reine
// Ratesache, wessen 1/20 da stehengeblieben ist. Es steht nur an einer natürlichen
// 1/20, also IMMER am W20 und damit am Sechseck: der breitesten, flachsten Form.
// Auch dort passt es nicht mehr HINEIN — die „20" füllt sie bereits — und hängt
// deshalb in einer zweiten Rasterspalte daneben (siehe .feed-die-attr in styles.css).
export default function Die({
  value,
  sides,
  code,
  attr,
}: {
  value: number;
  sides: number;
  code: 'w' | 'd';
  attr?: AttrRowCode;
}) {
  // sides kann bei einem beschädigten Eintrag fehlen — dann eben der Kasten.
  const shape = SHAPES[sides] ?? null;
  // Natürliche 20/1 stechen hervor, weil sie eine Bestätigung auslösen.
  const crit = sides === 20 && (value === 20 || value === 1);
  const showAttr = crit && attr;
  const classes = ['feed-die', `feed-die--${shape ? shape.name : 'plain'}`];
  if (crit) classes.push(value === 20 ? 'feed-die--20' : 'feed-die--1');
  // Beide Tooltips zusammengeführt statt einen zu wählen: die Sorte beantwortet
  // „welcher Würfel ist das", das Attribut „wessen Krit ist das" — zwei Fragen.
  const sorte = Number.isFinite(sides) ? `${code.toUpperCase()}${sides}: ${value}` : String(value);
  const tooltip = showAttr ? `${sorte} — ${ATTR_LABELS[attr]}` : sorte;
  return (
    <span className={classes.join(' ')} title={tooltip}>
      {shape && (
        <svg className="feed-die-shape" viewBox="0 0 26 24" aria-hidden="true">
          <path d={shape.d} />
        </svg>
      )}
      <span className="feed-die-num">{value}</span>
      {showAttr && <sub className="feed-die-attr">{attr}</sub>}
    </span>
  );
}
