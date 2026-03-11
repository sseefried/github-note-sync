# GitHub Note Sync Client

The client repository contains the authenticated web app: a login and repo-management shell around the two-pane editor. It talks to the separate server API for session status, login, registration, repo-alias registration, public-key retrieval, file reads, file writes, tree refreshes, and sync requests.

## Installation

1. Install Node.js 25+ and npm.
2. Install dependencies:

   ```bash
   npm install
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
10. When a repo alias is first opened from the URL, or when the browser is refreshed on that alias, the client performs an implicit force-refresh against the remote repo before starting normal polling.
11. Editor changes are debounced on the client for 3 seconds while typing, then flushed immediately on blur, tab hide, page unload, file switch, repo-alias switch, or manual sync.
12. Files ending in `.md` open in a lightweight CodeMirror editor with Markdown syntax highlighting (for example, `*emphasis*` and `_emphasis_` render with styled text while the raw markers remain visible), and line numbers are hidden.
13. On both desktop and mobile layouts, markdown files get a compact header toggle that switches between source editing and rendered GitHub Flavored Markdown preview. On mobile it appears next to the `<` button.
14. While the initial tree read is in flight, the client shows a loading state rather than incorrectly claiming the repo is empty.
15. The right pane is split into tabs:
   - `Write` for the alias dropdown, file tree, new-file and new-folder icon actions on any directory row, a root-level force-refresh action, empty-folder deletion, a draggable right-pane resizer, and a short configuration pointer to the repo-management tab
   - `Repos` for creating new aliases, editing existing alias repo URLs, viewing the selected alias deploy key in a read-only box with copy support and GitHub setup link, and deleting aliases after a browser confirmation prompt
16. New files are created from a basename-only prompt. The UI rejects path separators such as `/` and `\`.
17. On mobile-width layouts (including Samsung Galaxy S21+ viewport widths), the file tree stacks above the editor. Selecting a file scrolls down to the editor, and a `<` button in the editor header scrolls back to the file tree so another file can be chosen.
18. On mobile, the editor header is intentionally compact: it shows the `<` back-to-files control, markdown preview toggle (for `.md` files), the selected filename (trimmed for small screens), and a small `Idle`/`Syncing` badge.
19. `Log out` is shown in the Files pane header instead of the editor header, and the editor-level `Sync now` action is removed.
20. Mobile typography and controls are scaled up for readability and touch use, while editor text itself is kept slightly smaller so more content fits on screen.
21. Mobile mode is triggered by a responsive rule that combines narrow viewport width (`max-width: 900px`) with a touch-device fallback (`max-width: 1024px` plus `hover: none` and `pointer: coarse`) so phones still get mobile behavior even when browsers report a wider layout viewport.
22. The client tracks the visible browser viewport height (`visualViewport.height` with `innerHeight` fallback) and applies it as a CSS variable so the editor pane fills the available window height, including mobile browser UI changes.
23. On mobile layouts, horizontal gutters are removed so the editor pane touches the screen edges and the editor text box spans the pane width with no left/right inset; rounded corners are preserved for both the pane and the text box.
24. The production build exposes a Web App Manifest and Service Worker, so Android Chrome can install the app from the browser menu and launch it in app/fullscreen display mode.

If the client and server are on different origins, the server must allow the client origin via `allowedOrigins`.
The browser client uses the server-managed session cookie (`credentials: include`) so users stay signed in across browser restarts until the session expires or they log out.
If you want HTTPS locally, terminate TLS in an external reverse proxy and point the browser at that proxy rather than teaching the client dev server about certificates.
For longer-lived browser sessions, increase the server `sessionTtlMs` value and keep cookie settings aligned with your deployment topology.

### Install As Android App (Chrome)

1. Build and serve the client over HTTPS.
2. Open the client URL in Android Chrome.
3. Open the Chrome menu and choose `Install app` (or `Add to Home screen` when Chrome offers install mode).
4. Launch from the home screen icon. The app uses the manifest `display: "fullscreen"` mode.

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

The client is a React app built with Vite. A thin CLI wrapper requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API. The client itself stays HTTP-only at the app-server level; if you want HTTPS locally or in production, terminate TLS in an external reverse proxy so the transport model matches production instead of embedding certificate handling into the app. In local HTTPS testing, a proxy such as Caddy sits in front of both the Vite dev server and the API server and exposes stable HTTPS origins like `https://notes.localhost` and `https://api.notes.localhost`. Because modern Vite rejects unknown `Host` headers by default, the client config now keeps an explicit allowlist for proxied browser hostnames in both `vite dev` and `vite preview`; `notes.internal.asymptoticsecurity.com` is allowed by default, and extra hostnames can be supplied through `VITE_ALLOWED_HOSTS`. A startup guard still refuses to boot the app for plain HTTP browser sessions, but it now checks both the browser URL scheme and a small same-origin request-context endpoint served by Vite, so reverse proxies can mark the original request as secure with `X-Forwarded-Proto: https` while direct HTTP visits to the raw Vite or preview ports remain intentionally unusable. On startup the browser first checks `/api/auth/session` and treats the server session as the source of truth for whether the editor can load at all. Until the user is authenticated, the UI stays on a dedicated auth screen that can register the first user, log in, and log out while keeping the password authority entirely on the server. Browser authentication is cookie-based: login and register requests let the server set the session cookie, and subsequent API calls include that cookie automatically with `credentials: include`. This keeps browser sign-in persistent until logout or server-side expiry (`sessionTtlMs`), without storing bearer tokens in browser storage. Once authenticated, the browser still treats the URL path as the source of truth for the active repo alias, so direct links remain deep-linkable inside that user's alias namespace. When an alias is first activated from the URL, the client first force-refreshes against the remote repo and only then falls back to normal polling, with an explicit loading state while that first tree read is still in flight. It separates repo selection and alias management into tabs in the right pane, renders the repository tree in the write tab, exposes compact file and folder creation icons on every directory row, places a refresh action on the repo row, allows immediate deletion of folders that contain no files, lets the user drag a splitter to resize the sidebar, and exposes the selected alias deploy key in a read-only copyable field with a direct GitHub setup link. The editor remains plain-text-first with the same debounce/flush write pipeline, but now uses a conditional editing surface: `.md` files render in a lightweight CodeMirror instance with Markdown syntax highlighting, line wrapping, and hidden line numbers, while other file types continue to use a native `<textarea>`. For `.md` files, a compact header toggle is available on both desktop and mobile to swap between source editing and rendered GitHub Flavored Markdown preview. On mobile-targeted viewports, the layout becomes a single vertical stack with repository controls first and editor second; selecting a file triggers a smooth scroll into the editor pane, and the editor header stays intentionally minimal with the back-to-files control, markdown toggle when applicable, a shortened filename, and a compact sync-state badge. The mobile breakpoint now combines narrow width with a coarse-touch fallback so phones still match mobile behavior when a browser reports a wider layout viewport. The same mobile mode also increases navigation and control sizing while keeping editor text slightly smaller to preserve editing space. To avoid short editor panes when mobile browser chrome expands or collapses, the client continuously syncs a viewport-height CSS variable from `visualViewport.height` (falling back to `innerHeight`) and uses that to size the workspace and editor pane to the visible window. In that mobile mode, horizontal gutters are removed so the editor pane and editor text box use edge-to-edge width while still keeping rounded corners on both elements. For installability and app-style launch on Android, the client ships a manifest (`display: "fullscreen"`), app icon, and service worker registration in production builds.

Design philosophy:

- Keep the browser stateless with respect to Git; the server owns the repository and sync rules.
- Treat the server-managed session cookie as the browser credential after login.
- Keep passwords and SSH keys out of browser storage.
- Use the URL path as the active-repo identifier so repo views are deep-linkable within one account.
- Make repo onboarding explicit: the client asks for a repo alias and repo URL, then shows the public key the user must install in GitHub.
- Reduce write traffic during active typing without hiding the durability tradeoff.
- Prefer plain-text editing defaults, while using lightweight editor extensions only where they materially improve readability (for example, Markdown syntax highlighting and optional rendered preview for `.md` files).
- Keep deployment simple by building the client once and running it under a user systemd unit.
- Keep TLS termination outside the app so local and production topology stay aligned.
- Keep Vite host validation explicit so proxied browser origins must be intentionally allowed.
- Refuse to boot the browser app on requests that are neither HTTPS in the browser nor explicitly marked as HTTPS by a trusted proxy.
- Bake the public HTTPS base URL into the production bundle so browsers never target the internal HTTP app ports.
- Surface configuration and authentication failures clearly at startup instead of failing silently.
- Keep mobile editing practical by stacking tree then editor, with explicit scroll navigation between them.
- Keep mobile UI readable and touch-friendly by scaling type and control sizes on narrow viewports.
- Keep the mobile editor header minimal so file context and sync state stay visible without wasting vertical space.
- Keep account actions in the Files pane and remove editor-level manual sync controls to reduce header clutter.
- Keep editor sizing tied to the live visible viewport so mobile browser UI changes do not shrink the editing area unexpectedly.
- Keep mobile horizontal layout edge-to-edge for editing density while preserving rounded visual boundaries.
- Keep mobile launch experience app-like by shipping a manifest/service worker pair for Android Chrome install mode.
