# GitHub Note Sync

This repository is now a monorepo for the full app:

- `client/` for the frontend web app
- `server/` for the backend API and git-sync engine
- `docs/` for shared architecture, deployment notes, and teaching material

The shared documentation includes the local-first sync state machine in [`docs/state-machine.dot`](./docs/state-machine.dot) and [`docs/state-machine.pdf`](./docs/state-machine.pdf), the combined system design in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), and private tailnet DNS notes in [`docs/TAILSCALE.md`](./docs/TAILSCALE.md).

## Installation

1. Install the dependencies required by the client and server:

   ```bash
   (cd client && npm install)
   (cd server && npm install)
   ```

2. Install Graphviz if you want to regenerate the state-machine PDF locally:

   ```bash
   brew install graphviz
   ```

## Usage

1. Regenerate the state-machine PDF from the Graphviz source:

   ```bash
   bash docs/gen-state-machine-pdf.sh
   ```

2. Open the generated diagram at `docs/state-machine.pdf`.

3. Read the shared architecture and deployment notes:
   - [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
   - [`docs/TAILSCALE.md`](./docs/TAILSCALE.md)

4. Run the client and server from their monorepo directories as documented in:
   - [`client/README.md`](./client/README.md)
   - [`server/README.md`](./server/README.md)

## Architecture

This repository contains the complete application. The runtime code lives under `client/` and `server/`, while `docs/` holds the shared architecture, sync-model, and deployment material that describes how those two halves work together.

The basic design is a local-first client paired with a server-owned Git sync engine. The client caches workspace state locally, freezes each dirty file's server base while edits are pending, and replays idempotent patch operations through `POST /api/ops`. The server owns authentication, SSH credentials, repo clones, and durable op receipts. When retries already converged, they are acknowledged as duplicates; when remote changes are non-overlapping, the client fast-forwards and retries; when edits truly overlap, the server materializes an explicit Git-based merge through `POST /api/conflicts/merge`.

Design philosophy:

- Keep client and server code in one repository, but keep shared design material in `docs/`.
- Prefer a local-first editing model with explicit, no-loss conflict handling.
- Keep authentication, SSH keys, and Git authority on the server.
- Make generated documentation reproducible from checked-in source.
- Prefer simple local tooling over bespoke documentation pipelines.
