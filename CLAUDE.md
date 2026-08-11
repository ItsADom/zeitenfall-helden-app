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

## Docs & user-facing text

- **`TODO.md` is a forward-looking backlog, not a changelog.** It lists open
  tasks only. When a task is done, prune its entry (or delete it) — no "(DONE)"
  markers, no phase-by-phase history. Keep only residual forward-looking bits
  (a decided-but-unbuilt concept, a constraint, a follow-up). Git history already
  records what was finished.
- **The in-app changelog is curated, not a commit log.** `client/src/changelog.ts`
  (rendered by `client/src/pages/Changelog.tsx`) is a short, user-facing summary
  for players. Only propose entries for notable, user-visible changes, and keep
  each to a few high-level bullets. Don't add entries proactively for routine
  work. Leave the `version` field unset until the user starts real versioned
  releases.
