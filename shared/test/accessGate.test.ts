import { describe, expect, it } from 'vitest';
import { mayEnterInstance, parseAllowedRoles } from '../src/accessGate.js';

const spieler = { isGm: false, isAdmin: false };
const spielleitung = { isGm: true, isAdmin: false };
const verwaltung = { isGm: false, isAdmin: true };
const beides = { isGm: true, isAdmin: true };

describe('parseAllowedRoles', () => {
  it('treats missing and empty configuration as an open instance', () => {
    expect(parseAllowedRoles(undefined).size).toBe(0);
    expect(parseAllowedRoles('').size).toBe(0);
    expect(parseAllowedRoles('  ,  ,').size).toBe(0);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(parseAllowedRoles(' GM , Admin ')).toEqual(new Set(['gm', 'admin']));
  });
});

describe('mayEnterInstance', () => {
  it('lets everyone in when no role is configured — production must not change', () => {
    const open = parseAllowedRoles(undefined);
    expect(mayEnterInstance(open, spieler)).toBe(true);
    expect(mayEnterInstance(open, undefined)).toBe(true);
  });

  it('lets Spielleitung and Verwaltung into a gm,admin instance', () => {
    const gate = parseAllowedRoles('gm,admin');
    expect(mayEnterInstance(gate, spielleitung)).toBe(true);
    expect(mayEnterInstance(gate, verwaltung)).toBe(true);
    expect(mayEnterInstance(gate, beides)).toBe(true);
  });

  it('keeps a plain player and an anonymous caller out of a restricted instance', () => {
    const gate = parseAllowedRoles('gm,admin');
    expect(mayEnterInstance(gate, spieler)).toBe(false);
    expect(mayEnterInstance(gate, undefined)).toBe(false);
  });

  it('honours a single configured role', () => {
    const nurGm = parseAllowedRoles('gm');
    expect(mayEnterInstance(nurGm, spielleitung)).toBe(true);
    expect(mayEnterInstance(nurGm, verwaltung)).toBe(false);
    expect(mayEnterInstance(nurGm, beides)).toBe(true);
  });

  it('ignores role names it does not know', () => {
    const unsinn = parseAllowedRoles('spieler');
    expect(mayEnterInstance(unsinn, spieler)).toBe(false);
    expect(mayEnterInstance(unsinn, beides)).toBe(false);
  });
});
