import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../api';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';
import { DOMAIN_LABELS, SHEET_DOMAINS, SYNCABLE_DOMAINS } from '@shared/sheetDomains';
import type { SheetDomain } from '@shared/sheetDomains';
import type { CharacterInfo, SheetInfo } from './charSheet';

// Mehrere Bögen pro Charakter (docs/concepts/shapeshifting.md): Umschalter für
// den BETRACHTETEN Bogen (Besitzer und Spielleitung), dazu — nur für den
// Besitzer — „Aktivieren" und die Verwaltung der Formen. „Aktiv" ist das, was
// Tisch, Gruppe und Würfe sehen; „betrachtet" ist nur, was hier im Editor offen ist.

const radioRow: React.CSSProperties = { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 8, textAlign: 'left' };
// Globale input-Regeln strecken sonst auch Radios auf volle Breite.
const radioInput: React.CSSProperties = { width: 'auto', flex: '0 0 auto', margin: '3px 0 0' };

export const sheetLabel = (s: SheetInfo) => s.label || (s.isBase ? 'Grundform' : 'Form');

export function SheetSwitcher({
  info,
  isOwner,
  readOnly,
  onView,
  onChanged,
}: {
  info: CharacterInfo;
  /** Nur die Besitzerin / der Besitzer verwaltet die Bögen. */
  isOwner: boolean;
  /** „Ansehen als" und Verwaltungs-Einsicht: nichts verändern. */
  readOnly: boolean;
  /** Anderen Bogen betrachten (der Aufrufer sichert zuvor ungespeicherte Änderungen). */
  onView: (sheetId: number) => void | Promise<void>;
  /** Nach jeder Änderung an den Formen: neu laden; `view` = danach diesen Bogen betrachten. */
  onChanged: (view?: number) => void | Promise<void>;
}) {
  const sheets = info.sheets ?? [];
  const viewed = info.sheetId ?? info.id;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = isOwner && !readOnly;
  // Ohne weitere Form gibt es nichts umzuschalten; die Besitzerin braucht trotzdem den Zugang zum Anlegen.
  if (sheets.length <= 1 && !canManage) return null;

  const run = async (fn: () => Promise<unknown>, view?: number) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const viewedActive = sheets.find((s) => s.id === viewed)?.active ?? true;

  return (
    <>
      {sheets.length > 1 && (
        <select
          style={{ width: 'auto', minWidth: '9.5em' }}
          value={viewed}
          aria-label="Bogen"
          title="Welcher Bogen hier geöffnet ist. Aktiv ist der Bogen, den Tisch, Gruppe und Würfe verwenden."
          onChange={(e) => {
            // Die Verwaltung steckt als letzter Eintrag im selben Menü (spart Platz in der Kopfzeile).
            if (e.target.value === 'manage') setOpen(true);
            else void onView(Number(e.target.value));
          }}
        >
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {sheetLabel(s)}
              {s.active ? ' ● aktiv' : ''}
            </option>
          ))}
          {canManage && <option value="manage">⚙ Formen verwalten…</option>}
        </select>
      )}
      {canManage && sheets.length > 1 && !viewedActive && (
        <button
          className="small primary"
          disabled={busy}
          title="Diesen Bogen ins Spiel bringen: Tisch, Gruppe und Würfe verwenden ab jetzt ihn"
          onClick={() => void run(() => apiPut(`/api/characters/${info.id}/active-sheet`, { sheetId: viewed }))}
        >
          Aktivieren
        </button>
      )}
      {canManage && sheets.length <= 1 && (
        <button className="small" onClick={() => setOpen(true)} title="Weitere Form anlegen (z. B. eine Tiergestalt)">
          + Form
        </button>
      )}
      {!canManage && sheets.length > 1 && !viewedActive && <span className="muted">(nicht aktiv, keine Würfe)</span>}
      {canManage && (
        <SheetsDialog
          open={open}
          onClose={() => setOpen(false)}
          info={info}
          sheets={sheets}
          busy={busy}
          error={error}
          run={run}
        />
      )}
    </>
  );
}

/** Knopf(-folge) zum Entkoppeln bzw. Wiederverknüpfen eines geteilten Teils; fragt nur dort nach, wo Daten betroffen sind. */
export function PartAction({
  linked,
  dormant,
  rows,
  busy,
  onDetach,
  onLink,
  unit = 'Einträge',
}: {
  linked: boolean;
  /** Es liegt noch eine zurückgelegte eigene Kopie darunter. */
  dormant: boolean;
  /** Anzahl der eigenen (bzw. zurückgelegten) Einträge, nur zur Anzeige. */
  rows: number;
  busy: boolean;
  onDetach: (resume: boolean) => void;
  onLink: () => void;
  unit?: string;
}) {
  const [ask, setAsk] = useState<null | 'detach' | 'link'>(null);
  const noun = rows === 1 ? (unit === 'Sektionen' ? 'Sektion' : 'Eintrag') : unit;
  const done = (fn: () => void) => () => {
    setAsk(null);
    fn();
  };
  const cancel = (
    <button className="small" onClick={() => setAsk(null)}>
      Abbrechen
    </button>
  );
  if (ask === 'detach') {
    return (
      <span style={askStyle}>
        <span>
          Es gibt noch eine eigene Kopie von früher ({rows} {noun}).
        </span>
        <button className="small" disabled={busy} onClick={done(() => onDetach(true))}>
          Weiterverwenden
        </button>
        <button className="small" disabled={busy} onClick={done(() => onDetach(false))} title="Ersetzt die zurückgelegte Kopie">
          Neu aus der Grundform
        </button>
        {cancel}
      </span>
    );
  }
  if (ask === 'link') {
    return (
      <span style={askStyle}>
        <span>
          Die eigenen Daten ({rows} {noun}) werden zurückgelegt, nicht gelöscht.
        </span>
        <button className="small primary" disabled={busy} onClick={done(onLink)}>
          Verknüpfen
        </button>
        {cancel}
      </span>
    );
  }
  return linked ? (
    <button
      className="small"
      disabled={busy}
      title="Die Form bekommt eine eigene Kopie. Die Grundform bleibt unverändert."
      onClick={() => (dormant ? setAsk('detach') : onDetach(false))}
    >
      Entkoppeln
    </button>
  ) : (
    <button
      className="small"
      disabled={busy}
      title="Die Form nutzt wieder die Daten der Grundform"
      onClick={() => (rows > 0 ? setAsk('link') : onLink())}
    >
      Mit Grundform verknüpfen
    </button>
  );
}

const askStyle: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 };

/** Was auf dem gerade betrachteten Reiter einer Form geteilt ist (für den Hinweis über dem Inhalt). */
export type LinkedHint = { kind: 'domain'; domain: SheetDomain } | { kind: 'tab'; tabId: number };

/** Hinweis „Gemeinsam mit Grundform" über einem verknüpften Reiter, mit Entkoppeln für den Besitzer. */
export function LinkedBanner({
  info,
  form,
  hint,
  canManage,
  onChanged,
}: {
  info: CharacterInfo;
  form: SheetInfo;
  hint: LinkedHint;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/characters/${info.id}/sheets/${form.id}`;
  const state = hint.kind === 'domain' ? form.domains?.[hint.domain] : form.tabs?.find((t) => t.id === hint.tabId);
  const dormant = hint.kind === 'domain' ? !!(state as { dormant?: boolean } | undefined)?.dormant : !!(state as { hasDormant?: boolean } | undefined)?.hasDormant;
  const rows = hint.kind === 'domain' ? ((state as { rows?: number } | undefined)?.rows ?? 0) : ((state as { ownSections?: number } | undefined)?.ownSections ?? 0);
  const what = hint.kind === 'domain' ? DOMAIN_LABELS[hint.domain] : 'Dieser Reiter';
  return (
    <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10 }}>
      <span>
        🔗 <strong>Gemeinsam mit Grundform.</strong>{' '}
        <span className="muted">
          {hint.kind === 'domain' && hint.domain === 'waffen'
            ? 'Die Listen (Raufen/Ringen, Kampfstile) sind geteilt. Waffen als Gegenstände sind es immer.'
            : `${what}: Änderungen hier gelten auch dort, und umgekehrt.`}
        </span>
      </span>
      {canManage && (
        <PartAction
          linked
          dormant={dormant}
          rows={rows}
          busy={busy}
          unit={hint.kind === 'domain' ? 'Einträge' : 'Sektionen'}
          onLink={() => undefined}
          onDetach={(resume) =>
            void run(() =>
              apiPost(hint.kind === 'domain' ? `${base}/domains/${hint.domain}/detach` : `${base}/tabs/${hint.tabId}/detach`, { resume }),
            )
          }
        />
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

type Choice = 'copy' | 'sync' | 'skip';
const CHOICE_LABELS: Record<Choice, string> = { copy: 'Kopieren (danach unabhängig)', sync: 'Synchron halten', skip: 'Leer lassen' };

function SheetsDialog({
  open,
  onClose,
  info,
  sheets,
  busy,
  error,
  run,
}: {
  open: boolean;
  onClose: () => void;
  info: CharacterInfo;
  sheets: SheetInfo[];
  busy: boolean;
  error: string;
  run: (fn: () => Promise<unknown>, view?: number) => Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [domainChoice, setDomainChoice] = useState<Record<string, Choice>>({});
  const [tabChoice, setTabChoice] = useState<Record<number, Choice>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const draftOf = (s: SheetInfo) => drafts[s.id] ?? s.label;
  const baseTabs = info.baseTabs ?? [];

  const create = () =>
    run(async () => {
      const domains: Record<string, Choice> = {};
      for (const d of SHEET_DOMAINS) domains[d] = domainChoice[d] ?? 'copy';
      const tabs: Record<number, Choice> = {};
      for (const t of baseTabs) tabs[t.id] = tabChoice[t.id] ?? 'copy';
      const res = await apiPost<{ id: number }>(`/api/characters/${info.id}/forms`, { label: newLabel.trim(), plan: { domains, tabs } });
      setNewLabel('');
      return res;
    }).then(() => undefined);

  const choiceRow = (key: string, label: string, value: Choice, options: Choice[], onChange: (c: Choice) => void) => (
    <tr key={key}>
      <td>{label}</td>
      <td>
        <select style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value as Choice)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {CHOICE_LABELS[o]}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Formen"
      wide
      footer={
        <button className="small" onClick={onClose}>
          Schließen
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Jede Form ist ein eigener, vollständiger Bogen. Gegenstände, Geld, Ausrüstungs-Sets, Schicksalspunkte und die
        SL-Notizen gehören zum Charakter und sind in allen Formen dieselben. Die Grundform lässt sich nicht löschen.
      </p>
      <table className="sheet" style={{ width: '100%' }}>
        <tbody>
          {sheets.map((s) => (
            <tr key={s.id}>
              <td style={{ verticalAlign: 'top' }}>
                <input
                  value={draftOf(s)}
                  placeholder={s.isBase ? 'Grundform' : 'Name der Form'}
                  maxLength={40}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  onBlur={() => {
                    const next = draftOf(s).trim();
                    if (next !== s.label && (s.isBase || next)) {
                      void run(() => apiPut(`/api/characters/${info.id}/sheets/${s.id}`, { label: next }));
                    }
                    setDrafts((d) => {
                      const { [s.id]: _drop, ...rest } = d;
                      return rest;
                    });
                  }}
                />
                {!s.isBase && <FormParts info={info} form={s} busy={busy} run={run} />}
              </td>
              <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                {s.active ? (
                  <span title="Dieser Bogen ist gerade im Spiel">● aktiv</span>
                ) : (
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => void run(() => apiPut(`/api/characters/${info.id}/active-sheet`, { sheetId: s.id }))}
                  >
                    Aktivieren
                  </button>
                )}
              </td>
              <td style={{ verticalAlign: 'top' }}>
                {!s.isBase && (
                  <ConfirmDeleteButton
                    title={`Form „${sheetLabel(s)}“ mit ihrem ganzen Bogen löschen`}
                    onConfirm={() => void run(() => apiDelete(`/api/characters/${info.id}/forms/${s.id}`))}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Neue Form</h4>
      <input value={newLabel} placeholder="Name, z. B. Bär" maxLength={40} onChange={(e) => setNewLabel(e.target.value)} />
      <p className="muted" style={{ margin: '8px 0 4px' }}>
        Was soll die Form von der Grundform bekommen? „Synchron halten“ heißt: ein gemeinsamer Bestand, Änderungen gelten in beiden
        Bögen. Später lässt sich das pro Teil wieder entkoppeln.
      </p>
      <table className="sheet" style={{ width: '100%' }}>
        <tbody>
          {choiceRow('heldenbrief', DOMAIN_LABELS.heldenbrief, domainChoice.heldenbrief ?? 'copy', ['copy', 'skip'], (c) =>
            setDomainChoice((p) => ({ ...p, heldenbrief: c })),
          )}
          {SYNCABLE_DOMAINS.map((d) =>
            choiceRow(d, DOMAIN_LABELS[d], domainChoice[d] ?? 'copy', ['copy', 'sync', 'skip'], (c) => setDomainChoice((p) => ({ ...p, [d]: c }))),
          )}
          {baseTabs.map((t) =>
            choiceRow(`tab${t.id}`, `Reiter „${t.name}“`, tabChoice[t.id] ?? 'copy', ['copy', 'sync', 'skip'], (c) =>
              setTabChoice((p) => ({ ...p, [t.id]: c })),
            ),
          )}
          <tr>
            <td>
              <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                <input type="checkbox" checked disabled style={{ width: 'auto', flex: '0 0 auto', margin: 0 }} />
                <span>Inventar, Ausrüstung, Waffen (Gegenstände), Geld</span>
              </label>
            </td>
            <td className="muted">bleibt immer gemeinsam</td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy || !newLabel.trim()} onClick={() => void create()}>
          Form anlegen
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}

/** Pro Form: welche Teile mit der Grundform geteilt sind, mit Entkoppeln / Verknüpfen. */
function FormParts({
  info,
  form,
  busy,
  run,
}: {
  info: CharacterInfo;
  form: SheetInfo;
  busy: boolean;
  run: (fn: () => Promise<unknown>, view?: number) => Promise<void>;
}) {
  const base = `/api/characters/${info.id}/sheets/${form.id}`;
  const rows: React.ReactNode[] = [];
  for (const d of SYNCABLE_DOMAINS) {
    const st = form.domains?.[d];
    if (!st) continue;
    rows.push(
      <PartRow key={d} label={DOMAIN_LABELS[d]} linked={st.mode === 'linked'}>
        <PartAction
          linked={st.mode === 'linked'}
          dormant={st.dormant}
          rows={st.rows}
          busy={busy}
          onDetach={(resume) => void run(() => apiPost(`${base}/domains/${d}/detach`, { resume }))}
          onLink={() => void run(() => apiPost(`${base}/domains/${d}/link`))}
        />
      </PartRow>,
    );
  }
  for (const t of form.tabs ?? []) {
    rows.push(
      <PartRow key={`t${t.id}`} label={`Reiter „${t.name}“`} linked={t.linked}>
        <PartAction
          linked={t.linked}
          dormant={t.hasDormant}
          rows={t.ownSections}
          unit="Sektionen"
          busy={busy}
          onDetach={(resume) => void run(() => apiPost(`${base}/tabs/${t.id}/detach`, { resume }))}
          onLink={() => void run(() => apiPost(`${base}/tabs/${t.id}/link`))}
        />
      </PartRow>,
    );
  }
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>
        Geteilte Teile
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>{rows}</div>
    </details>
  );
}

function PartRow({ label, linked, children }: { label: string; linked: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span style={{ minWidth: '11em' }}>{label}</span>
      <span className="muted" style={{ minWidth: '8em' }}>
        {linked ? '🔗 gemeinsam' : 'eigen'}
      </span>
      {children}
    </div>
  );
}
