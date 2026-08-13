// Die kuratierten Changelog-Daten liegen jetzt in `shared`, damit sowohl die
// Changelog-Seite als auch der Server (Discord-Spiegel) dieselbe Quelle nutzen.
// Zum Pflegen der Einträge → shared/src/changelog.ts bearbeiten.
export type { ChangelogEntry } from 'shared';
export { CHANGELOG, COMING_SOON } from 'shared';
