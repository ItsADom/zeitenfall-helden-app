import { VISIBILITY_LABELS } from '@shared/types';
import type { Attributes } from '@shared/types';
import { computeProbeCell, DYN_NOTIZ_KEY } from '@shared/dynamicSections';
import type { DynColumn, DynRow, DynSection } from '@shared/dynamicSections';

interface Info {
  id: number;
  name: string;
  ownerName: string;
  groupName: string;
}
interface Summary {
  bio: Record<string, string>;
  sections: Record<string, unknown>;
  dynSections: DynSection[];
  attributes: Attributes;
}

const BIO_LABELS: [string, string][] = [
  ['alterGeburtstag', 'Alter/Geburtstag'],
  ['geschlecht', 'Geschlecht'],
  ['groesse', 'Größe'],
  ['gewicht', 'Gewicht'],
  ['augenfarbe', 'Augenfarbe'],
  ['haarfarbe', 'Haarfarbe'],
  ['hautfarbe', 'Hautfarbe'],
  ['familienstand', 'Familienstand'],
  ['anrede', 'Anrede'],
  ['rasse', 'Rasse'],
  ['kultur', 'Kultur'],
  ['profession', 'Profession'],
  ['zweitprofession', 'Zweitprofession'],
  ['gottheit', 'Gottheit'],
];

// Schreibgeschützte Darstellung einer generischen Sektion
function DynSectionView({ section, attributes }: { section: DynSection; attributes: Attributes }) {
  if (section.type === 'notes') {
    return (
      <div className="panel">
        <h3>{section.name}</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{String(section.rows[0]?.text ?? '—')}</p>
      </div>
    );
  }
  const cols = section.columns.filter((c) => c.key !== DYN_NOTIZ_KEY);
  const cellText = (col: DynColumn, row: DynRow): string => {
    if (col.type === 'probe') {
      const v = computeProbeCell(attributes, col, row);
      return v == null ? '—' : String(v);
    }
    if (col.type === 'bool') return row[col.key] ? 'ja' : '';
    return String(row[col.key] ?? '');
  };
  return (
    <div className="panel">
      <h3>{section.name}</h3>
      {section.rows.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <div className="table-wrap">
          <table className="sheet" style={{ minWidth: cols.length * 120 }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.type === 'number' || c.type === 'probe' ? 'num' : undefined}>
                      {cellText(c, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SummaryView({ info, summary }: { info: Info; summary: Summary }) {
  const s = summary.sections as Record<string, never>;
  return (
    <>
      <h1>{info.name}</h1>
      <p className="muted">
        Spieler: {info.ownerName} · Gruppe: {info.groupName} · Zusammenfassung (freigegebene Bereiche)
      </p>
      <div className="panel">
        <h3>Person</h3>
        <div className="grid3">
          {BIO_LABELS.filter(([k]) => summary.bio[k]).map(([k, label]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <span>{summary.bio[k]}</span>
            </div>
          ))}
        </div>
      </div>

      {s.attribute && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.attribute}</h3>
          <table className="sheet" style={{ maxWidth: 400 }}>
            <tbody>
              {(s.attribute as { code: string; label: string; max: number }[]).map((a) => (
                <tr key={a.code}>
                  <td>{a.label}</td>
                  <td className="computed">{a.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.basiswerte && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.basiswerte}</h3>
          <table className="sheet" style={{ maxWidth: 400 }}>
            <tbody>
              {(s.basiswerte as { key: string; label: string; ergebnis: number }[]).map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td className="computed">{b.ergebnis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.ressourcen && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.ressourcen}</h3>
          <table className="sheet" style={{ maxWidth: 500 }}>
            <thead>
              <tr>
                <th>Energie</th>
                <th>Aktuell</th>
                <th>Ergebnis</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {(s.ressourcen as { key: string; label: string; aktuell: number; ergebnis: number; max: number | null }[]).map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num">{r.aktuell}</td>
                  <td className="computed">{r.ergebnis}</td>
                  <td className="computed">{r.max ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.talente && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.talente}</h3>
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Talent</th>
                  <th>Probe</th>
                  <th>TaW</th>
                  <th>Probe (Zahl)</th>
                  <th>Spezialisierung</th>
                </tr>
              </thead>
              <tbody>
                {(s.talente as { name: string; probe: string; taw: number; probeZahl: number | null; spezialisierung: string }[]).map(
                  (t, i) => (
                    <tr key={i}>
                      <td>{t.name}</td>
                      <td className="muted">{t.probe || '—'}</td>
                      <td className="num">{t.taw}</td>
                      <td className="computed">{t.probeZahl ?? '—'}</td>
                      <td>{t.spezialisierung}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {s.waffen && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.waffen}</h3>
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Waffe</th>
                  <th>Schaden</th>
                  <th>AT</th>
                  <th>PA</th>
                  <th>BL</th>
                </tr>
              </thead>
              <tbody>
                {(s.waffen as { nah: Record<string, unknown>[] }).nah.map((w, i) => {
                  const p = w.probes as { at: number; pa: number; bl: number };
                  return (
                    <tr key={i}>
                      <td>{String(w.name ?? '')}</td>
                      <td>{String(w.schaden ?? '')}</td>
                      <td className="computed">{p?.at ?? '—'}</td>
                      <td className="computed">{p?.pa ?? '—'}</td>
                      <td className="computed">{p?.bl ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {s.sprachen && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.sprachen}</h3>
          <table className="sheet" style={{ maxWidth: 500 }}>
            <tbody>
              {(s.sprachen as { name: string; taw: number }[]).map((l, i) => (
                <tr key={i}>
                  <td>{l.name}</td>
                  <td className="num">{l.taw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.dynSections.map((sec) => (
        <DynSectionView key={sec.id} section={sec} attributes={summary.attributes} />
      ))}
    </>
  );
}
