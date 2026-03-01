# GitHub Note Sync Client

The client repository contains the two-pane web app: an editor on the left and a GitHub-style file tree on the right. It talks to the separate server API for repo-alias registration, public-key retrieval, file reads, file writes, tree refreshes, and sync requests.

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

If `--server-url` is omitted, the client exits with a clear message explaining that it is required.

5. In the UI, create a repo alias by entering:
   - a `repoAlias` using letters, numbers, `_`, and `-`
   - a GitHub SSH repo URL such as `git@github.com:you/notes.git`
6. Copy the generated public key from the client and add it to GitHub for that repository.
7. Once GitHub grants that key access, select the repo alias and edit files normally.
8. Editor changes are debounced on the client for 3 seconds while typing, then flushed immediately on blur, tab hide, page unload, file switch, repo-alias switch, or manual sync.
9. The right pane is split into tabs:
   - `Select alias` for the alias dropdown, file tree, and a collapsed deploy-key section with copy-to-clipboard support plus a direct GitHub repo link
   - `Aliases` for creating new aliases and editing existing alias repo URLs

## Architecture

The client is a React app built with Vite. A thin CLI wrapper requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API. The browser separates repo selection and alias management into tabs in the right pane, renders the repository tree in the selection tab, reveals the public key inside a collapsed deploy-key section, and uses the aliases tab for both creating and editing alias metadata. Editor writes are debounced for 3 seconds while typing before being sent to the server. Pending edits are flushed immediately on blur, page hide, unload, file switch, repo-alias switch, and manual sync.

Design philosophy:

- Keep the browser stateless with respect to Git; the server owns the repository and sync rules.
- Require the server URL explicitly so deployments and local development are unambiguous.
- Make repo onboarding explicit: the client asks for a repo alias and repo URL, then shows the public key the user must install in GitHub.
- Reduce write traffic during active typing without hiding the durability tradeoff.
- Prefer a plain-text editing experience over heavy editor abstractions.
- Surface configuration failures clearly at startup instead of failing silently.
