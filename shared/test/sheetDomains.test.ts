import { describe, expect, it } from 'vitest';
import {
  SHEET_DOMAINS,
  SYNCABLE_DOMAINS,
  detachAction,
  domainOwnerId,
  isSyncable,
  normalizeCarryOver,
  sectionDomain,
  tabKeyDomain,
  uniformCarryOver,
} from '../src/sheetDomains.js';

describe('domainOwnerId', () => {
  it('die Grundform liest immer ihre eigenen Zeilen', () => {
    expect(domainOwnerId(10, 10, 'linked')).toBe(10);
    expect(domainOwnerId(10, 10, 'own')).toBe(10);
    expect(domainOwnerId(10, 10, undefined)).toBe(10);
  });

  it('eine verknüpfte Form liest die der Grundform', () => {
    expect(domainOwnerId(11, 10, 'linked')).toBe(10);
  });

  it('eine Form mit eigenen oder ohne Modus liest ihre eigenen Zeilen (Formen aus Phase 1)', () => {
    expect(domainOwnerId(11, 10, 'own')).toBe(11);
    expect(domainOwnerId(11, 10, null)).toBe(11);
    expect(domainOwnerId(11, 10, undefined)).toBe(11);
  });
});

describe('Domänen', () => {
  it('der Heldenbrief ist die einzige nicht teilbare Domäne', () => {
    expect(isSyncable('heldenbrief')).toBe(false);
    expect(SYNCABLE_DOMAINS).toEqual(SHEET_DOMAINS.filter((d) => d !== 'heldenbrief'));
    for (const d of SYNCABLE_DOMAINS) expect(isSyncable(d)).toBe(true);
  });

  it('ordnet Speicher-Bereiche den Domänen zu', () => {
    expect(sectionDomain('talents')).toBe('talente');
    expect(sectionDomain('languages')).toBe('sprachen');
    expect(sectionDomain('waffenlos')).toBe('waffen');
    expect(sectionDomain('kampfstile')).toBe('waffen');
    expect(sectionDomain('attributes')).toBeNull();
    expect(sectionDomain('meta')).toBeNull();
  });

  it('ordnet eingebaute Reiter den Domänen zu', () => {
    expect(tabKeyDomain('Talente')).toBe('talente');
    expect(tabKeyDomain('Sprachen')).toBe('sprachen');
    expect(tabKeyDomain('WaffenNeu')).toBe('waffen');
    expect(tabKeyDomain('Zauber')).toBe('faehigkeiten');
    expect(tabKeyDomain('Fähigkeiten')).toBe('faehigkeiten');
    expect(tabKeyDomain('Heldenbrief')).toBe('heldenbrief');
    // Gegenstände gehören zum Charakter, nicht zu einer Domäne
    expect(tabKeyDomain('Inventar')).toBeNull();
    expect(tabKeyDomain('Ausrüstung')).toBeNull();
    expect(tabKeyDomain('c12')).toBeNull();
  });
});

describe('normalizeCarryOver', () => {
  it('fehlende oder kaputte Eingabe: alles kopieren', () => {
    for (const raw of [undefined, null, 'x', 5, [], {}]) {
      const p = normalizeCarryOver(raw, [3, 4]);
      for (const d of SHEET_DOMAINS) expect(p.domains[d]).toBe('copy');
      expect(p.tabs).toEqual({ 3: 'copy', 4: 'copy' });
    }
  });

  it('übernimmt gültige Wahl je Domäne und Reiter', () => {
    const p = normalizeCarryOver(
      { domains: { talente: 'sync', sprachen: 'skip', waffen: 'copy' }, tabs: { 3: 'sync', 4: 'skip' } },
      [3, 4],
    );
    expect(p.domains.talente).toBe('sync');
    expect(p.domains.sprachen).toBe('skip');
    expect(p.domains.waffen).toBe('copy');
    expect(p.domains.faehigkeiten).toBe('copy');
    expect(p.tabs).toEqual({ 3: 'sync', 4: 'skip' });
  });

  it('der Heldenbrief wird nie synchronisiert, höchstens übersprungen', () => {
    expect(normalizeCarryOver({ domains: { heldenbrief: 'sync' } }, []).domains.heldenbrief).toBe('copy');
    expect(normalizeCarryOver({ domains: { heldenbrief: 'skip' } }, []).domains.heldenbrief).toBe('skip');
  });

  it('ungültige Werte werden zu „kopieren", unbekannte Reiter fallen weg', () => {
    const p = normalizeCarryOver({ domains: { talente: 'bogus' }, tabs: { 3: 7, 99: 'sync' } }, [3]);
    expect(p.domains.talente).toBe('copy');
    expect(p.tabs).toEqual({ 3: 'copy' });
  });
});

describe('uniformCarryOver', () => {
  it('kopiert oder überspringt überall', () => {
    const all = uniformCarryOver('copy', [1, 2]);
    expect(Object.values(all.domains).every((c) => c === 'copy')).toBe(true);
    expect(all.tabs).toEqual({ 1: 'copy', 2: 'copy' });
    const none = uniformCarryOver('skip', [1]);
    expect(Object.values(none.domains).every((c) => c === 'skip')).toBe(true);
    expect(none.tabs).toEqual({ 1: 'skip' });
  });
});

describe('detachAction', () => {
  it('weiterverwenden nur, wenn eine zurückgelegte Kopie da ist UND gewählt wurde', () => {
    expect(detachAction(true, true)).toBe('resume');
    expect(detachAction(true, false)).toBe('snapshot');
    expect(detachAction(false, true)).toBe('snapshot');
    expect(detachAction(false, false)).toBe('snapshot');
  });
});
