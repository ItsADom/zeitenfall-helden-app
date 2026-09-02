import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoinPouch } from '@shared/currency';
import { apiPut } from '../api';

// Gruppenkasse: ein einzelnes CoinPouch-Objekt statt einer Liste (genau ein
// Beutel je Gruppe, siehe GeldPanel's `fixed`-Modus) — kein Op-Diffing wie
// usePoolItems nötig, nur die ganze Kasse debounced per PUT ersetzen. Gleiches
// lokale-optimistic-state-Muster (siehe usePoolItems.ts).
const FLUSH_DELAY_MS = 1200;

export function useGroupPouch(pouchUrl: string, serverPouch: CoinPouch) {
  const [pouch, setPouchState] = useState(serverPouch);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  useEffect(() => {
    if (dirty.current) return;
    setPouchState(serverPouch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPouch]);

  const flush = useCallback(
    async (next: CoinPouch) => {
      dirty.current = false;
      const res = await apiPut<{ pouch: CoinPouch }>(pouchUrl, next);
      setPouchState(res.pouch);
    },
    [pouchUrl],
  );

  const setPouch = (next: CoinPouch) => {
    setPouchState(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(next), FLUSH_DELAY_MS);
  };

  return { pouch, setPouch };
}
