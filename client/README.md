# GitHub Note Sync Client

The client repository contains the authenticated local-first web app: a login and repo-management shell around the two-pane editor. It talks to the separate server API for session status, login, registration, repo-alias registration, public-key retrieval, file reads, diff-based patch writes, tree refreshes, and sync requests, while restoring cached repo/file state locally and replaying durable pending edits when the API becomes reachable again.

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
12. Editor changes are written to IndexedDB first and queued locally per file. Normal text edits are replayed as diff-based `POST /api/ops` patch requests with `baseRevision` checks on debounce, blur, tab hide, and reconnect, and each request also carries the intended final file text so the server can acknowledge already-converged retries instead of surfacing a false conflict. If a cached file has no known server revision yet, the client no longer tries to sync it automatically; it now requires a refresh from the server before those edits can sync. The background 3-second maintenance loop is also serialized now: it flushes pending writes before refreshing repo state so one tab does not race its own write replay with a simultaneous status refresh.
13. When a patch op hits a revision conflict, the client first checks whether the server already contains the exact local target text; if it does, the client advances its cached base and clears that stale op instead of showing a conflict. Otherwise it checks whether the remote change and the local change are non-overlapping. If they are, it shows an `OK`-only prompt explaining that newer non-overlapping server changes will be pulled in, updates the local base to that newer server version, reapplies the local edit on top, and immediately retries sync. If the edits overlap, the client stores the blocked op plus the last repo commit it knew for that edit, shows a single `OK` action for that file, and after you press it sends whole-file conflict input to `POST /api/conflicts/merge`. The server creates a temporary local branch from that known base commit, commits the client’s whole-file content there, merges that temporary commit with current `HEAD`, commits the merge result, and then deletes the temporary branch. Clean cached files now follow the same explicit model: when the app reopens a cached file and the server has a newer clean version, it checks that immediately and shows an `OK`-only prompt before replacing the cached version in the editor. If a fetched server file already matches dirty local text, the client now treats that as a successful base advance and clears the stale pending write instead of preserving an old dirty snapshot. Conflict-confirmation errors are shown inline in these prompts as well, and the prompt is now rendered as a fixed blocking overlay so it cannot disappear off-screen on desktop. If the client has no usable base commit, or the server no longer has that commit, the app now shows a second `OK`-only prompt and reloads the latest server version for that file instead of attempting a merge.
14. Changing a repo alias to point at a different GitHub repo is now fenced off from stale local state. Before the client sends `PUT /api/repos/:repoAlias`, it flushes all pending writes and refuses the repo change if that alias still has queued, blocked, or invalid local operations. After a successful repo change, it clears the cached repo tree, file snapshots, and pending operations for that alias before loading the new remote.
15. Files ending in `.md` open in a lightweight CodeMirror editor with Markdown syntax highlighting (for example, `*emphasis*` and `_emphasis_` render with styled text while the raw markers remain visible), and line numbers are hidden.
16. On both desktop and mobile layouts, markdown files get a compact header toggle that switches between source editing and rendered GitHub Flavored Markdown preview. The icon indicates the destination view (`#` means go to editor source, `<>` means go to rendered preview). On mobile it appears next to the `<` button.
17. Mobile keyboard hints are enabled for sentence capitalization/autocorrect in both the Markdown CodeMirror editor and the plain textarea editor.
18. While the initial tree read is in flight, the client shows a loading state rather than incorrectly claiming the repo is empty.
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
26. The editor header now shows a short `base:` commit hash for debugging conflict merges. It prefers the current file's pending/conflict `baseCommit` and otherwise falls back to the repo's last known `headRevision`, and it refreshes when sync state advances.
27. When a conflict prompt or reload-from-server prompt is visible, the client now freezes editor and tree interactions until the user responds. On mobile, the app also scrolls that prompt into view automatically so it sits at the top of the screen.
26. On mobile layouts, horizontal gutters are removed so the editor pane touches the screen edges and the editor text box spans the pane width with no left/right inset; rounded corners are preserved for both the pane and the text box.
27. The production build exposes a Web App Manifest and Service Worker, so Android Chrome can install the app from the browser menu, relaunch at `/`, and restore the last valid repo alias from local state in app/fullscreen display mode.
28. The production Service Worker now precaches the built app shell, including the hashed JS/CSS bundles emitted by Vite. That means if Android or Chrome discards the PWA process in the background, a later cold relaunch can still boot offline from the local precache and then restore repo/file/editor state from IndexedDB.
29. Startup no longer waits indefinitely for `/api/auth/session` during cold relaunch. The initial session probe now times out after a short window and falls back to cached authenticated session metadata when available, so Android process eviction plus flaky connectivity does not leave the app stuck on the startup screen.
30. Repo alias restore is now cache-first for rendering and network-preferred for truth. On startup the client immediately shows aliases recovered from IndexedDB/local storage so the last workspace can hydrate without a blank dropdown, then refreshes `/api/repos` in the background and replaces that list with the authoritative server result when reachable.
31. The client no longer reloads the open file on reconnect or background status refresh just because repo state changed. Those paths now refresh tree/status metadata only. On startup, the app still checks the currently selected cached file against the server immediately when connectivity exists, but it now blocks editing until that check completes and requires explicit confirmation before adopting newer server content.
32. On mobile layouts, the app now behaves as two pages instead of one long stacked page: a Files page for alias selection, tree browsing, and repo management, and an Editor page for the open file. If the URL already points at a selected file, mobile startup opens directly into the Editor page.
33. Sync badge state now treats locally dirty editor status consistently: if the current file has unsynced local edits, the badge reports `Local` instead of incorrectly showing `Synced`.
34. The `Local` sync badge is visually distinct from `Synced`, and the client now does lightweight background status refreshes without reloading the open file. That lets the badge move from `Local` to `Synced` after the server's periodic Git sync completes, without bringing back timer-driven editor overwrites.

If the client and server are on different origins, the server must allow the client origin via `allowedOrigins`.
The browser client uses the server-managed session cookie (`credentials: include`) so users stay signed in across browser restarts until the session expires or they log out.
If the browser cannot reach the server but a cached authenticated session exists, the client opens in offline mode, keeps cached files editable, and disables repo-management actions that still require a live API round-trip.
If you want HTTPS locally, terminate TLS in an external reverse proxy and point the browser at that proxy rather than teaching the client dev server about certificates.
For longer-lived browser sessions, increase the server `sessionTtlMs` value and keep cookie settings aligned with your deployment topology.

To regenerate the reducer diagram from the repo root, run `bash docs/gen-state-machine-pdf.sh`.

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


