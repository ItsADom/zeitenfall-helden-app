import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function BoniTab() {
  const { data, update } = useChar();
  return (
    <div className="panel">
      <h3>Boni</h3>
      <ListEditor def={listSectionById('boni')!} rows={data.lists.boni} onChange={(rows) => update('boni', rows)} />
    </div>
  );
}
