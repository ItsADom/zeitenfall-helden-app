import { schreibenProbe, sprechenProbe } from '@shared/rules';
import type { CharLanguage } from '@shared/types';
import { CollapsiblePanel } from '../components/collapse';
import { useReadOnly } from '../components/displayMode';
import { NumInput } from '../components/inputs';
import { ColumnDivider, TableTools, useTableLayout } from '../components/tableLayout';
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

  return (
    <div className="grid2">
      <LanguageTable
        kind="sprache"
        title="Sprachen"
        info={
          <>
            Sprechen-Probe (KL/IN/CH): <strong>{sprechenProbe(data.attributes)}</strong> — erleichtert um TaW in der Sprache.
          </>
        }
        entries={catalogs.languages.filter((l) => l.kind === 'sprache')}
        values={values}
        setValue={setValue}
      />
      <LanguageTable
        kind="schrift"
        title="Schriften"
        info={
          <>
            Lesen/Schreiben-Probe (KL/KL/FF): <strong>{schreibenProbe(data.attributes)}</strong> — erleichtert um TaW in der
            Sprache.
          </>
        }
        entries={catalogs.languages.filter((l) => l.kind === 'schrift')}
        values={values}
        setValue={setValue}
      />
    </div>
  );
}

// Eigene Komponente statt einer Hilfsfunktion im Tab: die Tabelle hält mit
// useTableLayout eigenen Zustand, und Hooks dürfen nicht in einer Funktion
// stehen, die pro Durchlauf mehrfach aufgerufen wird.
function LanguageTable({
  kind,
  title,
  info,
  entries,
  values,
  setValue,
}: {
  kind: 'sprache' | 'schrift';
  title: string;
  info: React.ReactNode;
  entries: LanguageCatalogRow[];
  values: Map<number, CharLanguage>;
  setValue: (id: number, patch: Partial<CharLanguage>) => void;
}) {
  const readOnly = useReadOnly();
  const heads = kind === 'sprache' ? ['Name', 'Komplexität', 'TaW', 'Muttersprache'] : ['Name', 'Komplexität', 'TaW'];
  const layout = useTableLayout(`sprachen:${kind}`, heads.length, {
    defaults: kind === 'sprache' ? [4, 2, 1.5, 2] : [4, 2, 1.5],
  });

  const rows: React.ReactNode[] = [];
  let lastFamilie = '';
  for (const e of entries) {
    if (e.familie !== lastFamilie) {
      lastFamilie = e.familie;
      rows.push(
        <tr className="subtle-head" key={`f-${e.familie}`}>
          <td colSpan={heads.length}>
            <span className="sticky-label">{e.familie}</span>
          </td>
        </tr>,
      );
    }
    const v = values.get(e.id);
    rows.push(
      <tr key={e.id}>
        <td title={e.name}>{e.name}</td>
        <td className="num muted">{e.komplexitaet}</td>
        <td className="num">
          <NumInput value={v?.taw ?? 0} onChange={(x) => setValue(e.id, { taw: x })} />
        </td>
        {kind === 'sprache' && (
          <td style={{ textAlign: 'center' }}>
            <input
              type="checkbox"
              checked={v?.muttersprache ?? false}
              disabled={readOnly}
              onChange={(ev) => setValue(e.id, { muttersprache: ev.target.checked })}
            />
          </td>
        )}
      </tr>,
    );
  }

  return (
    <CollapsiblePanel collapseKey={`sprachen:${kind}`} title={title} info={info} rows={entries.length}>
      <>
        <TableTools layout={layout} label={title} />
        <div className="table-wrap">
            <table ref={layout.tableRef} className="sheet" style={{ tableLayout: 'fixed', width: '100%', minWidth: heads.length * 80 }}>
              <colgroup>
                {heads.map((h, i) => (
                  <col key={h} style={{ width: layout.colWidth(i) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {heads.map((h, i) => (
                    <th key={h} title={h}>
                      {h}
                      {i < heads.length - 1 && <ColumnDivider layout={layout} index={i} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
        </div>
      </>
    </CollapsiblePanel>
  );
}
