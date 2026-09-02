import { useState } from 'react';
import type { CoinPouch, CurrencySystem } from '@shared/currency';
import { pouchFuellung, pouchUeberfuellt } from '@shared/currency';
import { NumInput, TextInput } from './inputs';
import { useReadOnly } from './displayMode';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';

// Umsortieren per Ziehen, gleiches Prinzip wie reorderItems() in shared/src/
// items.ts, aber Index-basiert statt uid-basiert: Beutel haben, anders als
// Items, keine stabile Kennung, solange sie noch nicht gespeichert sind
// (mehrere neue Beutel tragen alle id 0), also splict das direkt am Index.
function reorderPouches(pouches: CoinPouch[], from: number, to: number): CoinPouch[] {
  if (from === to) return pouches;
  const next = pouches.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Geld (Münz-Umbau): ein Charakter hat null oder mehr benannte Geldbeutel
// (Gürtelbeutel, Bank, …), jeder an ein GM-Katalog-Währungssystem gebunden.
// Kapazität wird HIER direkt gepflegt (nicht über die Ausrüstung) und zählt in
// Münzen — jede Sorte gleich gewichtet, kein Deckel, nur eine Warnfarbe bei
// Überfüllung (siehe pouchUeberfuellt). Kein Gesamtvermögen mehr über Beutel/
// Währungen hinweg — Spieler-Entscheidung, „intercontinental currencies usually
// don't touch".
const MAX_POUCHES = 50;

export function GeldPanel({
  pouches,
  systems,
  setPouches,
  fixed,
}: {
  pouches: CoinPouch[];
  systems: CurrencySystem[];
  setPouches: (next: CoinPouch[]) => void;
  /** Für die Gruppenkasse: genau ein Beutel, kein Hinzufügen/Entfernen — nur
   * Name, Währung, Kapazität und Münzen bleiben bearbeitbar. */
  fixed?: boolean;
}) {
  const readOnly = useReadOnly();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const setPouch = (i: number, patch: Partial<CoinPouch>) => setPouches(pouches.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setCoin = (i: number, denomId: number, anzahl: number) =>
    setPouch(i, { coins: { ...pouches[i].coins, [denomId]: anzahl } });
  const addPouch = () =>
    setPouches([...pouches, { id: 0, name: 'Neuer Beutel', systemId: systems[0]?.id ?? null, kapazitaet: 0, coins: {}, bank: false }]);
  // Der Bank-Beutel ist genau einer und nie löschbar (siehe CoinPouch.bank) —
  // der Löschen-Knopf wird für ihn erst gar nicht angezeigt (PouchCard unten),
  // dies ist nur ein zweiter Riegel.
  const removePouch = (i: number) => setPouches(pouches.filter((_, j) => j !== i || pouches[j].bank));

  return (
    <div className="panel">
      <div className="subhead-row">
        <h3>Geld</h3>
        {!readOnly && !fixed && pouches.length < MAX_POUCHES && (
          <button className="small add-row" onClick={addPouch}>
            + Beutel
          </button>
        )}
      </div>
      {pouches.length === 0 && <p className="muted">Noch kein Geldbeutel angelegt — „+ Beutel" legt den ersten an.</p>}
      {pouches.map((pouch, i) => (
        <PouchCard
          key={pouch.id || `neu-${i}`}
          pouch={pouch}
          systems={systems}
          removable={!fixed}
          draggable={!fixed && pouches.length > 1}
          dropBefore={overIdx === i}
          onDragStart={() => setDragIdx(i)}
          onDragEnd={() => {
            setDragIdx(null);
            setOverIdx(null);
          }}
          onDragOver={() => {
            if (dragIdx !== null && dragIdx !== i) setOverIdx(i);
          }}
          onDrop={() => {
            if (dragIdx !== null && dragIdx !== i) setPouches(reorderPouches(pouches, dragIdx, i));
            setDragIdx(null);
            setOverIdx(null);
          }}
          onChangeName={(v) => setPouch(i, { name: v })}
          onChangeSystem={(systemId) => setPouch(i, { systemId, coins: {} })}
          onChangeKapazitaet={(v) => setPouch(i, { kapazitaet: v })}
          onChangeCoin={(denomId, v) => setCoin(i, denomId, v)}
          onRemove={() => removePouch(i)}
        />
      ))}
    </div>
  );
}

function PouchCard({
  pouch,
  systems,
  removable,
  draggable,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onChangeName,
  onChangeSystem,
  onChangeKapazitaet,
  onChangeCoin,
  onRemove,
}: {
  pouch: CoinPouch;
  systems: CurrencySystem[];
  /** false für die Gruppenkasse (fixed) — dort gibt es nur den einen Beutel. */
  removable: boolean;
  /** false für die Gruppenkasse oder eine einzelne Karte — Ziehen ist erst mit
   * mindestens zwei Beuteln sinnvoll. */
  draggable: boolean;
  /** Markiert die Karte als Ziel, wenn ein anderer Beutel gerade über sie gezogen wird. */
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onChangeName: (v: string) => void;
  onChangeSystem: (systemId: number | null) => void;
  onChangeKapazitaet: (v: number) => void;
  onChangeCoin: (denomId: number, v: number) => void;
  onRemove: () => void;
}) {
  const readOnly = useReadOnly();
  const system = systems.find((s) => s.id === pouch.systemId) ?? null;
  const fuellung = pouchFuellung(pouch);
  const over = pouchUeberfuellt(pouch);

  return (
    <div
      className={`pouch${dropBefore ? ' pouch-drop-before' : ''}`}
      onDragOver={(e) => {
        if (readOnly || !draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver();
      }}
      onDrop={(e) => {
        if (readOnly || !draggable) return;
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="pouch-head">
        {!readOnly && draggable && (
          <span
            className="pouch-drag-handle"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Ziehen zum Umsortieren"
            aria-hidden
          >
            ⠿
          </span>
        )}
        <span className="pouch-name">
          {pouch.bank ? (
            <span className="static-value static-text pouch-bank-name" title="Der Bank-Beutel ist immer da, unbegrenzt und nicht löschbar.">
              Bank
            </span>
          ) : (
            <TextInput value={pouch.name} onChange={onChangeName} />
          )}
        </span>
        <span className="pouch-system">
          <CurrencySystemSelect systemId={pouch.systemId} systems={systems} onChange={onChangeSystem} />
        </span>
        {!readOnly && !pouch.bank && removable && <ConfirmDeleteButton title="Geldbeutel entfernen" onConfirm={onRemove} />}
      </div>
      <div className="container-cap-edit">
        <span className={`container-cap${over ? ' over' : ''}`} title="Münzen im Beutel / Kapazität (0 = unbegrenzt)">
          {fuellung} / {pouch.bank || pouch.kapazitaet <= 0 ? '∞' : pouch.kapazitaet} Münzen
        </span>
        {!readOnly && !pouch.bank && (
          <>
            <label>Kapazität</label>
            <NumInput value={pouch.kapazitaet} min={0} onChange={onChangeKapazitaet} />
          </>
        )}
      </div>
      {!system ? (
        <p className="muted">Kein Währungssystem gewählt.</p>
      ) : (
        <div className="coins">
          {system.denominations.map((d) => (
            <div className="coin" key={d.id}>
              <span className="coin-disc" aria-hidden />
              <label>{d.name}</label>
              <NumInput value={pouch.coins[d.id] ?? 0} min={0} onChange={(v) => onChangeCoin(d.id, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Ein `<select>` läuft nicht durch NumInput/TextInput und bliebe ungegated auch
// auf einem schreibgeschützten Blatt bedienbar (gleiche Begründung wie
// RaceSelect in Heldenbrief.tsx) — im Nur-Lesen-Modus daher nur Text.
function CurrencySystemSelect({
  systemId,
  systems,
  onChange,
}: {
  systemId: number | null;
  systems: CurrencySystem[];
  onChange: (systemId: number | null) => void;
}) {
  const readOnly = useReadOnly();
  const current = systems.find((s) => s.id === systemId) ?? null;

  if (readOnly) {
    return <span className="static-value static-text">{current?.name ?? ''}</span>;
  }

  return (
    <select value={systemId ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">— kein System —</option>
      {systems.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
