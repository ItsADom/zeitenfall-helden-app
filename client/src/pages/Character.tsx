import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Attributes, BaseValueInputs, CharLanguage, CharTalent, Resources } from '@shared/types';
import type { DynSection } from '@shared/dynamicSections';
import { apiGet, apiPut } from '../api';
import type { Row } from '../components/inputs';
import DynamicSectionsTab from '../tabs/Sektionen';
import HeldenbriefTab from '../tabs/Heldenbrief';
import TalenteTab from '../tabs/Talente';
import WaffenTab from '../tabs/Waffen';
import ZauberTab from '../tabs/Zauber';
import AusruestungTab from '../tabs/Ausruestung';
import InventarTab from '../tabs/Inventar';
import SprachenTab from '../tabs/Sprachen';
import ArtefakteTab from '../tabs/Artefakte';
import BesitzTab from '../tabs/Besitz';
import BibliothekTab from '../tabs/Bibliothek';
import BoniTab from '../tabs/Boni';
import VorliebenTab from '../tabs/Vorlieben';
import SichtbarkeitTab from '../tabs/Sichtbarkeit';
import SummaryView from '../tabs/Summary';

export interface FullData {
  bio: Record<string, string>;
  meta: Record<string, number>;
  attributes: Attributes;
  baseValues: BaseValueInputs;
  resources: Resources;
  talents: CharTalent[];
  languages: CharLanguage[];
  lists: Record<string, Row[]>;
  sections: DynSection[];
  visibility: Record<string, boolean>;
}

export interface TalentCatalogRow {
  id: number;
  kategorie: string;
  gruppe: string;
  name: string;
  klasse: string;
  probe: string;
  ableiten: string;
  sort: number;
}
export interface LanguageCatalogRow {
  id: number;
  kind: string;
  familie: string;
  name: string;
  komplexitaet: string;
  sort: number;
}
export interface Catalogs {
  talents: TalentCatalogRow[];
  languages: LanguageCatalogRow[];
}

interface CharacterInfo {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  groupId: number;
  groupName: string;
}

interface CharCtxValue {
  charId: number;
  data: FullData;
  catalogs: Catalogs;
  update: (section: string, value: unknown) => void;
}
const CharCtx = createContext<CharCtxValue | null>(null);
export const useChar = () => useContext(CharCtx)!;

const TABS = [
  'Heldenbrief', 'Talente', 'Waffen', 'Zauber', 'Ausrüstung', 'Inventar', 'Sprachen',
  'Artefakte', 'Besitz', 'Bibliothek', 'Boni', 'Vorlieben', 'Sektionen', 'Sichtbarkeit',
] as const;

export default function CharacterPage() {
  const { id } = useParams();
  const charId = Number(id);
  const [info, setInfo] = useState<CharacterInfo | null>(null);
  const [access, setAccess] = useState<'edit' | 'summary' | null>(null);
  const [data, setData] = useState<FullData | null>(null);
  const [summary, setSummary] = useState<unknown>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Heldenbrief');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    setData(null);
    setSummary(null);
    setError('');
    apiGet<{ character: CharacterInfo; access: 'edit' | 'summary'; data?: FullData; summary?: unknown }>(`/api/characters/${charId}`)
      .then((res) => {
        setInfo(res.character);
        setAccess(res.access);
        if (res.data) setData(res.data);
        if (res.summary) setSummary(res.summary);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'));
    apiGet<Catalogs>('/api/catalogs').then(setCatalogs);
  }, [charId]);

  // Automatisches Speichern geänderter Sektionen (entprellt)
  const dirty = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);
  const dataRef = useRef<FullData | null>(null);
  dataRef.current = data;

  const flush = useCallback(async () => {
    const sections = [...dirty.current];
    dirty.current.clear();
    const d = dataRef.current;
    if (!d || sections.length === 0) return;
    setSaveState('Speichere…');
    try {
      for (const s of sections) {
        if (s === 'visibility') await apiPut(`/api/characters/${charId}/visibility`, d.visibility);
        else {
          const value =
            s === 'bio' ? d.bio
            : s === 'meta' ? d.meta
            : s === 'attributes' ? d.attributes
            : s === 'baseValues' ? d.baseValues
            : s === 'resources' ? d.resources
            : s === 'talents' ? d.talents
            : s === 'languages' ? d.languages
            : d.lists[s];
          await apiPut(`/api/characters/${charId}/section/${s}`, value);
        }
      }
      setSaveState(`Gespeichert (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      dirty.current = new Set([...dirty.current, ...sections]);
      setSaveState(`Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
    }
  }, [charId]);

  const update = useCallback(
    (section: string, value: unknown) => {
      setData((prev) => {
        if (!prev) return prev;
        if (section === 'bio') return { ...prev, bio: value as FullData['bio'] };
        if (section === 'meta') return { ...prev, meta: value as FullData['meta'] };
        if (section === 'attributes') return { ...prev, attributes: value as Attributes };
        if (section === 'baseValues') return { ...prev, baseValues: value as BaseValueInputs };
        if (section === 'resources') return { ...prev, resources: value as Resources };
        if (section === 'talents') return { ...prev, talents: value as CharTalent[] };
        if (section === 'languages') return { ...prev, languages: value as CharLanguage[] };
        if (section === 'visibility') return { ...prev, visibility: value as FullData['visibility'] };
        return { ...prev, lists: { ...prev.lists, [section]: value as Row[] } };
      });
      dirty.current.add(section);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  if (error) return <p className="error">{error}</p>;
  if (!info || !catalogs || (access === 'edit' && !data)) return <p className="muted">Lade…</p>;

  if (access === 'summary') {
    return <SummaryView info={info} summary={summary as never} />;
  }

  return (
    <CharCtx.Provider value={{ charId, data: data!, catalogs, update }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1>{info.name}</h1>
        <span className="muted">
          Spieler: {info.ownerName} · Gruppe: {info.groupName}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="savestate">{saveState}</span>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Heldenbrief' && <HeldenbriefTab />}
      {tab === 'Talente' && <TalenteTab />}
      {tab === 'Waffen' && <WaffenTab />}
      {tab === 'Zauber' && <ZauberTab />}
      {tab === 'Ausrüstung' && <AusruestungTab />}
      {tab === 'Inventar' && <InventarTab />}
      {tab === 'Sprachen' && <SprachenTab />}
      {tab === 'Artefakte' && <ArtefakteTab />}
      {tab === 'Besitz' && <BesitzTab />}
      {tab === 'Bibliothek' && <BibliothekTab />}
      {tab === 'Boni' && <BoniTab />}
      {tab === 'Vorlieben' && <VorliebenTab />}
      {tab === 'Sektionen' && <DynamicSectionsTab key={charId} charId={charId} initial={data!.sections} attributes={data!.attributes} />}
      {tab === 'Sichtbarkeit' && <SichtbarkeitTab />}
    </CharCtx.Provider>
  );
}
