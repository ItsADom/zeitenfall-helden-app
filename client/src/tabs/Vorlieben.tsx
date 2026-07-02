import { TextInput } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function VorliebenTab() {
  const { data, update } = useChar();
  const rows = data.lists.vorlieben;

  const column = (kind: 'mag' | 'magNicht', title: string) => {
    const entries = rows.map((r, i) => ({ row: r, i })).filter((e) => e.row.kind === kind);
    const setText = (i: number, text: string) => {
      const next = rows.slice();
      next[i] = { ...next[i], text };
      update('vorlieben', next);
    };
    const remove = (i: number) => update('vorlieben', rows.filter((_, j) => j !== i));
    const add = () => update('vorlieben', [...rows, { kind, text: '' } as Row]);
    return (
      <div className="panel">
        <h3>{title}</h3>
        <table className="sheet">
          <tbody>
            {entries.map(({ row, i }) => (
              <tr key={i}>
                <td>
                  <TextInput value={String(row.text ?? '')} onChange={(v) => setText(i, v)} />
                </td>
                <td style={{ width: 30 }}>
                  <button className="small" onClick={() => remove(i)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="small" onClick={add}>
          + Eintrag
        </button>
      </div>
    );
  };

  return (
    <div className="grid2">
      {column('mag', 'Mag')}
      {column('magNicht', 'Mag nicht')}
    </div>
  );
}
