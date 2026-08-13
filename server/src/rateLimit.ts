import type { Request } from 'express';

// Schlanker In-Memory-Fehlversuchszähler gegen Brute-Force am Login — ohne
// externe Abhängigkeit. Gezählt werden NUR Fehlversuche: ein gültiger Login
// setzt den Zähler zurück, sodass normale Nutzung nie blockiert. Zwei Zähler
// je Versuch (siehe routes): pro Konto (IP+Benutzername) und pro IP insgesamt —
// der erste bremst gezieltes Raten eines Kontos, der zweite das „Durchprobieren"
// vieler Namen von einer Quelle. Prozess-lokal (reicht für einen Node-Prozess);
// bei mehreren Instanzen bräuchte es einen gemeinsamen Speicher.

interface Bucket {
  count: number;
  resetAt: number;
}

export interface AttemptLimiter {
  // Sekunden bis zur Freigabe, wenn gesperrt — sonst false.
  blocked(key: string): number | false;
  // Einen Fehlversuch verbuchen.
  fail(key: string): void;
  // Nach Erfolg zurücksetzen.
  reset(key: string): void;
}

export function createAttemptLimiter({ windowMs, max }: { windowMs: number; max: number }): AttemptLimiter {
  const buckets = new Map<string, Bucket>();

  // Abgelaufene Einträge periodisch aufräumen, damit die Map nicht wächst.
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, windowMs).unref();

  return {
    blocked(key) {
      const b = buckets.get(key);
      const now = Date.now();
      if (b && b.resetAt > now && b.count >= max) return Math.ceil((b.resetAt - now) / 1000);
      return false;
    },
    fail(key) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      b.count++;
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

// Client-IP als Schlüsselbestandteil. Hinter dem Reverse-Proxy liefert
// Express bei gesetztem `trust proxy` die echte Adresse; sonst die Peer-Adresse.
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
