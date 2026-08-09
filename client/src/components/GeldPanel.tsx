import { NumInput } from './inputs';

// Münzen mit Metall-Farbwelt: Dublonen (Gold), Silbertaler (Silber),
// Heller (Bronze), Kreuzer (Eisen). Wird im Heldenbrief genutzt; die
// Gesamtsumme (gesamtDublonen) zeigt auch die Seitenleiste.
const COIN_FIELDS: [string, string, string][] = [
  ['geldD', 'Dublonen', 'gold'],
  ['geldS', 'Silbertaler', 'silver'],
  ['geldH', 'Heller', 'bronze'],
  ['geldK', 'Kreuzer', 'iron'],
];

// Jede Münzstufe ist ×10: 10 Kreuzer = 1 Heller, 10 Heller = 1 Silbertaler,
// 10 Silbertaler = 1 Dublone. Die Bank steht bereits in Dublonen. Gerechnet
// wird in der kleinsten Einheit (Kreuzer, ganzzahlig), um Rundungsfehler zu
// vermeiden; das Ergebnis geteilt durch 1000 sind Dublonen.
const KREUZER_WERT: Record<string, number> = { geldD: 1000, geldS: 100, geldH: 10, geldK: 1, bank: 1000 };

export function gesamtDublonen(meta: Record<string, number>): number {
  const kreuzer = Object.entries(KREUZER_WERT).reduce((sum, [key, faktor]) => sum + (meta[key] ?? 0) * faktor, 0);
  return kreuzer / 1000;
}

export function GeldPanel({
  meta,
  setMeta,
}: {
  meta: Record<string, number>;
  setMeta: (key: string, v: number) => void;
}) {
  return (
    <div className="panel">
      <h3>Geld</h3>
      <div className="coins">
        {COIN_FIELDS.map(([key, label, tone]) => (
          <div className={`coin coin-${tone}`} key={key}>
            <span className="coin-disc" aria-hidden />
            <label>{label}</label>
            <NumInput value={meta[key] ?? 0} min={0} onChange={(v) => setMeta(key, v)} />
          </div>
        ))}
      </div>
      <div className="coin coin-bank">
        <span className="coin-disc" aria-hidden />
        <label>Bank in Dublonen</label>
        <NumInput value={meta.bank ?? 0} min={0} onChange={(v) => setMeta('bank', v)} />
      </div>
      <div className="coin-total" title="Alle Münzen in Dublonen umgerechnet, inklusive Bank">
        <span>Gesamt</span>
        <strong>{gesamtDublonen(meta).toLocaleString('de-DE', { maximumFractionDigits: 3 })} D</strong>
      </div>
    </div>
  );
}
