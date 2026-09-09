import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Ability } from '@shared/abilities';
import { abilityGrade, abilityGradeLabel } from '@shared/abilities';
import { apiGet, apiPost, apiPut } from '../api';
import { useThemeControls } from '../App';
import { AbilityEditDialog } from '../components/AbilityEditDialog';
import { BackToSheet } from '../components/BackToSheet';
import { CollapsiblePanel } from '../components/collapse';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { ExitGuard } from '../components/exitGuard';
import { Field } from '../components/inputs';

// Regeltabelle fürs Erschaffen neuer Zauber im Spiel: pro Attribut, was es beim
// Geschoss- bzw. Erschaffen-Typ steuert. Quelle: files/spell_creation.png (GM-Doku).
const SPELL_CREATION_ROWS: { attribut: string; geschoss: string; erschaffen: string }[] = [
  { attribut: 'Mut', geschoss: 'Nebeneffekt des Elements gestärkt', erschaffen: 'Magische Beständigkeit (Dauer)' },
  { attribut: 'Klugheit', geschoss: 'Verstärken; Effekte +', erschaffen: 'Konsistenz des Objekts' },
  { attribut: 'Intuition', geschoss: 'Genauigkeit erweitern', erschaffen: 'Positionierung des Objekts' },
  { attribut: 'Charisma', geschoss: 'Einbringung des Karmas', erschaffen: 'Effekt hinzufügen' },
  { attribut: 'Fingerfertigkeit', geschoss: 'Formen bewegen', erschaffen: 'Formen des Objekts' },
  { attribut: 'Gewandtheit', geschoss: 'Beschl. / komplexe Bewegung', erschaffen: 'Bewegung / Beweglichkeit' },
  { attribut: 'Konstitution', geschoss: 'Durchdringung', erschaffen: 'Dichte des Objekts' },
  { attribut: 'Körperkraft', geschoss: 'Intensität erhöhen', erschaffen: 'Kraft des Objekts' },
];

// „Zauber & Fähigkeiten verwalten" (Cluster 6): die dedizierte Bearbeitungsseite
// und „einzige Quelle der Wahrheit". Zwei getrennte Listen — Zauber (magisch) und
// Fähigkeiten (mundan). Die Reiter auf dem Bogen zeigen daraus nur an (und lassen
// einzig den Fortschritt/Würfel-Favorit zu). Änderungen hier sind erst mit
// „Speichern" verbindlich. Strukturelle Felder werden ausschließlich über
// AbilityEditDialog bearbeitet (kein Inline-/Aufklapp-Bearbeiten mehr in der
// Zeile) — derselbe Anlegen/Bearbeiten-in-einem-Dialog-Zuschnitt wie beim
// Gegenstands-Dialog, siehe TODO.md „Editing dialog for abilities".

const ZAUBER_TAB_NAME = 'Zauber/Fähigkeiten';

interface LoadResp {
  character: { id: number; name: string; theme?: string };
  access: 'edit' | 'summary' | null;
  data?: {
    abilities?: Ability[];
    abilityLists?: { element: string[]; kategorie: string[] };
    tabs?: { id: number; name: string }[];
  };
}

export default function AbilityManagerPage() {
  const { id } = useParams();
  const charId = Number(id);
  const [searchParams] = useSearchParams();
  // Woher man kam (Zauber-/Fähigkeiten-Reiter) — der Zurück-Link kehrt dorthin
  // zurück statt zum Heldenbrief. Vorgabe: der Zauber-Reiter.
  const fromTab = searchParams.get('from') || 'Zauber';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [retiring, setRetiring] = useState(false);
  // „Alten Reiter entfernen" ist ein Einweg-Schritt — deshalb zweistufig: erst
  // scharfschalten, dann bestätigen.
  const [retireArmed, setRetireArmed] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<string | null>(null);
  const [hasOldTab, setHasOldTab] = useState(false);

  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [elements, setElements] = useState<string[]>([]);
  const [kategorien, setKategorien] = useState<string[]>([]);
  // Dialogzustand: uid !== null → Bearbeiten dieser Fähigkeit; uid === null →
  // Anlegen (magisch legt fest, in welcher der beiden Listen).
  const [dlg, setDlg] = useState<{ uid: string | null; magisch: boolean } | null>(null);

  const [saved, setSaved] = useState({ abilities: '', elements: '', kategorien: '' });

  const load = useCallback(() => {
    setLoading(true);
    setMsg('');
    return apiGet<LoadResp>(`/api/characters/${charId}`)
      .then((res) => {
        if (res.access !== 'edit' || !res.data) {
          setError('Diese Seite ist nur für eigene Charaktere.');
          return;
        }
        const abils = res.data.abilities ?? [];
        const els = res.data.abilityLists?.element ?? [];
        const kats = res.data.abilityLists?.kategorie ?? [];
        setName(res.character.name);
        setTheme(res.character.theme ?? null);
        setAbilities(abils);
        setElements(els);
        setKategorien(kats);
        setHasOldTab((res.data.tabs ?? []).some((t) => t.name === ZAUBER_TAB_NAME));
        setSaved({ abilities: JSON.stringify(abils), elements: JSON.stringify(els), kategorien: JSON.stringify(kats) });
      })
      .catch(() => setError('Konnte den Charakter nicht laden.'))
      .finally(() => setLoading(false));
  }, [charId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Wie die Charakterseite bringt auch die Verwaltungsseite die Farbwelt des
  // Charakters mit — sonst zeigte sie die persönliche Vorgabe des Betrachters.
  // Beim Verlassen wieder abräumen.
  const { setOverrideTheme } = useThemeControls();
  useEffect(() => {
    setOverrideTheme(theme);
    return () => setOverrideTheme(null);
  }, [theme, setOverrideTheme]);

  const dirty =
    JSON.stringify(abilities) !== saved.abilities ||
    JSON.stringify(elements) !== saved.elements ||
    JSON.stringify(kategorien) !== saved.kategorien;

  const zauber = useMemo(() => abilities.filter((a) => a.magisch), [abilities]);
  const faehig = useMemo(() => abilities.filter((a) => !a.magisch), [abilities]);

  // Signatur ist einzigartig: sobald ein Patch sie anfasst, gewinnt der
  // bearbeitete Eintrag und alle anderen werden zurückgesetzt — dieselbe
  // blunte Rundum-Zurücksetzung wie beim früheren Inline-Umschalter.
  const patch = (uid: string, p: Partial<Ability>) =>
    setAbilities((list) => {
      const next = list.map((a) => (a.uid === uid ? { ...a, ...p } : a));
      return 'signatur' in p ? next.map((a) => (a.uid === uid ? a : { ...a, signatur: false })) : next;
    });
  const addNew = (a: Ability) =>
    setAbilities((list) => {
      const next = [...list, a];
      return a.signatur ? next.map((x) => (x.uid === a.uid ? x : { ...x, signatur: false })) : next;
    });
  const remove = (uid: string) => setAbilities((list) => list.filter((a) => a.uid !== uid));
  // Ziehen zum Umsortieren: den gezogenen Eintrag vor das Ziel setzen — aber nur
  // innerhalb derselben Liste (Zauber bzw. Fähigkeiten).
  const reorder = (dragUid: string, targetUid: string) =>
    setAbilities((list) => {
      if (dragUid === targetUid) return list;
      const from = list.findIndex((a) => a.uid === dragUid);
      const to = list.findIndex((a) => a.uid === targetUid);
      if (from < 0 || to < 0 || list[from].magisch !== list[to].magisch) return list;
      const arr = list.slice();
      const [item] = arr.splice(from, 1);
      const insertAt = arr.findIndex((a) => a.uid === targetUid);
      arr.splice(insertAt, 0, item);
      return arr;
    });

  const seed = async () => {
    setSeeding(true);
    setMsg('');
    try {
      const r = await apiPost<{ skipped: boolean; zauber: number; faehigkeiten: number }>(
        `/api/characters/${charId}/abilities/seed`,
      );
      await load();
      setMsg(r.skipped ? 'Nichts zu übernehmen.' : `Übernommen: ${r.zauber} Zauber, ${r.faehigkeiten} Fähigkeiten.`);
    } catch (e) {
      setMsg(`Fehler beim Übernehmen: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSeeding(false);
    }
  };

  const retire = async () => {
    setRetiring(true);
    setMsg('');
    try {
      const r = await apiPost<{ retired: boolean }>(`/api/characters/${charId}/abilities/retire-old-tab`);
      await load();
      setRetireArmed(false);
      setMsg(r.retired ? 'Alter Reiter entfernt.' : 'Kein alter Reiter gefunden.');
    } catch (e) {
      setMsg(`Fehler beim Entfernen: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRetiring(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await apiPut(`/api/characters/${charId}/abilities`, abilities);
      if (JSON.stringify(elements) !== saved.elements) {
        await apiPut(`/api/characters/${charId}/ability-lists/manage`, { kind: 'element', order: elements });
      }
      if (JSON.stringify(kategorien) !== saved.kategorien) {
        await apiPut(`/api/characters/${charId}/ability-lists/manage`, { kind: 'kategorie', order: kategorien });
      }
      await load();
      setMsg(`Gespeichert (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      setMsg(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Lade…</p>;
  if (error)
    return (
      <>
        <p className="muted">{error}</p>
        <p>
          <Link to={`/charakter/${charId}?tab=${fromTab}`}>← Zurück zum Charakter</Link>
        </p>
      </>
    );

  const editingAbility = dlg?.uid ? abilities.find((a) => a.uid === dlg.uid) : undefined;

  return (
    <>
      <ExitGuard dirty={dirty} />
      <div className="werk-head">
        <h1>Zauber &amp; Fähigkeiten verwalten</h1>
        <div className="head-save">
          <button className="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
          {dirty && !saving && <span className="muted">Ungespeicherte Änderungen</span>}
          <span className="savestate">{msg}</span>
        </div>
        <BackToSheet charId={charId} tab={fromTab} name={name} />
      </div>
      <p className="muted">
        Die Stammliste, aus der die Reiter „Zauber" und „Fähigkeiten" ihren Inhalt beziehen. Ein Eintrag anklicken öffnet ihn zum
        Bearbeiten; im Reiter selbst werden nur Lernfortschritt und Würfel-Favorit geändert. Änderungen sind erst mit „Speichern"
        verbindlich.
      </p>

      <CollapsiblePanel collapseKey="spellCreationTable" standardZu title="Regeltabelle: Zauber erschaffen" rows={SPELL_CREATION_ROWS.length}>
        <p className="muted">
          Wer im Spiel einen neuen Zauber erschafft, bespricht mit der Spielleitung Wirkung und Element, wählt dann
          passend zur Tabelle die Attribute für die Probe (und die Kosten) und probiert den Zauber im Spiel aus.
        </p>
        <table className="rules-table">
          <thead>
            <tr>
              <th>Attribut</th>
              <th>Geschoss</th>
              <th>Erschaffen</th>
            </tr>
          </thead>
          <tbody>
            {SPELL_CREATION_ROWS.map((r) => (
              <tr key={r.attribut}>
                <th scope="row">{r.attribut}</th>
                <td>{r.geschoss}</td>
                <td>{r.erschaffen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>

      {abilities.length === 0 && hasOldTab && (
        <div className="panel werk-seed">
          <h3>Aus der alten Tabelle übernehmen</h3>
          <p className="muted">
            Dieser Charakter hat noch einen alten dynamischen „{ZAUBER_TAB_NAME}"-Reiter. Einträge einmalig hierher
            übernehmen? Der alte Reiter bleibt unangetastet, bis du ihn später bewusst stilllegst.
          </p>
          <button className="primary" disabled={seeding} onClick={seed}>
            {seeding ? 'Übernehme…' : 'Übernehmen'}
          </button>
        </div>
      )}

      {abilities.length > 0 && hasOldTab && (
        <div className="panel werk-retire">
          <h3>Alten Reiter entfernen</h3>
          <p className="muted">
            Der alte dynamische „{ZAUBER_TAB_NAME}"-Reiter liegt noch auf dem Bogen. Alles Nötige steht jetzt in den
            Listen weiter unten — du kannst ihn entfernen. Das löscht die alte Tabelle endgültig; die hier gepflegten Einträge
            bleiben erhalten. Danach lässt sich nichts mehr aus der alten Tabelle ablesen.
          </p>
          {retireArmed ? (
            <div className="werk-retire-confirm">
              <button className="danger" disabled={retiring} onClick={retire}>
                {retiring ? 'Entferne…' : 'Wirklich entfernen?'}
              </button>
              <button className="small" disabled={retiring} onClick={() => setRetireArmed(false)}>
                Abbrechen
              </button>
            </div>
          ) : (
            <button className="danger" onClick={() => setRetireArmed(true)}>
              Alten Reiter entfernen
            </button>
          )}
        </div>
      )}

      <AbilityListPanel
        title="Zauber"
        magisch
        list={zauber}
        allAbilities={abilities}
        elements={elements}
        kategorien={kategorien}
        onReorder={reorder}
        onEdit={(uid) => setDlg({ uid, magisch: true })}
        onAddNew={() => setDlg({ uid: null, magisch: true })}
      />

      <AbilityListPanel
        title="Fähigkeiten"
        magisch={false}
        list={faehig}
        allAbilities={abilities}
        elements={elements}
        kategorien={kategorien}
        onReorder={reorder}
        onEdit={(uid) => setDlg({ uid, magisch: false })}
        onAddNew={() => setDlg({ uid: null, magisch: false })}
      />

      <div className="panel">
        <h3>Listen</h3>
        <p className="muted">Element- und Kategorie-Vorschläge — nach ihnen können die Reiter gruppieren und filtern.</p>
        <div className="werk-lists">
          <StringListEditor label="Elemente" items={elements} onChange={setElements} />
          <StringListEditor label="Kategorien" items={kategorien} onChange={setKategorien} />
        </div>
      </div>

      <AbilityEditDialog
        open={dlg !== null}
        onClose={() => setDlg(null)}
        ability={editingAbility}
        magisch={dlg?.magisch ?? true}
        abilities={abilities}
        elements={elements}
        kategorien={kategorien}
        onSave={(p) => dlg?.uid && patch(dlg.uid, p)}
        onAdd={addNew}
        onDelete={() => dlg?.uid && remove(dlg.uid)}
      />
    </>
  );
}

// --- Eine der beiden Listen ---

interface ListPanelProps {
  title: string;
  magisch: boolean;
  list: Ability[];
  /** Beide Listen zusammen — für die Grad-Anzeige (derivedFrom kann auf jede uid zeigen). */
  allAbilities: Ability[];
  elements: string[];
  kategorien: string[];
  onReorder: (dragUid: string, targetUid: string) => void;
  onEdit: (uid: string) => void;
  onAddNew: () => void;
}

function AbilityListPanel({ title, magisch, list, allAbilities, elements, kategorien, onReorder, onEdit, onAddNew }: ListPanelProps) {
  const [q, setQ] = useState('');
  const [fEl, setFEl] = useState('');
  const [fKat, setFKat] = useState('');
  const [fPassiv, setFPassiv] = useState<'' | 'passiv' | 'aktiv'>('');
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [overUid, setOverUid] = useState<string | null>(null);
  const filtering = q.trim() !== '' || fEl !== '' || fKat !== '' || fPassiv !== '';

  const byUid = useMemo(() => new Map(allAbilities.map((a) => [a.uid, a])), [allAbilities]);

  // Filter-Optionen: Vorschlagsliste UND die tatsächlich vergebenen Werte
  // (sonst fehlt ein Filter, wenn die Vorschlagsliste noch leer ist).
  const elemOptions = [...new Set([...elements, ...list.map((a) => a.element)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const katOptions = [...new Set([...kategorien, ...list.flatMap((a) => a.kategorien)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  const needle = q.trim().toLowerCase();
  // Suchen hat Vorrang und ignoriert die Auswahlfilter (ganzer Bestand).
  const shown = list.filter((a) => {
    if (needle) return a.name.toLowerCase().includes(needle) || a.effekt.toLowerCase().includes(needle) || a.notiz.toLowerCase().includes(needle);
    if (fEl && a.element !== fEl) return false;
    if (fKat && !a.kategorien.includes(fKat)) return false;
    if (fPassiv === 'passiv' && !a.passiv) return false;
    if (fPassiv === 'aktiv' && a.passiv) return false;
    return true;
  });

  return (
    <div className="panel">
      <h3>
        {title} <span className="muted">· {list.length}{filtering ? ` (${shown.length} sichtbar)` : ''}</span>
      </h3>

      <div className="abil-toolbar werk-controls">
        <Field label="Suchen" className="notch-search" active={needle !== ''}>
          <input type="text" placeholder="Name, Effekt…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {magisch && elemOptions.length > 0 && (
          <Field label="Element" active={fEl !== ''}>
            <select value={fEl} onChange={(e) => setFEl(e.target.value)} title="Nach Element filtern">
              <option value="">alle Elemente</option>
              {elemOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
        )}
        {katOptions.length > 0 && (
          <Field label="Kategorie" active={fKat !== ''}>
            <select value={fKat} onChange={(e) => setFKat(e.target.value)} title="Nach Kategorie filtern">
              <option value="">alle Kategorien</option>
              {katOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Aktiv/Passiv" active={fPassiv !== ''}>
          <select value={fPassiv} onChange={(e) => setFPassiv(e.target.value as '' | 'passiv' | 'aktiv')} title="Passiv/aktiv">
            <option value="">alle</option>
            <option value="aktiv">nur aktive</option>
            <option value="passiv">nur passive</option>
          </select>
        </Field>
        {filtering && (
          <button className="small" onClick={() => { setQ(''); setFEl(''); setFKat(''); setFPassiv(''); }} title="Filter zurücksetzen">
            ✕
          </button>
        )}
      </div>

      {filtering && <p className="muted abil-count">Zum Umsortieren die Suche/Filter zurücksetzen.</p>}
      <div className="abil-list">
        {shown.map((a) => {
          const grade = abilityGrade(a, byUid);
          return (
            <div
              className={`abil-row${dragUid === a.uid ? ' dragging' : ''}${overUid === a.uid && dragUid && dragUid !== a.uid ? ' drop-before' : ''}`}
              key={a.uid}
              onDragOver={(e) => {
                if (!dragUid || filtering) return;
                e.preventDefault();
                if (overUid !== a.uid) setOverUid(a.uid);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = e.dataTransfer.getData('text/plain') || dragUid;
                if (from) onReorder(from, a.uid);
                setDragUid(null);
                setOverUid(null);
              }}
            >
              <div className="abil-compact abil-compact-ro" onClick={() => onEdit(a.uid)} role="button" tabIndex={0} title="Bearbeiten">
                <span
                  className={`abil-grip${filtering ? ' disabled' : ''}`}
                  draggable={!filtering}
                  title={filtering ? 'Zum Umsortieren Suche/Filter zurücksetzen' : 'Ziehen zum Umsortieren'}
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', a.uid);
                    setDragUid(a.uid);
                  }}
                  onDragEnd={() => {
                    setDragUid(null);
                    setOverUid(null);
                  }}
                >
                  ⠿
                </span>
                {a.signatur && <span className="abil-sig-star" title="Signatur-Zauber">★</span>}
                <span className="abil-name">{a.name || '—'}</span>
                {magisch && a.element && <span className="muted">{a.element}</span>}
                {a.kategorien.length > 0 && <span className="muted">{a.kategorien.join(', ')}</span>}
                <span className="muted">St {a.stufe}{magisch ? ` · Kx ${a.komplexitaet}` : ''}</span>
                {a.passiv && <span className="abil-badge">passiv</span>}
                {grade > 1 && <span className="abil-badge">{abilityGradeLabel(grade)}</span>}
                {a.favorit && <span title="Würfel-Favorit">📌</span>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">Noch nichts.</p>}
        {list.length > 0 && shown.length === 0 && <p className="muted">Nichts gefunden.</p>}
        <button className="small" onClick={onAddNew}>
          + {title === 'Zauber' ? 'Zauber' : 'Fähigkeit'}
        </button>
      </div>
    </div>
  );
}

// --- Vorschlags-Liste (Elemente / Kategorien) ---

function StringListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="werk-strlist">
      <h4>{label}</h4>
      <div className="cat-editor">
        {items.map((it, i) => (
          <div className="cat-row" key={i}>
            <input value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={label} />
            <ConfirmDeleteButton title="Entfernen" onConfirm={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button className="small" onClick={() => onChange([...items, ''])}>
          + {label.replace(/e$/, '')}
        </button>
      </div>
    </div>
  );
}
