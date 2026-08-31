import { useState } from 'react';
import { computeBaseValues, weaponProbe, weaponProbes } from '@shared/rules';
import { attrsMitBoni, baseInputsMitBoni, talentMitBoni } from '@shared/items';
import type { Item, WaffenStatFeld } from '@shared/items';
import { makeItem, waffenStatWert, waffenStatZahl, waffenStatZeile, waffenStatsFuerArt } from '@shared/items';
import { NOTIZ_KEY, listSectionById } from '@shared/sections';
import type { ColumnDef } from '@shared/sections';
import { CollapseChevron, CollapsiblePanel } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import WeaponDamageRollButton from '../components/dice/WeaponDamageRollButton';
import { ListEditor, NumInput, TextInput } from '../components/inputs';
import type { Row } from '../components/inputs';
import { useDisplayMode, useReadOnly } from '../components/displayMode';
import { useAuth } from '../App';
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
// Weapons become real items (TODO.md): eine Waffe ist seit Kurzem ein ganz
// normales `char_items`-Item mit `waffenArt` gesetzt — dieselbe Liste, die
// Ausrüstung/Inventar zeigen. Diese Karte ist nur noch eine GEFILTERTE SICHT
// auf `data.items` (waffenArt === 'nah'/'fern'), editiert über denselben
// `patch`-Op wie jedes andere Item; ein Haltbarkeits-Update von hier landet
// auf exakt derselben Zeile, die Ausrüstung zeigt, keine Kopie. Die
// eigentlichen Waffenwerte (Schaden, AT/PA/BL, Kampftalent, …) liegen als
// `WaffenStat`-Zeilen in `item.waffenStats` — jede einzeln SL-verdeckbar,
// genau wie eine Item-Bonus-Zeile („Hidden/revealable Ausrüstung stats",
// TODO.md, hier auf jedes Waffenfeld erweitert statt nur RS/Haltbarkeit).
//
// Waffenloser Kampf / Kampfstile / Pfeile-Bolzen (Munition) hängen unten noch
// dran, unverändert mit der generischen `ListEditor`-Tabelle: sie waren nie
// Teil dieser Migration und leben weiter in den alten Listen-Sektionen.
// Munition bekommt mit dem geplanten Nachschlage-Katalog (siehe TODO.md)
// ohnehin eine eigene Lösung; Waffenloser Kampf und Kampfstile warten noch
// auf ihren eigenen Kartenumbau.

export default function WaffenNeuTab() {
  const { data, catalogs, stats, update } = useChar();
  const { user } = useAuth();
  const bv = computeBaseValues(attrsMitBoni(data.attributes, stats), baseInputsMitBoni(data.baseValues, stats));
  const base = { at: bv.at.ergebnis, pa: bv.pa.ergebnis, bl: bv.bl.ergebnis };
  const talents = new Map(data.talents.map((t) => [t.talentId, t]));
  const kampfTalente = catalogs.talents.filter((t) => t.kategorie === 'kampf');
  const nahItems = data.items.filter((it) => it.waffenArt === 'nah');
  const fernItems = data.items.filter((it) => it.waffenArt === 'fern');
  const setItems = (next: Item[]) => update('items', next);

  const probesFor = (item: Item) => {
    const talentId = Number(waffenStatWert(item, 'talentId')) || 0;
    const raw = talents.get(talentId);
    const t = raw ? talentMitBoni(raw, stats) : undefined;
    return weaponProbes(
      { at: waffenStatZahl(item, 'at'), pa: waffenStatZahl(item, 'pa'), bl: waffenStatZahl(item, 'bl') },
      base,
      { at: t?.at ?? 0, pa: t?.pa ?? 0, bl: t?.bl ?? 0 },
    );
  };
  const fkProbeFor = (item: Item) => {
    const talentId = Number(waffenStatWert(item, 'talentId')) || 0;
    const raw = talents.get(talentId);
    const t = raw ? talentMitBoni(raw, stats) : undefined;
    return weaponProbe(waffenStatZahl(item, 'atMod'), bv.fk.ergebnis, t?.at ?? 0);
  };

  return (
    <>
      <p className="muted">
        Basiswerte: AT {base.at} · PA {base.pa} · BL {base.bl} · FK {bv.fk.ergebnis} · INI {bv.ini.ergebnis}
      </p>
      <CollapsiblePanel collapseKey="list:waffenNahNeu" title="Nahkampfwaffen" rows={nahItems.length}>
        <NahCards
          items={nahItems}
          allItems={data.items}
          setItems={setItems}
          kampfTalente={kampfTalente}
          probesFor={probesFor}
          isGm={user.isGm}
        />
      </CollapsiblePanel>
      <CollapsiblePanel collapseKey="list:waffenFernNeu" title="Fernkampfwaffen" rows={fernItems.length}>
        <FernCards
          items={fernItems}
          allItems={data.items}
          setItems={setItems}
          kampfTalente={kampfTalente}
          fkProbeFor={fkProbeFor}
          isGm={user.isGm}
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
 * Talent-Feld). Dieselbe Vorsicht wie bei `TalentSelect` weiter unten: ein
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
 * jemand gerade ansieht — Karten sind über ihre `item.uid` identifizierbar,
 * der Index dient nur der offen/zu-Verwaltung selbst. Beim Löschen rutschen
 * die Indizes nach — `dropAt` zieht den Zustand mit, sonst stünde nach dem
 * Entfernen die falsche Karte offen. Im Druck ist alles offen: auf Papier
 * gibt es kein Aufklappen.
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
 * stehen, damit es befüllbar ist. Für plain Item-Felder (Name, Notiz) ohne
 * Verdeckungs-Mechanik — für Waffen-Stat-Felder siehe `WaffenFeld` unten.
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

/**
 * Ein Waffen-Stat-Feld (siehe WaffenStat in shared/src/items.ts) — wie Feld,
 * aber verdeckungs-bewusst: eine SL sieht den echten Wert plus 🔒-Marker
 * (dieselbe Konvention wie RS/Haltbarkeit auf dem Ausrüstungs-Chip), ein
 * Nicht-SL sieht ausschließlich „???", auch im Bearbeiten-Modus — für sie
 * gibt es strukturell kein Eingabefeld für eine Zeile, die sie serverseitig
 * nie mit echtem Wert zu Gesicht bekommen (siehe ohneVerborgeneItems).
 * `children` ist wie bei Feld die fertige Eingabe (NumInput/TextInput/
 * TalentSelect) — sie bindet an den ROHEN Wert (siehe rawStat in den Karten
 * unten), NIE an den „effektiven" (waffenStatWert liefert für eine verdeckte
 * Zeile immer '', auch der SL — das gilt nur fürs Wirken/die Probe, nicht
 * fürs Bearbeiten).
 */
function WaffenFeld({
  item,
  feld,
  label,
  title,
  wide,
  isGm,
  onReveal,
  children,
}: {
  item: Item;
  feld: WaffenStatFeld;
  label: string;
  title?: string;
  wide?: boolean;
  isGm: boolean;
  onReveal: () => void;
  children: React.ReactNode;
}) {
  const ro = useReadOnly();
  const row = waffenStatZeile(item, feld);
  const verborgen = row?.verborgen ?? false;
  const raw = row?.wert ?? '';
  if (verborgen && !isGm) {
    return (
      <label title="Von der Spielleitung noch nicht aufgedeckt">
        {label}
        <span className="static-value chip-verborgen"> ???</span>
      </label>
    );
  }
  if (ro && !raw) return null;
  return (
    <label className={wide ? 'chip-notiz' : undefined} title={title}>
      {label}
      {verborgen &&
        (ro ? (
          <span className="chip-verborgen" title="Für Spieler noch verborgen"> 🔒</span>
        ) : (
          <ConfirmDeleteButton
            className="small chip-verborgen"
            title="Aufdecken — für Spieler dann sichtbar, keine Rückgängig-Funktion"
            onConfirm={onReveal}
          >
            👁 Aufdecken
          </ConfirmDeleteButton>
        ))}
      {children}
    </label>
  );
}

// Der Server schlägt die Waffe über ihre Item-id nach; ein frisch angelegtes,
// noch nicht gespeichertes Item hat keine — dort bleibt der Würfel-Knopf weg,
// bis gespeichert wurde.
function rollFor(item: Item, probe: 'at' | 'pa' | 'bl' | 'fk') {
  return item.id ? { itemId: item.id, probe } : undefined;
}

// Dieselbe Grund-Bedingung wie rollFor: keine gespeicherte Zeile, kein Würfel-
// Knopf. Zusätzlich ohne Schaden-Text kein Knopf — sonst würfelt man gegen
// eine leere Formel und bekommt nur eine Fehlermeldung. Liest den EFFEKTIVEN
// Wert (waffenStatWert) — eine noch verdeckte Schaden-Formel ist noch nicht
// würfelbar, auch nicht für die SL selbst (siehe WaffenFeld-Kommentar oben).
function damageRollFor(item: Item): number | undefined {
  return item.id && waffenStatWert(item, 'schaden').trim() ? item.id : undefined;
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
  roll?: { itemId: number; probe: 'at' | 'pa' | 'bl' | 'fk' };
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
              <WeaponDamageRollButton itemId={damageRollId} title={`${name || 'Waffe'} — Schaden`} />
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
 * Kampftalent-Auswahl. Das Auswahlfeld gibt es NUR im Bearbeiten-Modus: ein
 * `<select>` läuft nicht durch NumInput/TextInput und bliebe sonst auch auf
 * einem schreibgeschützten Blatt ein bedienbares Klappmenü — man könnte das
 * Talent eines fremden Charakters im Vorbeigehen umstellen. Gelesen wird es
 * als fester Text wie jeder andere Wert auch. Bindet an den ROHEN Wert (über
 * `raw`, von der aufrufenden WaffenFeld-Stelle durchgereicht) — nicht an
 * waffenStatWert, siehe dessen Kommentar.
 */
function TalentSelect({
  raw,
  kampfTalente,
  onChange,
}: {
  raw: string;
  kampfTalente: TalentCatalogRow[];
  onChange: (id: number) => void;
}) {
  const ro = useReadOnly();
  const id = Number(raw) || 0;
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

function EmptyNote({ what }: { what: string }) {
  return <p className="muted collapsed-note">Keine {what}</p>;
}

/** Haltbarkeit-Feld — anders als die Waffen-Stat-Felder ein PLAIN Item-Feld
 * (haltbarkeitMax/haltbarkeitAktuell), mit seiner EIGENEN, schon länger
 * bestehenden Verdeckungs-Mechanik (item.haltbarkeitVerborgen — dieselbe wie
 * auf dem Ausrüstungs-Chip). Dieselbe Zeile wie dort, also dieselbe Regel:
 * ein von Ausrüstung aus verdecktes Item bleibt auch hier verdeckt, keine
 * eigene Kopie des Zustands. */
function HaltbarkeitFeld({ item, isGm, onPatch }: { item: Item; isGm: boolean; onPatch: (patch: Partial<Item>) => void }) {
  const ro = useReadOnly();
  if (ro && item.haltbarkeitMax <= 0 && !item.haltbarkeitVerborgen) return null;
  if (item.haltbarkeitVerborgen && !isGm) {
    return (
      <label title="Von der Spielleitung noch nicht aufgedeckt">
        Haltbarkeit
        <span className="static-value chip-verborgen"> ???</span>
      </label>
    );
  }
  return (
    <label title="Haltbarkeit">
      Haltbarkeit
      {item.haltbarkeitVerborgen && <span className="chip-verborgen" title="Für Spieler noch verborgen"> 🔒</span>}
      <NumInput value={item.haltbarkeitAktuell} min={0} max={item.haltbarkeitMax} onChange={(v) => onPatch({ haltbarkeitAktuell: v })} />
      {' / '}
      <NumInput
        value={item.haltbarkeitMax}
        min={0}
        onChange={(v) => onPatch({ haltbarkeitMax: v, haltbarkeitAktuell: item.haltbarkeitMax === 0 && item.haltbarkeitAktuell === 0 ? v : item.haltbarkeitAktuell })}
      />
    </label>
  );
}

function NahCards({
  items,
  allItems,
  setItems,
  kampfTalente,
  probesFor,
  isGm,
}: {
  items: Item[];
  allItems: Item[];
  setItems: (items: Item[]) => void;
  kampfTalente: TalentCatalogRow[];
  probesFor: (item: Item) => { at: number; pa: number; bl: number };
  isGm: boolean;
}) {
  const ro = useReadOnly();
  const { isOpen, toggle, dropAt } = useWeaponCards();
  const patchItem = (uid: string, patch: Partial<Item>) => setItems(allItems.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));
  const patchStat = (item: Item, feld: WaffenStatFeld, wert: string) =>
    patchItem(item.uid, { waffenStats: item.waffenStats.map((s) => (s.feld === feld ? { ...s, wert } : s)) });
  const revealStat = (item: Item, feld: WaffenStatFeld) =>
    patchItem(item.uid, { waffenStats: item.waffenStats.map((s) => (s.feld === feld ? { ...s, verborgen: false } : s)) });
  const removeItem = (uid: string) => setItems(allItems.filter((it) => it.uid !== uid));
  const addWaffe = () =>
    setItems([...allItems, makeItem({ waffenArt: 'nah', waffenStats: waffenStatsFuerArt('nah').map((s) => ({ ...s, verborgen: isGm })) })]);
  const rawStat = (item: Item, feld: WaffenStatFeld) => waffenStatZeile(item, feld)?.wert ?? '';

  return (
    <>
      <div className="wpn-list">
        {items.map((item, i) => {
          const probes = probesFor(item);
          const notiz = item.notiz;
          const open = isOpen(i);
          const exp = waffenStatWert(item, 'expLevel');
          // Das Kampftalent steht bewusst NICHT im Kopf: es ist bereits in die
          // Proben eingerechnet, die daneben stehen.
          const sub = exp ? `EXP/LVL ${exp}` : '';
          return (
            <div className={`wpn-card${open ? ' open' : ''}`} key={item.uid}>
              <CardHead
                name={item.name}
                sub={sub}
                schaden={waffenStatWert(item, 'schaden')}
                rd={waffenStatWert(item, 'rd')}
                damageRollId={damageRollFor(item)}
                ranged={false}
                notiz={notiz}
                open={open}
                onToggle={() => toggle(i)}
              >
                <ProbeChip label="AT" value={probes.at} title="Attacke — fertige Probe" roll={rollFor(item, 'at')} />
                <ProbeChip label="PA" value={probes.pa} title="Parade — fertige Probe" roll={rollFor(item, 'pa')} />
                <ProbeChip label="BL" value={probes.bl} title="Block — fertige Probe" roll={rollFor(item, 'bl')} />
              </CardHead>
              {open && (
                <div className="chip-editor">
                  {/* Nur zum Bearbeiten — im Nur-Lesen steht der Name schon
                      im Kartenkopf und stünde hier ein zweites Mal. */}
                  {!ro && (
                    <Feld label="Waffe/Typ" leer={false}>
                      <TextInput value={item.name} onChange={(v) => patchItem(item.uid, { name: v })} />
                    </Feld>
                  )}
                  <WaffenFeld item={item} feld="schaden" label="Schaden" isGm={isGm} onReveal={() => revealStat(item, 'schaden')}>
                    <TextInput value={rawStat(item, 'schaden')} onChange={(v) => patchStat(item, 'schaden', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="material" label="Material" isGm={isGm} onReveal={() => revealStat(item, 'material')}>
                    <TextInput value={rawStat(item, 'material')} onChange={(v) => patchStat(item, 'material', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="rd" label="RD" title="Rüstungsdurchdringung" isGm={isGm} onReveal={() => revealStat(item, 'rd')}>
                    <TextInput value={rawStat(item, 'rd')} onChange={(v) => patchStat(item, 'rd', v)} />
                  </WaffenFeld>
                  <HaltbarkeitFeld item={item} isGm={isGm} onPatch={(p) => patchItem(item.uid, p)} />
                  <WaffenFeld item={item} feld="reichweite" label="Reichweite" isGm={isGm} onReveal={() => revealStat(item, 'reichweite')}>
                    <TextInput value={rawStat(item, 'reichweite')} onChange={(v) => patchStat(item, 'reichweite', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="iniBonus" label="Ini-Bonus" isGm={isGm} onReveal={() => revealStat(item, 'iniBonus')}>
                    <NumInput value={Number(rawStat(item, 'iniBonus')) || 0} onChange={(v) => patchStat(item, 'iniBonus', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="anforderung" label="Anforderung" isGm={isGm} onReveal={() => revealStat(item, 'anforderung')}>
                    <TextInput value={rawStat(item, 'anforderung')} onChange={(v) => patchStat(item, 'anforderung', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="expLevel" label="EXP/LVL" isGm={isGm} onReveal={() => revealStat(item, 'expLevel')}>
                    <TextInput value={rawStat(item, 'expLevel')} onChange={(v) => patchStat(item, 'expLevel', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="talentId" label="Kampftalent" isGm={isGm} onReveal={() => revealStat(item, 'talentId')}>
                    <TalentSelect raw={rawStat(item, 'talentId')} kampfTalente={kampfTalente} onChange={(v) => patchStat(item, 'talentId', String(v))} />
                  </WaffenFeld>
                  {/* Waffeneigene Boni — was die Waffe zur Probe beisteuert. Die
                      fertige Zahl steht oben im Kopf. */}
                  <WaffenFeld item={item} feld="at" label="AT-Bonus" title="Bonus dieser Waffe auf die Attacke" isGm={isGm} onReveal={() => revealStat(item, 'at')}>
                    <NumInput value={Number(rawStat(item, 'at')) || 0} onChange={(v) => patchStat(item, 'at', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="pa" label="PA-Bonus" title="Bonus dieser Waffe auf die Parade" isGm={isGm} onReveal={() => revealStat(item, 'pa')}>
                    <NumInput value={Number(rawStat(item, 'pa')) || 0} onChange={(v) => patchStat(item, 'pa', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="bl" label="BL-Bonus" title="Bonus dieser Waffe auf den Block" isGm={isGm} onReveal={() => revealStat(item, 'bl')}>
                    <NumInput value={Number(rawStat(item, 'bl')) || 0} onChange={(v) => patchStat(item, 'bl', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="besonderes" label="Besonderes" isGm={isGm} onReveal={() => revealStat(item, 'besonderes')} wide>
                    <TextInput value={rawStat(item, 'besonderes')} onChange={(v) => patchStat(item, 'besonderes', v)} />
                  </WaffenFeld>
                  <Feld label="Notiz" leer={!notiz} wide>
                    <TextInput value={notiz} onChange={(v) => patchItem(item.uid, { notiz: v })} />
                  </Feld>
                  {!ro && (
                    <ConfirmDeleteButton className="small chip-del" title="Waffe entfernen" onConfirm={() => { dropAt(i); removeItem(item.uid); }}>
                      🗑 Löschen
                    </ConfirmDeleteButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <EmptyNote what="Nahkampfwaffen" />}
      </div>
      {!ro && (
        <button className="small add-row" onClick={addWaffe}>+ Waffe</button>
      )}
    </>
  );
}

function FernCards({
  items,
  allItems,
  setItems,
  kampfTalente,
  fkProbeFor,
  isGm,
}: {
  items: Item[];
  allItems: Item[];
  setItems: (items: Item[]) => void;
  kampfTalente: TalentCatalogRow[];
  fkProbeFor: (item: Item) => number;
  isGm: boolean;
}) {
  const ro = useReadOnly();
  const { isOpen, toggle, dropAt } = useWeaponCards();
  const patchItem = (uid: string, patch: Partial<Item>) => setItems(allItems.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));
  const patchStat = (item: Item, feld: WaffenStatFeld, wert: string) =>
    patchItem(item.uid, { waffenStats: item.waffenStats.map((s) => (s.feld === feld ? { ...s, wert } : s)) });
  const revealStat = (item: Item, feld: WaffenStatFeld) =>
    patchItem(item.uid, { waffenStats: item.waffenStats.map((s) => (s.feld === feld ? { ...s, verborgen: false } : s)) });
  const removeItem = (uid: string) => setItems(allItems.filter((it) => it.uid !== uid));
  const addWaffe = () =>
    setItems([...allItems, makeItem({ waffenArt: 'fern', waffenStats: waffenStatsFuerArt('fern').map((s) => ({ ...s, verborgen: isGm })) })]);
  const rawStat = (item: Item, feld: WaffenStatFeld) => waffenStatZeile(item, feld)?.wert ?? '';

  return (
    <>
      <div className="wpn-list">
        {items.map((item, i) => {
          const notiz = item.notiz;
          const open = isOpen(i);
          return (
            <div className={`wpn-card${open ? ' open' : ''}`} key={item.uid}>
              {/* Kein Beiwerk im Kopf: das Kampftalent steckt schon in der
                  FK-Probe daneben, und eine Stufe gibt es hier nicht. */}
              <CardHead
                name={item.name}
                sub=""
                schaden={waffenStatWert(item, 'schaden')}
                rd={waffenStatWert(item, 'rd')}
                damageRollId={damageRollFor(item)}
                ranged
                notiz={notiz}
                open={open}
                onToggle={() => toggle(i)}
              >
                <ProbeChip label="FK" value={fkProbeFor(item)} title="Fernkampf — fertige Probe" roll={rollFor(item, 'fk')} />
              </CardHead>
              {open && (
                <div className="chip-editor">
                  {/* Nur zum Bearbeiten — im Nur-Lesen steht der Name schon
                      im Kartenkopf und stünde hier ein zweites Mal. */}
                  {!ro && (
                    <Feld label="Waffe/Typ" leer={false}>
                      <TextInput value={item.name} onChange={(v) => patchItem(item.uid, { name: v })} />
                    </Feld>
                  )}
                  <WaffenFeld item={item} feld="schaden" label="Schaden" isGm={isGm} onReveal={() => revealStat(item, 'schaden')}>
                    <TextInput value={rawStat(item, 'schaden')} onChange={(v) => patchStat(item, 'schaden', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="eBE" label="Material" isGm={isGm} onReveal={() => revealStat(item, 'eBE')}>
                    <TextInput value={rawStat(item, 'eBE')} onChange={(v) => patchStat(item, 'eBE', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="rd" label="RD" title="Rüstungsdurchdringung" isGm={isGm} onReveal={() => revealStat(item, 'rd')}>
                    <TextInput value={rawStat(item, 'rd')} onChange={(v) => patchStat(item, 'rd', v)} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="entfernung" label="Entfernung" isGm={isGm} onReveal={() => revealStat(item, 'entfernung')}>
                    <TextInput value={rawStat(item, 'entfernung')} onChange={(v) => patchStat(item, 'entfernung', v)} />
                  </WaffenFeld>
                  <HaltbarkeitFeld item={item} isGm={isGm} onPatch={(p) => patchItem(item.uid, p)} />
                  <WaffenFeld item={item} feld="talentId" label="Kampftalent" isGm={isGm} onReveal={() => revealStat(item, 'talentId')}>
                    <TalentSelect raw={rawStat(item, 'talentId')} kampfTalente={kampfTalente} onChange={(v) => patchStat(item, 'talentId', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="atMod" label="AT-Mod" title="Modifikator dieser Waffe auf die Fernkampfprobe" isGm={isGm} onReveal={() => revealStat(item, 'atMod')}>
                    <NumInput value={Number(rawStat(item, 'atMod')) || 0} onChange={(v) => patchStat(item, 'atMod', String(v))} />
                  </WaffenFeld>
                  <WaffenFeld item={item} feld="besonderes" label="Besonderes" isGm={isGm} onReveal={() => revealStat(item, 'besonderes')} wide>
                    <TextInput value={rawStat(item, 'besonderes')} onChange={(v) => patchStat(item, 'besonderes', v)} />
                  </WaffenFeld>
                  <Feld label="Notiz" leer={!notiz} wide>
                    <TextInput value={notiz} onChange={(v) => patchItem(item.uid, { notiz: v })} />
                  </Feld>
                  {!ro && (
                    <ConfirmDeleteButton className="small chip-del" title="Waffe entfernen" onConfirm={() => { dropAt(i); removeItem(item.uid); }}>
                      🗑 Löschen
                    </ConfirmDeleteButton>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <EmptyNote what="Fernkampfwaffen" />}
      </div>
      {!ro && (
        <button className="small add-row" onClick={addWaffe}>+ Waffe</button>
      )}
    </>
  );
}
