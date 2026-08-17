import { describe, expect, it } from 'vitest';
import {
  kategorieKeyFuerTitel,
  kategorieTitel,
  istKategorieTitel,
  teileTitel,
  vollerTitel,
} from '../src/wikiNamensraum.js';

describe('teileTitel', () => {
  it('splits a category title into namespace and name', () => {
    expect(teileTitel('Kategorie:Orte')).toEqual({ namensraum: 'kategorie', name: 'Orte' });
  });

  it('accepts the sloppy spellings people actually type', () => {
    expect(teileTitel('kategorie:orte').namensraum).toBe('kategorie');
    expect(teileTitel('Kategorie : Orte')).toEqual({ namensraum: 'kategorie', name: 'Orte' });
    expect(teileTitel('  KATEGORIE:Orte  ')).toEqual({ namensraum: 'kategorie', name: 'Orte' });
  });

  it('leaves an ordinary title alone', () => {
    expect(teileTitel('Die Straße nach Gareth')).toEqual({
      namensraum: 'seite',
      name: 'Die Straße nach Gareth',
    });
  });

  it('does not treat a bare prefix as a category — that would be one without a name', () => {
    expect(teileTitel('Kategorie:').namensraum).toBe('seite');
    expect(teileTitel('Kategorie:   ').namensraum).toBe('seite');
  });

  it('only reacts to the prefix, not to a colon anywhere in the title', () => {
    expect(teileTitel('Gareth: Die Stadt').namensraum).toBe('seite');
    expect(teileTitel('Regel: Kategorie:Zauber').namensraum).toBe('seite');
  });

  it('keeps a colon inside the name', () => {
    expect(teileTitel('Kategorie:Regeln: Kampf').name).toBe('Regeln: Kampf');
  });
});

describe('vollerTitel', () => {
  it('is the inverse of teileTitel', () => {
    for (const titel of ['Kategorie:Orte', 'Gareth', 'Kategorie:NSC in Garetien']) {
      const { namensraum, name } = teileTitel(titel);
      expect(vollerTitel(namensraum, name)).toBe(titel);
    }
  });

  it('normalises the PREFIX but leaves the name spelled as written', () => {
    // The prefix is the app's word, so it gets one spelling. The name is the
    // author's — „NPCs" must not come back as „Npcs".
    const { namensraum, name } = teileTitel('kategorie : orte');
    expect(vollerTitel(namensraum, name)).toBe('Kategorie:orte');
    expect(vollerTitel('kategorie', 'NPCs')).toBe('Kategorie:NPCs');
  });
});

describe('kategorieKeyFuerTitel', () => {
  it('folds the name the same way page tags are folded', () => {
    // Otherwise the description page and the pages carrying the tag end up in
    // two different categories that look identical.
    expect(kategorieKeyFuerTitel('Kategorie:NPCs')).toBe('npcs');
    expect(kategorieKeyFuerTitel('Kategorie:npcs')).toBe('npcs');
    expect(kategorieKeyFuerTitel('Kategorie:Städte')).toBe('staedte');
    expect(kategorieKeyFuerTitel('Kategorie:Straßen')).toBe('strassen');
  });

  it('is null for anything that is not a category page', () => {
    expect(kategorieKeyFuerTitel('Gareth')).toBeNull();
    expect(kategorieKeyFuerTitel('Kategorie:')).toBeNull();
  });
});

describe('kategorieTitel / istKategorieTitel', () => {
  it('round-trips', () => {
    expect(kategorieTitel('Orte')).toBe('Kategorie:Orte');
    expect(istKategorieTitel(kategorieTitel('Orte'))).toBe(true);
    expect(istKategorieTitel('Orte')).toBe(false);
  });
});
