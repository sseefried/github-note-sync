# GitHub Note Sync Workspace

This top-level workspace ties together the two sibling repositories that make up the app:

- `github-note-sync-client` for the frontend web app
- `github-note-sync-server` for the backend API and git-sync engine

It also holds shared design material and generated documentation artifacts, including the local-first sync state machine in [`docs/state-machine.dot`](./docs/state-machine.dot) and [`docs/state-machine.pdf`](./docs/state-machine.pdf).

## Installation

1. Install the dependencies required by each sibling repository:

   ```bash
   (cd github-note-sync-client && npm install)
   (cd github-note-sync-server && npm install)
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

3. Run the client and server from their own repositories as documented in:
   - [`github-note-sync-client/README.md`](./github-note-sync-client/README.md)
   - [`github-note-sync-server/README.md`](./github-note-sync-server/README.md)

## Architecture

This repository is a coordination layer rather than a deployable app on its own. The real runtime architecture lives in the sibling client and server repositories, while this top-level workspace stores shared design documents, deployment notes, and teaching artifacts that explain how those two repos work together.

The most important shared artifact here is the local-first sync state machine. It documents the intended behavior for one file under one repo alias: frozen client base snapshots while dirty, idempotent patch replay through `POST /api/ops`, duplicate/converged retry handling, non-overlapping fast-forward replay, explicit overlapping-conflict materialization through `POST /api/conflicts/merge`, and the repo-alias safety rails that prevent stale cached state from leaking into a different upstream repo.

Design philosophy:

- Keep client and server implementation details in their own repositories.
- Keep cross-repo design artifacts in one shared, easy-to-find place.
- Make generated documentation reproducible from checked-in source.
- Prefer simple local tooling over bespoke documentation pipelines.
