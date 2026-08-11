import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Ability } from '@shared/abilities';
import { makeAbilityUid } from '@shared/abilities';
import { apiGet, apiPost, apiPut } from '../api';

// Zauber-&-Fähigkeiten-Werkstatt (Cluster 6): die dedizierte Bearbeitungsseite und
// „einzige Quelle der Wahrheit" für die Fähigkeiten eines Charakters. Zwei
// getrennte Listen — Zauber (magisch) und Fähigkeiten (mundan). Die Reiter auf dem
// Bogen zeigen daraus nur an (und lassen einzig den Fortschritt zu). Änderungen
// hier sind erst mit „Speichern" verbindlich, wie auf der Einstellungen-Seite.

const ZAUBER_TAB_NAME = 'Zauber/Fähigkeiten';

interface LoadResp {
  character: { id: number; name: string };
  access: 'edit' | 'summary' | null;
  data?: {
    abilities?: Ability[];
    abilityLists?: { element: string[]; kategorie: string[] };
    tabs?: { id: number; name: string }[];
  };
}

function emptyAbility(magisch: boolean): Ability {
  return {
    id: 0,
    uid: makeAbilityUid(),
    magisch,
    passiv: false,
    gruppe: '',
    name: '',
    element: '',
    kategorie: '',
    stufe: magisch ? 1 : 0,
    komplexitaet: magisch ? 1 : 0,
    kosten: '',
    probe: '',
    effekt: '',
    fortschritt: 0,
    notiz: '',
  };
}

const num = (v: string): number => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export default function WerkstattPage() {
  const { id } = useParams();
  const charId = Number(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [hasOldTab, setHasOldTab] = useState(false);

  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [elements, setElements] = useState<string[]>([]);
  const [kategorien, setKategorien] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Gespeicherter Stand (Vergleichsbasis für „dirty").
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

  const dirty =
    JSON.stringify(abilities) !== saved.abilities ||
    JSON.stringify(elements) !== saved.elements ||
    JSON.stringify(kategorien) !== saved.kategorien;

  const zauber = useMemo(() => abilities.filter((a) => a.magisch), [abilities]);
  const faehig = useMemo(() => abilities.filter((a) => !a.magisch), [abilities]);

  // Einträge werden über ihre uid angesprochen (Reihenfolge bleibt stabil).
  const patch = (uid: string, p: Partial<Ability>) =>
    setAbilities((list) => list.map((a) => (a.uid === uid ? { ...a, ...p } : a)));
  const remove = (uid: string) => setAbilities((list) => list.filter((a) => a.uid !== uid));
  const add = (magisch: boolean) => {
    const a = emptyAbility(magisch);
    setAbilities((list) => [...list, a]);
    setExpanded((s) => new Set(s).add(a.uid));
  };
  const toggleExpand = (uid: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
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
          <Link to={`/charakter/${charId}`}>← Zurück zum Charakter</Link>
        </p>
      </>
    );

  return (
    <>
      <div className="werk-head">
        <h1>Zauber &amp; Fähigkeiten</h1>
        <Link to={`/charakter/${charId}`} className="muted">
          ← {name}
        </Link>
      </div>
      <p className="muted">
        Die Stammliste, aus der die Reiter „Zauber" und „Fähigkeiten" anzeigen. Hier wird alles gepflegt; im Reiter selbst
        ändert sich nur der Fortschritt. Änderungen sind erst mit „Speichern" verbindlich.
      </p>

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

      <AbilityListPanel
        title="Zauber"
        hint="Magisch — Stufe × Komplexität ergeben die Magiepunkte."
        magisch
        list={zauber}
        elements={elements}
        kategorien={kategorien}
        expanded={expanded}
        onToggle={toggleExpand}
        onPatch={patch}
        onRemove={remove}
        onAdd={() => add(true)}
      />

      <AbilityListPanel
        title="Fähigkeiten"
        hint="Mundan — Techniken und Talente; passive wie aktive."
        magisch={false}
        list={faehig}
        elements={elements}
        kategorien={kategorien}
        expanded={expanded}
        onToggle={toggleExpand}
        onPatch={patch}
        onRemove={remove}
        onAdd={() => add(false)}
      />

      <div className="panel">
        <h3>Listen</h3>
        <p className="muted">Element- und Kategorie-Vorschläge — nach ihnen können die Reiter gruppieren.</p>
        <div className="werk-lists">
          <StringListEditor label="Elemente" items={elements} onChange={setElements} />
          <StringListEditor label="Kategorien" items={kategorien} onChange={setKategorien} />
        </div>
      </div>

      <div className="panel set-save">
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Speichere…' : 'Speichern'}
        </button>
        {dirty && !saving && <span className="muted">Ungespeicherte Änderungen</span>}
        <span className="savestate">{msg}</span>
      </div>
    </>
  );
}

// --- Eine der beiden Listen ---

interface ListPanelProps {
  title: string;
  hint: string;
  magisch: boolean;
  list: Ability[];
  elements: string[];
  kategorien: string[];
  expanded: Set<string>;
  onToggle: (uid: string) => void;
  onPatch: (uid: string, p: Partial<Ability>) => void;
  onRemove: (uid: string) => void;
  onAdd: () => void;
}

function AbilityListPanel({ title, hint, magisch, list, elements, kategorien, expanded, onToggle, onPatch, onRemove, onAdd }: ListPanelProps) {
  const elId = `elemente-${magisch ? 'z' : 'f'}`;
  const katId = `kategorien-${magisch ? 'z' : 'f'}`;
  return (
    <div className="panel">
      <h3>
        {title} <span className="muted">· {list.length}</span>
      </h3>
      <p className="muted">{hint}</p>
      <datalist id={elId}>
        {elements.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <datalist id={katId}>
        {kategorien.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <div className="abil-list">
        {list.map((a) => (
          <div className="abil-row" key={a.uid}>
            <div className="abil-compact">
              <button className="abil-chev" onClick={() => onToggle(a.uid)} title={expanded.has(a.uid) ? 'zuklappen' : 'aufklappen'} aria-label="Details">
                {expanded.has(a.uid) ? '▾' : '▸'}
              </button>
              <input className="abil-name" value={a.name} placeholder="Name" onChange={(e) => onPatch(a.uid, { name: e.target.value })} />
              {magisch && (
                <input
                  className="abil-el"
                  list={elId}
                  value={a.element}
                  placeholder="Element"
                  onChange={(e) => onPatch(a.uid, { element: e.target.value })}
                />
              )}
              <input
                className="abil-kat"
                list={katId}
                value={a.kategorie}
                placeholder="Kategorie"
                onChange={(e) => onPatch(a.uid, { kategorie: e.target.value })}
              />
              <label className="abil-num" title="Stufe">
                St
                <input type="number" min={0} value={a.stufe} onChange={(e) => onPatch(a.uid, { stufe: num(e.target.value) })} />
              </label>
              {magisch && (
                <label className="abil-num" title="Komplexität">
                  Kx
                  <input type="number" min={0} value={a.komplexitaet} onChange={(e) => onPatch(a.uid, { komplexitaet: num(e.target.value) })} />
                </label>
              )}
              <label className="abil-passiv" title="Passiv (Dauerwirkung)">
                <input type="checkbox" checked={a.passiv} onChange={(e) => onPatch(a.uid, { passiv: e.target.checked })} />
                passiv
              </label>
              <button className="small abil-del" title="Entfernen" onClick={() => onRemove(a.uid)}>
                ✕
              </button>
            </div>
            {expanded.has(a.uid) && (
              <div className="abil-detail">
                <label>
                  Gruppe
                  <input value={a.gruppe} placeholder="z. B. Heilmagie" onChange={(e) => onPatch(a.uid, { gruppe: e.target.value })} />
                </label>
                <label>
                  Kosten
                  <input value={a.kosten} placeholder="AP, frei" onChange={(e) => onPatch(a.uid, { kosten: e.target.value })} />
                </label>
                <label>
                  Probe
                  <input value={a.probe} placeholder="FF+FF+KL" onChange={(e) => onPatch(a.uid, { probe: e.target.value })} />
                </label>
                <label>
                  Fortschritt
                  <input type="number" min={0} value={a.fortschritt} onChange={(e) => onPatch(a.uid, { fortschritt: num(e.target.value) })} />
                </label>
                <label className="abil-wide">
                  Effekt
                  <textarea value={a.effekt} rows={2} onChange={(e) => onPatch(a.uid, { effekt: e.target.value })} />
                </label>
                <label className="abil-wide">
                  Notiz
                  <textarea value={a.notiz} rows={2} onChange={(e) => onPatch(a.uid, { notiz: e.target.value })} />
                </label>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="muted">Noch nichts.</p>}
        <button className="small" onClick={onAdd}>
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
            <button className="small" title="Entfernen" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="small" onClick={() => onChange([...items, ''])}>
          + {label.replace(/e$/, '')}
        </button>
      </div>
    </div>
  );
}
