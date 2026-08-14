# CLAUDE.md — working agreement for this repo

Rules for any AI assistant working on the Zeitenfall / Heldenverwaltung app. This
file is committed and travels with the repo, so it applies on **every machine**.
These are standing instructions — follow them without being reminded.

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

## Codebase constraints & gotchas (don't relearn these)

- **A table must not get its own scroll area.** `overflow-x: auto` silently makes
  a box a scroll container in BOTH axes, so a sticky `thead` inside can only stick
  to the box, never the page. Tables drop their own overflow; this only works
  because `main` uses `overflow-x: clip` (clip cuts off without creating a scroll
  container; `hidden` would break it). Below 700px is the deliberate exception:
  the table keeps its own horizontal scroller and the header sticks within it.
- **Sticky offsets are measured, not hard-coded.** Each thing stuck at the top
  (top bar, sheet header, tab bar, talent search) writes its height into a CSS
  variable via `components/stickyChrome.ts`; the stylesheet sums them with
  `calc()`. One variable per observer, so none depends on who measured first.
- **Everything editable flows through `NumInput`/`TextInput`** (they read the
  display mode themselves), which is why one provider flips a whole sheet at once.
  Structural buttons (`+ Zeile`, columns, delete, tab reorder, portrait) do NOT
  pass through them and must be gated one by one.
- **No data loss on migration** (top-ranking rule): map known fields and fold any
  unmapped/custom column into the row's `notiz` as `Label: value`. Nothing a
  player typed is ever silently dropped.
