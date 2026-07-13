import { maximaleLast } from '@shared/rules';
import { INVENTAR_KATEGORIEN, listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function InventarTab() {
  const { data, update } = useChar();
  const rows = data.lists.inventar;
  const gesamt = rows.reduce((s, r) => s + (Number(r.anzahl) || 0) * (Number(r.eGewicht) || 0), 0);
  const max = maximaleLast(data.attributes);

  const kategorieCell = (col: { key: string }, row: Row, updateRow: (r: Row) => void) => {
    if (col.key !== 'kategorie') return undefined;
    return (
      <select value={String(row.kategorie ?? INVENTAR_KATEGORIEN[0])} onChange={(e) => updateRow({ ...row, kategorie: e.target.value })}>
        {INVENTAR_KATEGORIEN.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    );
  };

  const sortByName = (a: Row, b: Row) => String(a.name).localeCompare(String(b.name), 'de');
  const sortRows = (mode: 'kategorie' | 'name') => {
    const sorted = [...rows].sort((a, b) => {
      if (mode === 'kategorie') {
        const kat = String(a.kategorie).localeCompare(String(b.kategorie), 'de');
        if (kat !== 0) return kat;
      }
      return sortByName(a, b);
    });
    update('inventar', sorted);
  };

  return (
    <div className="panel">
      <h3>Inventar</h3>
      <p>
        Gesamtgewicht: <strong>{gesamt.toFixed(1)} kg</strong> · Maximale Last: <strong>{max} kg</strong>{' '}
        {gesamt > max && <span className="error">— überladen!</span>}
      </p>
      <p>
        <span className="muted">Sortieren: </span>
        <button className="small" onClick={() => sortRows('kategorie')}>
          Kategorie &amp; Name
        </button>{' '}
        <button className="small" onClick={() => sortRows('name')}>
          Name
        </button>
      </p>
      <ListEditor
        def={listSectionById('inventar')!}
        rows={rows}
        onChange={(r) => update('inventar', r)}
        customCell={kategorieCell}
        emptyRow={{ kategorie: INVENTAR_KATEGORIEN[0] }}
        extraColumns={[{ label: 'G-Gewicht', render: (row) => ((Number(row.anzahl) || 0) * (Number(row.eGewicht) || 0)).toFixed(1) }]}
      />
    </div>
  );
}
