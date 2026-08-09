import { computeBaseValues, weaponProbes, wurfweiten } from '@shared/rules';
import { listSectionById } from '@shared/sections';
import type { ColumnDef } from '@shared/sections';
import { CollapsiblePanel } from '../components/collapse';
import { ListEditor } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useChar } from '../pages/Character';

export default function WaffenTab() {
  const { data, catalogs, update } = useChar();
  const bv = computeBaseValues(data.attributes, data.baseValues);
  const base = { at: bv.at.ergebnis, pa: bv.pa.ergebnis, bl: bv.bl.ergebnis };
  const talents = new Map(data.talents.map((t) => [t.talentId, t]));
  const kampfTalente = catalogs.talents.filter((t) => t.kategorie === 'kampf');

  const talentSelect = (col: ColumnDef, row: Row, updateRow: (r: Row) => void) => {
    if (col.key !== 'talentId') return undefined;
    return (
      <select value={Number(row.talentId) || 0} onChange={(e) => updateRow({ ...row, talentId: Number(e.target.value) })}>
        <option value={0}>—</option>
        {kampfTalente.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    );
  };

  const probesFor = (row: Row) => {
    const t = talents.get(Number(row.talentId));
    return weaponProbes(
      { at: Number(row.at) || 0, pa: Number(row.pa) || 0, bl: Number(row.bl) || 0, atMax: Number(row.atMax) || 0 },
      base,
      { at: t?.at ?? 0, pa: t?.pa ?? 0, bl: t?.bl ?? 0 },
    );
  };

  const weiten = wurfweiten(data.attributes);

  return (
    <>
      <p className="muted">
        Basiswerte: AT {base.at} · PA {base.pa} · BL {base.bl} · FK {bv.fk.ergebnis} · INI {bv.ini.ergebnis}
      </p>
      <CollapsiblePanel collapseKey="list:waffenNah" title="Nahkampfwaffen" rows={data.lists.waffenNah.length}>
        <ListEditor
          def={listSectionById('waffenNah')!}
          rows={data.lists.waffenNah}
          onChange={(rows) => update('waffenNah', rows)}
          customCell={talentSelect}
          extraColumns={[
            { label: 'Angriff (Probe)', render: (row) => probesFor(row).at },
            { label: 'Parade (Probe)', render: (row) => probesFor(row).pa },
            { label: 'Blocken (Probe)', render: (row) => probesFor(row).bl },
          ]}
        />
      </CollapsiblePanel>
      <CollapsiblePanel collapseKey="list:waffenFern" title="Fernkampfwaffen" rows={data.lists.waffenFern.length}>
        <ListEditor
          def={listSectionById('waffenFern')!}
          rows={data.lists.waffenFern}
          onChange={(rows) => update('waffenFern', rows)}
          customCell={talentSelect}
          extraColumns={[
            {
              label: 'FK (Probe)',
              render: (row) => bv.fk.ergebnis + (Number(row.atMod) || 0),
            },
          ]}
        />
      </CollapsiblePanel>
      <div className="grid2">
        <CollapsiblePanel collapseKey="list:waffenlos" title="Waffenloser Kampf" rows={data.lists.waffenlos.length}>
          <ListEditor
            def={listSectionById('waffenlos')!}
            rows={data.lists.waffenlos}
            onChange={(rows) => update('waffenlos', rows)}
            customCell={talentSelect}
          />
        </CollapsiblePanel>
        <CollapsiblePanel collapseKey="list:munition" title="Pfeile/Bolzen" rows={data.lists.munition.length}>
          <ListEditor def={listSectionById('munition')!} rows={data.lists.munition} onChange={(rows) => update('munition', rows)} />
        </CollapsiblePanel>
      </div>
      <div className="grid2">
        <CollapsiblePanel collapseKey="list:kampfstile" title="Kampfstile" rows={data.lists.kampfstile.length}>
          <ListEditor def={listSectionById('kampfstile')!} rows={data.lists.kampfstile} onChange={(rows) => update('kampfstile', rows)} />
        </CollapsiblePanel>
      </div>
    </>
  );
}
