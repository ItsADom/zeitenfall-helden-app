import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../api';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';
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
  const [mode, setMode] = useState<'copy' | 'blank'>('copy');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const draftOf = (s: SheetInfo) => drafts[s.id] ?? s.label;

  const create = () =>
    run(async () => {
      const res = await apiPost<{ id: number }>(`/api/characters/${info.id}/forms`, { label: newLabel.trim(), mode });
      setNewLabel('');
      return res;
    }).then(() => undefined);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Formen"
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
              <td>
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
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
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
              <td>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={newLabel} placeholder="Name, z. B. Bär" maxLength={40} onChange={(e) => setNewLabel(e.target.value)} />
        <label style={radioRow}>
          <input type="radio" style={radioInput} checked={mode === 'copy'} onChange={() => setMode('copy')} />
          <span>Heldenbrief und Reiter von der Grundform übernehmen (danach unabhängig)</span>
        </label>
        <label style={radioRow}>
          <input type="radio" style={radioInput} checked={mode === 'blank'} onChange={() => setMode('blank')} />
          <span>Leerer Bogen</span>
        </label>
        <div>
          <button className="primary" disabled={busy || !newLabel.trim()} onClick={() => void create()}>
            Form anlegen
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
