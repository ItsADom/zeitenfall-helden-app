import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function BibliothekTab() {
  const { data, update } = useChar();
  return (
    <div className="panel">
      <h3>Bücher</h3>
      <ListEditor def={listSectionById('bibliothek')!} rows={data.lists.bibliothek} onChange={(rows) => update('bibliothek', rows)} />
    </div>
  );
}
