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
2. Start the client in development and pass the server URL explicitly:

   ```bash
   npm run dev -- --server-url=http://127.0.0.1:3001
   ```

3. Build the client with an explicit server URL:

   ```bash
   npm run build -- --server-url=http://127.0.0.1:3001
   ```

4. Preview the built client with the same argument:

   ```bash
   npm run start -- --server-url=http://127.0.0.1:3001
   ```

If `--server-url` is omitted, the client exits with a clear message explaining that it is required. If the server is configured to listen on a different port, use that port in `--server-url`.

The Vite dev server and preview server still listen on HTTP internally, but the browser client now refuses to run unless the page itself is loaded over HTTPS. In practice, open the app through your reverse proxy rather than visiting the raw Vite URL directly.

5. Open the client in the browser. Register a server user, or sign in with an existing server-owned username and password.
6. The Register tab stays available by default so you can create multiple users. If the server is configured with `allowRegistration: false`, the Register tab disappears and only sign-in remains.
7. Once signed in, create a repo alias by entering:
   - a `repoAlias` using letters, numbers, `_`, and `-`
   - a GitHub SSH repo URL such as `git@github.com:you/notes.git`
8. Copy the generated public key from the client and add it to GitHub.
9. Repo aliases are private to the signed-in server user. Another user can reuse the same alias name without colliding with yours.
10. When a repo alias is first opened from the URL, or when the browser is refreshed on that alias, the client performs an implicit force-refresh against the remote repo before starting normal polling.
11. Editor changes are debounced on the client for 3 seconds while typing, then flushed immediately on blur, tab hide, page unload, file switch, repo-alias switch, or manual sync.
12. While the initial tree read is in flight, the client shows a loading state rather than incorrectly claiming the repo is empty.
13. The right pane is split into tabs:
   - `Write` for the alias dropdown, file tree, new-file and new-folder icon actions on any directory row, a root-level force-refresh action, empty-folder deletion, a draggable right-pane resizer, and a short configuration pointer to the repo-management tab
   - `Repos` for creating new aliases, editing existing alias repo URLs, viewing the selected alias deploy key in a read-only box with copy support and GitHub setup link, and deleting aliases after a browser confirmation prompt
14. New files are created from a basename-only prompt. The UI rejects path separators such as `/` and `\`.

If the client and server are on different origins, the server must allow the client origin via `allowedOrigins`.
The browser client requests a bearer `sessionToken` from the server and keeps it in `sessionStorage`, so sign-in works even when the client and server run on different machines or origins.
If you want HTTPS locally, terminate TLS in an external reverse proxy and point the browser at that proxy rather than teaching the client dev server about certificates.
Phone or native clients can use the same server auth model by requesting their own bearer `sessionToken`.

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

5. Start Caddy:

   ```bash
   caddy run --config /absolute/path/to/Caddyfile
   ```

6. Open the app at `https://notes.localhost`.

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
  --server-url=https://203.0.113.10 \
  --listen-port 4173
```

This script:
- copies the repository into `~/.local/opt/github-note-sync-client`
- installs dependencies with `npm ci`
- builds the production bundle with the requested `--server-url`
- writes `~/.config/systemd/user/github-note-sync-client.service`
- reloads, enables, and restarts the user service

The client service uses `vite preview`, so the systemd unit serves the prebuilt `dist/` output on the configured port.

## Architecture

The client is a React app built with Vite. A thin CLI wrapper requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API. The client itself stays HTTP-only at the app-server level; if you want HTTPS locally or in production, terminate TLS in an external reverse proxy so the transport model matches production instead of embedding certificate handling into the app. In local HTTPS testing, a proxy such as Caddy sits in front of both the Vite dev server and the API server and exposes stable HTTPS origins like `https://notes.localhost` and `https://api.notes.localhost`. A runtime guard refuses to boot the app unless the page was loaded over HTTPS, which means the raw Vite or preview URLs are intentionally unusable in a browser. On startup the browser first checks `/api/auth/session` and treats the server session as the source of truth for whether the editor can load at all. Until the user is authenticated, the UI stays on a dedicated auth screen that can register the first user, log in, and log out while keeping the password authority entirely on the server. This browser client explicitly requests a bearer session token from the server and stores it in `sessionStorage`, which avoids cross-site cookie issues when the frontend and backend run on different hosts. Once authenticated, the browser still treats the URL path as the source of truth for the active repo alias, so direct links remain deep-linkable inside that user's alias namespace. When an alias is first activated from the URL, the client first force-refreshes against the remote repo and only then falls back to normal polling, with an explicit loading state while that first tree read is still in flight. It separates repo selection and alias management into tabs in the right pane, renders the repository tree in the write tab, exposes compact file and folder creation icons on every directory row, places a refresh action on the repo row, allows immediate deletion of folders that contain no files, lets the user drag a splitter to resize the sidebar, and exposes the selected alias deploy key in a read-only copyable field with a direct GitHub setup link. All authenticated browser requests carry that bearer token, while non-browser clients can use the same authenticated API with their own bearer session tokens.

Design philosophy:

- Keep the browser stateless with respect to Git; the server owns the repository and sync rules.
- Treat the server-issued bearer token as the only browser credential after login.
- Keep passwords and SSH keys out of browser storage.
- Use the URL path as the active-repo identifier so repo views are deep-linkable within one account.
- Make repo onboarding explicit: the client asks for a repo alias and repo URL, then shows the public key the user must install in GitHub.
- Reduce write traffic during active typing without hiding the durability tradeoff.
- Prefer a plain-text editing experience over heavy editor abstractions.
- Keep deployment simple by building the client once and running it under a user systemd unit.
- Keep TLS termination outside the app so local and production topology stay aligned.
- Refuse to boot the browser app on non-HTTPS pages so the proxy requirement is visible immediately.
- Surface configuration and authentication failures clearly at startup instead of failing silently.
