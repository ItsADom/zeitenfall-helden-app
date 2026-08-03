import { NumInput } from './inputs';

// Münzen mit Metall-Farbwelt: Dublonen (Gold), Silbertaler (Silber),
// Heller (Bronze), Kreuzer (Eisen). Wird im Heldenbrief und in der Übersicht
// gleichermaßen genutzt.
const COIN_FIELDS: [string, string, string][] = [
  ['geldD', 'Dublonen', 'gold'],
  ['geldS', 'Silbertaler', 'silver'],
  ['geldH', 'Heller', 'bronze'],
  ['geldK', 'Kreuzer', 'iron'],
];

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
        <label>Bank</label>
        <NumInput value={meta.bank ?? 0} min={0} onChange={(v) => setMeta('bank', v)} />
      </div>
    </div>
  );
}
