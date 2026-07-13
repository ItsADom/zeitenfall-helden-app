import { probeExprZahl } from '@shared/rules';
import { listSectionById } from '@shared/sections';
import { ListEditor } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useChar } from '../pages/Character';

// Frei benennbare Sektionen: lists.zauberSektionen hält die Sektionsnamen,
// lists.zauberEintraege alle Einträge mit Verweis auf ihren Sektionsnamen.
export default function ZauberTab() {
  const { data, update } = useChar();
  const sektionen = data.lists.zauberSektionen;
  const eintraege = data.lists.zauberEintraege;
  const def = listSectionById('zauberEintraege')!;

  const probeZahl = (row: Row): React.ReactNode => {
    const computed = probeExprZahl(data.attributes, String(row.probe ?? ''));
    if (computed != null) return computed;
    const manuell = Number(row.probeZahlManuell) || 0;
    return manuell !== 0 ? `${manuell} (manuell)` : '—';
  };

  const addSection = () => {
    let name = 'Neue Sektion';
    let i = 2;
    while (sektionen.some((s) => s.name === name)) name = `Neue Sektion ${i++}`;
    update('zauberSektionen', [...sektionen, { name, notiz: '' }]);
  };

  const renameSection = (index: number, newName: string) => {
    const oldName = String(sektionen[index].name);
    if (!newName.trim() || newName === oldName) return;
    if (sektionen.some((s, i) => i !== index && s.name === newName)) return;
    update('zauberSektionen', sektionen.map((s, i) => (i === index ? { ...s, name: newName } : s)));
    update('zauberEintraege', eintraege.map((e) => (e.sektion === oldName ? { ...e, sektion: newName } : e)));
  };

  const deleteSection = (index: number) => {
    const name = String(sektionen[index].name);
    const count = eintraege.filter((e) => e.sektion === name).length;
    if (!confirm(`Sektion „${name}" ${count > 0 ? `mit ${count} Eintrag/Einträgen ` : ''}löschen?`)) return;
    update('zauberSektionen', sektionen.filter((_, i) => i !== index));
    update('zauberEintraege', eintraege.filter((e) => e.sektion !== name));
  };

  const setSectionRows = (name: string, rows: Row[]) => {
    update('zauberEintraege', [...eintraege.filter((e) => e.sektion !== name), ...rows]);
  };

  return (
    <>
      <p className="muted">
        Probe (Zahl) wird automatisch berechnet, wenn die Probe nur aus Attributen besteht (z.&nbsp;B. „KO+KO+KO"). Sonst gilt der
        manuelle Wert.
      </p>
      {sektionen.map((s, i) => {
        const name = String(s.name);
        return (
          <div className="panel" key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input
                className="section-title"
                defaultValue={name}
                key={name}
                title="Sektion umbenennen"
                onBlur={(e) => renameSection(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <button className="small" title="Sektion löschen" onClick={() => deleteSection(i)}>
                Sektion löschen
              </button>
            </div>
            <ListEditor
              def={def}
              rows={eintraege.filter((e) => e.sektion === name)}
              onChange={(rows) => setSectionRows(name, rows)}
              hiddenColumns={['sektion']}
              emptyRow={{ sektion: name }}
              extraColumns={[{ label: 'Probe (Zahl)', render: probeZahl }]}
            />
          </div>
        );
      })}
      {sektionen.length === 0 && <p className="muted">Noch keine Sektionen.</p>}
      <button className="primary" onClick={addSection}>
        + Neue Sektion
      </button>
    </>
  );
}
