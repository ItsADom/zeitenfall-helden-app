import {
  ATTR_LABELS,
  ATTR_ROW_CODES,
  BASE_VALUE_KEYS,
  BASE_VALUE_LABELS,
  RESOURCE_COLUMN_LABELS as RC,
  MAX_SPECIAL_RESOURCES,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
} from '@shared/types';
import type { AttrCode, AttrRowCode, BaseValueKey, ResourceKey, SpecialResource } from '@shared/types';
import { Fragment, useRef, useState } from 'react';
import {
  attrPointsActualTotal,
  attrPointsTheoreticalTotal,
  computeBaseValues,
  computeResource,
  evaluateEnergyFormula,
  levelForAp,
  nextLevelAp,
  psycheMax,
  psycheMuAnteil,
} from '@shared/rules';
import {
  attrBonusKey,
  attrsMitBoni,
  baseInputsMitBoni,
  baseValueBonusKey,
  PSYCHE_BONUS_KEY,
  resourceBonusKey,
  resourceInputMitBoni,
  specialMitBoni,
  spezialBonusKey,
} from '@shared/items';
import { useReadOnly } from '../components/displayMode';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import { NumInput, TextInput } from '../components/inputs';
import { BonusWert } from '../components/BonusWert';
import { GeldPanel } from '../components/GeldPanel';
import { MaximumWert } from '../components/MaximumWert';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { Portrait } from '../components/Portrait';
import { overfilled, poolClass } from '../components/energie';
import { useChar } from '../pages/Character';
import type { RaceCatalogRow } from '../pages/Character';

type BioField = [key: string, label: string];

// Die Personendaten in benannte Gruppen gefasst, damit die Felder nicht als
// lose Titel-mit-Text herumstehen. `singles` = kurze Einzelfelder in einem
// kompakten Raster; `pairs` = zusammengehörige Felder, die IMMER als Einheit
// beieinander bleiben (jedes Paar ein eigenes kleines Raster, das nie über
// einen Zeilenumbruch getrennt wird — das zweite Feld darf breiter sein).
interface BioGroup {
  title: string;
  singles?: BioField[];
  pairs?: [BioField, BioField][];
  // Paare aus zwei gleichrangigen Feldern (statt Basis + Modifikation): gleiche
  // Spaltenbreite. Sonst quetscht das schmale 1fr die Gottheit ein, während das
  // breite 1.5fr für die (oft leeren) Göttergeschenke danebensteht.
  evenPairs?: boolean;
}

const BIO_GROUPS: BioGroup[] = [
  {
    title: 'Eckdaten',
    singles: [
      ['alterGeburtstag', 'Alter/Geburtstag'],
      ['geschlecht', 'Geschlecht'],
      ['groesse', 'Größe'],
      ['gewicht', 'Gewicht'],
      ['familienstand', 'Familienstand'],
      ['anrede', 'Anrede'],
    ],
  },
  {
    title: 'Aussehen',
    singles: [
      ['augenfarbe', 'Augenfarbe'],
      ['haarfarbe', 'Haarfarbe'],
      ['hautfarbe', 'Hautfarbe'],
    ],
  },
  {
    title: 'Herkunft',
    pairs: [
      [['rasse', 'Rasse'], ['rasseMod', 'Modifikationen (Rasse)']],
      [['kultur', 'Kultur'], ['kulturMod', 'Modifikationen (Kultur)']],
    ],
  },
  {
    title: 'Beruf & Glaube',
    evenPairs: true,
    pairs: [
      [['profession', 'Profession'], ['zweitprofession', 'Zweitprofession']],
      [['gottheit', 'Gottheit'], ['goettergeschenke', 'Göttergeschenke']],
    ],
  },
];

const META_FIELDS: [string, string][] = [
  ['karma', 'Karma'],
  ['karmaGuthaben', 'Karma-Guthaben'],
  ['ruf', 'Ruf'],
];

export default function HeldenbriefTab() {
  const { charId, data, stats, catalogs, update } = useChar();
  const readOnly = useReadOnly();
  const { attributes, baseValues, resources, special, bio, meta, attrExtern, pouches } = data;
  // Item-Boni überlagert — NUR fürs Anzeigen/Rechnen. Editierbare Felder binden
  // weiter an attributes/baseValues/resources (roh); siehe attrsMitBoni.
  const attributesEff = attrsMitBoni(attributes, stats);
  const baseValuesEff = baseInputsMitBoni(baseValues, stats);

  // Aktuell gewählte Rasse (für Anzeige UND um Basis-Zellen zu sperren, siehe unten).
  const selectedRace = catalogs.races.find((r) => r.id === bio.rasseId) ?? null;

  // Rasse auswählen: setzt rasseId UND (fürs Altbestands-Freitextfeld, das
  // Zusammenfassung/Druck weiter unverändert lesen) den Namen mit. gs, Psyche
  // und Resilienz sind Rassengrundwerte (kein einfacher Bonus) — bei Auswahl
  // übernommen und danach GESPERRT (siehe die drei Zellen weiter unten), damit
  // sie nur über eine neue Rassen-Wahl ändern; persönliche Anpassung läuft über
  // die jeweils vorhandene Mod./Bonus-Spalte.
  // MR/Artefaktkontrolle (Basiswerte) und LE/AU/AsE (Energien) sind reine
  // Rassenboni ohne eigene Anzeige/Eingabe — anders als die drei oben werden
  // sie IMMER überschrieben (auch mit 0, wenn die neue Rasse keinen Wert
  // hinterlegt hat), damit ein Rassenwechsel den alten Bonus vollständig
  // abzieht statt ihn liegen zu lassen.
  const setRace = (race: RaceCatalogRow | null) => {
    update('bio', { ...bio, rasseId: race?.id ?? null, rasse: race?.name ?? '' });
    // EIN Aufruf je Sektion: update() spiegelt state-intern nicht sofort in
    // dieses `baseValues`/`resources` zurück, also würde ein zweiter Aufruf mit
    // demselben (veralteten) Objekt die erste Änderung überschreiben.
    update('baseValues', {
      ...baseValues,
      ...(race?.gs != null ? { gsBase: race.gs } : null),
      ...(race?.resilienz != null ? { resilienzBase: race.resilienz } : null),
      mrBase: race?.mr ?? 0,
      akBase: race?.ak ?? 0,
    });
    if (race?.psyche != null) update('meta', { ...meta, psycheBase: race.psyche });
    update('resources', {
      ...resources,
      le: { ...resources.le, raceBase: race?.le ?? 0 },
      aus: { ...resources.aus, raceBase: race?.au ?? 0 },
      ase: { ...resources.ase, raceBase: race?.ae ?? 0 },
    });
  };

  const bv = computeBaseValues(attributesEff, baseValuesEff);

  // Ungenutzte Attributspunkte: theoretisch verfügbar (Stufe + externe Quellen,
  // siehe Einstellungen) minus tatsächlich gesetzte Summe. Eine Erhöhung, die
  // ins Minus liefe, wird abgelehnt — Spieler müssen die Quelle erst in den
  // Einstellungen eintragen (auch Bestandscharaktere: siehe Migrationskorrektur
  // serverseitig).
  const attrLevel = levelForAp(meta.ap ?? 0);
  const attrUnused = attrPointsTheoreticalTotal(attrLevel, attrExtern) - attrPointsActualTotal(attributes);
  const [attrWarn, setAttrWarn] = useState('');
  const [attrFieldKey, setAttrFieldKey] = useState(0);

  // `attributes` (render closure) goes stale between two keystrokes fired in
  // quick succession before React re-renders with the updated prop — both
  // would compute `delta` against the same pre-update `akt`, letting a
  // combined increase through that individually stayed in budget. This ref is
  // updated synchronously inside setAttr itself, so the very next call (even
  // before a re-render lands) reads the value it just wrote.
  const attributesRef = useRef(attributes);
  attributesRef.current = attributes;

  const setAttr = (code: AttrRowCode, field: 'akt' | 'mod', v: number) => {
    const current = attributesRef.current;
    if (field === 'akt') {
      const unusedNow = attrPointsTheoreticalTotal(attrLevel, attrExtern) - attrPointsActualTotal(current);
      const delta = v - current[code].akt;
      if (delta > unusedNow) {
        setAttrWarn(
          `Keine Attributspunkte mehr übrig (${unusedNow} verfügbar) — weitere Quellen lassen sich in den Einstellungen eintragen.`,
        );
        setAttrFieldKey((k) => k + 1); // Feld auf den alten Wert zurücksetzen
        return;
      }
      setAttrWarn('');
    }
    const next = { ...current, [code]: { ...current[code], [field]: v } };
    attributesRef.current = next;
    update('attributes', next);
  };
  const setBvMod = (key: BaseValueKey, v: number) => update('baseValues', { ...baseValues, mods: { ...baseValues.mods, [key]: v } });
  const setResource = (key: ResourceKey, field: string, v: unknown) =>
    update('resources', { ...resources, [key]: { ...resources[key], [field]: v } });
  // Spezialenergien: Vorräte neben LE/AUS/AsE, ausgewählt aus dem GM-Katalog
  // (special_energies_catalog). Unveränderlich aktualisiert, damit React die
  // Zeilen sauber neu zeichnet.
  const [specialPick, setSpecialPick] = useState('');
  const setSpecial = (next: SpecialResource[]) => update('special', next);
  const setSpecialField = (i: number, field: 'name' | 'max' | 'bonus' | 'aktuell', v: number | string) =>
    setSpecial(special.map((s, j) => (j === i ? { ...s, [field]: v } : s)));
  // Ein Katalog-Eintrag höchstens einmal pro Charakter (siehe TODO.md) — schon
  // gewählte Einträge fallen aus der Auswahlliste.
  const availableEnergies = catalogs.specialEnergies.filter((e) => !special.some((s) => s.catalogId === e.id));
  const addSpecialFromCatalog = (catalogId: number) => {
    const entry = catalogs.specialEnergies.find((e) => e.id === catalogId);
    if (!entry || special.some((s) => s.catalogId === entry.id)) return;
    setSpecial([...special, { catalogId: entry.id, name: entry.name, max: 0, bonus: 0, aktuell: 0 }]);
    setSpecialPick('');
  };
  const removeSpecial = (i: number) => setSpecial(special.filter((_, j) => j !== i));
  // Eingaben für Formel-Spezialenergien (evaluateEnergyFormula): Lp/Adp/Asp
  // sind das NUTZBARE Maximum der festen Energien (an der Ausbaugrenze
  // gekappt), nicht die rohe Summe — dieselbe Zahl, die in der Energien-Tabelle
  // oben als „Maximum" steht.
  const energyFormulaVars = {
    attrs: attributesEff,
    leMax: computeResource(attributesEff, 'le', resourceInputMitBoni(resources.le, 'le', stats)).nutzbar,
    auMax: computeResource(attributesEff, 'aus', resourceInputMitBoni(resources.aus, 'aus', stats)).nutzbar,
    aseMax: computeResource(attributesEff, 'ase', resourceInputMitBoni(resources.ase, 'ase', stats)).nutzbar,
    psycheMax: psycheMax(attributesEff, meta.psycheBase ?? 0, (meta.psycheBonus ?? 0) + stats.psyche),
  };
  const setBio = (key: string, v: string) => update('bio', { ...bio, [key]: v });
  const setMeta = (key: string, v: number) => update('meta', { ...meta, [key]: v });

  // Stufe wird aus den Abenteuerpunkten abgeleitet
  const ap = meta.ap ?? 0;
  const guthaben = meta.apGuthaben ?? 0;
  const level = levelForAp(ap);
  const nextAp = nextLevelAp(ap);

  const [apDelta, setApDelta] = useState('');
  const [guthabenDelta, setGuthabenDelta] = useState('');

  // Erfahrungsgewinn: erhöht Abenteuerpunkte UND Guthaben (nur positiv)
  const addAp = () => {
    const x = Math.floor(Number(apDelta) || 0);
    if (x <= 0) return;
    update('meta', { ...meta, ap: ap + x, apGuthaben: guthaben + x });
    setApDelta('');
  };
  // Guthaben ausgeben/anpassen: verändert nur das Guthaben (auch negativ)
  const adjustGuthaben = () => {
    const x = Math.floor(Number(guthabenDelta) || 0);
    if (x === 0) return;
    update('meta', { ...meta, apGuthaben: guthaben + x });
    setGuthabenDelta('');
  };

  return (
    <>
      <div className="panel">
        <h3>Person</h3>
        <div className="person-layout">
          <Portrait id={charId} initialHasImage={data.portrait} />
          <div className="person-fields">
            {BIO_GROUPS.map((g) => (
              <section className="bio-group" key={g.title}>
                <h4 className="bio-group-title">{g.title}</h4>
                {g.singles && (
                  <div className="bio-singles">
                    {g.singles.map(([key, label]) => (
                      <div className="bio-cell" key={key}>
                        <label>{label}</label>
                        <TextInput value={bio[key] ?? ''} onChange={(v) => setBio(key, v)} />
                      </div>
                    ))}
                  </div>
                )}
                {g.pairs && (
                  <div className={`bio-pairs${g.evenPairs ? ' even' : ''}`}>
                    {g.pairs.map((pair) => (
                      <div className="bio-pair" key={pair[0][0]}>
                        {pair.map(([key, label]) => (
                          <div className="bio-cell" key={key}>
                            <label>{label}</label>
                            {key === 'rasse' ? (
                              <RaceSelect raceId={bio.rasseId} races={catalogs.races} onChange={setRace} />
                            ) : (
                              <TextInput value={bio[key] ?? ''} onChange={(v) => setBio(key, v)} />
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Attribute</h3>
          <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>Attribut</th>
                <th style={{ width: 70 }}>Basis</th>
                <th style={{ width: 70 }}>Mod.</th>
                <th style={{ width: 70 }}>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {ATTR_ROW_CODES.map((code) => (
                <tr key={code}>
                  <td>{ATTR_LABELS[code]}</td>
                  <td>
                    <NumInput key={attrFieldKey} value={attributes[code].akt} onChange={(v) => setAttr(code, 'akt', v)} />
                  </td>
                  <td>
                    <NumInput value={attributes[code].mod} onChange={(v) => setAttr(code, 'mod', v)} />
                  </td>
                  <td className="computed">
                    {/* SO (Sozialstatus) hat keine attr-Boni-Zielspalte (ATTR_CODES
                        schließt es aus) — quellen bleibt für SO immer leer. */}
                    <BonusWert quellen={stats.quellen[attrBonusKey(code as AttrCode)]}>
                      {attributesEff[code].akt + attributesEff[code].mod}
                    </BonusWert>
                    <ProbeRollButton source={{ kind: 'attribute', attr: code }} title={ATTR_LABELS[code]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="attr-points-note">Ungenutzte Attributspunkte: {attrUnused}</div>
        {attrWarn && <div className="magier-warn">{attrWarn}</div>}
        </div>

        <div className="panel">
          <h3>Basiswerte</h3>
          <div className="table-wrap">
          <table className="sheet sheet-fluid">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Wert</th>
                <th style={{ width: '34%' }}>Formel</th>
                <th style={{ width: '12%' }}>Basis</th>
                <th style={{ width: '14%' }}>Mod.</th>
                <th style={{ width: '14%' }}>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {BASE_VALUE_KEYS.map((key) => (
                <tr key={key}>
                  <td title={BASE_VALUE_LABELS[key].label}>{BASE_VALUE_LABELS[key].label}</td>
                  <td className="formel" title={BASE_VALUE_LABELS[key].formel}>{BASE_VALUE_LABELS[key].formel}</td>
                  <td className={key === 'gs' && selectedRace?.gs == null ? 'num' : 'computed'}>
                    {key === 'gs' ? (
                      selectedRace?.gs != null ? (
                        <span className="cell-value" title={`Von „${selectedRace.name}“ vorgegeben — über die Rassen-Auswahl änderbar, persönliche Anpassung über die Mod.-Spalte`}>
                          {baseValues.gsBase}
                        </span>
                      ) : (
                        <NumInput value={baseValues.gsBase} onChange={(v) => update('baseValues', { ...baseValues, gsBase: v })} />
                      )
                    ) : key === 'resilienz' && selectedRace?.resilienz != null ? (
                      <span title={`Enthält den Rassengrundwert von „${selectedRace.name}“ (${selectedRace.resilienz})`}>{bv[key].base}</span>
                    ) : (
                      bv[key].base
                    )}
                  </td>
                  <td>
                    <NumInput value={baseValues.mods[key]} onChange={(v) => setBvMod(key, v)} />
                  </td>
                  <td className="computed">
                    <BonusWert quellen={stats.quellen[baseValueBonusKey(key)]}>{bv[key].ergebnis}</BonusWert>
                    {(key === 'ausweichen' || key === 'ini') && (
                      <ProbeRollButton source={{ kind: 'baseValue', key }} title={BASE_VALUE_LABELS[key].label} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Energien</h3>
        <div className="table-wrap">
        <table className="sheet sheet-fluid">
          <thead>
            {/* Zweizeiliger Kopf: oben das Ziel (Maximum bzw. Ausbaugrenze),
                unten die Herkunft (gewährt bzw. mit AP gekauft). */}
            <tr>
              <th rowSpan={2} style={{ width: '16%' }}>
                Energie
              </th>
              <th rowSpan={2} style={{ width: '28%' }}>
                Formel
              </th>
              <th rowSpan={2} style={{ width: '7%' }}>
                {RC.formelwert}
              </th>
              <th className="group" colSpan={3}>
                {RC.maximum}
              </th>
              <th className="group" colSpan={3}>
                {RC.ausbaugrenze}
              </th>
              <th rowSpan={2} style={{ width: '7%' }}>
                {RC.aktuell}
              </th>
            </tr>
            <tr>
              <th style={{ width: '7%' }}>{RC.bonus}</th>
              <th style={{ width: '7%' }}>{RC.gekauft}</th>
              <th style={{ width: '7%' }}>{RC.summe}</th>
              <th style={{ width: '7%' }}>{RC.bonus}</th>
              <th style={{ width: '7%' }}>{RC.gekauft}</th>
              <th style={{ width: '7%' }}>{RC.summe}</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((key) => {
              const r = computeResource(attributesEff, key, resourceInputMitBoni(resources[key], key, stats));
              const akt = resources[key].aktuell;
              // Zehrung UND Überladung messen am nutzbaren Maximum — über der
              // Ausbaugrenze liegende Rohsummen sind kein Vorrat.
              const cls = poolClass(key, akt, r.nutzbar);
              const ratio = r.nutzbar > 0 ? akt / r.nutzbar : 1;
              const quellen = stats.quellen[resourceBonusKey(key)];
              return (
                <tr key={key}>
                  <td title={RESOURCE_LABELS[key].label}>{RESOURCE_LABELS[key].label}</td>
                  <td className="formel" title={RESOURCE_LABELS[key].formel}>{RESOURCE_LABELS[key].formel}</td>
                  <td className="computed">{r.vorergebnis}</td>
                  <td>
                    <NumInput value={resources[key].permanent} onChange={(v) => setResource(key, 'permanent', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kauf} onChange={(v) => setResource(key, 'kauf', v)} />
                  </td>
                  <td className="computed">
                    <BonusWert quellen={quellen}>
                      <MaximumWert nutzbar={r.nutzbar} roh={r.ergebnis} gekappt={r.gekappt} />
                    </BonusWert>
                  </td>
                  <td>
                    <NumInput value={resources[key].maxPlus} onChange={(v) => setResource(key, 'maxPlus', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kaufMax} onChange={(v) => setResource(key, 'kaufMax', v)} />
                  </td>
                  <td className="computed">
                    <BonusWert quellen={quellen}>{r.max ?? '—'}</BonusWert>
                  </td>
                  <td
                    className={cls || undefined}
                    title={
                      cls === 'res-over'
                        ? `überladen: ${akt}/${r.nutzbar}`
                        : cls
                          ? `${Math.round(ratio * 100)} % — ${akt}/${r.nutzbar}`
                          : undefined
                    }
                  >
                    <NumInput value={akt} onChange={(v) => setResource(key, 'aktuell', v)} />
                  </td>
                </tr>
              );
            })}
            {/* Psyche: kein echter Vorrat wie LE/AUS/AsE — Max aus Rassengrundwert
                + Bonus + MU-Anteil, OHNE Ausbaugrenze. Rassengrundwert steht in
                der Bonus-Spalte, der Zusatz-Bonus in der Gekauft-Spalte (die
                festen Kopfzeilen passen nicht 1:1, daher die title-Tooltips).
                Rassengrundwert kommt aus dem Rassen-Katalog (races_catalog.psyche)
                und ist danach gesperrt, solange die Rasse einen Wert liefert —
                persönliche Anpassung läuft über den Bonus daneben. */}
            {(() => {
              const pBase = meta.psycheBase ?? 0;
              const pRaceLocked = selectedRace?.psyche != null;
              const pBonus = meta.psycheBonus ?? 0;
              const pMuAnteil = psycheMuAnteil(attributesEff);
              const pMax = psycheMax(attributesEff, pBase, pBonus + stats.psyche);
              const pAkt = meta.psycheAkt ?? 0;
              const pQuellen = stats.quellen[PSYCHE_BONUS_KEY];
              return (
                <tr>
                  <td title="Psyche">Psyche</td>
                  <td className="formel" title="Rasse + Bonus + 5·(MU-10)">Rasse + Bonus + 5·(MU-10)</td>
                  <td className="computed">{pMuAnteil}</td>
                  {/* Eigene Zell-Labels statt der geteilten Kopfzeile: die Psyche
                      hat andere Eingaben (Bonus/Rassenwert) als LE/AUS/AsE, deren
                      „Bonus/Gekauft"-Kopf hier nicht passt. Nur diese Zeile ist
                      betroffen; der Tabellenkopf bleibt für die anderen unberührt.
                      Reihenfolge bewusst: der Bonus sitzt unter „Bonus", der
                      Rassenwert übernimmt die „Gekauft"-Spalte. */}
                  <td title="Bonus (z. B. Effekte)">
                    <div className="cell-labeled">
                      <span className="cell-label">Bonus</span>
                      <NumInput value={pBonus} onChange={(v) => setMeta('psycheBonus', v)} />
                    </div>
                  </td>
                  <td title={pRaceLocked ? `Von „${selectedRace!.name}“ vorgegeben — über die Rassen-Auswahl änderbar, persönliche Anpassung über den Bonus` : 'Rassengrundwert'}>
                    <div className="cell-labeled">
                      <span className="cell-label">Rasse</span>
                      {pRaceLocked ? <span className="cell-value">{pBase}</span> : <NumInput value={pBase} onChange={(v) => setMeta('psycheBase', v)} />}
                    </div>
                  </td>
                  <td className="computed">
                    <BonusWert quellen={pQuellen}>{pMax}</BonusWert>
                  </td>
                  <td className="computed">—</td>
                  <td className="computed">—</td>
                  <td className="computed">—</td>
                  <td
                    className={overfilled(pAkt, pMax) ? 'res-over' : undefined}
                    title={overfilled(pAkt, pMax) ? `überladen: ${pAkt}/${pMax}` : undefined}
                  >
                    <NumInput value={pAkt} onChange={(v) => setMeta('psycheAkt', v)} />
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>
        </div>

        {/* Spezialenergien: eigene, schlanke Tabelle unter denselben Energien —
            ausgewählt aus dem GM-Katalog (special_energies_catalog), je Eintrag
            höchstens einmal pro Charakter. Hat der Katalog-Eintrag eine Formel,
            wird das Maximum wie bei LE/AUS/AsE live berechnet und ist NICHT
            editierbar; ohne Formel bleibt es (wie bisher) frei einstellbar.
            catalogId===null sind Altbestand aus der Zeit vor dem Katalog (siehe
            SpecialResource in shared/src/types.ts) — Name/Maximum bleiben dort
            wie gehabt frei editierbar, damit nichts verloren geht. Bewusst KEINE
            AP-/Ausbau-Spalten: sie soll nicht wie die feste Tabelle wirken.
            Getrennte Ablage, damit deren starre Spalten sie nicht verformen. */}
        <div className="subhead-row">
          <h4>Spezialenergien</h4>
          {!readOnly && special.length < MAX_SPECIAL_RESOURCES && availableEnergies.length > 0 && (
            <>
              <select value={specialPick} onChange={(e) => setSpecialPick(e.target.value)}>
                <option value="">Energie wählen …</option>
                {availableEnergies.map((e) => (
                  <option key={e.id} value={e.id} title={e.beschreibung}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button
                className="small add-row"
                disabled={!specialPick}
                onClick={() => addSpecialFromCatalog(Number(specialPick))}
              >
                + Hinzufügen
              </button>
            </>
          )}
        </div>
        {special.length === 0 ? (
          <p className="muted">Energien aus dem Katalog des Spielleiters oben hinzufügen (z. B. Karma, Wut, Chi).</p>
        ) : (
          <div className="table-wrap">
            <table className="sheet" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Regeneration</th>
                  <th>Umrechnung in normale Energien</th>
                  <th style={{ width: 70 }} title="Nur bei Formel-Energien: persönlicher Zuschlag (Talent, Gegenstand …), addiert auf das Formel-Ergebnis">
                    Bonus
                  </th>
                  <th style={{ width: 100 }}>Maximum</th>
                  <th style={{ width: 100 }}>Aktuell</th>
                  {!readOnly && <th style={{ width: 40 }} aria-label="Entfernen" />}
                </tr>
              </thead>
              <tbody>
                {special.map((s, i) => {
                  const catEntry = s.catalogId == null ? null : (catalogs.specialEnergies.find((e) => e.id === s.catalogId) ?? null);
                  // Formel nur wirksam, wenn der Katalog-Eintrag (noch) existiert
                  // UND eine Formel trägt — sonst bleibt max frei editierbar, wie
                  // bei einer rein manuellen Energie oder einer gelöschten Katalog-
                  // Zuordnung (kein Datenverlust: die Zeile bleibt erhalten). Bonus
                  // gibt es nur bei Formel-Energien (siehe SpecialResource) — beim
                  // freien max deckt das Feld selbst denselben Zweck ab.
                  const formula = catEntry?.formula ?? '';
                  const formulaMax = formula ? evaluateEnergyFormula(formula, energyFormulaVars) : null;
                  // s.bonus ist der rohe, gespeicherte Wert (bindet die NumInput
                  // unten weiter unverändert); specialMitBoni legt den Item-Bonus
                  // fürs RECHNEN oben drauf, ohne ihn zurückzuschreiben.
                  const effectiveBonus = specialMitBoni(s, stats).bonus;
                  const computedMax = formulaMax != null ? formulaMax + effectiveBonus : null;
                  const max = computedMax ?? s.max;
                  const spezialQuellen = s.catalogId != null ? stats.quellen[spezialBonusKey(s.catalogId)] : undefined;
                  return (
                    <tr key={i}>
                      <td title={s.catalogId == null ? 'Altbestand (frei benannt)' : catEntry?.beschreibung}>
                        {s.catalogId == null ? <TextInput value={s.name} onChange={(v) => setSpecialField(i, 'name', v)} /> : s.name}
                      </td>
                      <td className="formel" title={catEntry?.regeneration || undefined}>
                        {catEntry?.regeneration || '—'}
                      </td>
                      <td className="formel" title={catEntry?.umrechnung || undefined}>
                        {catEntry?.umrechnung || '—'}
                      </td>
                      <td>
                        {formulaMax != null ? (
                          <NumInput value={s.bonus} onChange={(v) => setSpecialField(i, 'bonus', v)} />
                        ) : (
                          <span className="cell-value">—</span>
                        )}
                      </td>
                      <td className={computedMax != null ? 'computed' : undefined} title={formula || undefined}>
                        {computedMax != null ? (
                          <BonusWert quellen={spezialQuellen}>{computedMax}</BonusWert>
                        ) : (
                          <NumInput value={s.max} onChange={(v) => setSpecialField(i, 'max', v)} />
                        )}
                      </td>
                      {/* Aktuell darf über dem Maximum stehen (Überladung) — nicht
                          kappen, nur färben wie bei den festen Energien. */}
                      <td
                        className={overfilled(s.aktuell, max) ? 'res-over' : undefined}
                        title={overfilled(s.aktuell, max) ? `überladen: ${s.aktuell}/${max}` : undefined}
                      >
                        <NumInput value={s.aktuell} onChange={(v) => setSpecialField(i, 'aktuell', v)} />
                      </td>
                      {!readOnly && (
                        <td>
                          <ConfirmDeleteButton title="Energie entfernen" onConfirm={() => removeSpecial(i)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Stufe &amp; Punkte</h3>
          <div className="level-banner">
            <div className="level-badge">
              <span className="level-num">{level}</span>
            </div>
            <div className="level-next">
              {nextAp == null ? (
                <div>Maximale Stufe erreicht</div>
              ) : (
                <>
                  <div>
                    Nächste Stufe bei <strong>{nextAp.toLocaleString('de-DE')}</strong> AP
                  </div>
                  <div className="muted">noch {(nextAp - ap).toLocaleString('de-DE')} AP</div>
                </>
              )}
            </div>
          </div>
          <div className="points-grid">
            {/* Die Verrechnen-Felder sind Werkzeuge, keine Werte — ohne
                Bearbeiten bleibt nur der Stand stehen. */}
            <label>Abenteuerpunkte</label>
            {readOnly ? (
              <span />
            ) : (
              <input
                type="number"
                value={apDelta}
                placeholder="+ Menge"
                onChange={(e) => setApDelta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAp()}
              />
            )}
            <div className="pctrl">
              {!readOnly && (
                <button className="btn-action" disabled={!apDelta} onClick={addAp} title="Erfahrung gewinnen: erhöht Abenteuerpunkte und Guthaben">
                  Hinzufügen
                </button>
              )}
              <span className="muted">Stand:</span>
              <span className="pnum">{ap.toLocaleString('de-DE')}</span>
            </div>

            <label>AP-Guthaben</label>
            {readOnly ? (
              <span />
            ) : (
              <input
                type="number"
                value={guthabenDelta}
                placeholder="± Menge"
                onChange={(e) => setGuthabenDelta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && adjustGuthaben()}
              />
            )}
            <div className="pctrl">
              {!readOnly && (
                <button className="btn-action" disabled={!guthabenDelta} onClick={adjustGuthaben} title="Guthaben ausgeben oder anpassen (auch negativ)">
                  Anpassen
                </button>
              )}
              <span className="muted">Stand:</span>
              <span className="pnum">{guthaben.toLocaleString('de-DE')}</span>
            </div>

            {META_FIELDS.map(([key, label]) => (
              <Fragment key={key}>
                <label>{label}</label>
                <NumInput value={meta[key] ?? 0} onChange={(v) => setMeta(key, v)} />
                <span />
              </Fragment>
            ))}
          </div>
        </div>

        <GeldPanel pouches={pouches} systems={catalogs.currencies} setPouches={(next) => update('pouches', next)} />
      </div>
    </>
  );
}

// Rasse: ein `<select>` läuft nicht durch NumInput/TextInput und bliebe
// ungegated auch auf einem schreibgeschützten Blatt bedienbar (siehe WaffenNeu
// TalentCell für dieselbe Begründung) — im Nur-Lesen-Modus daher nur Text.
// Gruppiert per <optgroup>, damit die ~66 Katalog-Rassen nicht als eine lange
// flache Liste stehen; Reihenfolge folgt dem Katalog-Sort (Herkunft des PDFs).
function RaceSelect({
  raceId,
  races,
  onChange,
}: {
  raceId: number | null;
  races: RaceCatalogRow[];
  onChange: (race: RaceCatalogRow | null) => void;
}) {
  const readOnly = useReadOnly();
  const current = races.find((r) => r.id === raceId) ?? null;

  if (readOnly) {
    return <span className="static-value static-text">{current?.name ?? ''}</span>;
  }

  const groups = new Map<string, RaceCatalogRow[]>();
  for (const r of races) {
    const key = r.gruppe || '—';
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  return (
    <div className="race-select">
      <select value={raceId ?? ''} onChange={(e) => onChange(races.find((r) => r.id === Number(e.target.value)) ?? null)}>
        <option value="">— keine gewählt —</option>
        {[...groups.entries()].map(([gruppe, rows]) => (
          <optgroup key={gruppe} label={gruppe}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {current && (
        <p className="muted race-info">
          {current.beschreibung}
          {current.beschreibung ? ' — ' : ''}
          {raceBonusSummary(current)}
        </p>
      )}
    </div>
  );
}

function raceBonusSummary(r: RaceCatalogRow): string {
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const parts: string[] = [];
  if (r.le != null && r.le !== 0) parts.push(`LE ${signed(r.le)}`);
  if (r.au != null && r.au !== 0) parts.push(`AU ${signed(r.au)}`);
  if (r.ae != null && r.ae !== 0) parts.push(`AsE ${signed(r.ae)}`);
  if (r.mr != null && r.mr !== 0) parts.push(`MR ${signed(r.mr)}`);
  if (r.ak != null && r.ak !== 0) parts.push(`AK ${signed(r.ak)}`);
  if (r.gs != null) parts.push(`GS ${r.gs}`);
  if (r.psyche != null) parts.push(`Psyche ${r.psyche}`);
  if (r.resilienz != null && r.resilienz !== 0) parts.push(`Resilienz ${signed(r.resilienz)}`);
  return parts.length ? parts.join(', ') : 'keine Werte hinterlegt';
}
