# GitHub Note Sync

This repository is now a monorepo for the full app:

- `client/` for the frontend web app
- `server/` for the backend API and git-sync engine
- `docs/` for shared architecture, deployment notes, and teaching material

The shared documentation includes the local-first sync state machine in [`docs/state-machine.dot`](./docs/state-machine.dot) and [`docs/state-machine.pdf`](./docs/state-machine.pdf), the combined system design in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), and private tailnet DNS notes in [`docs/TAILSCALE.md`](./docs/TAILSCALE.md).

## Docs

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): top-level system design plus the detailed client and server architecture.
- [`docs/TAILSCALE.md`](./docs/TAILSCALE.md): private tailnet DNS setup notes for the deployment model used here.
- [`docs/local-first-pwa-design.md`](./docs/local-first-pwa-design.md): broader design notes for the local-first PWA approach.
- [`docs/state-machine.dot`](./docs/state-machine.dot): Graphviz source for the file-sync state machine.
- [`docs/gen-state-machine-pdf.sh`](./docs/gen-state-machine-pdf.sh): script that renders the state-machine PDF from the Graphviz source.

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

The canonical architecture document is [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). It contains the top-level system design plus the detailed client and server architecture sections.
