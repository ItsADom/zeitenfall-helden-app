import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function BesitzTab() {
  const { data, update } = useChar();
  return (
    <>
      <div className="grid2">
        <div className="panel">
          <h3>Cambio</h3>
          <ListEditor def={listSectionById('waehrungen')!} rows={data.lists.waehrungen} onChange={(rows) => update('waehrungen', rows)} />
        </div>
        <div className="panel">
          <h3>Schulden</h3>
          <ListEditor def={listSectionById('schulden')!} rows={data.lists.schulden} onChange={(rows) => update('schulden', rows)} />
        </div>
      </div>
      <div className="panel">
        <h3>Wertgegenstände</h3>
        <ListEditor
          def={listSectionById('wertgegenstaende')!}
          rows={data.lists.wertgegenstaende}
          onChange={(rows) => update('wertgegenstaende', rows)}
        />
      </div>
      <div className="panel">
        <h3>Einnahmequellen</h3>
        <ListEditor
          def={listSectionById('einnahmequellen')!}
          rows={data.lists.einnahmequellen}
          onChange={(rows) => update('einnahmequellen', rows)}
        />
      </div>
      <div className="panel">
        <h3>Land &amp; Immobilien</h3>
        <ListEditor def={listSectionById('immobilien')!} rows={data.lists.immobilien} onChange={(rows) => update('immobilien', rows)} />
      </div>
      <div className="panel">
        <h3>Sonstiges</h3>
        <ListEditor def={listSectionById('besitzSonstiges')!} rows={data.lists.besitzSonstiges} onChange={(rows) => update('besitzSonstiges', rows)} />
      </div>
    </>
  );
}
