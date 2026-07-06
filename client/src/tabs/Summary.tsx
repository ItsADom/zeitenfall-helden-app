import { listSectionById } from '@shared/sections';
import { VISIBILITY_LABELS } from '@shared/types';
import type { Row } from '../components/inputs';

interface Info {
  id: number;
  name: string;
  ownerName: string;
  groupName: string;
}
interface Summary {
  bio: Record<string, string>;
  sections: Record<string, unknown>;
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

// Generische, schreibgeschützte Tabelle für Zeilen-Objekte
function RowsTable({ rows, sectionId }: { rows: Row[]; sectionId?: string }) {
  if (!rows || rows.length === 0) return <p className="muted">—</p>;
  const def = sectionId ? listSectionById(sectionId) : undefined;
  const skip = new Set(['id', 'character_id', 'pos']);
  const keys = def ? def.columns.map((c) => c.key) : Object.keys(rows[0]).filter((k) => !skip.has(k));
  const label = (k: string) => def?.columns.find((c) => c.key === k)?.label ?? k;
  return (
    <div className="table-wrap" style={{ marginBottom: 10 }}>
    <table className="sheet">
      <thead>
        <tr>
          {keys.map((k) => (
            <th key={k}>{label(k)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {keys.map((k) => (
              <td key={k}>{formatValue(r[k])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'ja' : '';
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).join(' / ');
  return String(v);
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
      {s.vorteile && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.vorteile}</h3>
          <h4>Vorteile</h4>
          <RowsTable rows={(s.vorteile as { vorteile: Row[] }).vorteile} sectionId="vorteile" />
          <h4>Nachteile</h4>
          <RowsTable rows={(s.vorteile as { nachteile: Row[] }).nachteile} sectionId="nachteile" />
          <h4>Titel / Orden</h4>
          <RowsTable rows={(s.vorteile as { titel: Row[] }).titel} sectionId="titel" />
        </div>
      )}
      {s.talente && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.talente}</h3>
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
      )}
      {s.waffen && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.waffen}</h3>
          <h4>Nahkampf</h4>
          <RowsTable rows={(s.waffen as { nah: Row[] }).nah} />
          <h4>Fernkampf</h4>
          <RowsTable rows={(s.waffen as { fern: Row[] }).fern} sectionId="waffenFern" />
          <h4>Waffenlos</h4>
          <RowsTable rows={(s.waffen as { waffenlos: Row[] }).waffenlos} sectionId="waffenlos" />
        </div>
      )}
      {s.zauber && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.zauber}</h3>
          <h4>Talente/Kampfstile/Stellungen</h4>
          <RowsTable rows={(s.zauber as { techniken: Row[] }).techniken} sectionId="techniken" />
          <h4>Liturgien</h4>
          <RowsTable rows={(s.zauber as { liturgien: Row[] }).liturgien} sectionId="liturgien" />
          <h4>Allgemeinzauber</h4>
          <RowsTable rows={(s.zauber as { allgemeinzauber: Row[] }).allgemeinzauber} sectionId="allgemeinzauber" />
        </div>
      )}
      {s.ausruestung && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.ausruestung}</h3>
          <h4>Getragen</h4>
          <RowsTable rows={(s.ausruestung as { slots: Row[] }).slots} sectionId="ausruestungSlots" />
          <h4>Proviant/Tränke</h4>
          <RowsTable rows={(s.ausruestung as { proviant: Row[] }).proviant} sectionId="proviant" />
          <h4>Kleidungen</h4>
          <RowsTable rows={(s.ausruestung as { kleidungen: Row[] }).kleidungen} sectionId="kleidungen" />
        </div>
      )}
      {s.inventar && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.inventar}</h3>
          <RowsTable rows={s.inventar as Row[]} />
        </div>
      )}
      {s.sprachen && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.sprachen}</h3>
          <RowsTable rows={s.sprachen as Row[]} />
        </div>
      )}
      {s.artefakte && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.artefakte}</h3>
          <h4>Kraftspeicher</h4>
          <RowsTable rows={(s.artefakte as { kraftspeicher: Row[] }).kraftspeicher} sectionId="kraftspeicher" />
          <h4>Artefakte</h4>
          <RowsTable rows={(s.artefakte as { artefakte: Row[] }).artefakte} sectionId="artefakte" />
        </div>
      )}
      {s.besitz && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.besitz}</h3>
          <h4>Cambio</h4>
          <RowsTable rows={(s.besitz as { waehrungen: Row[] }).waehrungen} sectionId="waehrungen" />
          <h4>Wertgegenstände</h4>
          <RowsTable rows={(s.besitz as { wertgegenstaende: Row[] }).wertgegenstaende} sectionId="wertgegenstaende" />
          <h4>Einnahmequellen</h4>
          <RowsTable rows={(s.besitz as { einnahmequellen: Row[] }).einnahmequellen} sectionId="einnahmequellen" />
          <h4>Land &amp; Immobilien</h4>
          <RowsTable rows={(s.besitz as { immobilien: Row[] }).immobilien} sectionId="immobilien" />
        </div>
      )}
      {s.bibliothek && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.bibliothek}</h3>
          <RowsTable rows={s.bibliothek as Row[]} sectionId="bibliothek" />
        </div>
      )}
      {s.boni && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.boni}</h3>
          <RowsTable rows={s.boni as Row[]} sectionId="boni" />
        </div>
      )}
      {s.vorlieben && (
        <div className="panel">
          <h3>{VISIBILITY_LABELS.vorlieben}</h3>
          <div className="grid2">
            <div>
              <h4>Mag</h4>
              <ul>
                {(s.vorlieben as Row[]).filter((r) => r.kind === 'mag').map((r, i) => (
                  <li key={i}>{String(r.text)}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Mag nicht</h4>
              <ul>
                {(s.vorlieben as Row[]).filter((r) => r.kind === 'magNicht').map((r, i) => (
                  <li key={i}>{String(r.text)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
