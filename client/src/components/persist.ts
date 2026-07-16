import { useState } from 'react';

// Zustand, der in localStorage gemerkt wird — überlebt Tab-Wechsel und Reload.
// storageKey eindeutig pro Verwendung; JSON-serialisierbare Werte.
export function usePersistedState<T>(storageKey: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      // localStorage nicht verfügbar oder Inhalt defekt — Ausgangswert nutzen
    }
    return initial;
  });

  const set = (v: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof v === 'function' ? (v as (prev: T) => T)(prev) : v;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Speichern optional
      }
      return next;
    });
  };

  return [state, set];
}
