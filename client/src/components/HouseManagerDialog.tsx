import { useEffect, useState } from 'react';
import type { Item } from '@shared/items';
import { apiPut } from '../api';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { Dialog } from './Dialog';

// Houses (docs/concepts/houses.md): Verwaltung von Häusern UND ihren Räumen —
// strukturell wie CategoryManagerDialog (Umbenennen-mit-Kaskade, Entfernen-
// mit-Kaskade), nur eine Ebene tiefer verschachtelt. haus/raum auf Item sind
// freie Strings (kein Fremdschlüssel, siehe shared-inventories.md §3.1), also
// wendet dieser Dialog seine Kaskade — wie applyCategoryCascade — selbst auf
// die schon geladene Item-Liste an, statt einen Refetch zu erzwingen.

interface HouseCascade {
  houseRenames: { from: string; to: string }[];
  houseRemoves: string[];
  roomRenames: { haus: string; from: string; to: string }[];
  roomRemoves: { haus: string; name: string }[];
}

export function applyHouseCascade(items: Item[], c: HouseCascade): Item[] {
  return items.map((it) => {
    const hr = c.houseRenames.find((x) => x.from === it.haus);
    if (hr) return { ...it, haus: hr.to };
    if (c.houseRemoves.includes(it.haus)) return { ...it, haus: '', raum: '' };
    const rr = c.roomRenames.find((x) => x.haus === it.haus && x.from === it.raum);
    if (rr) return { ...it, raum: rr.to };
    if (c.roomRemoves.some((x) => x.haus === it.haus && x.name === it.raum)) return { ...it, raum: '' };
    return it;
  });
}

interface RoomRow {
  orig: string | null;
  name: string;
}
interface HouseRow {
  orig: string | null;
  name: string;
  rooms: RoomRow[];
}

export function HouseManagerDialog({
  open,
  onClose,
  groupId,
  houses,
  roomsByHaus,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  groupId: number;
  houses: string[];
  roomsByHaus: Record<string, string[]>;
  onSaved: (houses: string[], roomsByHaus: Record<string, string[]>, cascade: HouseCascade) => void;
}) {
  const [rows, setRows] = useState<HouseRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setRows(houses.map((h) => ({ orig: h, name: h, rooms: (roomsByHaus[h] ?? []).map((r) => ({ orig: r, name: r })) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const seenHouse = new Set<string>();
      const cleanHouses: string[] = [];
      for (const r of rows) {
        const n = r.name.trim();
        if (n && !seenHouse.has(n)) {
          seenHouse.add(n);
          cleanHouses.push(n);
        }
      }
      const houseRenames = rows
        .filter((r) => r.orig !== null && r.name.trim() !== '' && r.name.trim() !== r.orig)
        .map((r) => ({ from: r.orig as string, to: r.name.trim() }));
      const houseRemoves = houses.filter((o) => !rows.some((r) => r.orig === o));

      const res = await apiPut<{ houses: string[]; roomsByHaus: Record<string, string[]> }>(
        `/api/groups/${groupId}/houses/manage`,
        { order: cleanHouses, renames: houseRenames, removes: houseRemoves },
      );

      const roomRenames: { haus: string; from: string; to: string }[] = [];
      const roomRemoves: { haus: string; name: string }[] = [];
      let roomsByHausNext = res.roomsByHaus;
      for (const r of rows) {
        const hausName = r.name.trim();
        if (!hausName || houseRemoves.includes(r.orig ?? '')) continue; // Haus selbst entfernt — seine Räume sind es damit auch
        const seenRoom = new Set<string>();
        const cleanRooms: string[] = [];
        for (const rr of r.rooms) {
          const n = rr.name.trim();
          if (n && !seenRoom.has(n)) {
            seenRoom.add(n);
            cleanRooms.push(n);
          }
        }
        const origRooms = r.orig !== null ? (roomsByHaus[r.orig] ?? []) : [];
        const renames = r.rooms
          .filter((rr) => rr.orig !== null && rr.name.trim() !== '' && rr.name.trim() !== rr.orig)
          .map((rr) => ({ from: rr.orig as string, to: rr.name.trim() }));
        const removes = origRooms.filter((o) => !r.rooms.some((rr) => rr.orig === o));
        for (const rn of renames) roomRenames.push({ haus: hausName, ...rn });
        for (const rm of removes) roomRemoves.push({ haus: hausName, name: rm });
        if (renames.length === 0 && removes.length === 0 && cleanRooms.join(' ') === origRooms.join(' ') && r.orig === hausName) continue;
        const roomRes = await apiPut<{ rooms: string[] }>(
          `/api/groups/${groupId}/houses/${encodeURIComponent(hausName)}/rooms/manage`,
          { order: cleanRooms, renames, removes },
        );
        roomsByHausNext = { ...roomsByHausNext, [hausName]: roomRes.rooms };
      }

      onSaved(res.houses, roomsByHausNext, { houseRenames, houseRemoves, roomRenames, roomRemoves });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const patchHouse = (i: number, patch: Partial<HouseRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const patchRoom = (i: number, j: number, patch: Partial<RoomRow>) =>
    setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, rooms: r.rooms.map((rr, rj) => (rj === j ? { ...rr, ...patch } : rr)) } : r)));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Häuser & Räume verwalten"
      wide
      footer={
        <>
          <button type="button" className="small" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" disabled={saving} onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <p className="muted">Entfernen eines Hauses/Raums setzt die betroffenen Gegenstände auf „nicht zugeordnet".</p>
      <div className="cat-editor">
        {rows.map((r, i) => (
          <div key={i} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <div className="cat-row">
              <input value={r.name} placeholder="Hausname" onChange={(e) => patchHouse(i, { name: e.target.value })} />
              <ConfirmDeleteButton title="Haus entfernen" onConfirm={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
            </div>
            <div style={{ marginLeft: 20 }}>
              {r.rooms.map((rr, j) => (
                <div className="cat-row" key={j}>
                  <input
                    value={rr.name}
                    placeholder="Raumname"
                    onChange={(e) => patchRoom(i, j, { name: e.target.value })}
                  />
                  <ConfirmDeleteButton
                    title="Raum entfernen"
                    onConfirm={() => patchHouse(i, { rooms: r.rooms.filter((_, rj) => rj !== j) })}
                  />
                </div>
              ))}
              <button type="button" className="small" onClick={() => patchHouse(i, { rooms: [...r.rooms, { orig: null, name: '' }] })}>
                + Raum
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="small" onClick={() => setRows((rs) => [...rs, { orig: null, name: '', rooms: [] }])}>
          + Haus
        </button>
      </div>
    </Dialog>
  );
}
