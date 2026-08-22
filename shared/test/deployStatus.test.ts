import { describe, expect, it } from 'vitest';
import {
  DEPLOY_ANFANG,
  DEPLOY_LANGSAM_MS,
  istEndzustand,
  naechsteAnsicht,
  type DeployAnsicht,
  type DeployBeobachtung,
} from '../src/deployStatus.js';

const ALT = 'boot-vor-dem-neustart';
const NEU = 'boot-danach';
const ctx = (laufzeitMs = 0) => ({ bootVorher: ALT, laufzeitMs });

/** Shorthand: a status answer from the process we started out talking to. */
const status = (phase: string, fehler?: string): DeployBeobachtung => ({
  art: 'status',
  boot: ALT,
  status: { phase: phase as never, zeit: 0, ...(fehler === undefined ? {} : { fehler }) },
});

describe('naechsteAnsicht — laufender Deploy', () => {
  it('shows each progress phase as it arrives', () => {
    let ansicht: DeployAnsicht = DEPLOY_ANFANG;
    for (const phase of ['pruefe', 'baue', 'starte'] as const) {
      ansicht = naechsteAnsicht(ansicht, status(phase), ctx());
      expect(ansicht).toEqual({ zustand: 'laeuft', phase, langsam: false });
    }
  });

  it('treats a missing status file as the first phase, not as an error', () => {
    const ansicht = naechsteAnsicht(DEPLOY_ANFANG, { art: 'status', boot: ALT, status: null }, ctx());
    expect(ansicht).toEqual({ zustand: 'laeuft', phase: 'pruefe', langsam: false });
  });

  it('waits while the app is unreachable', () => {
    const ansicht = naechsteAnsicht(DEPLOY_ANFANG, { art: 'stumm' }, ctx());
    expect(ansicht).toEqual({ zustand: 'wartetAufNeustart', langsam: false });
  });
});

describe('naechsteAnsicht — die boot-Kennung entscheidet', () => {
  // The whole point of the machine. An HTTP 200 during the build comes from the
  // OLD process, which is still serving: the symlink swap and restart are the
  // last thing helden-deploy does.
  it('keeps waiting when the app answers with the SAME boot id', () => {
    expect(naechsteAnsicht(DEPLOY_ANFANG, { art: 'gesund', boot: ALT, wartung: true }, ctx())).toEqual({
      zustand: 'wartetAufNeustart',
      langsam: false,
    });
  });

  it('stops waiting when the same process reports no run in flight', () => {
    // The announcement goes out before anyone knows whether there is anything
    // to deploy. A run that ends in "already up to date" must not leave every
    // other browser waiting for a restart that will never come.
    expect(naechsteAnsicht(DEPLOY_ANFANG, { art: 'gesund', boot: ALT, wartung: false }, ctx())).toEqual({
      zustand: 'aktuell',
    });
  });

  it('declares the server back as soon as any answer carries a different boot id', () => {
    expect(naechsteAnsicht(DEPLOY_ANFANG, { art: 'gesund', boot: NEU, wartung: false }, ctx())).toEqual({ zustand: 'zurueck' });
    expect(
      naechsteAnsicht(DEPLOY_ANFANG, { art: 'status', boot: NEU, status: null }, ctx()),
    ).toEqual({ zustand: 'zurueck' });
  });

  it('lets the boot id outrank the phase — a changed id wins even mid-build', () => {
    const ansicht = naechsteAnsicht(DEPLOY_ANFANG, { art: 'status', boot: NEU, status: { phase: 'baue', zeit: 0 } }, ctx());
    expect(ansicht).toEqual({ zustand: 'zurueck' });
  });

  it('does NOT declare the server back on phase "fertig" alone', () => {
    // helden-deploy writes 'fertig' four seconds after the restart, so this
    // phase can be read from either process. Only the id may end the wait.
    expect(naechsteAnsicht(DEPLOY_ANFANG, status('fertig'), ctx())).toEqual({
      zustand: 'wartetAufNeustart',
      langsam: false,
    });
  });
});

describe('naechsteAnsicht — Ausgänge', () => {
  it('closes on "nothing to do"', () => {
    expect(naechsteAnsicht(DEPLOY_ANFANG, status('aktuell'), ctx())).toEqual({ zustand: 'aktuell' });
  });

  it('carries the error text through', () => {
    expect(naechsteAnsicht(DEPLOY_ANFANG, status('fehlgeschlagen', ' npm ci schlug fehl \n'), ctx())).toEqual({
      zustand: 'fehlgeschlagen',
      fehler: 'npm ci schlug fehl',
    });
  });

  it('substitutes a usable sentence when the error text is missing or blank', () => {
    for (const leer of [undefined, '', '   ']) {
      const ansicht = naechsteAnsicht(DEPLOY_ANFANG, status('fehlgeschlagen', leer), ctx());
      expect(ansicht.zustand).toBe('fehlgeschlagen');
      expect(ansicht.zustand === 'fehlgeschlagen' && ansicht.fehler.length).toBeGreaterThan(0);
    }
  });
});

describe('naechsteAnsicht — Endzustände sind endgültig', () => {
  const enden: DeployAnsicht[] = [
    { zustand: 'zurueck' },
    { zustand: 'aktuell' },
    { zustand: 'fehlgeschlagen', fehler: 'kaputt' },
  ];

  it('absorbs every later observation, including a late answer still in flight', () => {
    for (const ende of enden) {
      expect(istEndzustand(ende)).toBe(true);
      expect(naechsteAnsicht(ende, { art: 'stumm' }, ctx())).toEqual(ende);
      expect(naechsteAnsicht(ende, status('baue'), ctx())).toEqual(ende);
      expect(naechsteAnsicht(ende, { art: 'gesund', boot: NEU, wartung: false }, ctx())).toEqual(ende);
    }
  });

  it('does not count a running deploy as an ending', () => {
    expect(istEndzustand(DEPLOY_ANFANG)).toBe(false);
    expect(istEndzustand({ zustand: 'wartetAufNeustart', langsam: true })).toBe(false);
  });
});

describe('naechsteAnsicht — langsam, aber nicht gescheitert', () => {
  it('flags a long run without leaving the waiting state', () => {
    const spaet = ctx(DEPLOY_LANGSAM_MS + 1);
    expect(naechsteAnsicht(DEPLOY_ANFANG, status('baue'), spaet)).toEqual({
      zustand: 'laeuft',
      phase: 'baue',
      langsam: true,
    });
    expect(naechsteAnsicht(DEPLOY_ANFANG, { art: 'stumm' }, spaet)).toEqual({
      zustand: 'wartetAufNeustart',
      langsam: true,
    });
  });

  it('stays unflagged right up to the threshold', () => {
    expect(naechsteAnsicht(DEPLOY_ANFANG, status('baue'), ctx(DEPLOY_LANGSAM_MS))).toEqual({
      zustand: 'laeuft',
      phase: 'baue',
      langsam: false,
    });
  });
});
