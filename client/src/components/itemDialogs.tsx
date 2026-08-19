import { useState } from 'react';
import type { ContainerArt, Item, KapazitaetArt } from '@shared/items';
import { Dialog } from './Dialog';
import { NumInput } from './inputs';

// Anlegen-Dialoge fürs Inventar: sammeln alle Felder VOR dem Einfügen, statt
// einen leeren Item-Datensatz einzufügen und sofort zu bearbeiten (Item
// creation — fill fields while inserting). Zwei getrennte Dialoge, weil sich
// „Gegenstand" und „Behälter" fürs Anlegen unterschiedlich anfühlen, auch wenn
// beide am Ende ein `Item` sind.

const AUSRUESTUNG_KATEGORIE = 'Ausrüstung';

export function AddItemDialog({
  open,
  onClose,
  categories,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  onAdd: (fields: Partial<Item>) => void;
}) {
  const [mode, setMode] = useState<'allgemein' | 'ausruestung'>('allgemein');
  const [name, setName] = useState('');
  const [kategorie, setKategorie] = useState('');
  const [anzahl, setAnzahl] = useState(1);
  const [gewicht, setGewicht] = useState(0);
  const [rs, setRs] = useState(0);
  const [haltbarkeit, setHaltbarkeit] = useState(0);
  const [quickslots, setQuickslots] = useState(0);
  const [notiz, setNotiz] = useState('');

  const reset = () => {
    setMode('allgemein');
    setName('');
    setKategorie('');
    setAnzahl(1);
    setGewicht(0);
    setRs(0);
    setHaltbarkeit(0);
    setQuickslots(0);
    setNotiz('');
  };
  const close = () => {
    reset();
    onClose();
  };
  const commit = () => {
    if (!name.trim()) return;
    const ausr = mode === 'ausruestung';
    onAdd({
      name: name.trim(),
      kategorie: ausr ? AUSRUESTUNG_KATEGORIE : kategorie,
      anzahl,
      gewicht,
      rs: ausr ? rs : 0,
      // 0 heißt „nicht verfolgt" (siehe haltbarkeitPct) — startet dann bei Max.
      haltbarkeitMax: ausr ? haltbarkeit : 0,
      haltbarkeitAktuell: ausr ? haltbarkeit : 0,
      notiz,
      // Quickslots > 0 macht die Ausrüstung selbst zum Schnellzugriff-Behälter
      // (dieselbe Mechanik wie Gürtel/Bandelier) — ein Feld statt der vollen
      // Behälter-Konfiguration.
      istBehaelter: ausr && quickslots > 0,
      containerArt: 'quick',
      kapazitaetArt: 'stueck',
      kapazitaet: ausr ? quickslots : 0,
    });
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Gegenstand anlegen"
      footer={
        <>
          <button type="button" className="small" onClick={close}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={commit}>
            Gegenstand anlegen
          </button>
        </>
      }
    >
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
              <NumInput value={rs} min={0} onChange={setRs} />
            </label>
            <label className="dlg-field" title="0 = nicht verfolgt, keine %-Anzeige. Sonst startet die Ausrüstung voll.">
              Haltbarkeit
              <NumInput value={haltbarkeit} min={0} onChange={setHaltbarkeit} />
            </label>
          </div>
          <label className="dlg-field">
            Quickslots
            <NumInput value={quickslots} min={0} onChange={setQuickslots} />
          </label>
        </div>
      )}

      <label className="dlg-field">
        Notiz
        <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="optional…" />
      </label>
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
  const [kapazitaet, setKapazitaet] = useState(0);
  const [kapazitaetArt, setKapazitaetArt] = useState<KapazitaetArt>('gewicht');
  const [gewichtsreduktion, setGewichtsreduktion] = useState(0);
  const [notiz, setNotiz] = useState('');

  const reset = () => {
    setName('');
    setContainerArt('storage');
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
          Kapazität
          <NumInput value={kapazitaet} min={0} onChange={setKapazitaet} />
        </label>
        <label className="dlg-field">
          Einheit
          <select value={kapazitaetArt} onChange={(e) => setKapazitaetArt(e.target.value as KapazitaetArt)}>
            <option value="gewicht">kg</option>
            <option value="stueck">Stück</option>
          </select>
        </label>
      </div>

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
