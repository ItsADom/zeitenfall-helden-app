import { useEffect, useMemo, useState } from 'react';
import { apiPut } from '../api';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';

interface CatRow {
  orig: string | null;
  name: string;
}

// Kategorien-Verwaltung (rename/remove-with-cascade) als eigener Dialog,
// direkt vom jeweiligen Item-Bildschirm aus erreichbar (Inventar, Gruppen-
// Vorrat, SL-Vorrat) statt nur über die Einstellungen-Seite — ein Bauteil für
// alle drei Owner-Scopes, nur `endpoint` unterscheidet sich zwischen ihnen.
export function CategoryManagerDialog({
  open,
  onClose,
  categories,
  endpoint,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  /** z.B. `/api/characters/:id/item-categories/manage`, `/api/groups/:id/...`, `/api/gm/...` */
  endpoint: string;
  onSaved: (categories: string[]) => void;
}) {
  const [rows, setRows] = useState<CatRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setRows(categories.map((c) => ({ orig: c, name: c })));
  }, [open, categories]);

  const cleanNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const n = r.name.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [rows]);

  const changed = categories.join(' ') !== cleanNames.join(' ');

  const save = async () => {
    setSaving(true);
    try {
      const renames = rows
        .filter((r) => r.orig !== null && r.name.trim() !== '' && r.name.trim() !== r.orig)
        .map((r) => ({ from: r.orig as string, to: r.name.trim() }));
      const removes = categories.filter((o) => !rows.some((r) => r.orig === o));
      const res = await apiPut<{ categories: string[] }>(endpoint, { order: cleanNames, renames, removes });
      onSaved(res.categories);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Kategorien verwalten"
      footer={
        <>
          <button type="button" className="small" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={!changed || saving} onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <p className="muted">Entfernen einer Kategorie setzt alle Gegenstände darin auf „ohne Kategorie".</p>
      <div className="cat-editor">
        {rows.map((r, i) => (
          <div className="cat-row" key={i}>
            <input
              value={r.name}
              placeholder="Kategoriename"
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <ConfirmDeleteButton title="Kategorie entfernen" onConfirm={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button type="button" className="small" onClick={() => setRows((rs) => [...rs, { orig: null, name: '' }])}>
          + Kategorie
        </button>
      </div>
    </Dialog>
  );
}
