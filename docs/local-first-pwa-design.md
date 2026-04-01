# Local-First PWA Redesign For GitHub Note Sync

## Goal

Redesign `github-note-sync` so the client behaves as a local-first PWA:

- Fully usable for editing after initial app load, even without connectivity.
- Reliable offline durability for user edits.
- Explicit, non-destructive sync and conflict handling.
- URL-based repo alias routing that preserves editing context across app relaunches.

This document captures:

- What has already been implemented.
- What still needs to be done.
- The target architecture and API contract for local-first sync.
- The remaining merge/conflict design work that avoids silent data loss.

## Implemented

### Client-side local-first behavior

- Accepted edits are persisted locally first in IndexedDB.
- The client stores repo snapshots, file snapshots, last-known server content, file revisions, and pending operations locally.
- Normal text edits are replayed as diff-based `POST /api/ops` patch requests.
- Older cached files without a known revision still use `PUT /api/file` as a guarded compatibility fallback.
- Pending local work is replayed on debounce, blur, hide/unload lifecycle events, and reconnect.
- Background timer-based repo/file polling has been removed for now so active editing is not interrupted by timer-driven reloads.

### Routing and workspace restore

- Repo alias remains part of the URL.
- The selected file is also part of the URL in readable form: `/<repoAlias>/file/<repo-relative path>`.
- Launching the PWA at `/` restores the last valid repo alias client-side.
- Startup now restores cached repo aliases immediately so the workspace does not wait on `/api/repos` before rendering obvious local state.

### PWA cold-start behavior

- The production Service Worker now precaches the built app shell, including the hashed Vite bundles.
- Android/Chrome process eviction is therefore survivable offline: the shell can cold-start from cache and the app can rehydrate workspace state from IndexedDB.
- The initial `/api/auth/session` probe now has a short timeout so startup can fall back to cached authenticated session metadata instead of hanging indefinitely.

### Server/API behavior

- `POST /api/ops` exists and accepts patch ops with `opId`, `baseRevision`, and range-replace operations.
- `GET /api/file` returns `{ content, path, revision }`.
- `GET /api/bootstrap` now includes forward-compatible revision/conflict fields such as `headRevision`, `stateRevision`, `mergeInProgress`, and `conflictPaths`.
- The server durably records recent applied `opId` values so retries are idempotent.
- `409 conflict` responses return the server's current content and revision for the conflicting file.
- `POST /api/conflicts/commit-markers` now exists for the explicit conflict-confirmation path. It accepts whole-file `baseContent` and `localContent`, runs a 3-way merge against the server's current file text, and commits the result as ordinary repo content.

## Still To Be Done

### Conflict and sync hardening

- Replace the remaining remote-overwrite periodic sync behavior so server-originated divergence is handled with the same no-loss policy as the explicit conflict-confirmation path.
- Decide whether forward-compatible bootstrap fields such as `mergeInProgress` and `conflictPaths` should remain once the committed-marker workflow is the only supported conflict model.
- Add broader integration coverage around repeated conflicts, reconnect during conflict confirmation, and multi-device race windows.

### Hardening and operational polish

- Export/import backup for local op logs.
- Telemetry and sync audit logs.
- Better handling for long offline windows with expired sessions.
- Better handling for remote-missing/remote-unreachable repair flows.
- Chaos/integration coverage for offline/online flaps, duplicate sends, and mid-merge restarts.

## Design Principles For V2

- Local-first UX:
  - user edits should be accepted and persisted locally first.
- No silent loss:
  - neither client nor server should silently drop accepted edits.
- Explicit conflict states:
  - conflicts are surfaced, never hidden by destructive reset.
- Idempotent sync protocol:
  - retries must be safe.
- Remote repo remains authoritative for shared state, but not by destructive overwrite.
- When conflict materialization is required, commit Git-style conflict markers as ordinary text so both sides survive and the user can edit the result like any other note.

## Proposed Architecture

### Client storage model (IndexedDB)

Use IndexedDB stores (names indicative):

- `repos`: repo alias metadata and last-known server pointers.
- `files`: last local materialized file content + metadata.
- `ops`: append-only local operation log (pending and acked).
- `checkpoints`: sync cursors (last acked op, last synced revision).
- `sessions`: auth/session metadata needed for UX state handling.

Suggested per-op fields:

- `opId` (UUID, client-generated, idempotency key)
- `repoAlias`
- `path`
- `kind` (`patch`, `createFile`, `createFolder`, `deleteFolder`, `resolveConflict`)
- `baseRevision` (server file/tree revision at op creation)
- `payload` (patch ops or structured command)
- `createdAt`
- `status` (`pending`, `sent`, `acked`, `failed`, `blocked_conflict`)
- `attemptCount`
- `lastError`

Important: write to IndexedDB before considering edit accepted by UI.

### Connectivity detection

Treat online/offline as state machine, not a single boolean:

- Browser signal: `navigator.onLine`, `online`/`offline` events.
- Real connectivity probe: lightweight authenticated endpoint (for example `/api/auth/session` or dedicated `/api/ping`).
- States:
  - `offline`
  - `degraded` (network present, API unreachable)
  - `online`

Sync worker should run only in `online`.

### Routing and repo persistence

Keep repo alias in URL path as primary state:

- canonical route: `/<repoAlias>`
- default route: `/` redirects to last-opened alias if available and valid
- persist `lastOpenedRepoAlias` in local storage/IndexedDB

Flow:

1. If launch path has alias, use it.
2. If path is `/`, resolve `lastOpenedRepoAlias`.
3. If alias exists for user, `history.replaceState` to `/<alias>`.
4. If alias no longer exists (deleted/non-existent remote/etc), show repo picker and clear stale default.

This handles rare broken alias/remotes while fixing most relaunch deselection cases.

### PWA launch behavior

`manifest.start_url` cannot be dynamically per-user repo alias. Keep `/`, then client-side redirect logic above performs context restore.

### Background sync model

- Foreground replay loop in app process plus optional service-worker-assisted replay where feasible.
- Replay queue strictly ordered by creation time per repo/path.
- Use idempotent op processing on server (`opId` dedup).
- Do not reintroduce timer-driven background repo/file refresh until merge/conflict semantics are implemented clearly enough that refresh cannot silently or unexpectedly alter the active editor state.

## API Redesign (Diff-Based Writes + Durable Ops)

## 1) Patch endpoint

`POST /api/ops`

Request body (batch allowed):

```json
{
  "repoAlias": "personal-notes",
  "ops": [
    {
      "opId": "3f5f8e7d-7992-4de8-9f37-e03b0f9d42f0",
      "kind": "patch",
      "path": "notes/today.md",
      "baseRevision": "sha256:abc...",
      "payload": {
        "ops": [
          { "type": "replace", "from": 120, "to": 138, "text": "new text" }
        ]
      }
    }
  ]
}
```

Response:

- `ackedOpIds`
- per-op outcome:
  - `applied`
  - `duplicate` (already applied)
  - `conflict` (revision mismatch)
  - `invalid`
- updated file/tree revision metadata where relevant

## 2) Bootstrap endpoint extension

`GET /api/bootstrap?repoAlias=...`

Add:

- `mergeInProgress`
- `conflictPaths`
- `headRevision`/`stateRevision`
- `pendingServerOps` (optional for diagnostics)

## 3) Conflict payload on 409

For patch conflict:

```json
{
  "error": "conflict",
  "path": "notes/today.md",
  "expectedBaseRevision": "sha256:def...",
  "currentRevision": "sha256:xyz...",
  "currentContent": "...",
  "serverMergeState": {
    "mergeInProgress": true,
    "conflictPaths": ["notes/today.md"]
  }
}
```

## 4) Explicit conflict materialization endpoint

When a normal diff op hits `409 conflict`, the client does not retry by sending another diff blindly. Instead it waits for explicit user acknowledgement and then sends whole-file data for a 3-way merge:

`POST /api/conflicts/commit-markers`

```json
{
  "repoAlias": "personal-notes",
  "path": "notes/today.md",
  "baseContent": "the last content the client diffed against",
  "localContent": "the user's full local file text"
}
```

Server behavior:

- Read the server's current file content.
- Run a 3-way merge using `baseContent`, `localContent`, and the server's current content.
- If the merge is clean, commit the merged text.
- If the merge conflicts, commit the merged text with Git conflict markers.
- Push that ordinary commit.

After that, the app treats the resulting file as ordinary text. It does not parse, track, or interpret conflict markers.

## Remaining Server-Side Sync Design

## Objective

Replace the remaining destructive overwrite paths with the same no-loss policy used by the explicit conflict-materialization endpoint.

## Sync algorithm (per repo alias)

1. Ensure clean repo metadata fetched (`git fetch --prune origin`).
2. Materialize local pending changes into commit if working tree dirty.
3. If a stale patch op cannot be applied, stop normal replay and wait for explicit user acknowledgement.
4. After acknowledgement, create a 3-way merged file from:
   - the client's original base text
   - the client's current local text
   - the server's current text
5. Commit and push the merged result as ordinary repo content.

## Conflict resolution workflow

1. Client receives a `409 conflict` payload from `POST /api/ops`.
2. Client stores the blocked conflict plus the original base text used for the diff.
3. Client shows a single explicit acknowledgement action:
   - tell the user a merged version with Git conflict markers is about to be created so nothing is lost
   - require `OK`
   - do not auto-run this in the background
4. After `OK`, client sends whole-file conflict materialization input to `POST /api/conflicts/commit-markers`.
5. Server commits the merged text.
6. Client reloads that file content and treats it as ordinary text from then on.

## Safety mechanisms

- Never hard reset automatically while unresolved local edits/ops exist.
- Log all sync decisions with user/alias/op context.

## Durability Guarantees: What Is Realistic

Absolute guarantee is impossible in web-only environments (device loss, user-cleared site data, browser corruption).  
Practical guarantee should be:

- No silent application-level data loss for accepted edits.

To meet that:

- Persist ops locally before acking UI edits.
- Replay until server ack.
- Server durably records op receipt before apply.
- Use idempotency (`opId`) and checksums.
- Never discard local ops due to remote divergence.
- Surface unsynced count/state prominently.
- Offer export/import backup of local op log for disaster recovery.

## Handling Non-Existent/Invalid Remote Repo

Rare case: configured remote disappears or access key revoked.

Expected behavior:

- Alias stays selectable.
- Status transitions to `remote_unreachable` or `remote_missing`.
- Local editing and op logging continue.
- Sync retries with exponential backoff.
- UI offers repair actions:
  - update repo URL
  - refresh deploy key instructions
  - test connectivity

Do not clear selected alias automatically unless alias is explicitly deleted.

## Client UX Requirements

- Top-level sync indicator states:
  - `offline`
  - `pending_local`
  - `syncing`
  - `pushed`
  - `conflict`
  - `remote_error`
- Show:
  - pending op count
  - last successful push time
  - conflict file count
- Conflict entry dialog support:
  - tell the user a merged version with Git conflict markers is about to be created
  - make clear that automatic background resolution is not occurring
  - require an explicit acknowledgement before the whole-file merge request is sent

## Data/Protocol Compatibility Strategy

Migration should be staged:

1. Keep existing `PUT /api/file` for compatibility.
2. Add `POST /api/ops` behind feature flag.
3. New client uses ops; old client still works.
4. Once stable, deprecate whole-file writes.

Server should still accept full-content fallback for:

- very large edits where diff algorithm fails
- binary/non-text files
- emergency fallback mode

## Phased Implementation Status

### Done

#### Phase 1: Context persistence + non-destructive refresh

- Keep alias in path.
- Add last-opened alias redirect on `/`.
- Stop automatic destructive refresh path on alias activation.
- Load from local cache first when available.

#### Phase 2: Local op log + offline editing

- IndexedDB schema and write-through local persistence.
- Connectivity monitor and retry worker.
- Pending-op UI status.

#### Phase 3: Server op ingestion + idempotency

- `POST /api/ops` endpoint.
- op dedup and durable receipt.
- patch apply with revision checking.

### Still To Do

#### Phase 4: Merge-aware sync

- add the explicit conflict-confirmation flow.
- commit conflict-marked merged text as ordinary repo content.
- replace remaining remote-overwrite behavior with the same no-loss conflict policy.

#### Phase 5: Hardening

- backup/export tools
- telemetry and sync audit logs
- chaos tests (offline/online flaps, duplicate sends, mid-merge restarts)

## Testing Strategy

Core scenarios to automate:

- Edit offline -> reload app -> edits still present -> reconnect -> synced.
- Duplicate op replay -> idempotent no double-apply.
- Remote changed + local edits -> explicit confirmation -> conflict-marked commit pushed with no data loss.
- User edits conflict-marked text afterward -> ordinary follow-up edit syncs normally.
- PWA relaunch from `/` -> auto-restore to last alias when valid.
- Alias invalid/remote missing -> no deselect loops, clear repair messaging.

## Open Design Decisions

- Patch format choice:
  - custom range-replace ops vs JSON Patch vs text diff/OT/CRDT.
- Auth/session behavior for long offline windows:
  - UX when queued ops exist but session expired.
- Scope of service worker background sync support on Android Chrome vs foreground-only retry.

## Recommended Defaults

- Use simple range-replace patch ops first.
- Use diff ops for normal editing and whole-file 3-way merge input only for explicit conflict materialization.
- Preserve full-content fallback endpoint during transition.
- Treat URL alias as source of truth, with `/` redirect to last valid alias.
- Prioritize "no silent data loss" over minimizing implementation complexity.
