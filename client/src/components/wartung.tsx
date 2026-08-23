import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  DEPLOY_ANFANG,
  istEndzustand,
  naechsteAnsicht,
  type DeployAnsicht,
  type DeployBeobachtung,
  type DeployStatus,
} from 'shared';

// Shared state for an ongoing redeploy: the admin who triggered it and everyone
// else caught by it watch the same thing, only from different angles.
//
// The admin polls the authenticated status endpoint and gets named phases. Every
// other client polls the plain /api/health probe, which is all it is allowed to
// see and all it needs. Both feed their observations through the same state
// machine in shared/src/deployStatus.ts.

const POLL_MS = 2000;
// Long enough to read "wieder da", short enough not to feel stuck.
const RELOAD_VERZUG_MS = 800;

type Rolle = 'ausloeser' | 'mitbetroffen';

interface Lauf {
  rolle: Rolle;
  /** The boot id of the process we were talking to before the restart. */
  bootVorher: string;
  /** Display name of whoever pressed the button. */
  durch: string;
  begonnen: number;
}

interface WartungWert {
  lauf: Lauf | null;
  ansicht: DeployAnsicht;
  /** False once the server stops answering — the moment the full screen is due. */
  erreichbar: boolean;
  starteAlsAusloeser(bootVorher: string): void;
  ankuendigungEmpfangen(durch: string): void;
  schliessen(): void;
}

const WartungContext = createContext<WartungWert | null>(null);

export function useWartung(): WartungWert {
  const ctx = useContext(WartungContext);
  if (!ctx) throw new Error('useWartung braucht einen WartungProvider');
  return ctx;
}

// Raw fetch rather than apiGet on purpose: apiGet routes a 401 through the
// global unauthorized handler, which would throw the user back to the login
// screen mid-deploy. Here a failed request is information, not an error.
async function beobachteStatus(): Promise<DeployBeobachtung> {
  try {
    const res = await fetch('/api/admin/deploy/status', { credentials: 'same-origin' });
    if (!res.ok) return { art: 'stumm' };
    const daten = (await res.json()) as { boot: string; status: DeployStatus | null };
    return { art: 'status', boot: daten.boot, status: daten.status };
  } catch {
    return { art: 'stumm' };
  }
}

async function beobachteGesundheit(): Promise<DeployBeobachtung> {
  try {
    const res = await fetch('/api/health', { credentials: 'same-origin' });
    if (!res.ok) return { art: 'stumm' };
    const daten = (await res.json()) as { boot: string; wartung?: boolean };
    return { art: 'gesund', boot: daten.boot, wartung: daten.wartung === true };
  } catch {
    return { art: 'stumm' };
  }
}

/**
 * The boot id right now, for clients that learn of a deploy from the
 * announcement rather than from having pressed the button. Answers null unless
 * a run really is in flight, so an announcement whose deploy turned out to have
 * nothing to do never puts a notice on anyone's screen.
 */
async function holeBoot(): Promise<string | null> {
  const beobachtung = await beobachteGesundheit();
  return beobachtung.art === 'gesund' && beobachtung.wartung ? beobachtung.boot : null;
}

export function WartungProvider({ children }: { children: React.ReactNode }) {
  const [lauf, setLauf] = useState<Lauf | null>(null);
  const [ansicht, setAnsicht] = useState<DeployAnsicht>(DEPLOY_ANFANG);
  const [erreichbar, setErreichbar] = useState(true);

  // The poll loop reads these without wanting to restart on every change.
  const laufRef = useRef<Lauf | null>(null);
  const ansichtRef = useRef<DeployAnsicht>(DEPLOY_ANFANG);
  laufRef.current = lauf;
  ansichtRef.current = ansicht;

  const starteAlsAusloeser = useCallback((bootVorher: string) => {
    setAnsicht(DEPLOY_ANFANG);
    setErreichbar(true);
    setLauf({ rolle: 'ausloeser', bootVorher, durch: '', begonnen: Date.now() });
  }, []);

  const ankuendigungEmpfangen = useCallback((durch: string) => {
    // Already watching (we pressed the button ourselves, or a second
    // announcement arrived) — nothing to do.
    if (laufRef.current) return;
    // The announcement itself proves the old process is still alive, so asking
    // it for its id right now cannot race the restart. If the run is already
    // over by the time we ask — a deploy that found nothing to do finishes in
    // well under a second — there is nothing to show anyone.
    void holeBoot().then((boot) => {
      if (!boot || laufRef.current) return;
      setAnsicht(DEPLOY_ANFANG);
      setErreichbar(true);
      setLauf({ rolle: 'mitbetroffen', bootVorher: boot, durch, begonnen: Date.now() });
    });
  }, []);

  const schliessen = useCallback(() => {
    setLauf(null);
    setAnsicht(DEPLOY_ANFANG);
    setErreichbar(true);
  }, []);

  useEffect(() => {
    if (!lauf) return;
    let aktiv = true;

    const tick = async () => {
      const beobachtung =
        lauf.rolle === 'ausloeser' ? await beobachteStatus() : await beobachteGesundheit();
      if (!aktiv) return;

      setErreichbar(beobachtung.art !== 'stumm');
      const naechste = naechsteAnsicht(ansichtRef.current, beobachtung, {
        bootVorher: lauf.bootVorher,
        laufzeitMs: Date.now() - lauf.begonnen,
      });
      ansichtRef.current = naechste;
      setAnsicht(naechste);
    };

    void tick();
    const timer = setInterval(() => {
      // Stop polling the moment the run has resolved; the interval is cleared
      // by the effect cleanup, but a request may still be in flight.
      if (istEndzustand(ansichtRef.current)) return;
      void tick();
    }, POLL_MS);

    return () => {
      aktiv = false;
      clearInterval(timer);
    };
  }, [lauf]);

  // A new process answered: the only signal that licenses a reload.
  useEffect(() => {
    if (ansicht.zustand !== 'zurueck') return;
    const timer = setTimeout(() => window.location.reload(), RELOAD_VERZUG_MS);
    return () => clearTimeout(timer);
  }, [ansicht.zustand]);

  return (
    <WartungContext.Provider
      value={{ lauf, ansicht, erreichbar, starteAlsAusloeser, ankuendigungEmpfangen, schliessen }}
    >
      {children}
    </WartungContext.Provider>
  );
}
