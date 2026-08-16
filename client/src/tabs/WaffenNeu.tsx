import { useState } from 'react';
import { computeBaseValues, weaponProbes } from '@shared/rules';
import { NOTIZ_KEY } from '@shared/sections';
import { CollapsiblePanel } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { NumInput, TextInput } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useReadOnly } from '../components/displayMode';
import { useChar } from '../pages/Character';
import type { TalentCatalogRow } from '../pages/Character';

// Kompaktes Layout mit gepaarten Spalten (zweizeiliger Kopf, zwei Werte pro
// Zelle übereinander) statt vieler schmaler Einzelspalten — löst den alten,
// generisch-listenbasierten Reiter „Waffen (alt)" (Waffen.tsx) ab. Die Felder
// sind 1:1-Umbenennungen der alten Spalten (siehe Migration in db.ts).

function emptyNahRow(): Row {
  return {
    typ: '', expLevel: '', schaden: '', material: '', iniBonus: 0, rd: '', reichweite: '',
    haltbarkeit: '', besonderes: '', anforderung: '', talentId: 0, at: 0, pa: 0, bl: 0, [NOTIZ_KEY]: '',
  };
}
function emptyFernRow(): Row {
  return {
    typ: '', eBE: '', haltbarkeit: '', entfernung: '', besonderes: '', schaden: '',
    talentId: 0, atMod: 0, [NOTIZ_KEY]: '',
  };
}

export default function WaffenNeuTab() {
  const { data, catalogs, update } = useChar();
  const bv = computeBaseValues(data.attributes, data.baseValues);
  const base = { at: bv.at.ergebnis, pa: bv.pa.ergebnis, bl: bv.bl.ergebnis };
  const talents = new Map(data.talents.map((t) => [t.talentId, t]));
  const kampfTalente = catalogs.talents.filter((t) => t.kategorie === 'kampf');

  const probesFor = (row: Row) => {
    const t = talents.get(Number(row.talentId));
    return weaponProbes(
      { at: Number(row.at) || 0, pa: Number(row.pa) || 0, bl: Number(row.bl) || 0 },
      base,
      { at: t?.at ?? 0, pa: t?.pa ?? 0, bl: t?.bl ?? 0 },
    );
  };

  return (
    <>
      <p className="muted">
        Basiswerte: AT {base.at} · PA {base.pa} · BL {base.bl} · FK {bv.fk.ergebnis} · INI {bv.ini.ergebnis}
      </p>
      <CollapsiblePanel collapseKey="list:waffenNahNeu" title="Nahkampfwaffen" rows={data.lists.waffenNahNeu.length}>
        <NahTable
          rows={data.lists.waffenNahNeu}
          onChange={(rows) => update('waffenNahNeu', rows)}
          kampfTalente={kampfTalente}
          probesFor={probesFor}
        />
      </CollapsiblePanel>
      <CollapsiblePanel collapseKey="list:waffenFernNeu" title="Fernkampfwaffen" rows={data.lists.waffenFernNeu.length}>
        <FernTable
          rows={data.lists.waffenFernNeu}
          onChange={(rows) => update('waffenFernNeu', rows)}
          kampfTalente={kampfTalente}
          fk={bv.fk.ergebnis}
        />
      </CollapsiblePanel>
    </>
  );
}

// Notiz-Zelle: derselbe Knopf+Klapp-Zeile-Trick wie im generischen ListEditor,
// hier von Hand nachgebaut, weil die Tabelle selbst nicht generisch ist.
function useNotes() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return { open, toggle };
}

function NoteRow({ colSpan, value, onChange, ro }: { colSpan: number; value: string; onChange: (v: string) => void; ro: boolean }) {
  return (
    <tr className="note-row">
      <td colSpan={colSpan}>
        <textarea className="note-area" rows={2} placeholder="Notiz…" value={value} readOnly={ro} autoFocus onChange={(e) => onChange(e.target.value)} />
      </td>
    </tr>
  );
}

const NAH_COLS = 9;

function NahTable({
  rows,
  onChange,
  kampfTalente,
  probesFor,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  kampfTalente: TalentCatalogRow[];
  probesFor: (row: Row) => { at: number; pa: number; bl: number };
}) {
  const ro = useReadOnly();
  const { open, toggle } = useNotes();
  const setRow = (i: number, row: Row) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <>
      <div className="table-wrap">
        <table className="sheet weapon-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: 850 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 55 }} />
            <col style={{ width: 55 }} />
            <col style={{ width: 55 }} />
            <col style={{ width: 40 }} />
            {!ro && <col style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} title="Waffe/Typ">Waffe/Typ</th>
              <th title="EXP/LVL">EXP/LVL</th>
              <th title="Material">Material</th>
              <th title="Rüstungsdurchdringung">Rüstungsdurchdringung</th>
              <th title="Haltbarkeit">Haltbarkeit</th>
              <th title="Anforderung">Anforderung</th>
              <th title="AT">AT</th>
              <th title="PA">PA</th>
              <th title="BL">BL</th>
              <th rowSpan={2} />
              {!ro && <th rowSpan={2} />}
            </tr>
            <tr>
              <th title="Schaden">Schaden</th>
              <th title="Ini-Bonus">Ini-Bonus</th>
              <th title="Reichweite">Reichweite</th>
              <th title="Besonderes">Besonderes</th>
              <th title="Kampftalent">Kampftalent</th>
              <th title="AT-Zahl">AT-Zahl</th>
              <th title="PA-Zahl">PA-Zahl</th>
              <th title="BL-Zahl">BL-Zahl</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const probes = probesFor(row);
              const notiz = String(row[NOTIZ_KEY] ?? '');
              return [
                <tr key={i}>
                  <td>
                    <TextInput value={String(row.typ ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, typ: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.expLevel ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, expLevel: v })} />
                    <TextInput value={String(row.schaden ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, schaden: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.material ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, material: v })} />
                    <NumInput value={Number(row.iniBonus) || 0} disabled={ro} onChange={(v) => setRow(i, { ...row, iniBonus: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.rd ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, rd: v })} />
                    <TextInput value={String(row.reichweite ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, reichweite: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.haltbarkeit ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, haltbarkeit: v })} />
                    <TextInput value={String(row.besonderes ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, besonderes: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.anforderung ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, anforderung: v })} />
                    <select value={Number(row.talentId) || 0} disabled={ro} onChange={(e) => setRow(i, { ...row, talentId: Number(e.target.value) })}>
                      <option value={0}>—</option>
                      {kampfTalente.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="paired-cell">
                    <NumInput value={Number(row.at) || 0} disabled={ro} onChange={(v) => setRow(i, { ...row, at: v })} />
                    <span className="computed">{probes.at}</span>
                  </td>
                  <td className="paired-cell">
                    <NumInput value={Number(row.pa) || 0} disabled={ro} onChange={(v) => setRow(i, { ...row, pa: v })} />
                    <span className="computed">{probes.pa}</span>
                  </td>
                  <td className="paired-cell">
                    <NumInput value={Number(row.bl) || 0} disabled={ro} onChange={(v) => setRow(i, { ...row, bl: v })} />
                    <span className="computed">{probes.bl}</span>
                  </td>
                  <td>
                    <button className={`small note-btn${notiz ? ' has-note' : ''}`} title={notiz || 'Notiz hinzufügen'} onClick={() => toggle(i)}>
                      {notiz ? '📝' : '✎'}
                    </button>
                  </td>
                  {!ro && (
                    <td>
                      <ConfirmDeleteButton title="Zeile entfernen" onConfirm={() => removeRow(i)} />
                    </td>
                  )}
                </tr>,
                open.has(i) ? (
                  <NoteRow key={`note-${i}`} colSpan={NAH_COLS + 1 + (ro ? 0 : 1)} value={notiz} ro={ro} onChange={(v) => setRow(i, { ...row, [NOTIZ_KEY]: v })} />
                ) : null,
              ];
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={NAH_COLS + 1 + (ro ? 0 : 1)} className="muted">Keine Einträge</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!ro && (
        <button className="small add-row" onClick={() => onChange([...rows, emptyNahRow()])}>+ Zeile</button>
      )}
    </>
  );
}

const FERN_COLS = 5;

function FernTable({
  rows,
  onChange,
  kampfTalente,
  fk,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  kampfTalente: TalentCatalogRow[];
  fk: number;
}) {
  const ro = useReadOnly();
  const { open, toggle } = useNotes();
  const setRow = (i: number, row: Row) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <>
      <div className="table-wrap">
        <table className="sheet weapon-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: 650 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 40 }} />
            {!ro && <col style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} title="Waffe/Typ">Waffe/Typ</th>
              <th title="eBE">eBE</th>
              <th title="Entfernung">Entfernung</th>
              <th title="Schaden">Schaden</th>
              <th title="AT-Mod">AT-Mod</th>
              <th rowSpan={2} />
              {!ro && <th rowSpan={2} />}
            </tr>
            <tr>
              <th title="Haltbarkeit">Haltbarkeit</th>
              <th title="Besonderes">Besonderes</th>
              <th title="Kampftalent">Kampftalent</th>
              <th title="FK-Zahl">FK-Zahl</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const notiz = String(row[NOTIZ_KEY] ?? '');
              return [
                <tr key={i}>
                  <td>
                    <TextInput value={String(row.typ ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, typ: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.eBE ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, eBE: v })} />
                    <TextInput value={String(row.haltbarkeit ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, haltbarkeit: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.entfernung ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, entfernung: v })} />
                    <TextInput value={String(row.besonderes ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, besonderes: v })} />
                  </td>
                  <td className="paired-cell">
                    <TextInput value={String(row.schaden ?? '')} disabled={ro} onChange={(v) => setRow(i, { ...row, schaden: v })} />
                    <select value={Number(row.talentId) || 0} disabled={ro} onChange={(e) => setRow(i, { ...row, talentId: Number(e.target.value) })}>
                      <option value={0}>—</option>
                      {kampfTalente.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="paired-cell">
                    <NumInput value={Number(row.atMod) || 0} disabled={ro} onChange={(v) => setRow(i, { ...row, atMod: v })} />
                    <span className="computed">{fk + (Number(row.atMod) || 0)}</span>
                  </td>
                  <td>
                    <button className={`small note-btn${notiz ? ' has-note' : ''}`} title={notiz || 'Notiz hinzufügen'} onClick={() => toggle(i)}>
                      {notiz ? '📝' : '✎'}
                    </button>
                  </td>
                  {!ro && (
                    <td>
                      <ConfirmDeleteButton title="Zeile entfernen" onConfirm={() => removeRow(i)} />
                    </td>
                  )}
                </tr>,
                open.has(i) ? (
                  <NoteRow key={`note-${i}`} colSpan={FERN_COLS + 1 + (ro ? 0 : 1)} value={notiz} ro={ro} onChange={(v) => setRow(i, { ...row, [NOTIZ_KEY]: v })} />
                ) : null,
              ];
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={FERN_COLS + 1 + (ro ? 0 : 1)} className="muted">Keine Einträge</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!ro && (
        <button className="small add-row" onClick={() => onChange([...rows, emptyFernRow()])}>+ Zeile</button>
      )}
    </>
  );
}
