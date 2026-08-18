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
import type { AttrRowCode, BaseValueKey, ResourceKey, SpecialResource } from '@shared/types';
import { Fragment, useState } from 'react';
import {
  attrPointsActualTotal,
  attrPointsTheoreticalTotal,
  computeBaseValues,
  computeResource,
  levelForAp,
  nextLevelAp,
  psycheMax,
  psycheMuAnteil,
} from '@shared/rules';
import { useReadOnly } from '../components/displayMode';
import ProbeRollButton from '../components/dice/ProbeRollButton';
import { NumInput, TextInput } from '../components/inputs';
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
  const { charId, data, catalogs, update } = useChar();
  const readOnly = useReadOnly();
  const { attributes, baseValues, resources, special, bio, meta, attrExtern, pouches } = data;

  // Aktuell gewählte Rasse (für Anzeige UND um Basis-Zellen zu sperren, siehe unten).
  const selectedRace = catalogs.races.find((r) => r.id === bio.rasseId) ?? null;

  // Rasse auswählen: setzt rasseId UND (fürs Altbestands-Freitextfeld, das
  // Zusammenfassung/Druck weiter unverändert lesen) den Namen mit. gs, Psyche
  // und Resilienz sind Rassengrundwerte (kein einfacher Bonus) — bei Auswahl
  // übernommen und danach GESPERRT (siehe die drei Zellen weiter unten), damit
  // sie nur über eine neue Rassen-Wahl ändern; persönliche Anpassung läuft über
  // die jeweils vorhandene Mod./Bonus-Spalte.
  const setRace = (race: RaceCatalogRow | null) => {
    update('bio', { ...bio, rasseId: race?.id ?? null, rasse: race?.name ?? '' });
    // EIN Aufruf für beide Basiswert-Felder: update() spiegelt state-intern
    // nicht sofort zurück in dieses `baseValues`, also würde ein zweiter
    // Aufruf mit demselben (veralteten) Objekt die erste Änderung überschreiben.
    if (race?.gs != null || race?.resilienz != null) {
      update('baseValues', {
        ...baseValues,
        ...(race?.gs != null ? { gsBase: race.gs } : null),
        ...(race?.resilienz != null ? { resilienzBase: race.resilienz } : null),
      });
    }
    if (race?.psyche != null) update('meta', { ...meta, psycheBase: race.psyche });
  };

  const bv = computeBaseValues(attributes, baseValues);

  // Ungenutzte Attributspunkte: theoretisch verfügbar (Stufe + externe Quellen,
  // siehe Einstellungen) minus tatsächlich gesetzte Summe. Eine Erhöhung, die
  // ins Minus liefe, wird abgelehnt — Spieler müssen die Quelle erst in den
  // Einstellungen eintragen (auch Bestandscharaktere: siehe Migrationskorrektur
  // serverseitig).
  const attrLevel = levelForAp(meta.ap ?? 0);
  const attrUnused = attrPointsTheoreticalTotal(attrLevel, attrExtern) - attrPointsActualTotal(attributes);
  const [attrWarn, setAttrWarn] = useState('');
  const [attrFieldKey, setAttrFieldKey] = useState(0);

  const setAttr = (code: AttrRowCode, field: 'akt' | 'mod', v: number) => {
    if (field === 'akt') {
      const delta = v - attributes[code].akt;
      if (delta > attrUnused) {
        setAttrWarn(
          `Keine Attributspunkte mehr übrig (${attrUnused} verfügbar) — weitere Quellen lassen sich in den Einstellungen eintragen.`,
        );
        setAttrFieldKey((k) => k + 1); // Feld auf den alten Wert zurücksetzen
        return;
      }
      setAttrWarn('');
    }
    update('attributes', { ...attributes, [code]: { ...attributes[code], [field]: v } });
  };
  const setBvMod = (key: BaseValueKey, v: number) => update('baseValues', { ...baseValues, mods: { ...baseValues.mods, [key]: v } });
  const setResource = (key: ResourceKey, field: string, v: unknown) =>
    update('resources', { ...resources, [key]: { ...resources[key], [field]: v } });
  // Spezialenergien: frei benannte Vorräte in einer eigenen Liste. Unveränderlich
  // aktualisiert, damit React die Zeilen sauber neu zeichnet.
  const setSpecial = (next: SpecialResource[]) => update('special', next);
  const setSpecialField = (i: number, field: keyof SpecialResource, v: unknown) =>
    setSpecial(special.map((s, j) => (j === i ? { ...s, [field]: v } : s)));
  const addSpecial = () => setSpecial([...special, { name: '', max: 0, aktuell: 0 }]);
  const removeSpecial = (i: number) => setSpecial(special.filter((_, j) => j !== i));
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
          <Portrait charId={charId} initialHasImage={data.portrait} />
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
                <th style={{ width: 70 }}>Bonus</th>
                <th style={{ width: 70 }}>Max</th>
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
                    {attributes[code].akt + attributes[code].mod}
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
          <table className="sheet">
            <thead>
              <tr>
                <th>Wert</th>
                <th>Formel</th>
                <th style={{ width: 60 }}>Basis</th>
                <th style={{ width: 70 }}>Mod.</th>
                <th style={{ width: 70 }}>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {BASE_VALUE_KEYS.map((key) => (
                <tr key={key}>
                  <td>{BASE_VALUE_LABELS[key].label}</td>
                  <td className="formel">{BASE_VALUE_LABELS[key].formel}</td>
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
                  <td className="computed">{bv[key].ergebnis}</td>
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
        <table className="sheet" style={{ minWidth: 900 }}>
          <thead>
            {/* Zweizeiliger Kopf: oben das Ziel (Maximum bzw. Ausbaugrenze),
                unten die Herkunft (gewährt bzw. mit AP gekauft). */}
            <tr>
              <th rowSpan={2}>Energie</th>
              <th rowSpan={2}>Formel</th>
              <th rowSpan={2} style={{ width: 80 }}>
                {RC.formelwert}
              </th>
              <th className="group" colSpan={3}>
                {RC.maximum}
              </th>
              <th className="group" colSpan={3}>
                {RC.ausbaugrenze}
              </th>
              <th rowSpan={2} style={{ width: 80 }}>
                {RC.aktuell}
              </th>
            </tr>
            <tr>
              <th style={{ width: 80 }}>{RC.bonus}</th>
              <th style={{ width: 80 }}>{RC.gekauft}</th>
              <th style={{ width: 80 }}>{RC.summe}</th>
              <th style={{ width: 80 }}>{RC.bonus}</th>
              <th style={{ width: 80 }}>{RC.gekauft}</th>
              <th style={{ width: 80 }}>{RC.summe}</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((key) => {
              const r = computeResource(attributes, key, resources[key]);
              const akt = resources[key].aktuell;
              // Zehrung UND Überladung messen am nutzbaren Maximum — über der
              // Ausbaugrenze liegende Rohsummen sind kein Vorrat.
              const cls = poolClass(key, akt, r.nutzbar);
              const ratio = r.nutzbar > 0 ? akt / r.nutzbar : 1;
              return (
                <tr key={key}>
                  <td>{RESOURCE_LABELS[key].label}</td>
                  <td className="formel">{RESOURCE_LABELS[key].formel}</td>
                  <td className="computed">{r.vorergebnis}</td>
                  <td>
                    <NumInput value={resources[key].permanent} onChange={(v) => setResource(key, 'permanent', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kauf} onChange={(v) => setResource(key, 'kauf', v)} />
                  </td>
                  <td className="computed">
                    <MaximumWert nutzbar={r.nutzbar} roh={r.ergebnis} gekappt={r.gekappt} />
                  </td>
                  <td>
                    <NumInput value={resources[key].maxPlus} onChange={(v) => setResource(key, 'maxPlus', v)} />
                  </td>
                  <td>
                    <NumInput value={resources[key].kaufMax} onChange={(v) => setResource(key, 'kaufMax', v)} />
                  </td>
                  <td className="computed">{r.max ?? '—'}</td>
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
              const pMuAnteil = psycheMuAnteil(attributes);
              const pMax = psycheMax(attributes, pBase, pBonus);
              const pAkt = meta.psycheAkt ?? 0;
              return (
                <tr>
                  <td>Psyche</td>
                  <td className="formel">Rasse + Bonus + 5·(MU-10)</td>
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
                  <td className="computed">{pMax}</td>
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

        {/* Spezialenergien (light): eigene, schlanke Tabelle unter denselben
            Energien — name/max/aktuell, vom Spieler selbst erweiterbar. Bewusst
            KEINE AP-/Ausbau-Spalten: sie soll nicht wie die feste Tabelle wirken.
            Getrennte Ablage, damit deren starre Spalten sie nicht verformen. */}
        <div className="subhead-row">
          <h4>Spezialenergien</h4>
          {!readOnly && special.length < MAX_SPECIAL_RESOURCES && (
            <button className="small add-row" onClick={addSpecial}>
              + Zeile
            </button>
          )}
        </div>
        {special.length === 0 ? (
          <p className="muted">
            Eigene Energien (z. B. Karma, Odem, Blutkraft) mit „+ Zeile“ hinzufügen — je Eintrag Name, Maximum und
            aktueller Wert.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="sheet" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 100 }}>Maximum</th>
                  <th style={{ width: 100 }}>Aktuell</th>
                  {!readOnly && <th style={{ width: 40 }} aria-label="Entfernen" />}
                </tr>
              </thead>
              <tbody>
                {special.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <TextInput value={s.name} onChange={(v) => setSpecialField(i, 'name', v)} />
                    </td>
                    <td>
                      <NumInput value={s.max} onChange={(v) => setSpecialField(i, 'max', v)} />
                    </td>
                    {/* Aktuell darf über dem Maximum stehen (Überladung) — nicht
                        kappen, nur färben wie bei den festen Energien. */}
                    <td
                      className={overfilled(s.aktuell, s.max) ? 'res-over' : undefined}
                      title={overfilled(s.aktuell, s.max) ? `überladen: ${s.aktuell}/${s.max}` : undefined}
                    >
                      <NumInput value={s.aktuell} onChange={(v) => setSpecialField(i, 'aktuell', v)} />
                    </td>
                    {!readOnly && (
                      <td>
                        <ConfirmDeleteButton title="Energie entfernen" onConfirm={() => removeSpecial(i)} />
                      </td>
                    )}
                  </tr>
                ))}
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
