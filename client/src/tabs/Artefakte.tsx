import { computeBaseValues, mrErgebnis } from '@shared/rules';
import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function ArtefakteTab() {
  const { data, update } = useChar();
  const mr = mrErgebnis(data.attributes, data.resources);
  const bv = computeBaseValues(data.attributes, data.baseValues, mr);

  return (
    <>
      <p className="muted">
        Artefaktkontrolle (IN+MR+MU): <strong>{bv.artefaktkontrolle.ergebnis}</strong>
      </p>
      <div className="panel">
        <h3>Kraftspeicher</h3>
        <ListEditor def={listSectionById('kraftspeicher')!} rows={data.lists.kraftspeicher} onChange={(rows) => update('kraftspeicher', rows)} />
      </div>
      <div className="panel">
        <h3>Artefakte</h3>
        <ListEditor def={listSectionById('artefakte')!} rows={data.lists.artefakte} onChange={(rows) => update('artefakte', rows)} />
      </div>
    </>
  );
}
