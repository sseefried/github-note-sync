# GitHub Note Sync Client

The client repository contains the authenticated local-first web app: a login and repo-management shell around the two-pane editor. It talks to the separate server API for session status, login, registration, repo-alias registration, public-key retrieval, file reads, diff-based patch writes, compatibility fallback writes, tree refreshes, and sync requests, while restoring cached repo/file state locally and replaying durable pending edits when the API becomes reachable again.

## Installation

1. Install Node.js 25+ and npm.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the unit tests:

   ```bash
   npm test
   ```

## Usage

1. Start the server repository first.
2. Start the client in development and pass the HTTPS API origin explicitly:

   ```bash
   npm run dev -- --server-url=https://api.notes.localhost
   ```

3. Build the client with an explicit HTTPS server URL:

   ```bash
   npm run build -- --server-url=https://api.notes.localhost
   ```

4. Preview the built client with the same argument:

   ```bash
   npm run start -- --server-url=https://api.notes.localhost
   ```

   If you serve the client through a hostname other than `localhost`, add it to Vite's host allowlist before starting the client:

   ```bash
   VITE_ALLOWED_HOSTS=notes.internal.asymptoticsecurity.com npm run dev -- --server-url=https://api.notes.localhost
   ```

   Use a comma-separated list when you need multiple proxy hostnames. The client already allows `notes.internal.asymptoticsecurity.com` by default for both `vite dev` and `vite preview`.

If `--server-url` is omitted, the client exits with a clear message explaining that it is required. Because the browser app only runs on HTTPS pages, use the public HTTPS API URL rather than an internal HTTP app port.

The Vite dev server and preview server still listen on HTTP internally, but the browser client now refuses to run unless the page itself is loaded over HTTPS. In practice, open the app through your reverse proxy rather than visiting the raw Vite URL directly.
When the client sits behind one or more proxies, it also accepts requests that arrive over HTTP internally if the proxy forwards `X-Forwarded-Proto: https`; that lets the app trust the original browser transport without exposing the raw Vite or preview listener as a valid HTTP endpoint.

5. Open the client in the browser. Register a server user, or sign in with an existing server-owned username and password.
6. The Register tab stays available by default so you can create multiple users. If the server is configured with `allowRegistration: false`, the Register tab disappears and only sign-in remains.
7. Once signed in, create a repo alias by entering:
   - a `repoAlias` using letters, numbers, `_`, and `-`
   - a GitHub SSH repo URL such as `git@github.com:you/notes.git`
8. Copy the generated public key from the client and add it to GitHub.
9. Repo aliases are private to the signed-in server user. Another user can reuse the same alias name without colliding with yours.
10. When the app launches at `/`, it restores the last valid repo alias from local storage, hydrates the tree and file view from the local cache, and then refreshes from the server when reachable. Opening an alias no longer performs an implicit force-refresh against the remote repo.
11. The selected file is now reflected in the browser path using a readable route form: `/<repoAlias>/file/<repo-relative path>`. That means links, reloads, and browser Back/Forward can reopen a specific file instead of only reopening the repo alias.
12. Editor changes are written to IndexedDB first and queued locally per file. Normal text edits are replayed as diff-based `POST /api/ops` patch requests with `baseRevision` checks on debounce, blur, tab hide, and reconnect. If an older cached file has no known server revision yet, the client temporarily falls back to `PUT /api/file`, refetches that file to learn its revision, and then resumes patch-based sync.
13. When a patch op hits a revision conflict, the client does not blindly retry with another diff. Instead it stores the blocked op plus the original base text, shows a single `OK` action for that file, and after you press it sends whole-file conflict input to `POST /api/conflicts/commit-markers`. The server commits the merged result as ordinary text, with Git conflict markers only where needed. Conflict-confirmation errors are shown inline in that prompt as well, so mobile layouts do not hide them in the footer, and the prompt is scoped to the file that is currently open rather than hijacking later file navigation or disappearing on same-file reloads.
14. Files ending in `.md` open in a lightweight CodeMirror editor with Markdown syntax highlighting (for example, `*emphasis*` and `_emphasis_` render with styled text while the raw markers remain visible), and line numbers are hidden.
15. On both desktop and mobile layouts, markdown files get a compact header toggle that switches between source editing and rendered GitHub Flavored Markdown preview. The icon indicates the destination view (`#` means go to editor source, `<>` means go to rendered preview). On mobile it appears next to the `<` button.
16. Mobile keyboard hints are enabled for sentence capitalization/autocorrect in both the Markdown CodeMirror editor and the plain textarea editor.
17. While the initial tree read is in flight, the client shows a loading state rather than incorrectly claiming the repo is empty.
18. The right pane is split into tabs:
   - `Write` for the alias dropdown, file tree, new-file and new-folder icon actions on any directory row, an online-only manual refresh action, empty-folder deletion, a draggable right-pane resizer, and a short configuration pointer to the repo-management tab
   - `Repos` for creating new aliases, editing existing alias repo URLs, viewing the selected alias deploy key in a read-only box with copy support and GitHub setup link, and deleting aliases after a browser confirmation prompt
19. New files are created from a basename-only prompt. The UI rejects path separators such as `/` and `\`.
20. On mobile-width layouts (including Samsung Galaxy S21+ viewport widths), the app uses separate Files and Editor pages instead of stacking both panes at once. Selecting a file opens the Editor page, and the `<` button in the editor header returns to the Files page.
21. On mobile, the editor header is intentionally compact: it shows the `<` back-to-files control, markdown preview toggle (for `.md` files), the selected filename in a clearly reduced heading size that still uses available space before truncating, and a small fixed-width sync badge so label changes do not shift layout.
22. `Log out` is shown in the Files pane header instead of the editor header, and the editor-level `Sync now` action is removed.
23. Mobile typography and controls are scaled up for readability and touch use, while editor text itself is kept slightly smaller so more content fits on screen.
24. Mobile mode is triggered by a responsive rule that combines narrow viewport width (`max-width: 900px`) with a touch-device fallback (`max-width: 1024px` plus `hover: none` and `pointer: coarse`) so phones still get mobile behavior even when browsers report a wider layout viewport.
25. The client tracks the visible browser viewport height (`visualViewport.height` with `innerHeight` fallback) and applies it as a CSS variable so the editor pane fills the available window height, including mobile browser UI changes.
26. On mobile layouts, horizontal gutters are removed so the editor pane touches the screen edges and the editor text box spans the pane width with no left/right inset; rounded corners are preserved for both the pane and the text box.
27. The production build exposes a Web App Manifest and Service Worker, so Android Chrome can install the app from the browser menu, relaunch at `/`, and restore the last valid repo alias from local state in app/fullscreen display mode.
28. The production Service Worker now precaches the built app shell, including the hashed JS/CSS bundles emitted by Vite. That means if Android or Chrome discards the PWA process in the background, a later cold relaunch can still boot offline from the local precache and then restore repo/file/editor state from IndexedDB.
29. Startup no longer waits indefinitely for `/api/auth/session` during cold relaunch. The initial session probe now times out after a short window and falls back to cached authenticated session metadata when available, so Android process eviction plus flaky connectivity does not leave the app stuck on the startup screen.
30. Repo alias restore is now cache-first for rendering and network-preferred for truth. On startup the client immediately shows aliases recovered from IndexedDB/local storage so the last workspace can hydrate without a blank dropdown, then refreshes `/api/repos` in the background and replaces that list with the authoritative server result when reachable.
31. The client no longer reloads the open file on a timer while you are editing. Local op replay still runs in the background, and the client does lightweight background status refreshes so the sync badge can move from `Local` to `Synced`, but it avoids timer-driven file fetches that could overwrite in-progress typing.
32. On mobile layouts, the app now behaves as two pages instead of one long stacked page: a Files page for alias selection, tree browsing, and repo management, and an Editor page for the open file. If the URL already points at a selected file, mobile startup opens directly into the Editor page.
33. Sync badge state now treats locally dirty editor status consistently: if the current file has unsynced local edits, the badge reports `Local` instead of incorrectly showing `Synced`.
34. The `Local` sync badge is visually distinct from `Synced`, and the client now does lightweight background status refreshes without reloading the open file. That lets the badge move from `Local` to `Synced` after the server's periodic Git sync completes, without bringing back timer-driven editor overwrites.

If the client and server are on different origins, the server must allow the client origin via `allowedOrigins`.
The browser client uses the server-managed session cookie (`credentials: include`) so users stay signed in across browser restarts until the session expires or they log out.
If the browser cannot reach the server but a cached authenticated session exists, the client opens in offline mode, keeps cached files editable, and disables repo-management actions that still require a live API round-trip.
If you want HTTPS locally, terminate TLS in an external reverse proxy and point the browser at that proxy rather than teaching the client dev server about certificates.
For longer-lived browser sessions, increase the server `sessionTtlMs` value and keep cookie settings aligned with your deployment topology.

### Install As Android App (Chrome)

1. Build and serve the client over HTTPS.
2. Open the client URL in Android Chrome.
3. Open the Chrome menu and choose `Install app` (or `Add to Home screen` when Chrome offers install mode).
4. Launch from the home screen icon. The app uses the manifest `display: "fullscreen"` mode and restores the last valid repo alias client-side when the manifest opens the app at `/`.

If you only add a plain shortcut without install mode, Chrome can still open it as a browser tab instead of a standalone app window.

## Local HTTPS Testing

Use Caddy to terminate TLS locally while keeping both app servers on HTTP.

1. Install Caddy on macOS:

   ```bash
   brew install caddy
   ```

2. Create a `Caddyfile` somewhere convenient:

   ```caddy
   notes.localhost {
     reverse_proxy 127.0.0.1:5173
   }

   api.notes.localhost {
     reverse_proxy 127.0.0.1:3001
   }
   ```

3. Start the server from the server repository:

   ```bash
   cd /Users/sseefried/code/github-note-sync/github-note-sync-server
   npm run dev
   ```

4. Start the client and point it at the HTTPS API origin:

   ```bash
   cd /Users/sseefried/code/github-note-sync/github-note-sync-client
   npm run dev -- --server-url=https://api.notes.localhost
   ```

   If your reverse proxy uses a non-localhost hostname, include it in Vite's allowlist:

   ```bash
   VITE_ALLOWED_HOSTS=notes.internal.asymptoticsecurity.com npm run dev -- --server-url=https://api.notes.localhost
   ```

5. Start Caddy:

   ```bash
   caddy run --config /absolute/path/to/Caddyfile
   ```

6. Open the app at `https://notes.localhost`.

If you have an extra proxy hop in front of Caddy or another TLS terminator, preserve the original scheme by forwarding `X-Forwarded-Proto: https` to the client process as well.

Direct visits to `http://127.0.0.1:5173` or `http://localhost:5173` are expected to show an HTTPS-required screen.

For this setup, the server repository should allow the browser origin:

```json
{
  "allowedOrigins": [
    "https://notes.localhost"
  ]
}
```

## Deployment

App-user deployment on the internal server:

```bash
scripts/install-user-service.sh \
  --server-url=https://notes.example.com \
  --listen-port 4173
```

This script:
- copies the repository into `~/.local/opt/github-note-sync-client`
- installs dependencies with `npm ci`
- builds the production bundle with the requested `--server-url`
- writes `~/.config/systemd/user/github-note-sync-client.service`
- reloads, enables, and restarts the user service

The client service uses `vite preview`, so the systemd unit serves the prebuilt `dist/` output on the configured port.
That internal preview listener is meant to sit behind your HTTPS reverse proxy; browsing directly to its HTTP port should show the HTTPS-required screen.

## Architecture

The client is a React app built with Vite. A thin CLI wrapper still requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API. The client itself stays HTTP-only at the app-server level; if you want HTTPS locally or in production, terminate TLS in an external reverse proxy so the transport model matches production instead of embedding certificate handling into the app. In local HTTPS testing, a proxy such as Caddy sits in front of both the Vite dev server and the API server and exposes stable HTTPS origins like `https://notes.localhost` and `https://api.notes.localhost`. Because modern Vite rejects unknown `Host` headers by default, the client config keeps an explicit allowlist for proxied browser hostnames in both `vite dev` and `vite preview`; `notes.internal.asymptoticsecurity.com` is allowed by default, and extra hostnames can be supplied through `VITE_ALLOWED_HOSTS`. A startup guard still refuses to boot the app for plain HTTP browser sessions, but it now checks both the browser URL scheme and a small same-origin request-context endpoint served by Vite, so reverse proxies can mark the original request as secure with `X-Forwarded-Proto: https` while direct HTTP visits to the raw Vite or preview ports remain intentionally unusable.

The major client-side design change is that the browser is no longer stateless with respect to the editing workspace. After a successful authenticated load, the client caches a session snapshot, the repo-alias list, and the last-opened alias in local storage, while repo trees, selected files, materialized local file contents, last-known server contents, file revisions, and pending operations are cached in IndexedDB. Launching the PWA at `/` restores the last valid repo alias client-side, and file selection now has a readable URL form of `/<repoAlias>/file/<repo-relative path>` so a reload or shared link can reopen a specific note. The app hydrates the file tree and editor from the local cache first, then refreshes `/api/bootstrap` and `/api/file` when the API is reachable. If the network is unavailable but a cached authenticated session exists, the client still boots into the editor with the cached workspace instead of failing closed on startup.

The current local-first write path is split into two explicit protocols. Normal accepted edits are written to IndexedDB immediately, the client computes a range-replace patch from the last known server content to the current local content, and replay uses `POST /api/ops` with one idempotent patch op per file at a time. Server acknowledgements update the cached `revision` and `serverContent`, so later edits diff against the last acked server state instead of repeatedly overwriting the whole file. If a cached file predates revision tracking, the client uses `PUT /api/file` only as a guarded compatibility fallback, immediately refetches `GET /api/file`, and then returns to patch ops for subsequent edits. Manual refresh, repo alias mutation, and tree-structure actions still call the server directly and therefore stay available only when the API is reachable.

Conflict handling is now explicit instead of passive. If `POST /api/ops` returns `409 conflict`, the client stores the blocked op plus the original base text it diffed against, keeps the local text visible, and shows a single confirmation action for that file. Pressing `OK` sends whole-file conflict input to `POST /api/conflicts/commit-markers`; the server then performs a 3-way merge against its current file content and commits the result as ordinary text, with Git conflict markers only where the texts genuinely overlap. After that, the client treats the file like any other note and does not parse or track the markers specially. Because mobile hides the normal footer status row, conflict-confirmation failures are also rendered inline inside that prompt, changing files clears the prompt unless the newly selected file is itself the blocked one, and same-file reloads re-sync the prompt from IndexedDB instead of dropping it.

The UI structure remains the same: repo selection and repo management live in the right pane, the editor stays plain-text-first, `.md` files use a lightweight CodeMirror surface plus an optional rendered preview, and mobile layout now treats Files and Editor as separate pages with a compact editor header and a fixed-width sync badge. The client also continues to track `visualViewport.height` so the visible editor height follows mobile browser chrome changes. For installability and app-style launch on Android, the client ships a manifest (`display: "fullscreen"`), app icon, and service worker registration in production builds.

The Service Worker is now build-aware instead of hand-maintaining a tiny shell list. During `vite build`, the client emits a `precache-manifest.js` file that lists the current hashed bundles and public assets, and the Service Worker precaches that full set during install. Navigation requests are served from cached `index.html` first while the worker refreshes it in the background, which makes “Android killed the PWA and reopened it offline” behave like a cold local launch instead of a network failure. The API is still not cached as app data; repo trees, file contents, revisions, selected files, and pending ops remain in IndexedDB and are rehydrated by the React app after the shell boots.

Startup auth is also bounded now. The first `/api/auth/session` request uses a short timeout instead of waiting forever for the browser network stack to decide that the request failed. If that probe times out and there is cached authenticated session metadata from a previous online run, the client opens from cache immediately and continues treating the server as degraded/offline until a later probe succeeds.

Repo alias startup follows the same principle, but without changing the source of truth. The client seeds the alias list from local cache immediately so the last repo can be selected and hydrated without waiting on `/api/repos`, then still asks the server for the canonical alias list and replaces the cached view with that network result as soon as it arrives.

Because merge-aware conflict handling has not landed yet, the client avoids periodic open-file reloads while the editor is active. The app still replays local edits on debounce and reconnect, and it still does lightweight status refreshes, but it does not keep re-fetching the open file on a timer and risking visible content churn.

Startup now prefers cached authenticated state as well when it exists. If the browser has a cached authenticated session snapshot from a prior online run, the client boots from that cache immediately so repo aliases, tree state, and file contents can hydrate as quickly as possible. The network session probe still runs and wins when it returns, but it no longer blocks cached workspace restore first.

Design philosophy:

- Keep accepted edits durable on-device first, then replay them to the server when connectivity permits.
- Prefer diff-based, idempotent patch ops for normal text edits, while using whole-file conflict payloads only for the explicit conflict-confirmation path and keeping `PUT /api/file` only as a guarded compatibility fallback.
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
- Prefer the network whenever it is reachable, but never make the user wait for obvious cached workspace state before rendering it.
- Avoid background repo/file polling until merge-conflict semantics exist, so editing remains stable and local input is never surprised by a timer-driven reload.
