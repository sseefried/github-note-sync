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

5. The active `repoAlias` lives in the browser URL path, for example `/notes-work`. If the URL has no alias segment, the write view stays empty.
6. In the UI, create a repo alias by entering:
   - a `repoAlias` using letters, numbers, `_`, and `-`
   - a GitHub SSH repo URL such as `git@github.com:you/notes.git`
7. Copy the generated public key from the client and add it to GitHub for that repository.
8. Once GitHub grants that key access, select the repo alias and edit files normally.
9. When a repo alias is first opened from the URL, or when the browser is refreshed on that alias, the client performs an implicit force-refresh against the remote repo before starting normal polling.
10. Editor changes are debounced on the client for 3 seconds while typing, then flushed immediately on blur, tab hide, page unload, file switch, repo-alias switch, or manual sync.
11. While the initial tree read is in flight, the client shows a loading state rather than incorrectly claiming the repo is empty.
12. The right pane is split into tabs:
   - `Write` for the alias dropdown, file tree, new-file and new-folder icon actions on any directory row, a root-level force-refresh action, empty-folder deletion, a draggable right-pane resizer, and a short configuration pointer to the repo-management tab
   - `Repos` for creating new aliases, editing existing alias repo URLs, viewing the selected alias deploy key in a read-only box with copy support and GitHub setup link, and deleting aliases after a browser confirmation prompt
13. New files are created from a basename-only prompt. The UI rejects path separators such as `/` and `\`.

## Architecture

The client is a React app built with Vite. A thin CLI wrapper requires `--server-url=<url>` and injects that value into the build/runtime environment so the UI can call the separate API. The browser treats the URL path as the source of truth for the active repo alias, so direct links open the same repo and the write view stays empty when no alias is present in the path. When an alias is first activated from the URL, the client first force-refreshes against the remote repo and only then falls back to normal polling, with an explicit loading state while that first tree read is still in flight. It separates repo selection and alias management into tabs in the right pane, renders the repository tree in the write tab, exposes compact file and folder creation icons on every directory row, places a refresh action on the repo row, allows immediate deletion of folders that contain no files, lets the user drag a splitter to resize the sidebar, points configuration tasks to the repo-management tab, and uses that repo-management tab for creating, editing, and deleting alias metadata with an explicit confirmation step before destructive actions while exposing the selected alias deploy key in a read-only copyable field with a direct GitHub setup link. The dark sidebar keeps file-tree helpers and destructive actions visually distinct so state and risk are easy to read at a glance. Editor writes are debounced for 3 seconds while typing before being sent to the server. Pending edits are flushed immediately on blur, page hide, unload, file switch, repo-alias switch, and manual sync.

Design philosophy:

- Keep the browser stateless with respect to Git; the server owns the repository and sync rules.
- Require the server URL explicitly so deployments and local development are unambiguous.
- Use the URL path as the active-repo identifier so repo views are deep-linkable.
- Make repo onboarding explicit: the client asks for a repo alias and repo URL, then shows the public key the user must install in GitHub.
- Reduce write traffic during active typing without hiding the durability tradeoff.
- Prefer a plain-text editing experience over heavy editor abstractions.
- Surface configuration failures clearly at startup instead of failing silently.
