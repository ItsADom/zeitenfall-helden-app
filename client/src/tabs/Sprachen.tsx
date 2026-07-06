import { schreibenProbe, sprechenProbe } from '@shared/rules';
import type { CharLanguage } from '@shared/types';
import { NumInput } from '../components/inputs';
import { useChar } from '../pages/Character';
import type { LanguageCatalogRow } from '../pages/Character';

export default function SprachenTab() {
  const { data, catalogs, update } = useChar();
  const values = new Map(data.languages.map((l) => [l.languageId, l]));

  const setValue = (languageId: number, patch: Partial<CharLanguage>) => {
    const existing = values.get(languageId);
    const next = existing
      ? data.languages.map((l) => (l.languageId === languageId ? { ...l, ...patch } : l))
      : [...data.languages, { languageId, taw: 0, muttersprache: false, ...patch }];
    update('languages', next);
  };

  const renderTable = (kind: 'sprache' | 'schrift', title: string) => {
    const entries = catalogs.languages.filter((l) => l.kind === kind);
    const rows: React.ReactNode[] = [];
    let lastFamilie = '';
    for (const e of entries) {
      if (e.familie !== lastFamilie) {
        lastFamilie = e.familie;
        rows.push(
          <tr className="subtle-head" key={`f-${e.familie}`}>
            <td colSpan={4}><span className="sticky-label">{e.familie}</span></td>
          </tr>,
        );
      }
      const v = values.get(e.id);
      rows.push(
        <tr key={e.id}>
          <td>{e.name}</td>
          <td className="num muted" style={{ width: 100 }}>
            {e.komplexitaet}
          </td>
          <td className="num" style={{ width: 80 }}>
            <NumInput value={v?.taw ?? 0} onChange={(x) => setValue(e.id, { taw: x })} />
          </td>
          <td style={{ width: 110, textAlign: 'center' }}>
            {kind === 'sprache' && (
              <input type="checkbox" checked={v?.muttersprache ?? false} onChange={(ev) => setValue(e.id, { muttersprache: ev.target.checked })} />
            )}
          </td>
        </tr>,
      );
    }
    return (
      <div className="panel">
        <h3>{title}</h3>
        <div className="table-wrap">
          <table className="sheet" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Komplexität</th>
                <th>TaW</th>
                <th>{kind === 'sprache' ? 'Muttersprache' : ''}</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <p className="muted">
        Sprechen-Probe (KL/IN/CH): <strong>{sprechenProbe(data.attributes)}</strong> · Lesen/Schreiben-Probe (KL/KL/FF):{' '}
        <strong>{schreibenProbe(data.attributes)}</strong> — erleichtert um TaW in der Sprache.
      </p>
      <div className="grid2">
        {renderTable('sprache', 'Sprachen')}
        {renderTable('schrift', 'Schriften')}
      </div>
    </>
  );
}
