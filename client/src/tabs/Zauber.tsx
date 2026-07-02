import { probeExprZahl } from '@shared/rules';
import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function ZauberTab() {
  const { data, update } = useChar();

  const probeZahl = (row: Row): React.ReactNode => {
    const computed = probeExprZahl(data.attributes, String(row.probe ?? ''));
    if (computed != null) return computed;
    const manuell = Number(row.probeZahlManuell) || 0;
    return manuell !== 0 ? `${manuell} (manuell)` : '—';
  };

  return (
    <>
      <div className="panel">
        <h3>Talente/Kampfstile/Stellungen</h3>
        <p className="muted">
          Probe (Zahl) wird automatisch berechnet, wenn die Probe nur aus Attributen besteht (z.&nbsp;B. „KO+KO+KO"). Sonst gilt der
          manuelle Wert.
        </p>
        <ListEditor
          def={listSectionById('techniken')!}
          rows={data.lists.techniken}
          onChange={(rows) => update('techniken', rows)}
          extraColumns={[{ label: 'Probe (Zahl)', render: probeZahl }]}
        />
      </div>
      <div className="panel">
        <h3>Liturgien</h3>
        <ListEditor def={listSectionById('liturgien')!} rows={data.lists.liturgien} onChange={(rows) => update('liturgien', rows)} />
      </div>
      <div className="panel">
        <h3>Allgemeinzauber</h3>
        <ListEditor
          def={listSectionById('allgemeinzauber')!}
          rows={data.lists.allgemeinzauber}
          onChange={(rows) => update('allgemeinzauber', rows)}
          extraColumns={[{ label: 'Probe (Zahl)', render: probeZahl }]}
        />
      </div>
    </>
  );
}
