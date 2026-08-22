# CLAUDE.md — working agreement for this repo

Rules for any AI assistant working on the Zeitenfall / Heldenverwaltung app. This
file is committed and travels with the repo, so it applies on **every machine**.
These are standing instructions — follow them without being reminded.

## Game system

**Zeitenfall is explicitly NOT DSA5 (Das Schwarze Auge).** It uses its own
heavily homebrewed, self-created ruleset — probe mechanics, attributes, and
formulas only coincidentally resemble DSA5 in places because that's the
GM's frame of reference, not because the app implements DSA5 rules. Never
assume a DSA5 rule applies here (e.g. for group/cooperation checks, crit
confirmation, energy types) without it being spelled out in this repo's own
docs/concepts or confirmed by the developer — check `shared/src/rules.ts`,
`shared/src/dice.ts`, and `docs/concepts/` for what this app actually does,
not general DSA5 knowledge.

## Git & branches

- **Work on `develop` by default.** It's the shared working line. Only create a
  separate feature branch when there's a specific reason to isolate the work
  (risky/large change, or parallel efforts that would interfere).
- **`main` is the release pointer** — "this is what's deployed/published".
  **Never suggest or perform `develop → main` merges on your own.** Merge to
  `main` only on direct, explicit instruction; the user decides when a release
  happens.
- **Don't auto-push.** Commit relevant work locally as it lands, then stop.
  Leave `git push` to the user — they push when they want to.
- **Delete merged feature branches.** After merging any branch that is *not*
  `develop` or `main`, run `git branch -d <branch>` automatically, without asking.
  `develop` and `main` are the only long-lived branches.
- Remote is `origin` (GitHub, business/collaborator account cached on the machine).

## Language

- **English by default for anything that isn't UI or otherwise user-visible:**
  commit messages, code comments you write, internal notes, `TODO.md` (it's a
  developer-only backlog, not player-facing). German stays reserved for
  actual player/GM-facing text — UI strings, the in-app changelog. Existing
  German comments in the codebase don't need to be translated retroactively;
  this is about what you write going forward.
- **Exception: changelog styling drafts.** Draft/preview text you write while
  iterating on a `shared/src/changelog.ts` entry's wording or tone may stay
  German, since it's a direct working draft of German user-facing copy, not
  an internal note.

## Commits

- **Commit functional/bugfix work as it lands** (one coherent change per commit).
- **Batch design iteration.** For visual/design work (theming, animations,
  layout, styling), do NOT commit every tweak — it bloats history with tiny
  back-and-forth changes. Make the change, verify it, leave it uncommitted, and
  commit once the design round settles or the user asks.

## Working on tasks

- **Concept first for anything not fully fleshed out.** When a TODO entry is
  thin, ambiguous, or leaves design decisions open, do NOT jump straight into
  code. Work out a concept *together with the developer* first: surface the
  uncertainties, propose an approach, and get their feedback before building.
  Only well-specified tasks (clear scope, no open decisions) go straight to
  implementation. When in doubt, ask.
- **Leave dev servers running after verifying a change.** Don't shut down a
  server/client preview you started just to tidy up — only stop one when it's
  actually in the way (e.g. a port conflict, or a throwaway DB that must not
  linger). The developer wants to poke at the running app themselves after a
  change lands, so a live preview is more useful left up than torn down.

## Docs & user-facing text

- **`TODO.md` is a forward-looking backlog, not a changelog.** It lists open
  tasks only. When a task is done, prune its entry (or delete it) — no "(DONE)"
  markers, no phase-by-phase history. Keep only residual forward-looking bits
  (a decided-but-unbuilt concept, a constraint, a follow-up). Git history already
  records what was finished. If the finished task was player-visible, don't just
  drop it — promote it to the changelog (see below).
- **The in-app changelog is curated, not a commit log.** The entries live in
  `shared/src/changelog.ts` (so the server's Discord mirror and the client share
  one source; `client/src/changelog.ts` just re-exports it), and are rendered by
  `client/src/pages/Changelog.tsx`. It is a short, user-facing summary for
  players. Only propose entries for notable, user-visible changes, and keep
  each to a few high-level bullets. Don't add entries proactively for routine
  work. Leave the `version` field unset until the user starts real versioned
  releases.
- **Finishing tracked work moves its entry into the changelog.** When you fix a
  bug or complete a feature that was tracked in a player-facing section — a
  `TODO.md` backlog item, a `KNOWN_BUGS` entry, or a `COMING_SOON` line — remove
  it from that section and fold a short player-facing note into the **newest
  unreleased changelog entry**: the top `CHANGELOG` entry that still has no
  `version`. If the top entry is already versioned (released), start a fresh
  draft entry above it (today's date, `version` left unset) and add to that.
  Sort the note into `added` (new features), `changed` (behaviour/renames/moves)
  or `fixed` (bugs). The curation bar above still holds — routine internal work
  that was never tracked gets no entry.
- **Mark admin-/GM-only changes as such.** A change that only touches the
  Spielleiter view or the Verwaltung/Kataloge routes — nothing a normal player
  sees on their own sheet — must say so in its changelog note (e.g. lead with
  „(Spielleiter)" or „(Verwaltung)"), so players reading it know it doesn't
  affect them.

### Versioning & releases

- **An unversioned entry is a draft — and invisible.** A `CHANGELOG` entry with
  no `version` is NOT shown to players on the Changelog page and NOT mirrored to
  Discord; it surfaces only once it gets a number. So finished work accumulates
  in the top version-less entry, and cutting the release is the moment someone
  assigns the version. (Both `client/src/pages/Changelog.tsx` and
  `server/src/discord.ts` filter to versioned entries; the Discord watermark
  therefore only ever tracks a stable `vX` key.)
- **Never assign a version yourself.** Numbering a release is the developer's
  decision, always. When a draft is ready, *recommend* a bump with a short
  reason and leave the `version` field for the developer to fill in — don't
  invent, bump, or guess numbers on your own.
- **How to frame the recommendation (pre-1.0 = `0.MINOR.PATCH`):**
  - `0.X.0` (minor) — a new player-facing capability or a substantial rework of
    an area (like the Ausrüstung/Inventar or Zauber & Fähigkeiten reworks): the
    player has to learn something new.
  - `0.X.Y` (patch) — smaller player-visible work: bug fixes, polish, navigation
    tweaks, small additions that don't change how an area works.
  - Litmus test: *does a player have to learn something new (minor), or is it the
    same app working better (patch)?* Untracked routine/internal work is neither
    — no entry, no bump.
- **`1.0.0` is a deliberate call by the developer:** core play loop complete,
  data model stable (no more disruptive migrations expected), `KNOWN_BUGS`
  essentially clear. After 1.0, normal semver — `MAJOR` for breaking or
  data-migrating changes, `MINOR` for new features, `PATCH` for fixes.
- **The version goes on before deploy.** Assigning it is part of cutting the
  release, so the draft never reaches production unnumbered — that keeps the
  Discord key stable and the release posts cleanly.
- **Re-check the entry's `title` when you assign the version.** The title is
  usually written early, while the draft entry is still growing, and can end
  up named after whatever landed first rather than what actually turned out
  to be the release's main point (happened with 0.5, titled „Event-Gruppen"
  — a minor addition — while the real weight was the money rework). Reread
  the finished entry at version-assignment time and rename it if a bigger
  point buried the original title.

## Codebase constraints & gotchas (don't relearn these)

- **A table must not get its own scroll area.** `overflow-x: auto` silently makes
  a box a scroll container in BOTH axes, so a sticky `thead` inside can only stick
  to the box, never the page. Tables drop their own overflow; this only works
  because `main` uses `overflow-x: clip` (clip cuts off without creating a scroll
  container; `hidden` would break it). Below 700px is the deliberate exception:
  the table keeps its own horizontal scroller and the header sticks within it.
- **Sticky offsets are measured, not hard-coded.** Each thing stuck at the top
  (top bar, sheet header, tab bar, talent search, wiki bar) writes its height into
  a CSS variable via `components/stickyChrome.ts`; the stylesheet sums them with
  `calc()`. One variable per observer, so none depends on who measured first.
  **Adding a new sticky bar is not done when its own rule is written** — every
  `calc()` for something that sticks *below* it has to gain the new term, and
  some of those rules are shared with pages that never see the bar (`.talent-search`
  is the wiki's list filter *and* the character sheet's search; `.table-wrap
  table.sheet thead` renders inside wiki articles too). Adding the term there is
  safe precisely because an unset variable falls back to `0px`.
- **Everything editable flows through `NumInput`/`TextInput`** (they read the
  display mode themselves), which is why one provider flips a whole sheet at once.
  Structural buttons (`+ Zeile`, columns, delete, tab reorder, portrait) do NOT
  pass through them and must be gated one by one.
- **No data loss on migration** (top-ranking rule): map known fields and fold any
  unmapped/custom column into the row's `notiz` as `Label: value`. Nothing a
  player typed is ever silently dropped.
- **A derived column added by `ALTER TABLE` is filled with its DEFAULT, not with
  the right answer.** New tables are free (`CREATE TABLE IF NOT EXISTS` and
  `user_version` stays put), but a new *column* on an existing table starts wrong
  for every row already there. So each derived column gets a boot-time re-derive
  next to `indexNachziehen()` — `namensraeumeNachziehen()` recomputes the wiki's
  `namensraum`/`kategorie_key`/`weiterleitung` from title and text. This is not
  only about the first upgrade: a release **rollback** puts old code on a migrated
  database, and an edit made under that code updates the text while leaving the
  derived column stale. A `user_version` step would catch neither that nor a
  restore from an older backup.
- **Async state read during render must carry the identity of what it describes.**
  Clearing it in an effect is TOO LATE — the render that reads it has already run
  and returned. The wiki page view kept `kanonisch` (the canonical slug of the
  page it had) in its own `useState`; after a click on a `[[Wikilink]]` the first
  render compared the NEW slug against the OLD page and its rename-redirect check
  navigated straight back where the reader came from. Moving the reset into
  `laden()` did NOT fix it and made it worse: the bounce became deterministic
  instead of a race, so the target page never loaded at all. The fix is to keep
  the response and the key it answers in ONE state object and derive
  `geladen?.schluessel === schluessel ? geladen : null` during render — then there
  is nothing to reset and no reset to forget. Separately, every fetch keyed on a
  route parameter or on typing needs a `let aktuell = true` guard whose cleanup
  drops the answer, or the slowest request wins over the newest.
  Browser-level regression check: drive the installed Edge through Playwright from
  a scratch directory (`channel: 'msedge'`, no download, nothing added to
  package.json) — reasoning about React's render-then-effect order is exactly what
  got this wrong twice.
- **Hiding text from a reader is not enough — you must not send it.** The wiki's
  ` ```gm ` regions are removed server-side before the response. A client that
  merely declined to render them would still have shipped the text, and anyone
  could read it in the network tab. The same applies to search snippets (two FTS
  tables, not one filtered query), to old revisions, and to a 409 conflict body.
  When adding any new endpoint that returns page text, ask which of those it is.
- **…but never send it and then silently drop it either.** A reader who may edit
  gets `[[gm:n]]` markers where GM regions stand (`verbergeGmBloecke` /
  `stelleGmBloeckeHer`), so their save puts the original back. Stripping for both
  reading *and* editing would mean a player's ordinary edit deletes the GM's
  notes — that is the no-data-loss rule above, applied to somebody else's text.
- **A backticked fence inside a SQL template literal ends the literal.** Writing
  ` ```gm ` in a `db.exec(\`…\`)` comment produces a wall of confusing syntax
  errors far from the cause. Reword the comment; this has now bitten twice.
- **`--tabs-h` falls back to `0px`, and every `.tabs` bar is measured.** All three
  renderers (Character, Group, Admin) attach `useTabsHeight()`. A page without a
  tab bar — the wiki — must not inherit a guessed offset, so any new page that
  sticks a tab bar has to measure it rather than relying on a fallback.
- **SQLite has no cross-database CASCADE.** Images live in `helden-assets.db`,
  everything else in `helden.db`. Any new delete path must call
  `loescheAssetsFuer()` by hand; the weekly sweeper in `assets/sweep.ts` is a
  safety net for what gets missed, not the mechanism.
- **Verified FTS5 facts, so nobody "fixes" them:** raw user input in `MATCH`
  *throws* (always go through `ftsAnfrage`), `bm25()` returns negative values so
  the sort is `ASC`, and `remove_diacritics 2` folds `ü` but **not** `ß` — which
  is why `wikiSuchtext` indexes a written-out copy alongside the original.
