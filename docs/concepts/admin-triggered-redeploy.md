# Admin-triggered redeploy — implementation plan

## Context

Rolling out a new version means an SSH session today: `sudo /usr/local/bin/helden-deploy prod`
(or `dev`), or waiting for the nightly chain that hangs off the OneDrive backup.
This feature puts the same action behind a button in the Verwaltung area, so an
admin can publish a pushed commit from wherever they are.

Two instances share one machine. `zeitenfall.de` runs `main` as the `helden`
user, `dev.zeitenfall.de` runs `develop` as `heldendev`; the deploy logic itself
is already unified in `/usr/local/bin/helden-deploy <prod|dev>`. The button
therefore does not need to *decide* anything — it needs to *ask*, and the
instance it belongs to has to be structural, not a parameter.

The hard part is not the button. It is that an Express process running as an
unprivileged, sandboxed user has to cause a root-level deploy that will then
kill that very process.

## Decisions settled with the developer

| Question | Decision |
|---|---|
| Who may trigger it | **Admin only.** Explicitly not GM, unlike almost every other `/api/admin/*` route. |
| Which branch | **Fixed per instance** — dev deploys `develop`, prod deploys `main`. Not selectable from the request. |
| Nothing new on the branch | **Do nothing** and report "already up to date". No restart, no rebuild. |
| Confirmation | **Notice → follow-up question → press-and-hold**, in that order. The hold is the point of no return, so nothing is asked after it. |
| Hold duration | **10 seconds**, with a progress indicator. |
| Other logged-in users | **Announcement plus the same waiting screen**, and an automatic reload once the server is back. |
| Progress detail for the admin | **Named phases plus the plain-text error** on failure. No live log. |
| Privilege mechanism | **Request file plus a systemd path unit.** No sudo, no weakening of the unit sandbox. |

## Why not sudo

The obvious design — a `sudoers` entry letting `helden` run `helden-deploy` —
fails twice over.

`helden-app.service` sets `NoNewPrivileges=true` and `RestrictSUIDSGID=true`.
Both flags are inherited by every child, and they make the setuid bit on
`/usr/bin/sudo` inert. The sudoers entry would not merely be unwise; it would
not function at all without removing hardening from the app process forever, for
the sake of one button.

Even with the hardening removed it would still be wrong. A `sudo helden-deploy`
spawned by the app is a child of the app, and therefore lives in the app unit's
cgroup. `systemctl restart helden-app` — which is the last thing `helden-deploy`
does — sends SIGTERM to the whole cgroup by default. The deploy would kill
itself mid-flight, seconds before finishing. Escaping that needs `systemd-run`,
which needs more privilege again.

The mechanism below has neither problem, and gets the decoupling for free.

## The privilege chain

*Built and verified on 2026-08-22; see "Evidence" below.*

The app is never granted anything. It may leave a note in a directory it already
owns; root decides what that note is worth.

```
App (helden)                  systemd (root)
    |                              |
    |-- write anstoss.json ------> | helden-deploy-trigger@helden.path
    |                              |     fires
    |                              |-- helden-deploy-trigger@helden.service
    |                              |     consumes the request
    |                              |     runs helden-deploy prod
    |<-- read status.json ---------|     writes phases back
```

### Control directory

`/srv/helden/deploy` and `/srv/helden-dev/deploy`, owned by the respective
service user, mode 750, added to that unit's `ReadWritePaths`. Deliberately a
directory of its own rather than `data/`, which holds the databases.

| File | Written by | Read by |
|---|---|---|
| `anstoss.json` | the app | root |
| `status.json` | root | the app |
| `fehler.txt` | root | the app |

`status.json` ends up `root:root 644`. The app can read it and **cannot forge
it** — a useful property that falls out of the direction of the permissions
rather than from any check.

The error text lives in its own plain file instead of inside the JSON. Hand
rolling JSON string escaping in bash is a reliable way to ship a quoting bug;
Node reads the file as text and escapes it properly on the way out. The
consequence for the client: `fehler.txt` is only meaningful while the phase is
`fehlgeschlagen`, otherwise it may be a leftover from an earlier run.

### Units

`helden-deploy-trigger@.path` watches `/srv/%i/deploy/anstoss.json`, where `%i`
is the base directory name (`helden` or `helden-dev`). One template serves both
instances, and the mapping from instance to branch lives in the unit name — so
dev structurally cannot deploy anything but `develop`, whatever a request says.

`PathExists` rather than `PathChanged`: the file is created once and the service
deletes it immediately, so the unit re-arms cleanly.

`helden-deploy-trigger@.service` is `Type=oneshot` with **`TimeoutStartSec=1800`**.
This is the setting that must not be forgotten: `npm ci` plus a Vite build takes
minutes, the default start timeout is 90 seconds, and systemd would otherwise
kill the deploy mid-build and leave a half-installed release behind.

### The wrapper

`/usr/local/bin/helden-deploy-trigger <basis>` runs as root and does four things
in a deliberate order:

1. **Claim the run, then consume the request.** The app reports "a deploy is in
   flight" when either the request file exists or the status says so, so the
   status has to say `pruefe` *before* the request file disappears — the other
   order leaves a sliver of a second in which neither is true, and a browser
   polling exactly then would stop waiting for the restart. Consuming the
   request early still matters for its own reason: a path unit only re-arms once
   the watched file is gone, so removing it before anything slow can fail turns
   a crash into one failed run instead of an endless restart loop. The requester
   is logged to the journal on the way past, which is the audit trail.
2. **Take `/run/helden-deploy.lock`** — the same lock the nightly chain uses.
   Colliding with the nightly run is not an error worth a failed unit; it is
   reported as "not now".
3. **Run `helden-deploy`** with `HELDEN_DEPLOY_STATUS` pointing at `status.json`.
4. **Have the last word on failure.** `helden-deploy` runs under `set -e`, so an
   aborted `npm ci` exits on the spot and cannot report its own verdict. The
   wrapper checks the exit code and writes `fehlgeschlagen` plus the last 20 log
   lines.

It always exits 0. A failed deploy is recorded in the app and in the journal;
leaving a unit sitting in `systemctl --failed` on top of that adds noise, not
information.

Deliberately **without `set -e`**: whatever goes wrong, this script must survive
long enough to write a final status. A run that dies quietly would strand every
waiting browser forever.

### The hook in helden-deploy

`helden-deploy` gains one function and five call sites:

```bash
melde() {
  [ -n "${HELDEN_DEPLOY_STATUS:-}" ] || return 0
  { printf '{"phase":"%s","zeit":%s}\n' "$1" "$(date +%s)" > "$HELDEN_DEPLOY_STATUS.neu" &&
    mv -f "$HELDEN_DEPLOY_STATUS.neu" "$HELDEN_DEPLOY_STATUS"; } || true
}
```

Two properties matter. It writes through a temporary name and renames, because a
rename within one filesystem is atomic and a reader must never catch the file
half-written. And it is a no-op unless `HELDEN_DEPLOY_STATUS` is set, so the
nightly run behaves exactly as it always did.

Phases: `pruefe` → `aktuell`, or `pruefe` → `baue` → `starte` → `fertig`, with
`fehlgeschlagen` possible from `baue` onward.

### Evidence

Verified by hand on 2026-08-22, before any application code existed:

- A request dropped as `heldendev` fired the path unit within the same second;
  the requester appeared in the journal.
- `anstoss.json` was consumed; the path unit returned to `active (waiting)`.
- `status.json` came out `root:root 644` and was readable by `heldendev`.
- With dev already on `origin/develop`, the run ended at `aktuell` and
  `helden-app-dev` was **not** restarted (`ActiveEnterTimestamp` unchanged).
- Holding the lock and triggering concurrently produced `fehlgeschlagen`, a
  readable sentence in `fehler.txt`, and `Result=success` on the unit.

Untested: the full `baue → starte → fertig` path, which needs a real new commit
and will exercise itself on the first deploy of this feature's own code.

## The application half

### Server

A new `server/src/deploy.ts` holding:

- `BOOT_ID` — a `randomUUID()` generated at import, so it differs on every
  process start. This is the signal the browser waits for.
- `stossDeployAn(user)` — writes `anstoss.json` atomically (temp name, rename),
  carrying username, id and timestamp as an audit record.
- `leseDeployStatus()` — reads and parses `status.json`, tolerating a missing or
  malformed file by returning `null`, and reading `fehler.txt` only while the
  phase is `fehlgeschlagen`.
- `deployVerfuegbar()` — gated on `HELDEN_DEPLOY_DIR`. Unset on a developer
  machine, where the button must not appear at all.

Three endpoints:

**`GET /api/health`** — no authentication, registered **before** the role gate,
or an ordinary player on dev would get a 403 from it. Returns `{ ok, boot }` and
nothing else: no commit, no version, no path. It is the one endpoint that has to
answer while everything else is uncertain, so the less it says the better.

**`POST /api/admin/deploy`** — `requireAuth, requireAdmin`. 501 when the feature
is not configured, 409 when a run is already in flight, otherwise: audit line to
the journal, write the request, announce over WebSocket, and answer **202 with
the current `boot` in the body**.

That last detail matters more than it looks. If the client fetched the boot id in
a separate call, that call could race the restart and return the *new* id — and
the waiting screen would then wait forever for a change that already happened.
Coming from the same response, it cannot.

**`GET /api/admin/deploy/status`** — `requireAuth, requireAdmin`; phase,
timestamp, the error text when there is one, and **`boot` again**. Carrying the
boot id on this response too means the client compares it on every answer it
gets, from either endpoint. `/api/health` is then purely the unauthenticated
fallback for the window in which the app is actually down — not the only place
the restart can be noticed.

`requireAdmin`, not `requireGmOrAdmin` — with a comment saying why. Nearly every
other `/admin/` route admits both roles, and without a stated reason someone will
eventually "fix" this one.

`ws.ts` gains a broadcast that walks every room. Every message today goes to
exactly one room, so this is the first of its kind and belongs beside
`broadcastToRoom`, not as a special case inside it.

### Client

The waiting-screen state machine goes into `shared/src/deployStatus.ts` with a
test beside it. The reason is the same one that put `accessGate.ts` there:
`server/` has no test script, so a test file there would never run. And this is
precisely the code whose bugs are invisible — a wrong transition strands somebody
on a screen that never goes away.

| State | Entered when | Shows |
|---|---|---|
| `laeuft` | status reports `pruefe`/`baue`/`starte` | the phase in plain words |
| `aktuell` | status reports `aktuell` | "already up to date", screen closes |
| `fehlgeschlagen` | status reports failure | the error, plus "the previous version is still running" |
| `wartetAufNeustart` | the status endpoint stops answering | the router-style waiting text |
| `zurueck` | **any** response carries a different `boot` | reload the page |
| — | status reports `fertig` but `boot` is unchanged | stay in `laeuft`; the old process is still answering |

The last row is the subtle one. `helden-deploy` writes `fertig` four seconds
*after* `systemctl restart`, so a client can read `fertig` from either process
depending on timing. The phase alone therefore never means "you may reload" —
only a changed `boot` does. Checking the id rather than the phase makes the
whole question of *which* process answered irrelevant.

A run that passes ten minutes without ending adds a "this is taking longer than
usual" note and a manual reload link, but does **not** leave the waiting state.
The unit allows thirty minutes; a client that declared failure at ten would be
lying about a deploy that is still working.

The sequence has a property that makes the screen calmer than expected: because
`helden-deploy` swaps the symlink only after the build, the old process stays up
for nearly the whole time and reports its own progress. The step from `laeuft` to
`wartetAufNeustart` happens right at the end and lasts seconds. There is no
four-minute "connection lost".

**UI pieces:**

- A new "Wartung" tab in `Admin.tsx`, shown only when the user is admin *and*
  the server offers the feature. `ADMIN_TABS` is a flat constant today and has to
  become conditional, including a fallback for a persisted `admin:tab` value that
  is no longer available to that user.
- A press-and-hold button component. Three details that otherwise surface late:
  `touch-action: none` so a tablet does not scroll away under the finger; abort
  on the pointer *leaving* the button, not only on release; and a visible second
  counter instead of the ring when the app's animation setting is off.
- A full-screen overlay mounted in `App.tsx` above the routes, so it covers
  everything including the dice dock.

**For everyone else:** the announcement arrives over the existing WebSocket and
shows a discreet banner. The full screen appears only when the connection then
drops. The banner is a required precondition — the dice panel already reconnects
after any blip, so "connection lost" on its own would pop the screen up on every
Wi-Fi hiccup.

Users who have never picked a room have no WebSocket and get no warning. Accepted
rather than inventing a second channel for a few seconds of unavailability.

## Security envelope

An admin session can cause a deploy. It cannot choose what gets deployed: the
branch comes from the unit name, and the request carries no branch at all. The
worst an attacker with a stolen admin session achieves is installing a commit
that is already published on GitHub. Stated here so the trade is on the record.

## Testing

`shared/test/deployStatus.test.ts` covers each transition in the table above, and
in particular the case that is easy to omit and expensive to get wrong:
**`boot` unchanged → keep waiting.** That is where the screen decides whether it
mistakes the old process for the new one.

Manual verification runs on dev first, then prod: trigger with nothing new
(expect "already up to date", no restart), trigger with a real commit (expect
phases, then reload), and a second browser to confirm the announcement and the
automatic return.

## Follow-ups

Two of the originally listed items are done: `scripts/install.sh` installs the
whole chain onto a prepared server, and `scripts/README.md` documents it —
including the two by-hand tests above, so the chain stays verifiable on a future
machine. `.gitattributes` pins `scripts/**` to LF, because this workstation has
`core.autocrlf=true` and a shell script with CRLF dies on the server as
`bad interpreter: ^M`.

What remains:

- **`ReadWritePaths` drop-in plus `HELDEN_DEPLOY_DIR`** in both env files. This
  is the only step that needs a restart of the running services; for prod it
  should be combined with the long-pending `HOST=127.0.0.1`, so it stays one
  restart rather than two. `scripts/install.sh` writes the drop-in but
  deliberately stops short of both the env edit and the restart.
- `DEPLOYMENT.md` and the server documentation repo.
- The scripts have to be reinstalled on the server (`sudo ./scripts/install.sh`):
  `helden-deploy-trigger` gained the reordering described above, and the
  `ReadWritePaths` drop-in did not exist during the first manual install.
