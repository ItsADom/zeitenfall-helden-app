import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@shared/items';
import { diffItems } from '@shared/items';
import { apiPost } from '../api';

// Shared inventories (docs/concepts/shared-inventories.md): local optimistic
// state + a debounced diffItems/applyItemOps flush, the same pattern
// charSheet.tsx's useCharSheet already relies on for a character's own items
// (see its `flush`/`itemsBaseline`) — a pool has no character-sheet host to
// borrow that plumbing from, so this is that same shape, extracted and made
// reusable for both the group pool and the GM pool.
const FLUSH_DELAY_MS = 1200;

export function usePoolItems(itemsOpsUrl: string, serverItems: Item[]) {
  const [items, setItemsState] = useState(serverItems);
  const baseline = useRef(serverItems);
  const timer = useRef<number | undefined>(undefined);
  // Eigene unversendete Änderung unterwegs? Dann darf ein Reload von außen
  // (Fokus-Nachladen) sie nicht stillschweigend überschreiben.
  const dirty = useRef(false);

  useEffect(() => {
    if (dirty.current) return;
    baseline.current = serverItems;
    setItemsState(serverItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverItems]);

  const flush = useCallback(
    async (next: Item[]) => {
      const ops = diffItems(baseline.current, next);
      dirty.current = false;
      if (ops.length === 0) return;
      const res = await apiPost<{ items: Item[] }>(`${itemsOpsUrl}/ops`, ops);
      baseline.current = res.items;
      setItemsState(res.items);
    },
    [itemsOpsUrl],
  );

  const setItems = (next: Item[]) => {
    setItemsState(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(next), FLUSH_DELAY_MS);
  };

  // Für den Verschieben-Weg (eigener Endpunkt, kein Op — siehe moveItem in
  // server/src/characterData.ts): ersetzt den lokalen Stand direkt durch die
  // Server-Antwort, ohne über den Ops-Umweg zu gehen, und verwirft eine noch
  // laufende Entprellung, damit die kein veraltetes diffItems mehr nachschickt.
  const replace = (next: Item[]) => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    baseline.current = next;
    setItemsState(next);
  };

  return { items, setItems, replace };
}
