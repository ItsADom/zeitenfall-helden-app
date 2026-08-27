import { useEffect, useState } from 'react';

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

  // Ein zweiter Tab derselben Person schreibt denselben Schlüssel — ohne das hier
  // hält dieser Tab seinen eigenen (jetzt veralteten) React-State, obwohl
  // localStorage längst den neuen Wert trägt ("Sichtbarkeit setzt sich zurück").
  // Das native "storage"-Event feuert per Spezifikation nur in ANDEREN Tabs, nie
  // in dem, der geschrieben hat — kein Echo-Risiko.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      if (e.newValue == null) return;
      try {
        setState(JSON.parse(e.newValue) as T);
      } catch {
        // Kaputter Inhalt aus einem anderen Tab — laufenden State behalten
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

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
