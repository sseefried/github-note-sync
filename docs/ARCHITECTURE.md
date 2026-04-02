# Architecture

## Top-level Architecture

This repository contains the complete application. The runtime code lives under `client/` and `server/`, while `docs/` holds the shared architecture, sync-model, and deployment material that describes how those two halves work together.

The basic design is a local-first client paired with a server-owned Git sync engine:

- The client caches workspace state locally, freezes each dirty file's server base while edits are pending, and replays idempotent patch operations through `POST /api/ops`.
- The server owns authentication, SSH credentials, repo clones, and durable op receipts.
- When retries already converged, they are acknowledged as duplicates.
- When remote changes are non-overlapping, the client fast-forwards and retries.
- When edits truly overlap, the server materializes an explicit Git-based merge through `POST /api/conflicts/merge`.

Design philosophy:

- Keep client and server code in one repository, but keep shared design material in `docs/`.
- Prefer a local-first editing model with explicit, no-loss conflict handling.
- Keep authentication, SSH keys, and Git authority on the server.
- Make generated documentation reproducible from checked-in source.
- Prefer simple local tooling over bespoke documentation pipelines.

## Client Architecture

The client keeps its app state in a single React reducer (`src/state-machine/app-machine.js`) with:

- a top-level session slice
- a top-level connectivity field
- a nested workspace slice that owns file, sync, replica, and interaction state

`workspace.interaction` only exists while the app is actually resolving a prompt, so the old sentinel `resolution.kind === 'none'` state is gone.

`deriveWorkspacePhase()` and `deriveFilePhase()` compute phase values from the current inputs, while `buildResolutionState()` now constructs the nested interaction branch, enforces the prompt precedence order `reload_from_server` > `fast_forward` > `merge_with_remote`, and preserves the busy flag when the prompt identity stays the same.

The Graphviz source and rendered PDF for the state machine now live at [`docs/state-machine.dot`](/Users/sseefried/code/github-note-sync/docs/state-machine.dot) and [`docs/state-machine.pdf`](/Users/sseefried/code/github-note-sync/docs/state-machine.pdf).

The client is a React app built with Vite. A thin CLI wrapper still requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API.

The client itself stays HTTP-only at the app-server level; if you want HTTPS locally or in production, terminate TLS in an external reverse proxy so the transport model matches production instead of embedding certificate handling into the app. In local HTTPS testing, a proxy such as Caddy sits in front of both the Vite dev server and the API server and exposes stable HTTPS origins like `https://notes.localhost` and `https://api.notes.localhost`.

Because modern Vite rejects unknown `Host` headers by default, the client config keeps an explicit allowlist for proxied browser hostnames in both `vite dev` and `vite preview`; `notes.internal.asymptoticsecurity.com` is allowed by default, and extra hostnames can be supplied through `VITE_ALLOWED_HOSTS`. A startup guard still refuses to boot the app for plain HTTP browser sessions, but it now checks both the browser URL scheme and a small same-origin request-context endpoint served by Vite, so reverse proxies can mark the original request as secure with `X-Forwarded-Proto: https` while direct HTTP visits to the raw Vite or preview ports remain intentionally unusable.

The major client-side design change is that the browser is no longer stateless with respect to the editing workspace. After a successful authenticated load, the client caches:

- in local storage: a session snapshot, the repo-alias list, and the last-opened alias
- in IndexedDB: repo trees, selected files, materialized local file contents, last-known server contents, file revisions, and pending operations

Launching the PWA at `/` restores the last valid repo alias client-side, and file selection now has a readable URL form of `/<repoAlias>/file/<repo-relative path>` so a reload or shared link can reopen a specific note.

The app hydrates the file tree and editor from the local cache first, then refreshes `/api/bootstrap` and `/api/file` when the API is reachable. If the network is unavailable but a cached authenticated session exists, the client still boots into the editor with the cached workspace instead of failing closed on startup.

For a teaching-oriented picture of that file-sync protocol, see the sibling workspace artifacts [`docs/state-machine.dot`](/Users/sseefried/code/github-note-sync/docs/state-machine.dot), [`docs/state-machine.pdf`](/Users/sseefried/code/github-note-sync/docs/state-machine.pdf), and [`docs/gen-state-machine-pdf.sh`](/Users/sseefried/code/github-note-sync/docs/gen-state-machine-pdf.sh). They model the implemented local-first flow for one file under one repo alias, including duplicate convergence, fast-forward replay, and explicit conflict materialization.

The current local-first write path has one normal sync protocol:

- Accepted edits are written to IndexedDB immediately.
- The client computes a range-replace patch from the last known server content to the current local content.
- Replay uses `POST /api/ops` with one idempotent patch op per file at a time.
- Each queued op also carries the intended final file text so a retry can be acknowledged cleanly when the server already contains that exact text.

Once a file is dirty, the cached server base for that file is frozen. Background reloads and conflict detection do not rewrite `serverContent` or `revision` underneath the local edit. The base advances only after:

- acknowledged write success
- explicit reload-from-server confirmation
- successful conflict resolution
- successful “server already has this text” convergence detection
- explicit clean-file fast-forward confirmation

Additional protections on that path are:

- If an older in-flight write is acknowledged after newer local edits have already been saved, the client advances the frozen server base without rewinding the newer local text.
- If the file/op snapshot moved while the next op was being prepared, the client refuses to enqueue a replacement op.
- If the app fetches a file and the fetched server content already matches the current dirty editor text, it advances the frozen base immediately instead of preserving a stale dirty snapshot.
- If a cached file does not have a valid `revision`, the client fails closed and requires a refresh from the server before that file can sync again.
- Background maintenance is single-flight: the app flushes pending writes before it refreshes repo metadata, so one client instance cannot create a self-conflict by running those two steps in parallel.
- Repo-alias mutation is fenced: before the client repoints an alias at a different Git repo, it requires that alias to have no remaining queued or blocked local operations, then clears the cached workspace for that alias after a successful update so stale snapshots cannot leak into the new remote.
- Manual refresh, repo alias mutation, and tree-structure actions still call the server directly and therefore stay available only when the API is reachable.

Conflict handling is now explicit instead of passive. If `POST /api/ops` returns `409 conflict`, the client follows this decision path:

- If the server’s current file already equals the local target text for that op, the client treats that as a converged retry, advances the local server base, and continues without surfacing a conflict prompt.
- Otherwise it compares the local edit and the server’s current file against the frozen base text.
- If those changes are non-overlapping, the client shows an acknowledgement prompt, advances the local server base to the newer server version, reapplies the local change on top of that newer text, and immediately retries sync.
- If the app reads a newer server version for a clean cached file, it also stops and asks for acknowledgement before adopting that newer server text into the editor.
- If the edits overlap, the client stores the blocked op plus the last repo commit it knew for that edit, keeps the local text visible, and shows a separate confirmation action for that file.

Pressing `OK` on the overlap path sends whole-file conflict input plus that known base commit to `POST /api/conflicts/merge`; the server then creates a temporary branch from the client’s base commit, commits the client’s whole-file text there, merges that temporary commit with current `HEAD`, commits the merge result, and deletes the temporary branch afterward. That makes the merge behave like a real Git merge between the client’s known commit and current `main`, rather than guessing only from text snapshots.

There is no longer any fallback path that fabricates a full-file conflict block without a known base commit. If the base commit is missing locally or the server reports that the commit no longer exists, the client switches to a second confirmation prompt and reloads the latest server version of that file, clearing the blocked conflict entry. After that, the client treats the file like any other note and does not parse or track the markers specially.

Because mobile hides the normal footer status row, prompt failures are also rendered inline inside the active prompt, changing files clears the prompt unless the newly selected file is itself the blocked one, and same-file reloads re-sync the prompt from IndexedDB instead of dropping it.

While any of these sync prompts are visible, the client now freezes editor input, file-tree navigation, and tab switching so the replay or merge decision cannot race with more local changes. On mobile, the app scrolls the prompt into view automatically.

For debugging merge behavior, the editor header also shows the first 8 characters of the current base commit. When a file has a pending or blocked operation, that value comes from the file-specific `baseCommit`; otherwise it falls back to the repo snapshot's last known `headRevision`. Successful write acknowledgements now update that repo-level head snapshot immediately, instead of waiting for a later bootstrap refresh.

The UI structure remains the same: repo selection and repo management live in the right pane, the editor stays plain-text-first, `.md` files use a lightweight CodeMirror surface plus an optional rendered preview, and mobile layout now treats Files and Editor as separate pages with a compact editor header and a fixed-width sync badge. The client also continues to track `visualViewport.height` so the visible editor height follows mobile browser chrome changes. For installability and app-style launch on Android, the client ships a manifest (`display: "fullscreen"`), app icon, and service worker registration in production builds.

The Service Worker is now build-aware instead of hand-maintaining a tiny shell list. During `vite build`, the client emits a `precache-manifest.js` file that lists the current hashed bundles and public assets, and the Service Worker precaches that full set during install. Navigation requests are served from cached `index.html` first while the worker refreshes it in the background, which makes “Android killed the PWA and reopened it offline” behave like a cold local launch instead of a network failure. The API is still not cached as app data; repo trees, file contents, revisions, selected files, and pending ops remain in IndexedDB and are rehydrated by the React app after the shell boots.

Startup auth is also bounded now. The first `/api/auth/session` request uses a short timeout instead of waiting forever for the browser network stack to decide that the request failed. If that probe times out and there is cached authenticated session metadata from a previous online run, the client opens from cache immediately and continues treating the server as degraded/offline until a later probe succeeds.

Repo alias startup follows the same principle, but without changing the source of truth. The client seeds the alias list from local cache immediately so the last repo can be selected and hydrated without waiting on `/api/repos`, then still asks the server for the canonical alias list and replaces the cached view with that network result as soon as it arrives.

Because merge-aware conflict handling has not landed yet, the client avoids periodic open-file reloads while the editor is active. The app still replays local edits on debounce and reconnect, and it still does lightweight status refreshes, but it does not keep re-fetching the open file on a timer and risking visible content churn.

Startup now prefers cached authenticated state as well when it exists. If the browser has a cached authenticated session snapshot from a prior online run, the client boots from that cache immediately so repo aliases, tree state, and file contents can hydrate as quickly as possible. The network session probe still runs and wins when it returns, but it no longer blocks cached workspace restore first.

Design philosophy:

- Keep accepted edits durable on-device first, then replay them to the server when connectivity permits.
- Prefer diff-based, idempotent patch ops for normal text edits, auto-replay safe non-overlapping remote changes only after explicit acknowledgement, and use whole-file conflict payloads plus a client-known base commit only for the true overlapping-conflict path.
- Keep destructive refresh behavior explicit and manual; never hide it behind repo selection or app relaunch.
- Keep the URL path as the primary workspace identifier, including both repo alias and selected file when available, while still restoring the last valid alias when the PWA launches at `/`.
- Keep cookie-based auth server-owned while caching only enough session metadata to reopen the workspace offline after a successful online session.
- Keep passwords and SSH keys out of browser storage.
- Make pending local work and blocked conflicts visible through queue-aware sync status instead of pretending the server is always authoritative in real time.
- When conflicts happen, never silently discard either side; create a committed merged text only after explicit user acknowledgement.
- Prefer offline editing of already-cached files and degrade repo-management actions gracefully when the API is unavailable.
- Prefer plain-text editing defaults, while using lightweight editor extensions only where they materially improve readability.
- Keep deployment simple by building the client once and running it under a user systemd unit.
- Keep TLS termination outside the app so local and production topology stay aligned.
- Keep Vite host validation explicit so proxied browser origins must be intentionally allowed.
- Refuse to boot the browser app on requests that are neither HTTPS in the browser nor explicitly marked as HTTPS by a trusted proxy.
- Bake the public HTTPS base URL into the production bundle so browsers never target the internal HTTP app ports.
- Surface configuration and connectivity failures clearly instead of failing silently.
- Keep mobile editing practical by treating Files and Editor as explicit pages instead of one long stacked screen.
- Keep mobile navigation explicit by treating Files and Editor as separate pages, defaulting to the Editor page only when the URL already names a file.
- Keep mobile UI readable and touch-friendly by scaling type and control sizes on narrow viewports.
- Keep the mobile editor header minimal so file context and sync state stay visible without wasting vertical space.
- Keep account actions in the Files pane and remove editor-level manual sync controls to reduce header clutter.
- Keep editor sizing tied to the live visible viewport so mobile browser UI changes do not shrink the editing area unexpectedly.
- Keep mobile horizontal layout edge-to-edge for editing density while preserving rounded visual boundaries.
- Keep mobile launch experience app-like by shipping a manifest/service worker pair for Android Chrome install mode.
- Treat “browser process was killed and later relaunched offline” as a first-class PWA scenario by precaching the full built shell, not just `index.html`.
- Bound startup auth checks so cached local state can reopen promptly even when the browser has not yet declared the network request dead.
- Prefer the network whenever it is reachable, but never make the user wait for obvious cached workspace state before rendering it, and never silently replace the open file with newer server text.
- Serialize background write replay and repo refresh so one client instance cannot race itself, and never timer-reload dirty file content underneath local edits.

----------------------------------------------------------------------------------------------------

## Server Architecture

## Architecture

The server is an Express API with two server-owned state layers: authentication and repo orchestration. Authentication stores users under `$HOME/.local/github-note-sync-server/users/<userId>/profile.json`, hashes passwords with Node's built-in `scrypt`, persists opaque sessions under `$HOME/.local/github-note-sync-server/sessions`, and resolves the authenticated user from either a session cookie or a bearer token on every request.

Repo state is namespaced per user under `$HOME/.local/github-note-sync-server/users/<userId>/repos/<repoAlias>`, where each alias contains metadata, a clone directory, an SSH directory, a small UI-state file, and a durable `ops-state.json` file for recent patch-op receipts. On startup the server loads optional local configuration, validates cookie/origin settings, verifies that `ssh-keygen` can successfully generate an ED25519 keypair, and deletes that startup-check keypair.

A global request guard rejects any request that does not arrive with `X-Forwarded-Proto: https`, so the service is intended to sit behind a reverse proxy that terminates TLS and forwards that header. The repo manager threads `userId` through every lookup so the same `repoAlias` can exist for multiple users without collision, and the Git layer still shells out with `GIT_SSH_COMMAND` pointed at the server-generated private key for that specific user-owned alias.

Transport security is intentionally external: both local HTTPS testing and production deployments are expected to terminate TLS in a reverse proxy such as Caddy or nginx before forwarding requests to this HTTP service.
Internal name resolution is external too: if the server sits on a tailnet, Tailscale MagicDNS or a private split-DNS server handles the hostnames, while the app itself only cares that requests arrive over HTTPS from a trusted proxy.

For a teaching-oriented picture of the combined client/server file-sync lifecycle, see the sibling workspace artifacts [`docs/state-machine.dot`](/Users/sseefried/code/github-note-sync/docs/state-machine.dot), [`docs/state-machine.pdf`](/Users/sseefried/code/github-note-sync/docs/state-machine.pdf), and [`docs/gen-state-machine-pdf.sh`](/Users/sseefried/code/github-note-sync/docs/gen-state-machine-pdf.sh). They show the implemented flow for one file under one repo alias, including `POST /api/ops` convergence handling and the explicit `POST /api/conflicts/merge` path.

The write API now has one normal edit path plus one explicit conflict path:

- `GET /api/file` returns both a content hash `revision` for the file and the repo `headRevision` for the current clone, so the client can associate a fetched file snapshot with a concrete Git base.
- `POST /api/ops` applies ordered range-replace patch ops against a `baseRevision`, records recent `opId` receipts for idempotent retry, and returns `409 conflict` with the server's current content and current repo `headRevision` when the base revision no longer matches.
- Clients may also send `targetContent`; when the current file already equals that exact text, the server records the op as a duplicate instead of manufacturing a conflict from a stale retry.
- Write-style success responses also include the repo `headRevision` so the client can advance its repo-level base snapshot only after acknowledged success.

That lets the client distinguish safe non-overlapping replay, already-converged retries, and true overlapping conflicts without advancing its frozen local base speculatively.

When the client later receives explicit user acknowledgement for a true overlapping conflict, `POST /api/conflicts/merge` accepts the client-known `baseCommit` plus whole-file `localContent`, creates a temporary branch from that commit, commits the client’s whole-file content there, merges that temporary commit into current `HEAD`, commits the merge result, and deletes the temporary branch afterward.

Even when that merge is a no-op because the temporary result already matches `main`, the server now switches the clone back to `main` before reporting `headRevision`, so clients never adopt a temporary-branch commit as their new base. If that base commit is no longer reachable on the server, the endpoint returns a clean `409` so the client can show a confirmation prompt and reload the latest server version for the file.

The bootstrap payload now also exposes forward-compatible `headRevision`, `stateRevision`, `mergeInProgress`, and `conflictPaths` fields so the client can reason about sync state without another endpoint.

This is still not the final fully hardened sync architecture, because the periodic sync loop elsewhere in the server still has older remote-overwrite behavior in some paths. But explicit client-confirmed conflicts now follow the stricter no-loss policy: keep diff ops for normal editing, and switch to whole-file conflict materialization rooted at the client’s known base commit when a stale diff must be turned into a committed merge result.

Design philosophy:

- Keep identity server-owned so passwords, sessions, SSH keys, and repo authorization live in one place.
- Keep SSH private keys on the server and never expose them over the API.
- Namespace aliases by user instead of assuming a global alias space.
- Treat the remote repository as authoritative and make each local clone disposable.
- Prefer idempotent diff-based patch ops for normal text edits, surface the current repo `headRevision` on revision conflicts so clients can safely replay non-overlapping changes first, and switch to whole-file conflict materialization rooted at the client’s known base commit only for explicit overlapping-conflict confirmation.
- When a retry already converged on the current server text, acknowledge that duplicate instead of turning it into a false conflict.
- Accept editor keystroke-driven writes, but batch Git commits onto a sync interval to avoid noisy history.
- Keep recent op receipts durable per alias so client retries are safe when requests or responses are lost.
- When conflicts occur, preserve both sides by committing Git-style conflict markers as ordinary text instead of leaving hidden merge state for the client to manage.
- Keep empty-folder UI affordances separate from Git by storing that state outside the repository clone.
- Require explicit browser origin configuration once deployments move beyond local/private-network testing.
- Keep TLS termination outside the app so local and production network topology stay aligned.
- Treat HTTPS at the reverse proxy as mandatory and reject requests that bypass that boundary.
- Keep private DNS outside the app so tailnet hostnames can be added or changed without touching server code.
- Keep runtime configuration local and human-editable, with simple precedence rules.
- Separate app-user service management from root-owned network and reverse-proxy changes.
