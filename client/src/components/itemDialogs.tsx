import { useEffect, useState } from 'react';
import type { ContainerArt, Item, ItemBonus, ItemBonusKind, KapazitaetArt, TalentBonusFeld } from '@shared/items';
import { makeUid } from '@shared/items';
import { ATTR_CODES, ATTR_LABELS, BASE_VALUE_KEYS, BASE_VALUE_LABELS, RESOURCE_KEYS, RESOURCE_LABELS } from '@shared/types';
import type { SpecialEnergyCatalogRow, TalentCatalogRow } from './charSheet';
import { AlwaysEditable } from './displayMode';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';
import { NumInput } from './inputs';

// Anlegen-/Bearbeiten-Dialoge fürs Inventar: sammeln alle Felder VOR dem
// Einfügen bzw. Patchen, statt einen leeren Item-Datensatz einzufügen und
// sofort zu bearbeiten (Item creation — fill fields while inserting). Zwei
// getrennte Dialoge, weil sich „Gegenstand" und „Behälter" fürs Anlegen
// unterschiedlich anfühlen, auch wenn beide am Ende ein `Item` sind.
// AddItemDialog ist bewusst BEIDES (anlegen UND bearbeiten) — siehe die
// `item`-Prop unten; AddContainerDialog bleibt reine Anlage, ein bestehender
// Behälter wird über AddItemDialog (mit `item` gesetzt) oder die Inline-Felder
// im Chip-Editor angefasst.

const AUSRUESTUNG_KATEGORIE = 'Ausrüstung';
// Client-seitiges Gegenstück zu MAX_BONUSSE_PRO_ITEM in
// server/src/characterData.ts — reine UX-Bremse (der Server deckelt ohnehin),
// verhindert nur, dass jemand über den „+ Bonus"-Knopf Zeilen anlegt, die beim
// Speichern klanglos verworfen würden.
const MAX_BONUSSE_PRO_ITEM = 20;

// Ziel+Code eines Bonus als EIN <select>-Wert kodiert (siehe ItemBonus in
// shared/src/items.ts): "attr:MU", "baseValue:at", "resource:le",
// "talent:42", "spezial:7", "psyche:", "traglast:". code ist bei
// psyche/traglast leer, daher reicht ein Split am ERSTEN ':' — talentId/
// catalogId sind reine Ziffern, enthalten selbst nie einen Doppelpunkt.
function bonusOptionValue(kind: ItemBonusKind, code: string): string {
  return `${kind}:${code}`;
}
function parseBonusOptionValue(value: string): { kind: ItemBonusKind; code: string } {
  const i = value.indexOf(':');
  return { kind: value.slice(0, i) as ItemBonusKind, code: value.slice(i + 1) };
}

function BonusRowsEditor({
  bonusse,
  onChange,
  talents,
  specialEnergies,
  isGm,
}: {
  bonusse: ItemBonus[];
  onChange: (next: ItemBonus[]) => void;
  talents: TalentCatalogRow[];
  specialEnergies: SpecialEnergyCatalogRow[];
  /** Hidden/revealable Ausrüstung stats (TODO.md): nur die SL kann Bonus-Zeilen
   * verborgen anlegen/aufdecken — Spieler sehen weder Umschalter noch verdeckte
   * Zeilen (die kommen serverseitig nie in `bonusse` an, siehe ohneVerborgeneItems). */
  isGm: boolean;
}) {
  // Spezialenergien ohne Formel haben kein Bonus-Feld, das ein Item-Bonus
  // treffen könnte (siehe SpecialResource) — würden hier gelistet, liefe der
  // Bonus ins Leere. Aus der Auswahl fernhalten, statt eine tote Option
  // anzubieten.
  const formelSpezialEnergien = specialEnergies.filter((e) => e.formula.trim());
  const patchRow = (i: number, patch: Partial<ItemBonus>) => onChange(bonusse.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  // Kampftalente führen TaW/AT/PA/BL als vier UNABHÄNGIGE Werte (siehe
  // Talente.tsx KampfTable) — es gibt nirgends eine Formel, die TaW in
  // AT/PA/BL umrechnet. Ein TaW-Bonus auf ein Kampftalent würde also nur die
  // Anzeige/Meisterschaftsschwelle heben, nie eine Probe — deshalb fällt die
  // Option dort weg; AT/PA/BL bleiben die Ziele, die eine Kampfprobe wirklich
  // treffen.
  const istKampftalent = (talentId: string): boolean =>
    talents.find((t) => String(t.id) === talentId)?.kategorie === 'kampf';

  return (
    <div className="dlg-fade-group">
      <div className="dlg-group-label" title="Wirkt nur, solange der Gegenstand getragen wird (Ausrüstung, Körperzone).">
        Boni beim Tragen
      </div>
      <div className="cat-editor">
        {bonusse.map((b, i) => (
          <div className="cat-row bonus-row" key={b.uid}>
            {isGm && b.verborgen && (
              <ConfirmDeleteButton
                title="Bonus aufdecken — einseitig, keine Rückgängig-Funktion"
                className="small"
                onConfirm={() => patchRow(i, { verborgen: false })}
              >
                👁 Aufdecken
              </ConfirmDeleteButton>
            )}
            <select
              value={bonusOptionValue(b.kind, b.code)}
              onChange={(e) => {
                const { kind, code } = parseBonusOptionValue(e.target.value);
                const feld = kind === 'talent' ? (istKampftalent(code) ? 'at' : 'taw') : '';
                patchRow(i, { kind, code, feld });
              }}
            >
              <optgroup label="Attribut">
                {ATTR_CODES.map((code) => (
                  <option key={code} value={bonusOptionValue('attr', code)}>
                    {ATTR_LABELS[code]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Basiswert">
                {BASE_VALUE_KEYS.map((key) => (
                  <option key={key} value={bonusOptionValue('baseValue', key)}>
                    {BASE_VALUE_LABELS[key].label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Energie">
                {RESOURCE_KEYS.map((key) => (
                  <option key={key} value={bonusOptionValue('resource', key)}>
                    {RESOURCE_LABELS[key].label}
                  </option>
                ))}
              </optgroup>
              {formelSpezialEnergien.length > 0 && (
                <optgroup label="Spezialenergie">
                  {formelSpezialEnergien.map((e) => (
                    <option key={e.id} value={bonusOptionValue('spezial', String(e.id))}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {talents.length > 0 && (
                <optgroup label="Talent">
                  {talents.map((t) => (
                    <option key={t.id} value={bonusOptionValue('talent', String(t.id))}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Sonstiges">
                <option value={bonusOptionValue('psyche', '')}>Psyche</option>
                <option value={bonusOptionValue('traglast', '')}>Traglast (kg)</option>
              </optgroup>
            </select>
            {b.kind === 'talent' && (
              <select value={b.feld} onChange={(e) => patchRow(i, { feld: e.target.value as TalentBonusFeld })}>
                {istKampftalent(b.code) ? (
                  <>
                    <option value="at">AT</option>
                    <option value="pa">PA</option>
                    <option value="bl">BL</option>
                  </>
                ) : (
                  <>
                    <option value="taw" title="Hebt den Talentwert selbst an — wirkt auf die Probe nur grob (alle 5 TaW +1).">
                      TaW
                    </option>
                    <option value="probe" title="Direkte Erschwernis/Erleichterung auf die Probe-Zahl, unabhängig vom TaW.">
                      Probe
                    </option>
                  </>
                )}
              </select>
            )}
            <NumInput value={b.wert} onChange={(v) => patchRow(i, { wert: v })} />
            <ConfirmDeleteButton title="Bonus entfernen" onConfirm={() => onChange(bonusse.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button
          type="button"
          className="small"
          disabled={bonusse.length >= MAX_BONUSSE_PRO_ITEM}
          onClick={() => onChange([...bonusse, { uid: makeUid(), kind: 'attr', code: 'MU', feld: '', wert: 0, verborgen: isGm }])}
        >
          + Bonus
        </button>
      </div>
    </div>
  );
}

export function AddItemDialog({
  open,
  onClose,
  categories,
  initialMode = 'allgemein',
  item,
  talents,
  specialEnergies,
  isGm,
  onAdd,
  onSave,
  onDuplicate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  initialMode?: 'allgemein' | 'ausruestung';
  /** Gesetzt → Bearbeiten-Modus für ein bestehendes Item statt Anlegen. */
  item?: Item;
  talents: TalentCatalogRow[];
  specialEnergies: SpecialEnergyCatalogRow[];
  /** Hidden/revealable Ausrüstung stats (TODO.md): nur die SL bekommt den
   * Verborgen-Zustand/Aufdecken-Knopf zu sehen. Von der SL neu angelegte
   * RS/Haltbarkeit/Bonus-Zeilen starten verdeckt (kein Verstecken-Knopf nötig —
   * es gibt keinen Weg zurück außer Aufdecken). */
  isGm: boolean;
  /** Anlegen-Modus (kein `item`). */
  onAdd?: (fields: Partial<Item>) => void;
  /** Bearbeiten-Modus (`item` gesetzt) — nur die tatsächlich geänderten Felder. */
  onSave?: (patch: Partial<Item>) => void;
  /** Bearbeiten-Modus: Duplizieren-Knopf im Fuß, falls gesetzt. */
  onDuplicate?: () => void;
  /** Bearbeiten-Modus: Löschen-Knopf im Fuß, falls gesetzt. */
  onDelete?: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [kategorie, setKategorie] = useState('');
  const [anzahl, setAnzahl] = useState(1);
  const [gewicht, setGewicht] = useState(0);
  const [rs, setRs] = useState(0);
  const [rsVerborgen, setRsVerborgen] = useState(false);
  const [haltbarkeitMax, setHaltbarkeitMax] = useState(0);
  const [haltbarkeitAktuell, setHaltbarkeitAktuell] = useState(0);
  const [haltbarkeitVerborgen, setHaltbarkeitVerborgen] = useState(false);
  const [quickslots, setQuickslots] = useState(0);
  const [notiz, setNotiz] = useState('');
  const [bonusse, setBonusse] = useState<ItemBonus[]>([]);

  // Beim Öffnen (neu) seeden statt bei reset() beim Schließen — AddItemDialog
  // selbst bleibt gemountet, während Dialog.tsx nur sein eigenes DOM ab- und
  // aufbaut (if (!open) return null), siehe NeueSeiteDialog.tsx fürs gleiche
  // Muster. `item?.uid` als Abhängigkeit: ein Wechsel des Bearbeiten-Ziels
  // (anderes Item, Dialog bleibt offen) seedet neu, ohne dass open selbst
  // wechseln müsste.
  useEffect(() => {
    if (!open) return;
    if (item) {
      setMode(item.kategorie === AUSRUESTUNG_KATEGORIE ? 'ausruestung' : 'allgemein');
      setName(item.name);
      setKategorie(item.kategorie);
      setAnzahl(item.anzahl);
      setGewicht(item.gewicht);
      setRs(item.rs);
      setRsVerborgen(item.rsVerborgen);
      setHaltbarkeitMax(item.haltbarkeitMax);
      setHaltbarkeitAktuell(item.haltbarkeitAktuell);
      setHaltbarkeitVerborgen(item.haltbarkeitVerborgen);
      setQuickslots(item.istBehaelter && item.containerArt === 'quick' ? item.kapazitaet : 0);
      setNotiz(item.notiz);
      setBonusse(item.bonusse);
    } else {
      setMode(initialMode);
      setName('');
      setKategorie('');
      setAnzahl(1);
      setGewicht(0);
      setRs(0);
      // Hidden/revealable Ausrüstung stats (TODO.md): von der SL neu angelegte
      // Ausrüstung startet verdeckt — es gibt keinen Verstecken-Knopf, das ist
      // der einzige Zeitpunkt, an dem der Zustand entsteht. Spieler legen nie
      // etwas Verdecktes an.
      setRsVerborgen(isGm);
      setHaltbarkeitMax(0);
      setHaltbarkeitAktuell(0);
      setHaltbarkeitVerborgen(isGm);
      setQuickslots(0);
      setNotiz('');
      setBonusse([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.uid, initialMode]);

  const close = () => onClose();

  // Ein Item, das schon ein Stauraum-Behälter ist (containerArt === 'storage',
  // z. B. ein per AddContainerDialog angelegter Rucksack), fasst dieser Dialog
  // beim Bearbeiten NICHT an seiner Behälter-Konfiguration an — das Quickslots-
  // Feld unten ist nur die kompakte Schreibweise für „Ausrüstung mit
  // Schnellzugriffs-Fächern" (Gürtel, Bandelier), keine allgemeine Behälter-
  // Bearbeitung. Ohne diese Sperre würde commit() unten containerArt/
  // kapazitaetArt/istBehaelter blind auf die Quickslot-Form umschreiben und
  // einen Stauraum-Rucksack in einen Schnellzugriffs-Behälter verwandeln.
  const isStorageContainer = !!item?.istBehaelter && item.containerArt === 'storage';

  const commit = () => {
    if (!name.trim()) return;
    const ausr = mode === 'ausruestung';
    const patch: Partial<Item> = {
      name: name.trim(),
      kategorie: ausr ? AUSRUESTUNG_KATEGORIE : kategorie,
      anzahl,
      gewicht,
      notiz,
      bonusse,
    };
    // RS/Haltbarkeit/Quickslots-Behälter nur einbeziehen, wenn ihr Feld auch
    // sichtbar war (ausr) — sonst würde das Umschalten auf „Allgemein" beim
    // Bearbeiten eines Items, dessen Kategorie einmal von „Ausrüstung" weg
    // geändert wurde (z. B. durch Umkategorisieren per Ziehen im Inventar-
    // Reiter), dessen RS/Haltbarkeit/Behälter-Status stillschweigend auf 0
    // zurücksetzen, obwohl niemand diese Felder je zu Gesicht bekam. Beim
    // Anlegen macht das Weglassen keinen Unterschied: makeItem() setzt
    // ohnehin dieselben Nullwerte für alles, was `fields` nicht mitbringt.
    if (ausr) {
      patch.rs = rs;
      patch.rsVerborgen = rsVerborgen;
      patch.haltbarkeitMax = haltbarkeitMax;
      patch.haltbarkeitAktuell = haltbarkeitAktuell;
      patch.haltbarkeitVerborgen = haltbarkeitVerborgen;
      if (!isStorageContainer) {
        // Quickslots > 0 macht die Ausrüstung selbst zum Schnellzugriff-
        // Behälter (dieselbe Mechanik wie Gürtel/Bandelier) — ein Feld statt
        // der vollen Behälter-Konfiguration.
        patch.istBehaelter = quickslots > 0;
        patch.containerArt = 'quick';
        patch.kapazitaetArt = 'stueck';
        patch.kapazitaet = quickslots;
      }
    }
    if (item) onSave?.(patch);
    else onAdd?.(patch);
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={item ? 'Gegenstand bearbeiten' : 'Gegenstand anlegen'}
      wide
      footer={
        <>
          {item && (onDuplicate || onDelete) && (
            <span className="dlg-foot-left">
              {onDuplicate && (
                <button
                  type="button"
                  className="small"
                  title="Duplizieren — legt eine exakte Kopie daneben an"
                  onClick={() => {
                    onDuplicate();
                    close();
                  }}
                >
                  ⧉ Duplizieren
                </button>
              )}
              {onDelete && (
                <ConfirmDeleteButton
                  title="Gegenstand entfernen"
                  onConfirm={() => {
                    onDelete();
                    close();
                  }}
                >
                  🗑 Löschen
                </ConfirmDeleteButton>
              )}
            </span>
          )}
          <button type="button" className="small" onClick={close}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={commit}>
            {item ? 'Speichern' : 'Gegenstand anlegen'}
          </button>
        </>
      }
    >
      {/* Bleibt bearbeitbar unabhängig vom Blatt-Anzeigemodus — Duplizieren/
          Löschen im Fuß oben laufen schon unbedingt, die Feldwerte hier sollen
          es genauso (siehe TODO.md, "AddItemDialog's fields should stay
          editable in read-only mode"). */}
      <AlwaysEditable>
        <div className="dlg-seg">
          <button type="button" className={mode === 'allgemein' ? 'active' : ''} onClick={() => setMode('allgemein')}>
            Allgemein
          </button>
          <button type="button" className={mode === 'ausruestung' ? 'active' : ''} onClick={() => setMode('ausruestung')}>
            Ausrüstung
          </button>
        </div>

        <label className="dlg-field">
          Name
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>

        <div className="dlg-row2">
          <label className="dlg-field">
            Anzahl
            <NumInput value={anzahl} min={0} onChange={setAnzahl} />
          </label>
          <label className="dlg-field">
            Gewicht (kg/St.)
            <NumInput value={gewicht} min={0} onChange={setGewicht} />
          </label>
        </div>

        {mode === 'allgemein' ? (
          <label className="dlg-field">
            Kategorie
            <select value={kategorie} onChange={(e) => setKategorie(e.target.value)}>
              <option value="">— ohne Kategorie —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="dlg-field">
            Kategorie
            <div className="dlg-locked">
              <span className="dlg-badge">{AUSRUESTUNG_KATEGORIE}</span> fest vorgegeben
            </div>
          </div>
        )}

        {mode === 'ausruestung' && (
          <div className="dlg-fade-group">
            <div className="dlg-group-label">Nur für Ausrüstung</div>
            <div className="dlg-row2">
              <label className="dlg-field">
                RS
                {!isGm && rsVerborgen ? (
                  <span className="dlg-locked" title="Von der Spielleitung noch nicht aufgedeckt">
                    ???
                  </span>
                ) : (
                  <NumInput value={rs} min={0} onChange={setRs} />
                )}
                {isGm && rsVerborgen && (
                  <ConfirmDeleteButton
                    title="RS aufdecken — einseitig, keine Rückgängig-Funktion"
                    className="small"
                    onConfirm={() => setRsVerborgen(false)}
                  >
                    👁 Aufdecken
                  </ConfirmDeleteButton>
                )}
              </label>
              <label className="dlg-field" title="0 = nicht verfolgt, keine %-Anzeige. Sonst startet die Ausrüstung voll.">
                Haltbarkeit
                {!isGm && haltbarkeitVerborgen ? (
                  <span className="dlg-locked" title="Von der Spielleitung noch nicht aufgedeckt">
                    ???
                  </span>
                ) : (
                <div className="dlg-row2">
                  <NumInput
                    value={haltbarkeitAktuell}
                    min={0}
                    max={haltbarkeitMax}
                    onChange={setHaltbarkeitAktuell}
                  />
                  <NumInput
                    value={haltbarkeitMax}
                    min={0}
                    onChange={(v) => {
                      // Neu eingeschaltet (war 0/0) → auf voll starten, statt
                      // sofort bei 0 % (dieselbe Regel wie im Chip-Editor).
                      setHaltbarkeitMax(v);
                      if (haltbarkeitMax === 0 && haltbarkeitAktuell === 0) setHaltbarkeitAktuell(v);
                    }}
                  />
                </div>
                )}
                {isGm && haltbarkeitVerborgen && (
                  <ConfirmDeleteButton
                    title="Haltbarkeit aufdecken — einseitig, keine Rückgängig-Funktion"
                    className="small"
                    onConfirm={() => setHaltbarkeitVerborgen(false)}
                  >
                    👁 Aufdecken
                  </ConfirmDeleteButton>
                )}
              </label>
            </div>
            {!isStorageContainer && (
              <label className="dlg-field">
                Quickslots
                <NumInput value={quickslots} min={0} onChange={setQuickslots} />
              </label>
            )}
          </div>
        )}

        <label className="dlg-field">
          Notiz
          <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="optional…" />
        </label>

        <BonusRowsEditor bonusse={bonusse} onChange={setBonusse} talents={talents} specialEnergies={specialEnergies} isGm={isGm} />
      </AlwaysEditable>
    </Dialog>
  );
}

export function AddContainerDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (fields: Partial<Item>) => void;
}) {
  const [name, setName] = useState('');
  const [containerArt, setContainerArt] = useState<ContainerArt>('storage');
  const [gewicht, setGewicht] = useState(0);
  const [kapazitaet, setKapazitaet] = useState(0);
  const [kapazitaetArt, setKapazitaetArt] = useState<KapazitaetArt>('gewicht');
  const [gewichtsreduktion, setGewichtsreduktion] = useState(0);
  const [notiz, setNotiz] = useState('');

  const reset = () => {
    setName('');
    setContainerArt('storage');
    setGewicht(0);
    setKapazitaet(0);
    setKapazitaetArt('gewicht');
    setGewichtsreduktion(0);
    setNotiz('');
  };
  const close = () => {
    reset();
    onClose();
  };
  const commit = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      istBehaelter: true,
      containerArt,
      gewicht,
      kapazitaet,
      kapazitaetArt,
      gewichtsreduktion: kapazitaetArt === 'stueck' ? 0 : gewichtsreduktion,
      notiz,
    });
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Behälter anlegen"
      footer={
        <>
          <button type="button" className="small" onClick={close}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={commit}>
            Behälter anlegen
          </button>
        </>
      }
    >
      <label className="dlg-field">
        Name
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </label>

      <label className="dlg-field">
        Art
        <select value={containerArt} onChange={(e) => setContainerArt(e.target.value as ContainerArt)}>
          <option value="storage">Stauraum (Inhalt im Inventar-Reiter)</option>
          <option value="quick">Schnellzugriff (Inhalt inline in der Ausrüstung)</option>
        </select>
      </label>

      <div className="dlg-row2">
        <label className="dlg-field">
          Eigengewicht (kg)
          <NumInput value={gewicht} min={0} onChange={setGewicht} />
        </label>
        <label className="dlg-field">
          Kapazität
          <NumInput value={kapazitaet} min={0} onChange={setKapazitaet} />
        </label>
      </div>

      <label className="dlg-field">
        Einheit
        <select value={kapazitaetArt} onChange={(e) => setKapazitaetArt(e.target.value as KapazitaetArt)}>
          <option value="gewicht">kg</option>
          <option value="stueck">Stück</option>
        </select>
      </label>

      {kapazitaetArt !== 'stueck' && (
        <label className="dlg-field">
          Gewichtsreduktion (%)
          <NumInput value={gewichtsreduktion} min={0} max={100} onChange={setGewichtsreduktion} />
        </label>
      )}

      <label className="dlg-field">
        Notiz
        <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="optional…" />
      </label>
    </Dialog>
  );
}
