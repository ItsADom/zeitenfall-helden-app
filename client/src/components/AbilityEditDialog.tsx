import { useEffect, useState } from 'react';
import type { Ability } from '@shared/abilities';
import { ABILITY_GRADE_MAX, ABILITY_STUFE_MAX, abilityGrade, abilityGradeLabel, makeAbilityUid } from '@shared/abilities';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';
import { FavPin } from './FavPin';

const num = (v: string): number => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

// Strukturierte Bearbeitung für „Zauber & Fähigkeiten verwalten" — ersetzt
// das frühere Inline-/Aufklapp-Bearbeiten direkt in der Zeile (TODO.md
// „Editing dialog for abilities"), nach demselben Muster wie AddItemDialog:
// EIN Dialog für Anlegen (kein `ability`) und Bearbeiten (`ability` gesetzt),
// flach statt als Assistent — der Feldsatz ist, anders als bei Gegenständen,
// schon einheitlich genug für einen einzigen Bildschirm. Fortschritt und
// Würfel-Favorit bleiben bewusst NUR im Reiter editierbar (AbilityTable.tsx);
// hier geht es um die strukturellen Angaben, die selten wechseln.
export function AbilityEditDialog({
  open,
  onClose,
  ability,
  magisch,
  abilities,
  elements,
  kategorien,
  onSave,
  onAdd,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  /** Vorhandene Fähigkeit = Bearbeiten; fehlt sie, wird angelegt. */
  ability?: Ability;
  /** Nur beim Anlegen relevant (Bearbeiten übernimmt ability.magisch). */
  magisch: boolean;
  /** Gesamtbestand (beide Reiter) — für den „Aufgewertet von"-Picker und die Grad-Anzeige. */
  abilities: Ability[];
  elements: string[];
  kategorien: string[];
  onSave?: (patch: Partial<Ability>) => void;
  onAdd?: (a: Ability) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState('');
  const [element, setElement] = useState('');
  const [kategorienVal, setKategorienVal] = useState<string[]>([]);
  const [kategorienText, setKategorienText] = useState('');
  const [stufe, setStufe] = useState(0);
  const [komplexitaet, setKomplexitaet] = useState(0);
  const [kosten, setKosten] = useState('');
  const [probe, setProbe] = useState('');
  const [effekt, setEffekt] = useState('');
  const [notiz, setNotiz] = useState('');
  const [passiv, setPassiv] = useState(false);
  const [signatur, setSignatur] = useState(false);
  const [favorit, setFavorit] = useState(false);
  const [derivedFrom, setDerivedFrom] = useState('');

  const isMagisch = ability?.magisch ?? magisch;

  useEffect(() => {
    if (!open) return;
    if (ability) {
      setName(ability.name);
      setElement(ability.element);
      setKategorienVal(ability.kategorien);
      setKategorienText(ability.kategorien.join(', '));
      setStufe(ability.stufe);
      setKomplexitaet(ability.komplexitaet);
      setKosten(ability.kosten);
      setProbe(ability.probe);
      setEffekt(ability.effekt);
      setNotiz(ability.notiz);
      setPassiv(ability.passiv);
      setSignatur(ability.signatur);
      setFavorit(ability.favorit);
      setDerivedFrom(ability.derivedFrom);
    } else {
      setName('');
      setElement('');
      setKategorienVal([]);
      setKategorienText('');
      setStufe(magisch ? 1 : 0);
      setKomplexitaet(magisch ? 1 : 0);
      setKosten('');
      setProbe('');
      setEffekt('');
      setNotiz('');
      setPassiv(false);
      setSignatur(false);
      setFavorit(false);
      setDerivedFrom('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ability?.uid, magisch]);

  const byUid = new Map(abilities.map((a) => [a.uid, a]));

  // Würde `candidateUid` als derivedFrom für die gerade bearbeitete Fähigkeit
  // einen Zyklus schließen? Läuft die Kette AB dem Kandidaten hoch und prüft,
  // ob sie auf die eigene uid trifft — nur beim Bearbeiten relevant, ein neuer
  // Eintrag hat noch keine uid, auf die irgendwas zurückverweisen könnte.
  const wouldCycle = (candidateUid: string): boolean => {
    if (!ability) return false;
    let cur: string | undefined = candidateUid;
    const seen = new Set<string>();
    while (cur) {
      if (cur === ability.uid) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = byUid.get(cur)?.derivedFrom || undefined;
    }
    return false;
  };
  // Nur derselbe magisch-Wert (Zauber leitet sich nur von Zauber ab, Fähigkeit
  // nur von Fähigkeit), nicht sich selbst, kein Grad-3-Kandidat (eine weitere
  // Aufwertung säße über ABILITY_GRADE_MAX) und kein Zyklus.
  const derivedOptions = abilities.filter(
    (a) => a.magisch === isMagisch && a.uid !== ability?.uid && abilityGrade(a, byUid) < ABILITY_GRADE_MAX && !wouldCycle(a.uid),
  );
  const grade = ability ? abilityGrade(ability, byUid) : 1;

  const close = () => onClose();

  const commit = () => {
    if (!name.trim()) return;
    const patch: Partial<Ability> = {
      name: name.trim(),
      element: isMagisch ? element : '',
      kategorien: kategorienVal,
      stufe,
      komplexitaet: isMagisch ? komplexitaet : 0,
      kosten,
      probe,
      effekt,
      notiz,
      passiv,
      signatur: isMagisch ? signatur : false,
      favorit,
      derivedFrom,
    };
    if (ability) onSave?.(patch);
    else
      onAdd?.({
        id: 0,
        uid: makeAbilityUid(),
        magisch: isMagisch,
        fortschritt: 0,
        ...patch,
      } as Ability);
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={ability ? `${isMagisch ? 'Zauber' : 'Fähigkeit'} bearbeiten` : `${isMagisch ? 'Zauber' : 'Fähigkeit'} anlegen`}
      footer={
        <>
          {ability && onDelete && (
            <span className="dlg-foot-left">
              <ConfirmDeleteButton
                title="Entfernen"
                onConfirm={() => {
                  onDelete();
                  close();
                }}
              >
                🗑 Löschen
              </ConfirmDeleteButton>
            </span>
          )}
          <button type="button" className="small" onClick={close}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={commit}>
            {ability ? 'Speichern' : isMagisch ? 'Zauber anlegen' : 'Fähigkeit anlegen'}
          </button>
        </>
      }
    >
      <label className="dlg-field">
        Name
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      </label>

      <div className="dlg-row2">
        <label className="dlg-field">
          Stufe {ability && grade > 1 && <span className="muted">· {abilityGradeLabel(grade)}</span>}
          <input
            type="number"
            min={0}
            max={ABILITY_STUFE_MAX}
            value={stufe}
            onChange={(e) => setStufe(Math.min(ABILITY_STUFE_MAX, num(e.target.value)))}
          />
        </label>
        {isMagisch && (
          <label className="dlg-field">
            Komplexität
            <input type="number" min={0} value={komplexitaet} onChange={(e) => setKomplexitaet(num(e.target.value))} />
          </label>
        )}
      </div>

      {isMagisch && (
        <label className="dlg-field">
          Element
          <input list="abil-dlg-elemente" value={element} placeholder="— ohne —" onChange={(e) => setElement(e.target.value)} />
          <datalist id="abil-dlg-elemente">
            {elements.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>
      )}

      <label className="dlg-field">
        Kategorie(n)
        <input
          list="abil-dlg-kategorien"
          value={kategorienText}
          placeholder="mit Komma trennen"
          title="Mehrere Kategorien mit Komma trennen — ein Eintrag kann in mehreren zugleich stehen."
          onChange={(e) => setKategorienText(e.target.value)}
          onBlur={() => setKategorienVal([...new Set(kategorienText.split(',').map((s) => s.trim()).filter(Boolean))])}
        />
        <datalist id="abil-dlg-kategorien">
          {kategorien.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>

      <label className="dlg-field">
        Aufgewertet von
        <select value={derivedFrom} onChange={(e) => setDerivedFrom(e.target.value)}>
          <option value="">— keine (Grad 1 „Basis")</option>
          {derivedOptions.map((a) => (
            <option key={a.uid} value={a.uid}>
              {a.name || '—'}
            </option>
          ))}
        </select>
      </label>

      <label className="dlg-field">
        Kosten
        <input value={kosten} placeholder="AP, frei" onChange={(e) => setKosten(e.target.value)} />
      </label>
      <label className="dlg-field">
        Probe
        <input value={probe} placeholder="FF+FF+KL" onChange={(e) => setProbe(e.target.value)} />
      </label>
      <label className="dlg-field">
        Effekt
        <textarea value={effekt} rows={2} onChange={(e) => setEffekt(e.target.value)} />
      </label>
      <label className="dlg-field">
        Notiz
        <textarea value={notiz} rows={2} onChange={(e) => setNotiz(e.target.value)} />
      </label>

      <label className="dlg-checkbox-row">
        <input type="checkbox" checked={passiv} onChange={(e) => setPassiv(e.target.checked)} />
        Passiv (Dauerwirkung statt aktiver Probe)
      </label>
      {isMagisch && (
        <label className="dlg-checkbox-row">
          <input type="checkbox" checked={signatur} onChange={(e) => setSignatur(e.target.checked)} />
          Signatur-Zauber (nur einer je Charakter)
        </label>
      )}
      <div className="dlg-checkbox-row">
        <FavPin active={favorit} onClick={() => setFavorit((v) => !v)} />
        Würfel-Favorit
      </div>
    </Dialog>
  );
}
