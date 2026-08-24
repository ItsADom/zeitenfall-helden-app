# Dice rolls and chat — implementation plan

Build plan for the "Dice rolls and chat" concept in TODO.md's `[sketch]`
entry (`TODO.md:96-202`), worked out in a planning session on 2026-08-17.
Copied here from the local Claude Code plan file so it's available on any
machine with this repo cloned, not just the one it was written on. TODO.md's
entry stays the source of truth on *scope*; this file is the concrete build
plan derived from it, and the Status section below records how far it has
actually been built.

## Status (last updated 2026-08-18)

**All 7 phases are built, verified and committed — nothing planned is left.**
Everything lives on the feature branch `feature/dice-rolls-chat`, cut off
`develop`, pushed to `origin`. Merging it back into `develop` is a deliberate
call left to the developer (per CLAUDE.md, standing instruction: don't merge
on your own initiative) — this file just records that the branch is ready
whenever that call is made.

The working tree was clean after phase 7 landed — no uncommitted work to
rescue.

### What is done

| Phase | Commit(s) |
| --- | --- |
| 1 — shared dice math + schema | `4905c13` |
| 2 — server WS infra + REST feed | `82b7056` |
| 3 — client connection layer + chat | `a280724`, `40dcfa9` |
| 4 — raw dice rolls, shortcuts, visibility | `5a0c277`, `57dd2e3` |
| 5 — sheet integration | `3a52fdd`, `baa4e5b`, `9f1633f`, `b217af6` |
| 5b — crit rule corrections | `7321bb2`, `28fb19b`, `4397634`, `8d99897`, `af8796c` |
| 6 — GM + selected player requests | `f38fa51` |
| 7 — rate limiting, changelog, dock polish | `84497af`, `2ce1c41`, `ad5c0d6` |

Phases 4-5 grew well beyond what this plan sketched, driven by rule
corrections that surfaced while testing. The rules as now implemented (all in
`shared/src/dice.ts`, all covered by `shared/test/dice.test.ts`):

- **Narrow pass (`NARROW_PASS_MARGIN = 4`).** A roll of **2+ dice** still
  passes when the adjusted sum overshoots the Probe-Zahl by at most 4
  („Knapper Erfolg"). **Single-die rolls have no such grace** — they were
  briefly rendered as though they did; fixed in `af8796c`.
- **An unconfirmed 20 downgrades** an otherwise clean multi-die pass to a
  narrow one, even when the sum alone would have passed comfortably.
- **20s and 1s cancel each other pairwise, in rolling order** — the first
  open 20 is cancelled by the next 1 and vice versa, as though the dice were
  thrown one after another. Cancellation removes only the *crit meaning*: a
  cancelled die **still rolls its confirmation, and that value still moves
  the sum** (`28fb19b`). Only `criticalFailureCount` ignores them.
- **A surviving natural 1 on a clean (non-narrow) pass makes it a critical
  success**, regardless of how its confirmation went — „a 1 is a 1". The
  confirmation is still rolled, there is simply no threshold on it.
- **Untrained talents and languages are rollable** (TaW 0 is a legal Probe).
  The source queries in `server/src/diceSource.ts` therefore start from the
  *catalogue* and `LEFT JOIN` the character rows with `COALESCE(taw, 0)`;
  starting from `char_talents`/`char_languages` silently hid every untrained
  entry (`baa4e5b`).
- **Attributes (Eigenschaftsproben) are rollable**, Sozialstatus included.
  Sidebar attribute boxes are click-to-roll; the printed Heldenbrief layout is
  untouched. SO is left off the *sidebar* only — it is rarely rolled — but is
  a normal rollable attribute everywhere else.

All player-visible wordings live in `client/src/components/dice/labels.ts`,
kept apart from the display logic so they can be reworded without touching any
rules: `shared/src/dice.ts` decides *when* an outcome applies, that file only
decides what it is called.

### Phase 6 deviations worth knowing

- Pending requests are held **in memory only** (`server/src/pendingRolls.ts`,
  5-minute TTL), never in the DB. A declined request therefore leaves no trace
  anywhere, because nothing was ever written.
- Accepting a request **recomputes** the Probe against the sheet as it stands
  at accept time — the value carried in the request is never trusted.
- The sheet entry point is a separate `🎲?` request button rather than a third
  `VisibilityPicker` option; see the note under Phase 6 below for why.

### Phase 7 — what it did

1. **Per-connection rate limiting** on `chat.send` and `roll.*`
   (`84497af`): a plain token bucket (burst 20, refill 5/s) per WebSocket
   connection, in `server/src/ws.ts` — `server/src/rateLimit.ts`'s existing
   `createAttemptLimiter` is shaped as a login-fail counter and didn't fit a
   per-message throttle, so `createTokenBucket` was added alongside it. This
   guards the permanently-stored feed against a runaway client (stuck macro,
   reconnect loop) rather than a determined attacker — the app already sits
   behind login.
2. **Changelog entry** (`ad5c0d6`): the two `COMING_SOON` teasers for this
   feature are now a real, unversioned `CHANGELOG` entry in
   `shared/src/changelog.ts` (title „Würfeln & Chat"). Left without a
   `version` per CLAUDE.md — the developer assigns one when cutting a
   release. A `0.X.0` (minor) bump is the shape to *recommend*: this is a new
   player-facing capability, not a same-app-working-better patch.
3. **Dock z-index / mobile polish** (`2ce1c41`): the dock's fixed `z-index`
   was `210`, above `.dialog-backdrop`'s `200` — any modal opened while the
   dock was visible got its corner covered by the dock instead of being
   blocked by it. Dropped to `150`. Also added a `max-width:700px` block
   bumping touch targets (icon buttons, send button, resize handle) and the
   chat input's font-size to 16px, which stops iOS Safari's auto-zoom on
   focus below that size.

### Still open — deliberately out of scope, stays in TODO.md

- **Wording for the critical success** — currently „Krit. Erfolg" in
  `labels.ts`; flagged as not-yet-satisfying and never resettled.
- **Dedicated chat page / virtual-table compatibility** — deliberately not
  built. The sketch and its three unresolved questions (selector entry point
  when no room is open, room persistence across reloads, how a GM's much
  longer group list should be presented) stay recorded in TODO.md.

### Picking it back up

- `npm ci` on a fresh clone can leave `better-sqlite3` without its native
  binary — npm blocks its install script by default (`npm warn
  install-scripts`), and the server then fails to start. Fix once per
  machine: `npm install-scripts approve better-sqlite3 esbuild && npm
  rebuild better-sqlite3 esbuild`.
- `npm test -w shared` — all 197 tests pass. (Eight `tabOrder`/`rules`
  Resilienz failures existed here for a while, unrelated to the dice work —
  two stale fixtures that hadn't caught up with the `WaffenNeu` tab rename and
  the race-catalog Resilienz formula. Fixed.)
- Browser verification needs two logged-in users (a GM plus `seed:testuser`,
  `testspieler`/`test1234`) — see the Verification section at the end of this
  file. Feed rows, temporary group memberships and per-character
  `chat_name`/`dice_shortcuts` written while testing were cleaned up after each
  round; keep doing that, they are visible to real players otherwise.

## Context

`TODO.md:96-202` already contains a fully worked-out concept for a dice-rolling
and chat feature — deliberately left as `[sketch]` not because anything is
undecided, but because it's large enough that "a build plan should re-walk it
piece by piece anyway." This plan is that walk-through: it turns the decided
concept into concrete DB schema, server modules, and client components, phased
so each step is independently committable.

A few things the concept text left open were resolved with the user while
writing this plan:
- **Dice shortcuts** (`Label: expression` favorites) are scoped **per
  character**, not per account — edited on the Einstellungen page's
  per-character section, alongside Farbwelt/Kategorien/Sichtbarkeit.
- **Weapon Proben (AT/PA/BL/FK)** roll a **single d20** each (N=1) — unlike
  Talente/Zauber they have no attribute-formula to derive N from (their
  target number is already collapsed through `weaponProbe`/
  `computeBaseValueBases`), and a single d20 per attack/parry/block/ranged
  roll also matches how these work at the table. They're in scope for this
  build alongside Talente/Zauber/Fähigkeiten/Sprachen.
- **GM + selected player must be initiable from the group overview page**,
  not only from a visited character sheet — this is how the GM picks *which
  player* to ask without first navigating to their sheet.
- **Only one GM exists per group/session** — no multi-GM handling needed
  anywhere in this feature.

**Branching:** this is large, multi-week, touches the DB schema and adds a
new dependency — a clear case for CLAUDE.md's "isolate risky/large work on
its own branch" exception. Create a feature branch off `develop` before
Phase 1; merge back to `develop` (and delete the branch) once the feature —
or an agreed subset of phases — is stable, not per-phase.

## Key design decisions (beyond the fixed concept)

- **One interleaved table (`group_feed`)**, not separate chat/roll tables +
  UNION — the concept requires identical chronological ordering *and*
  identical visibility filtering for both row kinds; one table means one
  filter predicate and one pagination cursor instead of two that could drift.
- **Dice shortcuts live in a plain-text column on `characters`**, mirroring
  the existing `characters.theme` pattern — never referenced by id elsewhere,
  no drag-reorder, so no dedicated table pays for itself.
- **The server recomputes the Probe-Zahl for every sheet/overview roll from
  the character's stored attributes/TaW/weapon data** — the client only
  sends *which* Probe to roll (`{kind:'talent', talentId}` etc.), never a
  number. `rules.ts` is already imported server-side; trusting a
  client-supplied target number would let a tampered client roll against an
  inflated threshold, RNG server-side notwithstanding.
- **Crit/confirmation math is pure and lives in `shared/src/dice.ts`**,
  unit-tested the same way `shared/test/rules.test.ts` already tests
  `rules.ts` (shared is the only workspace with a wired-up test runner).
  `crypto.randomInt` calls and DB/WS orchestration stay server-only. The
  mechanic is N-agnostic — it applies the same way whether N=1 (weapons) or
  N=3+ (Talente/Zauber/Sprachen).
- **Visibility filtering is one predicate (`canSeeFeedEntry`)**, used
  identically for live broadcast and history pagination, and it does
  **not** give the GM a bypass — "Hidden" must exclude the GM too, unlike
  every other access check in this codebase (`characterAccess`,
  `editableGroup`). This is the one deliberate exception to the app's usual
  "GM sees everything" pattern, so it's isolated in a single function
  precisely so nobody later pattern-matches an `isGm` bypass into it. (This
  stays a single-GM predicate, per the "only one GM per group" assumption
  above — no need to enumerate "which GM" beyond the one `gm_user_id`.)
- **The docked chat panel mounts once at the `App.tsx` level** as a fixed
  dock (not slotted into `Character.tsx`'s existing sidebar column or a new
  grid in `Group.tsx`/`GroupOverview.tsx`) — `Character.tsx` already has
  `CharacterSidebar` occupying the natural side-panel slot, and the group
  pages have no grid shell at all. A single global mount also means the same
  live connection and feed state survive navigating between a group's pages
  and a character on it — literally "without losing your place."
- **Pending GM+Player requests live in server memory, not the DB**, until
  accepted — "declining leaves no trace" is trivially true if nothing was
  ever persisted. A dropped request on server restart is an acceptable
  cost for this self-hosted, single-process app (the GM just re-sends it).
- **GM+Player picker: two entry points, one shared data source.** From a
  character sheet, the target is unambiguous (the sheet being viewed) and
  the existing per-row roll buttons work as-is with the visibility set to
  GM+Player. From the group overview, the GM doesn't have a sheet open, so
  each character card gets a "Probe anfordern" action that opens a small
  search picker (reusing the overview's existing search/pin UI idiom, see
  `gm-poll-search` in `GroupOverview.tsx`) listing that one character's
  rollable Talente/Zauber/Fähigkeiten/Sprachen/Waffen-Proben, fetched
  on-demand from a new endpoint (not eagerly loaded into every overview
  poll). Both entry points end up calling the same `roll.probe` WS message
  with `visibility:'gm_player'`.

## Database schema

**`group_feed`** — new table in `server/src/db.ts`, appended near
`group_tabs`/`group_sections`/`group_section_rows` (db.ts:336-361), same
`group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE` pattern:

```sql
CREATE TABLE IF NOT EXISTS group_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,                        -- 'message' | 'roll'
  visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'hidden' | 'gm_player'
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_char_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  gm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',       -- frozen display name at post time
  is_me INTEGER NOT NULL DEFAULT 0,           -- kind='message'
  text TEXT NOT NULL DEFAULT '',              -- kind='message'
  roll_json TEXT                              -- kind='roll', see shared/src/diceProtocol.ts
);
CREATE INDEX IF NOT EXISTS idx_group_feed_group_id ON group_feed(group_id, id);
```

This is the app's first table with genuinely unbounded, never-pruned growth
(per the concept: no retention window), and its first real secondary index —
existing tables get away with none because nothing else grows like this.
Cursor is `id` (not `created_at`): `better-sqlite3` is synchronous/single-writer
so `id` is already strictly monotonic, simpler than a millisecond timestamp.

**`characters.dice_shortcuts`** — migration next to the existing `theme`
column migration in `db.ts` (~line 530-534):

```ts
{
  const cols = new Set((db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('dice_shortcuts')) db.exec("ALTER TABLE characters ADD COLUMN dice_shortcuts TEXT NOT NULL DEFAULT ''");
}
```

## Shared modules

**`shared/src/dice.ts`** (new) — pure resolution math, no I/O:

```ts
export const MAX_DICE_COUNT = 20;
export const MAX_DICE_SIDES = 1000;

export function findCritTriggers(dice: number[], sides: number): { dieIndex: number; trigger: 20 | 1 }[];
export function confirmationsNeeded(dice: number[], sides: number): number;

// value: null = vom Spieler verworfen (siehe skipped)
export interface DieConfirmation { dieIndex: number; trigger: 20 | 1; value: number | null; confirmed?: boolean; skipped?: boolean }
export interface PendingConfirmation { dieIndex: number; trigger: 20 | 1 }
export interface RolledConfirmation { dieIndex: number; value: number | null }

export interface ProbeRollResult {
  dice: number[]; confirmations: DieConfirmation[];
  pending: PendingConfirmation[]; resolved: boolean;
  rawSum: number; adjustedSum: number; probeZahl: number;
  criticalFailureCount: number; criticalFailure: boolean; success: boolean;
}
export function resolveProbeRoll(dice: number[], rolled: RolledConfirmation[], probeZahl: number): ProbeRollResult;

export interface DiceExpression { count: number; sides: number; modifier: number }
export function parseDiceExpression(expr: string): DiceExpression | null;  // "2w6+5", "w20", case-insensitive "w"

export interface ExpressionRollResult {
  expression: DiceExpression; dice: number[]; confirmations: DieConfirmation[];
  pending: PendingConfirmation[]; resolved: boolean;
  rawSum: number; adjustedSum: number; flagged: boolean;
}
export function resolveExpressionRoll(expression: DiceExpression, dice: number[], rolled: RolledConfirmation[]): ExpressionRollResult;

export type DiceShortcutLine =
  | { kind: 'separator' }
  | { kind: 'shortcut'; label: string; expression: string; valid: boolean };
export function parseDiceShortcuts(raw: string): DiceShortcutLine[];  // "Label: expr" per line, "---" = separator
```

Crit/confirmation semantics (implemented exactly as decided, no house-rule
guessing): each natural 20 gets its own confirmation d20 — confirmation ≥10
confirms it as an instant critical failure (overrides the sum/Probe-Zahl
comparison entirely; `criticalFailureCount` tracks how many, since 2+ stack
into a worse failure); confirmation <10 leaves it unconfirmed and its value
is *added* to the sum instead. Each natural 1 also gets its own confirmation
d20, but that value is *always subtracted* from the sum, unconditionally (no
≥10/<10 branch for 1s — asymmetric with 20s by design). Confirmation rolls
are never themselves re-confirmed. Applies identically at N=1 (a single
weapon Probe die can still crit/fumble on its own) and at N=3+ (Talente/
Zauber/Sprachen). Same mechanic applies to raw shortcut/expression rolls
(only when `sides === 20`), just without a success/fail concept to override —
the entry is flagged for display instead.

**Confirmations are not rolled with the dice** (decided during phase 5): the
roll posts with its 20s/1s showing and the confirmations still open, and the
roller triggers each one afterwards, one button per die. Only the roller gets
those buttons. Each open confirmation can also be *declined* — not every d20
roll has a Patzer concept (a luck roll, a random-table roll) — which settles it
with no effect on the sum and no Patzer. Until nothing is `pending`, the entry
is not `resolved` and deliberately shows no success/failure, since an
outstanding 20 could still flip it. Feed entries are therefore mutable: written
once, then updated in place (`feed.update` beside `feed.append`, `roll.confirm`
client→server). The resolvers take the confirmations rolled *so far* (any
order, keyed by `dieIndex`) and report the rest as `pending`.

`shared/test/dice.test.ts` (vitest, same convention as `rules.test.ts`):
plain pass/fail, single confirmed/unconfirmed 20, single 1, two confirmed 20s
stacking, mixed 20s+1s, N=1 crit/fumble, `parseDiceExpression` edge cases,
non-d20 expression rolls never triggering confirmations, `parseDiceShortcuts`
separators/invalid lines/blank lines.

**`shared/src/diceProtocol.ts`** (new) — wire types shared by client and
server:

```ts
export type RollVisibility = 'public' | 'hidden' | 'gm_player';

export type ProbeSource =
  | { kind: 'talent'; talentId: number }
  | { kind: 'ability'; abilityId: number }
  | { kind: 'sprache'; languageId: number; mode: 'sprechen' | 'schreiben' }
  | { kind: 'weapon'; sectionRowId: number; probe: 'at' | 'pa' | 'bl' | 'fk' };
```

plus `FeedEntry` (`ChatFeedEntry | RollFeedEntry`), `PendingRollRequest`,
`ClientToServerMessage` / `ServerToClientMessage` discriminated unions (chat
send, roll request, pending accept/decline, feed append, error). Every
client→server message carries a `reqId` so the UI can correlate an error
reply back to the control that sent it.

Both new files re-exported from `shared/src/index.ts`.

## Server

**WS infra — `server/src/ws.ts`** (new): `attachWsServer(server: http.Server)`
creates a `WebSocketServer({ noServer: true })`, handles the `'upgrade'` event
on path `/ws/groups/:groupId`, authenticates by calling the existing
`getSessionToken`/`userForToken` (`server/src/auth.ts`) directly against the
raw upgrade request — the `helden_session` cookie rides along on the upgrade
GET automatically, no new token scheme needed. Membership check mirrors
`editableGroup`: group exists AND (`isGm` OR `isGroupMember`) — export
`isGroupMember` from `routes.ts` (currently module-private, routes.ts:101)
for reuse here. Unauthorized → write a 401 and destroy the socket.
Authenticated sockets join a per-group room (`Map<groupId, Set<WebSocket>>`),
get a 30s ping/pong heartbeat, and dispatch incoming JSON to per-type
handlers. `broadcastToGroup(groupId, entry)` iterates the room and sends
`feed.append` only to sockets for which `canSeeFeedEntry` passes.

`server/src/index.ts` needs restructuring to expose the underlying
`http.Server` so WS can share the port — today `app.listen(port, ...)`
(index.ts:61) hides it:
```ts
const server = http.createServer(app);
attachWsServer(server);
server.listen(port, () => { ... });
```
Add `ws` + `@types/ws` to `server/package.json` (no realtime library exists
in the repo today; `ws` matches this app's minimal-dependency style versus
`socket.io`'s heavier, mostly-unused feature surface).

**Visibility + persistence — `server/src/feed.ts`** (new):
```ts
export function canSeeFeedEntry(entry: {visibility, authorUserId, gmUserId}, viewer: {userId: number}): boolean;
// public → true; hidden → authorUserId===viewer.userId;
// gm_player → authorUserId===viewer.userId || gmUserId===viewer.userId
// Deliberately takes NO isGm parameter.
export function insertFeedMessage(groupId, author, text, isMe): FeedEntry;   // INSERT + broadcastToGroup
export function insertFeedRoll(groupId, author, gmUserId, visibility, roll, mode, label): FeedEntry;
export function loadFeedPage(groupId, viewer, before: number|null, limit: number): { entries: FeedEntry[]; hasMore: boolean };
// filtered through the SAME canSeeFeedEntry used for broadcast — the one
// place this predicate lives, so live and historical views can't drift apart.
```

**Dice orchestration — `server/src/dice.ts`** (new): `rollD20()`/`rollDie(sides)`
via `crypto.randomInt`; `performProbeRoll(n, probeZahl)` and
`performExpressionRoll(expr)` roll the primary dice, roll however many
confirmations `confirmationsNeeded` says are required, and call the
`shared/src/dice.ts` resolvers.

**Canonical Probe recompute — `server/src/diceSource.ts`** (new):
`computeProbeForCharacter(characterId, source): {n, probeZahl, label} | null`.
Verified against the actual schema:
- `talent`: join `char_talents`/`talents_catalog` (`talent_id` PK pair,
  `probe` column is **`/`-delimited**, matching `Talente.tsx:236`'s
  `e.probe.split('/')`) — always `n=3`, `null` if `probe` is empty (Kampftalente
  — these still have no formula and stay excluded even though weapon Proben
  are now in scope; they're superseded by the weapon-tab AT/PA/BL rolls) or
  doesn't split into exactly 3.
- `ability`: `char_abilities.probe` is **`+`-delimited** (different separator
  than talents — a real trap), parsed via `parseProbeExpr`; `n` = parsed
  length (variable).
- `sprache`: `char_languages`/`languages_catalog`, `n=3`,
  `probeZahl = (sprechenProbe|schreibenProbe)(attrs) + erleichterung(taw)` —
  this exact per-row formula is new (see Sheet integration below).
- `weapon`: load the `char_section_rows` row (`waffenNahNeu`/`waffenFernNeu`
  section) by `sectionRowId`, decode its `data` JSON, and recompute via the
  *same* `weaponProbes`/`weaponProbe` functions `WaffenNeu.tsx` already uses
  client-side (`shared/src/rules.ts`), using the row's own `at`/`pa`/`bl`/
  `atMod` plus the linked Kampftalent's `at`/`pa`/`bl` split and the
  character's base values. `n=1` always. `probe` selects which of the four
  computed values (`at`/`pa`/`bl`/`fk`) is the target.
- Attributes via the existing exported `loadAttributes(characterId)`
  (`server/src/characterData.ts:66`).

**Rollable-probes listing — `server/src/diceSource.ts`** (same file):
`listRollableProbes(characterId): { source: ProbeSource; label: string; n: number; probeZahl: number }[]`
— iterates the character's talents (excluding Kampftalente)/abilities/
languages/weapon rows and calls `computeProbeForCharacter` for each. Powers
the GM-overview picker (below); not used by the sheet, which already has
these numbers rendered per-row.

**REST endpoints — `server/src/routes.ts`**:
```
GET /api/groups/:id/feed?before=<id>&limit=<n>   -- editableGroup guard, → { entries, hasMore }
PUT /api/characters/:id/dice-shortcuts            -- same guard as /theme, body {text}, cap ~8000 chars
GET /api/characters/:id/probes                    -- requireGm (or owner), → listRollableProbes(id)
```
`GET /api/characters/:id`'s existing `info` object (routes.ts:468-477) gains
`diceShortcuts: char.dice_shortcuts ?? ''` next to `theme` — no new read
endpoint needed for that one, the sheet and Einstellungen already fetch it.

**Pending GM+Player requests** — in-memory `Map<string, PendingRollRequest>`
in `server/src/ws.ts` (or a small sibling file): `createPendingRequest`
(5-minute TTL, auto-expires + notifies both parties), `acceptPendingRequest`
(re-validates the accepting user, **re-runs `computeProbeForCharacter` against
current stats** rather than trusting whatever was true when the GM sent it,
rolls, persists via `insertFeedRoll` with `visibility:'gm_player'`),
`declinePendingRequest` (deletes from the map, no DB write at all). Works
identically regardless of which entry point (sheet or overview) created the
request — both just call the same `createPendingRequest` with a resolved
`ProbeSource` and `targetUserId`.

## Client

**Connection + panel state — `client/src/components/dice/DicePanelProvider.tsx`**
(new): owns the native `WebSocket` connection (no client npm dependency
needed — only the server needs `ws`), keyed on the currently "open" group.
On connect: buffer live pushes, fetch `GET /groups/:id/feed` for the initial
page, merge+dedupe by `id`, render, then switch to rendering live pushes
directly — closes the race between "history fetched" and "socket open."
Reconnect with 1s→2x→30s-cap backoff, ±20% jitter. Exposes `feed`,
`pendingRequests`, `sendChat` (handles the `/me ` prefix), `rollProbe`,
`rollExpr`, `acceptPending`/`declinePending`, `open(groupId, charId)` /
`collapsed`/`toggle`. Mounted once in `App.tsx` alongside the existing
`RequestsProvider`/`OverviewProvider` (App.tsx:95-96), with a `<DicePanel/>`
fixed-position dock as a sibling — gated on `groupId != null`, hidden in
print via the existing `.screen-only` class.

**Panel UI** — `client/src/components/dice/{DicePanel,FeedEntryView,
VisibilityPicker,ShortcutsFlyout,PendingRequestCard}.tsx` (new). Collapse
mechanics reuse the `useCollapsed`/`usePersistedState` pattern already used
by `CharacterSidebar`/`components/collapse.tsx`, under a new storage key.
`VisibilityPicker` and `ShortcutsFlyout` both build on a newly extracted
**`useHoverFlyout()`** hook (`client/src/components/useHoverFlyout.ts`) that
factors the ~25 duplicated lines of open/close/outside-click/Escape handling
already copy-pasted between `ProfileMenu.tsx` and `NavMenu.tsx`.
`PendingRequestCard` reuses the accept/decline *data flow* shape from
`Admin.tsx`'s existing request-approval pattern (`actOnRequest`,
`requests.tsx`'s `PendingBadge`/`RequestsProvider`) but with card/feed-item
chrome instead of a table row — there's no existing floating-card component
to copy directly.

**Mounting**: `Group.tsx`, `GroupOverview.tsx`, and `Character.tsx` all call
`useDicePanel().open(groupId, characterId)` in a `useEffect`. On
`Character.tsx` the active character is unambiguous. On `Group.tsx`, use the
player's sole owned character in that group — a player having more than one
character in the same group isn't a case the app supports, so no selector UI
is needed here at all. GM users get no character context (they can still
chat/`/me` under their account name). `GroupOverview.tsx` opens the panel
with no active character too (GM-only route) — its role in this feature is
purely the GM+Player request entry point, not a place to chat as a character.

**`CharCtx` groupId prerequisite** (`client/src/pages/Character.tsx`): fix
`CharacterInfo.groupId`'s type from `number` to `number | null` (matches
what the server actually sends, routes.ts:473) and thread it into `CharCtx`
(currently `{charId, data, catalogs, update}`, Character.tsx:131-138) so
tab components — which today only see `useChar()` and never `info` — can
gate roll buttons on "no group ⇒ no feed to post to."

**Dice-shortcuts editor** (`client/src/pages/Einstellungen.tsx`): new
per-character panel section (id `wuerfel`), following the file's existing
load/dirty/save shape exactly (mirrors the `theme`/`charTheme` state pair) —
`TextInput` (`components/inputs.tsx:104-143`, same widget as `SidebarNotiz`)
bound to the raw text, `PUT /characters/:id/dice-shortcuts` on save, plus a
live preview via `parseDiceShortcuts` so invalid lines are flagged inline
rather than silently dropped.

**Sheet roll buttons** — `client/src/components/dice/ProbeRollButton.tsx`
(new), reused across four tabs. Primary click = immediate Public roll;
secondary dropdown-arrow control opens `VisibilityPicker` for Hidden/GM+Player
(GM+Player option only rendered when `user.isGm && char.ownerUserId !== user.id`).
`n`/`probeZahl` stay display-only (the sheet keeps showing exactly what it
shows today) — only a `ProbeSource` descriptor is sent to the server.
- `Talente.tsx:245` — next to the existing `talentProbeZahl` cell; still `'—'`
  with no button for Kampftalente (`e.probe === null` — those roll via the
  weapon tab instead).
- `AbilityTable.tsx`'s `AbilityRow` (~231-246) — next to the existing `pz`
  display, covers both Zauber and Fähigkeiten tabs via the one shared component.
- `Sprachen.tsx` — **new** per-row roll button; today there's only one
  Probe-Zahl shown per whole table (an info blurb above each table, and
  notably one whose number doesn't actually add `erleichterung(taw)` despite
  its own text claiming it does). Out of scope to fix or duplicate that
  display: the sheet itself doesn't need a new per-row number column — the
  correct value (`sprechenProbe/schreibenProbe(attrs) + erleichterung(taw)`)
  only needs to exist where it's actually used, i.e. computed server-side for
  the roll and shown in the roll *result* in the feed. The existing blurb is
  left untouched.
- `WaffenNeu.tsx`'s `ProbeChip` (lines ~214-222, the single rendering point
  for AT/PA/BL and FK chips) — extend with an optional roll-context prop so
  each chip gets its own button (`source:{kind:'weapon', sectionRowId, probe:'at'|'pa'|'bl'|'fk'}`,
  `n=1`), rather than duplicating buttons at each of the `NahCards`/
  `FernCards` call sites.

Rolling from the sheet calls `dice.open(groupId, charId)` first (auto-expands
the panel) then fires the roll.

**GM-overview picker** (`client/src/pages/GroupOverview.tsx`): each `gm-card`
gets a "🎲 Probe anfordern" button. Clicking it fetches
`GET /api/characters/:id/probes` (on demand, not eagerly per poll cycle) and
opens a small search list scoped to that one character's rollable entries —
visually modeled on the existing `gm-poll-search`/`matches` talent-query UI
already on this page (search box, matching results, click to pick) rather
than a new pattern. Picking an entry calls `rollProbe(source, 'gm_player', targetUserId: char.ownerUserId)`
via `useDicePanel()`, which — same as the sheet path — goes through the
pending-request flow rather than rolling immediately.

## Phases (each independently committable, later phases depend only on earlier ones)

0. **Feature branch.** Cut off `develop` before any other work starts.
1. **Shared dice math + DB schema** — `shared/src/dice.ts`,
   `diceProtocol.ts`, tests; `group_feed` table + index; `dice_shortcuts`
   column. Inert: unused schema, fully tested pure logic, zero user-facing
   change.
2. **Server: WS infra + REST feed/shortcuts endpoints** — `ws.ts`, `feed.ts`,
   `dice.ts`, `diceSource.ts` (probe recompute only, not the listing yet);
   `isGroupMember` export; the feed + shortcuts routes; `diceShortcuts`
   added to the character info payload. Manually testable with a WS test
   client before any client code exists.
3. **Client: connection layer + docked panel shell + plain chat** (no rolls
   yet) — `DicePanelProvider`, `DicePanel`, `FeedEntryView` (chat only), WS
   dev proxy in `vite.config.ts`, mounting in `App.tsx`/`Group.tsx`/`Character.tsx`.
   Ships a real demoable slice: live group chat with `/me` and reconnect,
   from both pages.
4. **Raw dice rolls end-to-end** — `roll.expr` wired through `ws.ts`;
   `VisibilityPicker` (Public/Hidden only), `ShortcutsFlyout`, roll rendering
   in `FeedEntryView`, history pagination; Einstellungen shortcuts editor;
   `useHoverFlyout()` extraction. A complete, independently valuable
   feature — chat + shortcut/free-form dice with crits — before touching
   the character sheet.
5. **Sheet integration** — `roll.probe` wired via `computeProbeForCharacter`;
   `CharCtx` groupId threading; `ProbeRollButton`; wiring into Talente,
   AbilityTable, Sprachen (new roll buttons only, no new visible column —
   the Erleichterung-corrected value shows up in the roll result, not on
   the sheet), and WaffenNeu's `ProbeChip` (N=1 weapon rolls). Public/Hidden
   visibility only — GM+Player still comes in the next phase.
6. **GM + selected player flow, both entry points** — pending-request
   registry and `roll.pending.*` handling server-side; `listRollableProbes`
   + `GET /characters/:id/probes`; `PendingRequestCard`, the GM-overview
   picker UI in `GroupOverview.tsx`, accept/decline wiring, auto-expand on
   request client-side.
   - **Built differently than sketched in one respect:** the sheet entry
     point is NOT a third `VisibilityPicker` option. Phase 5 had already
     settled that a GM never rolls *as* a player (`rollCtx` is null on a
     foreign sheet), so "GM + Player" is not a visibility one picks for
     one's own roll — it is a different action. The GM therefore gets a
     separate `🎲?` request button on a foreign sheet (via `requestCtx`),
     and the picker keeps only Public/Hidden everywhere it appears.
7. **Hardening/polish** — per-connection rate limiting on `chat.send`/`roll.*`
   (new token-bucket limiter — not a direct reuse of
   `server/src/rateLimit.ts`'s fail-counter-shaped `createAttemptLimiter`,
   needs its own shape); move the feature out of the changelog's
   `COMING_SOON` into a real entry; z-index/mobile polish on the fixed dock.

## Later addition: „der große Wurf" (`/i`)

Built on top of everything above, after the fact. Only the parts that are not
obvious from the code are recorded here; the rules of the mechanic are
unchanged, because it does not have any of its own — it is the ordinary
expression roll with a performance in front of it.

- **`/i <Ausdruck>` / `/important <Ausdruck>`** is the Spielleitung's version of
  `/r`. Gated server-side in `ws.ts` (`roll.expr` + `important`), like every
  other GM-only message; the client check is only there to save a round trip.
  Always `visibility: 'public'` — an announcement to the whole table with a
  hidden result behind it makes no sense, so the picker is overridden and the
  dock says so once.
- **The entry is persisted but NOT broadcast.** It travels inside the transient
  `roll.important` message and each client appends it itself when *its own*
  cinematic ends. That is what lets one player skip the animation without
  affecting anybody else's timing, and it is why `writeFeedRoll` exists next to
  `insertFeedRoll` in `feed.ts`. Anyone who reconnects mid-performance picks the
  entry up through the ordinary history endpoint — the reconnect path is the
  safety net for a cinematic that never finishes.
- **The append is deliberately not a blind merge.** While a performance runs, a
  `feed.update` for that same id can already have arrived (someone who
  reconnected has the entry and can have thrown its confirmation). `mergeFeed`
  replaces by id, so appending the older copy on top would silently undo the
  newer one. See `haengeEintragAn` in `DicePanelProvider`.
- **Nothing new is stored.** No `important` column: a stored flag would replay
  the performance on every page load, and nothing ever needs to ask after the
  fact whether a roll was announced. The seed is meaningless outside the seconds
  it drives. The whole feature is additive on the wire and additive in the
  client — no migration at all.
- **Determinism** lives in `shared/src/diceCinematic.ts`, whose header states
  the three rules that hold it together (integer-only PRNG, closed-form
  functions of elapsed time, world units rather than pixels). What is
  deliberately *not* synchronised is the wall-clock start: the requirement is
  that everyone sees the same animation, not that they see it in the same
  millisecond.
- **three.js is lazy, and that has to be defended.** Only `preload.ts` and the
  overlay's effect may reference `cinematic/stage`, and only through `import()`.
  A static import of anything that transitively imports three moves ~132 KB
  gzipped into the chunk every page load fetches, and nothing fails to warn you
  — it happened once already, via a colour helper. That is why `kontrast.ts`
  exists separately from `faces.ts`.
- **Face recovery** groups triangles by ANGULAR similarity of their normals, not
  by rounding a normal into a map key: the latter splits components that land on
  a rounding boundary and yields 17 faces for a dodecahedron. The d10 is
  hand-built and its kite faces are planar at exactly one band-to-apex ratio,
  with a winding that must be right or its ten faces collapse into five against
  their own antipodes.
- **The camera angle is a correctness constraint, not a look.** A die at rest
  lies with the rolled face pointing straight up — that is what "the die shows a
  7" physically means — so a camera anywhere near level with the table sees that
  face edge-on and the numbers a player actually reads are the SIDE faces. This
  shipped at 12° and did exactly that: the roll was right and the picture
  disagreed with it. `CAMERA_TILT` therefore lives in `shared` beside the
  layout, at 64°, and the gathered dice are laid out on the plane perpendicular
  to it (`stagePoint`) so the grid is not squashed by the tilt.
- **The three opening beats are sequential on purpose.** Fanfare, then blackout,
  then dice — each finishing before the next begins. They used to overlap, which
  collapsed the announcement into one instant in which nothing read as causing
  anything else. The consequence is that for the first beat and a half the
  overlay is present but invisible, so it must also be intangible: it takes no
  clicks and answers no Escape until the screen has gone dark.
- **Cancelled crits get no effect**, because `findCritTriggers` has already
  declared them meaningless and the feed row says „· aufgehoben" underneath. The
  filter lives in `shared` (`effectTriggers`) and is tested, because it encodes a
  rules decision rather than a taste one.

## Open items

None remaining — the items originally flagged here (Group.tsx "posting as"
character selection, and whether to touch the Sprachen blurb) were both
resolved while writing this plan; see the Mounting and Sheet-roll-buttons
sections above.

Rate/size limits, reconnect backoff timing, heartbeat interval, exact
confirmation-roll display copy, and the WS URL shape are trivial
implementation-time picks, not design decisions, and are called out inline
above where relevant.

## Verification

- Phase 1: `npm test -w shared` (or the shared package's existing vitest
  entrypoint) covers the crit/confirmation math and expression/shortcut
  parsing without touching the running app.
- Phase 2: start the server (`npm run dev:server`), authenticate via the
  existing login flow to get a `helden_session` cookie, then drive the
  WS endpoint with a manual client (e.g. `wscat -c ws://localhost:3001/ws/groups/<id> -H "Cookie: helden_session=<token>"`)
  to confirm upgrade auth, membership gating, and `GET /api/groups/:id/feed`
  pagination.
- Phases 3-6: use the Browser pane against the Vite dev server
  (`.claude/launch.json`'s `client`/`server` configs) — log in as two
  different seeded users in two browser tabs (a GM tab and a player tab via
  `seed:testuser`) to confirm live chat/roll delivery, visibility filtering
  (a Hidden roll must not appear in the other tab's feed or network traffic
  at all), reconnect behavior (stop/restart the server config, confirm the
  client recovers), the weapon-tab N=1 rolls, and the pending-request
  Accept/Decline flow from BOTH entry points — the sheet and the group
  overview — between the GM tab and the player tab.
