import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function AusruestungTab() {
  const { data, update } = useChar();
  const gewichtProviant = data.lists.proviant.reduce((s, r) => s + (Number(r.gewicht) || 0), 0);
  const gewichtKleidung = data.lists.kleidungen.reduce((s, r) => s + (Number(r.gewicht) || 0), 0);

  return (
    <>
      <div className="panel">
        <h3>Getragene Ausrüstung</h3>
        <ListEditor
          def={listSectionById('ausruestungSlots')!}
          rows={data.lists.ausruestungSlots}
          onChange={(rows) => update('ausruestungSlots', rows)}
        />
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Behälter</h3>
          <ListEditor def={listSectionById('behaelter')!} rows={data.lists.behaelter} onChange={(rows) => update('behaelter', rows)} />
        </div>
        <div className="panel">
          <h3>Proviant/Tränke/Magisches</h3>
          <ListEditor def={listSectionById('proviant')!} rows={data.lists.proviant} onChange={(rows) => update('proviant', rows)} />
          <p className="muted">Gesamtgewicht: {gewichtProviant.toFixed(1)} kg</p>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Kleidungen</h3>
          <ListEditor def={listSectionById('kleidungen')!} rows={data.lists.kleidungen} onChange={(rows) => update('kleidungen', rows)} />
          <p className="muted">Gesamtgewicht: {gewichtKleidung.toFixed(1)} kg</p>
        </div>
        <div className="panel">
          <h3>Tier-Ausrüstung (Pferd, Begleiter …)</h3>
          <ListEditor
            def={listSectionById('tierAusruestung')!}
            rows={data.lists.tierAusruestung}
            onChange={(rows) => update('tierAusruestung', rows)}
          />
        </div>
      </div>
    </>
  );
}
