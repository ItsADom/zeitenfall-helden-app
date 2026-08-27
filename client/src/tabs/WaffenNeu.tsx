import { useState } from 'react';
import { computeBaseValues, weaponProbe, weaponProbes } from '@shared/rules';
import { NOTIZ_KEY, listSectionById } from '@shared/sections';
import type { ColumnDef } from '@shared/sections';
import { CollapseChevron, CollapsiblePanel } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import WeaponDamageRollButton from '../components/dice/WeaponDamageRollButton';
import { ListEditor, NumInput, TextInput } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useDisplayMode, useReadOnly } from '../components/displayMode';
import { useChar } from '../pages/Character';
import type { TalentCatalogRow } from '../pages/Character';

// Waffen als Karten, nicht als Tabelle — löst den alten, generisch-
// listenbasierten Reiter „Waffen (alt)" (Waffen.tsx) ab.
//
// Warum keine Tabelle: eine Tabelle erzwingt EINE Spaltenbreite über ALLE
// Waffen. „Besonderes" braucht bei der einen Waffe drei Zeilen und bei der
// nächsten gar nichts — in einer Tabelle zahlt jede Zeile die Breite der
// breitesten, und der Rest wird zu Leerfläche. Genau daran sind die früheren
// Anläufe (gepaarte Spalten, zweizeiliger Kopf) gescheitert: sie haben
// waagerechten Platz gegen senkrechten getauscht, statt die geteilte
// Spaltenbreite loszuwerden. Eine Karte pro Waffe bemisst jedes Feld an
// ihrem eigenen Inhalt und bringt die Beschriftung direkt über den Wert.
//
// Dieselbe Denkweise wie bei den Gegenstands-Chips der Ausrüstung: eingeklappt
// steht nur, was im Spiel zählt (Name, Kampftalent, die fertigen Proben),
// aufgeklappt kommt der beschriftete Feldblock (`.chip-editor`, von dort
// übernommen). Der Kopf zeigt bewusst die BERECHNETE Probe, nicht den
// waffeneigenen Bonus — die Zahl, die am Tisch gewürfelt wird.
//
// Im Druck sind alle Karten offen (siehe `useWeaponCards`); in Nur-Lesen
// bleiben leere Felder weg, damit eine kaum ausgefüllte Waffe nicht als Gitter
// leerer Kästchen erscheint. Die Felder sind 1:1-Umbenennungen der alten
// Spalten (siehe Migration in db.ts).
//
// Waffenloser Kampf / Kampfstile / Pfeile-Bolzen (Munition) hängen unten noch
// dran, unverändert mit der generischen `ListEditor`-Tabelle: sie waren nie
// Teil der Migration nach waffenNahNeu/waffenFernNeu und lebten NUR im alten,
// jetzt stillgelegten „Waffen (alt)"-Reiter — ohne sie hier wären bestehende
// Einträge dort unerreichbar geworden, nicht verloren, aber für niemanden mehr
// sichtbar oder bearbeitbar. Munition bekommt mit dem geplanten Nachschlage-
// Katalog (siehe TODO.md) ohnehin eine eigene Lösung; Waffenloser Kampf und
// Kampfstile warten noch auf ihren eigenen Kartenumbau.

function emptyNahRow(): Row {
  return {
    typ: '', expLevel: '', schaden: '', material: '', iniBonus: 0, rd: '', reichweite: '',
    haltbarkeit: '', besonderes: '', anforderung: '', talentId: 0, at: 0, pa: 0, bl: 0, [NOTIZ_KEY]: '',
  };
}
function emptyFernRow(): Row {
  return {
    typ: '', eBE: '', rd: '', haltbarkeit: '', entfernung: '', besonderes: '', schaden: '',
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
  const fkProbeFor = (row: Row) => {
    const t = talents.get(Number(row.talentId));
    return weaponProbe(Number(row.atMod) || 0, bv.fk.ergebnis, t?.at ?? 0);
  };

  return (
    <>
      <p className="muted">
        Basiswerte: AT {base.at} · PA {base.pa} · BL {base.bl} · FK {bv.fk.ergebnis} · INI {bv.ini.ergebnis}
      </p>
      <CollapsiblePanel collapseKey="list:waffenNahNeu" title="Nahkampfwaffen" rows={data.lists.waffenNahNeu.length}>
        <NahCards
          rows={data.lists.waffenNahNeu}
          onChange={(rows) => update('waffenNahNeu', rows)}
          kampfTalente={kampfTalente}
          probesFor={probesFor}
        />
      </CollapsiblePanel>
      <CollapsiblePanel collapseKey="list:waffenFernNeu" title="Fernkampfwaffen" rows={data.lists.waffenFernNeu.length}>
        <FernCards
          rows={data.lists.waffenFernNeu}
          onChange={(rows) => update('waffenFernNeu', rows)}
          kampfTalente={kampfTalente}
          fkProbeFor={fkProbeFor}
        />
      </CollapsiblePanel>
      <div className="grid2">
        <CollapsiblePanel collapseKey="list:waffenlos" title="Waffenloser Kampf" rows={data.lists.waffenlos.length}>
          <ListEditor
            def={listSectionById('waffenlos')!}
            rows={data.lists.waffenlos}
            onChange={(rows) => update('waffenlos', rows)}
            customCell={talentCell(kampfTalente)}
          />
        </CollapsiblePanel>
        <CollapsiblePanel collapseKey="list:munition" title="Pfeile/Bolzen" rows={data.lists.munition.length}>
          <ListEditor def={listSectionById('munition')!} rows={data.lists.munition} onChange={(rows) => update('munition', rows)} />
        </CollapsiblePanel>
      </div>
      <CollapsiblePanel collapseKey="list:kampfstile" title="Kampfstile" rows={data.lists.kampfstile.length}>
        <ListEditor def={listSectionById('kampfstile')!} rows={data.lists.kampfstile} onChange={(rows) => update('kampfstile', rows)} />
      </CollapsiblePanel>
    </>
  );
}

/**
 * Kampftalent-Spalte für die drei Listen, die (noch) nicht auf Karten
 * umgestellt sind (Waffenloser Kampf; Kampfstile/Munition haben gar kein
 * Talent-Feld). Dieselbe Vorsicht wie bei `TalentFeld` weiter unten: ein
 * `<select>` läuft nicht durch NumInput/TextInput und bliebe ungegated auch
 * auf einem schreibgeschützten Blatt bedienbar — siehe die identische
 * Begründung dort.
 */
function talentCell(kampfTalente: TalentCatalogRow[]) {
  return (col: ColumnDef, row: Row, updateRow: (r: Row) => void) => {
    if (col.key !== 'talentId') return undefined;
    const id = Number(row.talentId) || 0;
    return <TalentCell id={id} kampfTalente={kampfTalente} onChange={(v) => updateRow({ ...row, talentId: v })} />;
  };
}

function TalentCell({
  id,
  kampfTalente,
  onChange,
}: {
  id: number;
  kampfTalente: TalentCatalogRow[];
  onChange: (id: number) => void;
}) {
  const ro = useReadOnly();
  if (ro) return <span className="static-value static-text">{kampfTalente.find((t) => t.id === id)?.name ?? ''}</span>;
  return (
    <select value={id} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>—</option>
      {kampfTalente.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}

/**
 * Aufgeklappt-Zustand je Karte. Bewusst NICHT gespeichert: es beschreibt, was
 * jemand gerade ansieht, und die Zeilen sind ohnehin nur über ihre Position
 * identifizierbar. Beim Löschen rutschen die Indizes nach — `dropAt` zieht den
 * Zustand mit, sonst stünde nach dem Entfernen die falsche Karte offen.
 * Im Druck ist alles offen: auf Papier gibt es kein Aufklappen.
 */
function useWeaponCards() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const forPrint = useDisplayMode() === 'print';
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const dropAt = (i: number) =>
    setOpen((prev) => {
      const next = new Set<number>();
      for (const j of prev) {
        if (j < i) next.add(j);
        else if (j > i) next.add(j - 1);
      }
      return next;
    });
  return { isOpen: (i: number) => forPrint || open.has(i), toggle, dropAt };
}

/**
 * Ein beschriftetes Feld im aufgeklappten Block. `leer` sagt, ob nichts drin
 * steht — in Nur-Lesen fällt das Feld dann ganz weg, im Bearbeiten bleibt es
 * stehen, damit es befüllbar ist.
 */
function Feld({
  label,
  title,
  leer,
  wide,
  children,
}: {
  label: string;
  title?: string;
  leer: boolean;
  /** Über die volle Breite — für Freitext, der sonst in eine Spalte gequetscht wird. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ro = useReadOnly();
  if (ro && leer) return null;
  return (
    <label className={wide ? 'chip-notiz' : undefined} title={title}>
      {label}
      {children}
    </label>
  );
}

// Der Server schlägt die Waffenzeile über ihre id nach; eine frisch angelegte,
// noch nicht gespeicherte Zeile hat keine — dort bleibt der Würfel-Knopf weg,
// bis gespeichert wurde.
function rollFor(row: Row, probe: 'at' | 'pa' | 'bl' | 'fk') {
  const sectionRowId = Number(row.id) || 0;
  return sectionRowId ? { sectionRowId, probe } : undefined;
}

// Dieselbe Grund-Bedingung wie rollFor: keine gespeicherte Zeile, kein Würfel-
// Knopf. Zusätzlich ohne Schaden-Text kein Knopf — sonst würfelt man gegen
// eine leere Formel und bekommt nur eine Fehlermeldung.
function damageRollFor(row: Row): number | undefined {
  const sectionRowId = Number(row.id) || 0;
  return sectionRowId && String(row.schaden ?? '').trim() ? sectionRowId : undefined;
}

/**
 * Fertige Probe im Kartenkopf — die Zahl, die am Tisch gewürfelt wird.
 * `roll` hängt den Würfel-Knopf an: eine einzelne Stelle für alle vier Chips
 * (AT/PA/BL am Nahkampf, FK am Fernkampf), statt vier gleiche Knöpfe an den
 * jeweiligen Aufrufstellen.
 */
function ProbeChip({
  label,
  value,
  title,
  roll,
}: {
  label: string;
  value: number;
  title: string;
  roll?: { sectionRowId: number; probe: 'at' | 'pa' | 'bl' | 'fk' };
}) {
  return (
    <span className="wpn-chip" title={title}>
      <span className="wpn-chip-label">{label}</span>
      <span className="wpn-chip-val">{value}</span>
      {roll && <ProbeRollButton source={{ kind: 'weapon', ...roll }} title={`${title} (${label})`} />}
    </span>
  );
}

function CardHead({
  name,
  sub,
  schaden,
  rd,
  damageRollId,
  ranged,
  notiz,
  open,
  onToggle,
  children,
}: {
  name: string;
  sub: string;
  /** Roher Schaden-String (z.B. "1W6+2") — im Kopf schon sichtbar, nicht erst beim Ausklappen. */
  schaden: string;
  /** Rüstungsdurchdringung — steht mit im Schaden-Chip, eigener Wert wäre hier zu klein. */
  rd: string;
  /** Gesetzt (siehe damageRollFor), wenn diese Zeile Schaden würfelbar ist. */
  damageRollId?: number;
  ranged: boolean;
  notiz: string;
  open: boolean;
  onToggle: () => void;
  /** Die Proben-Chips. */
  children: React.ReactNode;
}) {
  return (
    <div
      className="wpn-head"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={open ? 'Einklappen' : 'Ausklappen'}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <CollapseChevron open={open} />
      <span className="wpn-name">{name || '(ohne Name)'}</span>
      {/* Die Proben stehen DIREKT beim Namen, nicht am rechten Rand: auf einem
          breiten Schirm liegen sonst 1500px zwischen Waffe und ihren Zahlen,
          und man verliert die Zuordnung. Nähe schlägt hier die saubere
          Zahlenkolonne. */}
      <span className="wpn-probes">
        {schaden && (
          <span className="wpn-chip" title="Schaden">
            <span className="wpn-chip-label">Schaden</span>
            <span className="wpn-chip-val">{schaden}{rd && ` · RD ${rd}`}</span>
            {damageRollId != null && (
              <WeaponDamageRollButton sectionRowId={damageRollId} ranged={ranged} title={`${name || 'Waffe'} — Schaden`} />
            )}
          </span>
        )}
        {children}
      </span>
      {sub && <span className="muted wpn-sub">{sub}</span>}
      {notiz && (
        <span className="wpn-note-flag" title={notiz} aria-label="Notiz vorhanden">
          📝
        </span>
      )}
    </div>
  );
}

/**
 * Kampftalent. Das Auswahlfeld gibt es NUR im Bearbeiten-Modus: ein `<select>`
 * läuft nicht durch NumInput/TextInput und bliebe sonst auch auf einem
 * schreibgeschützten Blatt ein bedienbares Klappmenü — man könnte das Talent
 * eines fremden Charakters im Vorbeigehen umstellen. Gelesen wird es als
 * fester Text wie jeder andere Wert auch.
 */
function TalentFeld({
  row,
  kampfTalente,
  onPatch,
}: {
  row: Row;
  kampfTalente: TalentCatalogRow[];
  onPatch: (patch: Partial<Row>) => void;
}) {
  const ro = useReadOnly();
  const id = Number(row.talentId) || 0;
  return (
    <Feld label="Kampftalent" leer={!id}>
      {ro ? (
        <span className="static-value static-text">{kampfTalente.find((t) => t.id === id)?.name ?? ''}</span>
      ) : (
        <select value={id} onChange={(e) => onPatch({ talentId: Number(e.target.value) })}>
          <option value={0}>—</option>
          {kampfTalente.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}
    </Feld>
  );
}

function EmptyNote({ what }: { what: string }) {
  return <p className="muted collapsed-note">Keine {what}</p>;
}

function NahCards({
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
  const { isOpen, toggle, dropAt } = useWeaponCards();
  const patch = (i: number, p: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const removeRow = (i: number) => {
    dropAt(i);
    onChange(rows.filter((_, j) => j !== i));
  };
  return (
    <>
      <div className="wpn-list">
        {rows.map((row, i) => {
          const probes = probesFor(row);
          const notiz = String(row[NOTIZ_KEY] ?? '');
          const open = isOpen(i);
          const exp = String(row.expLevel ?? '');
          // Das Kampftalent steht bewusst NICHT im Kopf: es ist bereits in die
          // Proben eingerechnet, die daneben stehen.
          const sub = exp ? `EXP/LVL ${exp}` : '';
          return (
            <div className={`wpn-card${open ? ' open' : ''}`} key={i}>
              <CardHead
                name={String(row.typ ?? '')}
                sub={sub}
                schaden={String(row.schaden ?? '')}
                rd={String(row.rd ?? '')}
                damageRollId={damageRollFor(row)}
                ranged={false}
                notiz={notiz}
                open={open}
                onToggle={() => toggle(i)}
              >
                <ProbeChip label="AT" value={probes.at} title="Attacke — fertige Probe" roll={rollFor(row, 'at')} />
                <ProbeChip label="PA" value={probes.pa} title="Parade — fertige Probe" roll={rollFor(row, 'pa')} />
                <ProbeChip label="BL" value={probes.bl} title="Block — fertige Probe" roll={rollFor(row, 'bl')} />
              </CardHead>
              {open && (
                <div className="chip-editor">
                  {/* Nur zum Bearbeiten — im Nur-Lesen steht der Name schon
                      im Kartenkopf und stünde hier ein zweites Mal. */}
                  {!ro && (
                    <Feld label="Waffe/Typ" leer={false}>
                      <TextInput value={String(row.typ ?? '')} onChange={(v) => patch(i, { typ: v })} />
                    </Feld>
                  )}
                  <Feld label="Schaden" leer={!String(row.schaden ?? '')}>
                    <TextInput value={String(row.schaden ?? '')} onChange={(v) => patch(i, { schaden: v })} />
                  </Feld>
                  <Feld label="Material" leer={!String(row.material ?? '')}>
                    <TextInput value={String(row.material ?? '')} onChange={(v) => patch(i, { material: v })} />
                  </Feld>
                  <Feld label="RD" title="Rüstungsdurchdringung" leer={!String(row.rd ?? '')}>
                    <TextInput value={String(row.rd ?? '')} onChange={(v) => patch(i, { rd: v })} />
                  </Feld>
                  <Feld label="Haltbarkeit" leer={!String(row.haltbarkeit ?? '')}>
                    <TextInput value={String(row.haltbarkeit ?? '')} onChange={(v) => patch(i, { haltbarkeit: v })} />
                  </Feld>
                  <Feld label="Reichweite" leer={!String(row.reichweite ?? '')}>
                    <TextInput value={String(row.reichweite ?? '')} onChange={(v) => patch(i, { reichweite: v })} />
                  </Feld>
                  <Feld label="Ini-Bonus" leer={!Number(row.iniBonus)}>
                    <NumInput value={Number(row.iniBonus) || 0} onChange={(v) => patch(i, { iniBonus: v })} />
                  </Feld>
                  <Feld label="Anforderung" leer={!String(row.anforderung ?? '')}>
                    <TextInput value={String(row.anforderung ?? '')} onChange={(v) => patch(i, { anforderung: v })} />
                  </Feld>
                  <Feld label="EXP/LVL" leer={!exp}>
                    <TextInput value={exp} onChange={(v) => patch(i, { expLevel: v })} />
                  </Feld>
                  <TalentFeld row={row} kampfTalente={kampfTalente} onPatch={(p) => patch(i, p)} />
                  {/* Waffeneigene Boni — was die Waffe zur Probe beisteuert. Die
                      fertige Zahl steht oben im Kopf. */}
                  <Feld label="AT-Bonus" title="Bonus dieser Waffe auf die Attacke" leer={!Number(row.at)}>
                    <NumInput value={Number(row.at) || 0} onChange={(v) => patch(i, { at: v })} />
                  </Feld>
                  <Feld label="PA-Bonus" title="Bonus dieser Waffe auf die Parade" leer={!Number(row.pa)}>
                    <NumInput value={Number(row.pa) || 0} onChange={(v) => patch(i, { pa: v })} />
                  </Feld>
                  <Feld label="BL-Bonus" title="Bonus dieser Waffe auf den Block" leer={!Number(row.bl)}>
                    <NumInput value={Number(row.bl) || 0} onChange={(v) => patch(i, { bl: v })} />
                  </Feld>
                  <Feld label="Besonderes" leer={!String(row.besonderes ?? '')} wide>
                    <TextInput value={String(row.besonderes ?? '')} onChange={(v) => patch(i, { besonderes: v })} />
                  </Feld>
                  <Feld label="Notiz" leer={!notiz} wide>
                    <TextInput value={notiz} onChange={(v) => patch(i, { [NOTIZ_KEY]: v })} />
                  </Feld>
                  {!ro && (
                    <ConfirmDeleteButton className="small chip-del" title="Waffe entfernen" onConfirm={() => removeRow(i)}>
                      🗑 Löschen
                    </ConfirmDeleteButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <EmptyNote what="Nahkampfwaffen" />}
      </div>
      {!ro && (
        <button className="small add-row" onClick={() => onChange([...rows, emptyNahRow()])}>+ Waffe</button>
      )}
    </>
  );
}

function FernCards({
  rows,
  onChange,
  kampfTalente,
  fkProbeFor,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  kampfTalente: TalentCatalogRow[];
  fkProbeFor: (row: Row) => number;
}) {
  const ro = useReadOnly();
  const { isOpen, toggle, dropAt } = useWeaponCards();
  const patch = (i: number, p: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const removeRow = (i: number) => {
    dropAt(i);
    onChange(rows.filter((_, j) => j !== i));
  };
  return (
    <>
      <div className="wpn-list">
        {rows.map((row, i) => {
          const notiz = String(row[NOTIZ_KEY] ?? '');
          const open = isOpen(i);
          return (
            <div className={`wpn-card${open ? ' open' : ''}`} key={i}>
              {/* Kein Beiwerk im Kopf: das Kampftalent steckt schon in der
                  FK-Probe daneben, und eine Stufe gibt es hier nicht. */}
              <CardHead
                name={String(row.typ ?? '')}
                sub=""
                schaden={String(row.schaden ?? '')}
                rd={String(row.rd ?? '')}
                damageRollId={damageRollFor(row)}
                ranged
                notiz={notiz}
                open={open}
                onToggle={() => toggle(i)}
              >
                <ProbeChip label="FK" value={fkProbeFor(row)} title="Fernkampf — fertige Probe" roll={rollFor(row, 'fk')} />
              </CardHead>
              {open && (
                <div className="chip-editor">
                  {/* Nur zum Bearbeiten — im Nur-Lesen steht der Name schon
                      im Kartenkopf und stünde hier ein zweites Mal. */}
                  {!ro && (
                    <Feld label="Waffe/Typ" leer={false}>
                      <TextInput value={String(row.typ ?? '')} onChange={(v) => patch(i, { typ: v })} />
                    </Feld>
                  )}
                  <Feld label="Schaden" leer={!String(row.schaden ?? '')}>
                    <TextInput value={String(row.schaden ?? '')} onChange={(v) => patch(i, { schaden: v })} />
                  </Feld>
                  <Feld label="Material" leer={!String(row.eBE ?? '')}>
                    <TextInput value={String(row.eBE ?? '')} onChange={(v) => patch(i, { eBE: v })} />
                  </Feld>
                  <Feld label="RD" title="Rüstungsdurchdringung" leer={!String(row.rd ?? '')}>
                    <TextInput value={String(row.rd ?? '')} onChange={(v) => patch(i, { rd: v })} />
                  </Feld>
                  <Feld label="Entfernung" leer={!String(row.entfernung ?? '')}>
                    <TextInput value={String(row.entfernung ?? '')} onChange={(v) => patch(i, { entfernung: v })} />
                  </Feld>
                  <Feld label="Haltbarkeit" leer={!String(row.haltbarkeit ?? '')}>
                    <TextInput value={String(row.haltbarkeit ?? '')} onChange={(v) => patch(i, { haltbarkeit: v })} />
                  </Feld>
                  <TalentFeld row={row} kampfTalente={kampfTalente} onPatch={(p) => patch(i, p)} />
                  <Feld label="AT-Mod" title="Modifikator dieser Waffe auf die Fernkampfprobe" leer={!Number(row.atMod)}>
                    <NumInput value={Number(row.atMod) || 0} onChange={(v) => patch(i, { atMod: v })} />
                  </Feld>
                  <Feld label="Besonderes" leer={!String(row.besonderes ?? '')} wide>
                    <TextInput value={String(row.besonderes ?? '')} onChange={(v) => patch(i, { besonderes: v })} />
                  </Feld>
                  <Feld label="Notiz" leer={!notiz} wide>
                    <TextInput value={notiz} onChange={(v) => patch(i, { [NOTIZ_KEY]: v })} />
                  </Feld>
                  {!ro && (
                    <ConfirmDeleteButton className="small chip-del" title="Waffe entfernen" onConfirm={() => removeRow(i)}>
                      🗑 Löschen
                    </ConfirmDeleteButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <EmptyNote what="Fernkampfwaffen" />}
      </div>
      {!ro && (
        <button className="small add-row" onClick={() => onChange([...rows, emptyFernRow()])}>+ Waffe</button>
      )}
    </>
  );
}
