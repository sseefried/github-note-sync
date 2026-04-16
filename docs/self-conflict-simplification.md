# Self-Conflict Simplification — Execution Log

Goal: remove the self-conflicts the user sees when editing → deleting → inserting
in quick succession. Hypothesised cause: queued ops carry a `baseRevision`
captured at prep time, which becomes stale by the time they are sent. Defence
layers around that core bug have piled up; this log executes a staged
simplification.

## Stages

- **A** — Collapse CAS + convergence into one predicate in `applyOps`.
- **B** — Await `preparePendingOperation` in `updateEditorContent`.
- **C** — Remove `expectedGeneration` retry loop.
- **D** — Re-read `baseRevision` at send time (the actual bug fix).
- **E** — Stop freezing `serverContent` on the client.
- **F** — Delete the server-side `opId` dedup table.

Each stage ends green (existing suites + any new test) before the next begins.

## Baseline

- Server: `8/8` passing.
- Client: `37/37` passing.
- Branch: `main`, clean working tree apart from `.claude/` and `.gitconfig`.

## Stage A — Unify accept predicate in `applyOps`

**File:** `server/server/git-service.js` (`applyOps`, lines ~153–254).

**Change.** Replaced the sequential `if (currentRevision !== baseRevision) {
converged? duplicate : conflict } else { apply }` structure with a single
`accepted = baseMatches || targetConverged` predicate and one write/record tail.
Semantics preserved exactly: an op whose base matches is applied; an op whose
target already equals current is recorded as `duplicate`; otherwise a 409
conflict is thrown.

**Test.** `pnpm -C server test` — 8/8 pass, including the existing case that
covers applied / duplicate-by-opId / converged-retry / 409 paths.

**Why this is a real simplification.** The decision to accept or reject now
lives in one expression; the "what outcome to emit and whether to write" logic
is deterministic tail code reading two booleans. The reader no longer has to
hold three branches in mind.

## Stage B — Serialise editor-update chain per file

**File:** `client/src/App.jsx` (`updateEditorContent`, and a new
`editorUpdateChainRef`).

**Change.** The original plan was "await `preparePendingOperation`", but
`updateEditorContent` is called synchronously from React event handlers, so
literal `await` there is not possible. The equivalent behaviour is to serialise
the fire-and-forget chain *per file*: successive keystrokes append to a
per-`(repoAlias, path)` tail promise, so the second keystroke's
`saveLocalFileContent` + `preparePendingOperation` cannot start until the
first's has completed.

This closes the door on a specific race: two rapid edits entering
`preparePendingOperation` concurrently and both reading the same file snapshot
/ pending-op state before either's upsert lands.

**Test.** `npm -C client test` — 37/37 pass. No existing unit tests exercise
`updateEditorContent` (it's UI-event wiring), so this is a no-regression
smoke test only. A proper reproduction requires a burst-typing test with a
simulated network, deferred to Stage D.

## Stage C — DEFERRED (plan deviation)

**Intent.** Delete the `expectedGeneration` retry loop in
`preparePendingOperation`, which the original plan claimed would be dead after
Stage B.

**Why deferred.** On closer reading, `preparePendingOperation` is called from
four sites: `updateEditorContent` (now serialised by Stage B), the main send
loop post-ack, the flush path, and the conflict-resolution handlers. Stage B's
per-file chain only serialises the editor path. The `expectedGeneration`
counter still does real work as cross-caller coordination — e.g. if a send-ack
triggers a prepare while the editor is mid-prepare on the same file, the
counter bumps and the older prepare bails out.

Safely deleting the generation mechanism would require a single per-file async
mutex that covers *all* prepare callers (Stage E in the original theoretical
plan). That's a larger change and not on the critical path for fixing the
reported self-conflict. Leaving it in place.

**Test.** None — no code changed.

## Plan pivot after closer reading of the code

Before implementing Stages D, E, and F, I reread the client sync machinery
carefully and had to revise the diagnosis that Stage D, E and F were predicated
on. The original analysis (from a first-pass exploration) claimed that rapid
edits could queue several pending operations that all carry a stale
`baseRevision` captured at prep time. The code does not actually work that
way:

1. `upsertPendingOperation` stores **at most one pending op per
   (repoAlias, filePath)**. Successive edits overwrite the previous op in
   place, they do not accumulate.
2. `saveLocalFileContent` does **not** re-freeze `serverContent`/`revision`
   each call. Those fields are set once (on first server load) and advanced
   only via a successful `acknowledgeOperation`.
3. The send loop in `App.jsx` is single-flight (`syncingOperationsRef`) and
   contains a pre-check (lines ~1538–1555) that re-reads the file snapshot
   before each POST and re-prepares the op if `snapshot.revision !==
   op.baseRevision`. That is effectively the "re-read at send time" fix that
   Stage D was going to introduce.
4. Because the loop sends serially and awaits each response, HTTP reordering
   cannot apply to ops on the same file.

In short, the specific race that Stages D/E/F were designed to close
cannot be demonstrated from the current code. The real fault lives on a path
I have not yet pinned down — candidates include the `fastForwardResult` /
resolution handler, `saveServerFileSnapshot({advanceBase: false})`
merge-preservation, or a state-machine transition.

Pushing through Stages E (remove frozen base) and F (remove `opId` dedup) on
the basis of a diagnosis I can no longer defend would delete two cheap and
load-bearing defences. Both stay.

## Stage D (revised) — Diagnostic logging

**Files:**
- `client/src/local-first/workspace-store.js` — added `syncLog`, `shortId`,
  `shortRev` helpers plus logs in `saveServerFileSnapshot`,
  `saveLocalFileContent`, `upsertPendingOperation`, `acknowledgeOperation`
  (match + stale branches).
- `client/src/App.jsx` — logs in `updateEditorContent` (editor-change),
  send-loop pre-check skip, send + send-ack, and the 409 conflict branch.
- `server/server/git-service.js` — added `opsLog`, `shortId`, `shortRev`
  helpers plus logs in `applyOps`: `recv`, `dedup`, `CONFLICT`, `applied`,
  `converged`.

**Activation.** All logs land in the server machine's stdout — no browser
interaction required. Turn on with two env vars when you start the processes:

- Server: `SYNC_LOG=1 npm --prefix server start`
- Client: `VITE_SYNC_LOG=1 npm --prefix client run dev` (or same env var at
  build time for a built bundle).

Effects:
- Server's own `applyOps` decisions appear on stdout prefixed `[ops]`.
- Client events are shipped fire-and-forget to `POST /api/client-log` on every
  call and land on the same stdout prefixed `[client] [sync]`.

Both flags default off, so nothing is logged or shipped in normal operation.
If `VITE_SYNC_LOG=1` is on but server `SYNC_LOG=1` is off, the server accepts
the POSTs and silently drops them (204) without printing — stray clients
cannot flood stdout.

**What to collect.** Reproduce the edit→delete→insert self-conflict with
logging on, then paste both the `[sync]` lines from the browser console and
the `[ops]` lines from the server. Each op carries an 8-character `opId`
prefix and the file `path` so lines can be correlated end-to-end.

**Key events and what they reveal.**
- `editor-change`: each keystroke burst's entry into `updateEditorContent`.
- `saveLocalFileContent`: the local snapshot write, including the preserved
  `revision` (so we can see if the frozen base is moving).
- `upsertPendingOperation`: the prep step, showing the new `opId` and
  `baseRev`.
- `send`/`send-ack`: the POST and its outcome.
- `send-precheck-skip`: the pre-check detected staleness and re-prepared —
  this path is expected and non-conflicting. If it fires near a conflict,
  that is suspicious.
- `acknowledgeOperation.stale` vs `.match`: whether the ack matched the
  pending op's `opId` or went to the stale branch.
- `saveServerFileSnapshot`: every advance or non-advance of the server base.
- Server `CONFLICT`: the smoking gun. Shows `expectedBaseRev` vs `currentRev`
  and both content lengths.

**Test.** `npm -C server test` — 8/8 pass. `npm -C client test` —
37/37 pass. The logging helpers are exported and trivially verifiable by
setting the flag in a `node` REPL; no automated reproduction test for the
bug itself yet, because we have not identified which path to exercise.

## Summary of outcomes

| Stage | Status | Net effect |
| ----- | ------ | ---------- |
| A | Applied | Server `applyOps` uses one accept predicate (`baseMatches \|\| targetConverged`). No behaviour change; easier to read. |
| B | Applied | Editor-update chain serialised per `(repoAlias, path)`. Closes one class of in-process prepare races. |
| C | Deferred | `expectedGeneration` is still load-bearing for cross-caller prepare coordination. |
| D | Revised & applied | Added `[sync]` / `[ops]` logs gated on flags. |
| E | Deferred | Frozen `serverContent` design is intentional; removing it needs a confirmed fault first. |
| F | Deferred | `opId` dedup is cheap; keep until the real fault is diagnosed. |

**Next step.** See `docs/debug-logging.md` for how to enable the trace in
dev and in the systemd user services (via the `--sync-log` flag on both
install scripts). Reproduce the self-conflict and paste the `[ops]` +
`[client] [sync]` lines around the `CONFLICT` event.




