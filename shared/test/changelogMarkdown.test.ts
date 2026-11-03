import { describe, expect, it } from 'vitest';
import { CHANGELOG, discordMarkdown } from '../src/changelog.js';

describe('discordMarkdown', () => {
  it('escapes asterisks so chat formulas stay literal', () => {
    expect(discordMarkdown('„2*Athletik“ würfelt zweimal, „2*Akrobatik“ auch')).toBe(
      '„2\\*Athletik“ würfelt zweimal, „2\\*Akrobatik“ auch',
    );
  });

  it('escapes every markdown character Discord would format', () => {
    expect(discordMarkdown('a * b und c_d und ~e~ und f|g und `h`')).toBe('a \\* b und c\\_d und \\~e\\~ und f\\|g und \\`h\\`');
  });

  it('leaves ordinary text, quotes and punctuation untouched', () => {
    const text = 'Der Knopf „Zurücksetzen“ zeigt „Stufe 0“ (z. B. 100 × 100 Felder), Shift+Enter und Tab.';
    expect(discordMarkdown(text)).toBe(text);
  });

  it('leaves no unescaped markdown character in any real changelog entry', () => {
    const alle = CHANGELOG.flatMap((e) => [
      ...(e.changes ?? []),
      ...[e, ...(e.features ?? [])].flatMap((b) => [...(b.added ?? []), ...(b.changed ?? []), ...(b.fixed ?? []), ...(b.admin ?? [])]),
    ]);
    for (const text of alle) {
      const rest = discordMarkdown(text).replace(/\\./g, '');
      expect(rest).not.toMatch(/[*_~|`]/);
    }
  });
});
