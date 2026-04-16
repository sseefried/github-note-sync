# Debug logging for self-conflict diagnosis

The client and server can emit a structured trace of every local edit, every
pending-op upsert, every POST `/api/ops`, every acknowledgement, and every
server-side accept/conflict decision. All of it lands on the server machine's
stdout — no browser interaction required — so you can tail a single stream
and reconstruct the exact sequence that produced a 409.

The tracing is off by default. Two environment flags turn it on:

| Side | Flag | Where it is consumed |
| ---- | ---- | -------------------- |
| Server | `SYNC_LOG=1` | `server/server/git-service.js` (ops decisions), `server/server/index.js` (accepts browser-shipped log lines at `POST /api/client-log`). |
| Client (build) | `VITE_SYNC_LOG=1` | `client/src/local-first/workspace-store.js` — when set at build time, `syncLog` fires-and-forgets a POST to `/api/client-log` on every call. When unset, `syncLog` is a no-op and is dead-code-eliminated from the bundle. |

Both are independent: leaving `SYNC_LOG` off but `VITE_SYNC_LOG` on means
the server receives `POST /api/client-log` requests and silently drops them
with 204.

## Running in development

Two terminals on the same machine. Server:

```
SYNC_LOG=1 npm --prefix server start
```

Client (choose whichever matches your setup — dev server or built preview):

```
VITE_SYNC_LOG=1 npm --prefix client run dev -- --server-url=https://notes.example.com
# or
VITE_SYNC_LOG=1 npm --prefix client run build -- --server-url=https://notes.example.com
VITE_SYNC_LOG=1 npm --prefix client run start -- --server-url=https://notes.example.com
```

`VITE_SYNC_LOG` must be set during `vite build` for a preview/production
bundle — Vite bakes `import.meta.env.VITE_*` at build time, so setting it at
runtime for `vite preview` has no effect.

Tail the server's stdout. You will see two event streams interleaved:

- `[ops] recv|dedup|applied|converged|CONFLICT` — the server's decision for
  each inbound op.
- `[client] [sync] editor-change|saveLocalFileContent|upsertPendingOperation|
  send|send-ack|send-precheck-skip|conflict-received|acknowledgeOperation.*|
  saveServerFileSnapshot` — events shipped from the browser.

Every line carries an 8-character `opId` prefix and a `path` field so you can
`grep` for one op end-to-end.

## Enabling in the systemd user services

Both install scripts accept `--sync-log`. Pass it when installing or
reinstalling the services and the resulting systemd unit (server) and bundle
(client) will have the flag baked in.

**Server:**

```
./server/scripts/install-user-service.sh --sync-log
```

This writes `Environment=SYNC_LOG=1` into
`~/.config/systemd/user/github-note-sync-server.service`.

**Client:**

```
./client/scripts/install-user-service.sh \
  --server-url=https://notes.example.com \
  --sync-log
```

This sets `VITE_SYNC_LOG=1` during the bundle build. The flag is baked into
`dist/`; restarting the service is sufficient to pick it up.

Apply the changes:

```
systemctl --user daemon-reload
systemctl --user restart github-note-sync-server.service
systemctl --user restart github-note-sync-client.service
```

## Viewing the combined log

```
journalctl --user -u github-note-sync-server.service -f
```

That is the single stream containing both server-emitted `[ops]` lines and
browser-shipped `[client] [sync]` lines for any browser talking to this
server.

## Turning it off

Reinstall the services without `--sync-log`:

```
./server/scripts/install-user-service.sh
./client/scripts/install-user-service.sh --server-url=https://notes.example.com
systemctl --user daemon-reload
systemctl --user restart github-note-sync-server.service
systemctl --user restart github-note-sync-client.service
```

Verification:

```
systemctl --user show github-note-sync-server.service -p Environment
# Should NOT contain SYNC_LOG=1
```

The client bundle is simply rebuilt without the flag; the dead-code path is
removed by Vite's production minifier, so there is zero runtime cost.

## Event reference

| Event | Emitted by | Meaning |
| ----- | ---------- | ------- |
| `editor-change` | client | User typed; `updateEditorContent` entered. |
| `saveLocalFileContent` | client | Local editor content persisted to IndexedDB. Shows preserved `revision` and whether the file is dirty. |
| `upsertPendingOperation` | client | Pending op written. Shows `prevOpId → nextOpId`, `baseRev`, `status`, `targetLen`. |
| `send` | client | About to POST `/api/ops`. Shows the op's `baseRev` and patch-op count. |
| `send-ack` | client | Server responded. Shows `status` (applied / duplicate) and new revision. |
| `send-precheck-skip` | client | Pre-send guard re-read the snapshot and detected drift; re-prepared and skipped this send. Expected and benign unless paired with a later conflict. |
| `conflict-received` | client | Server returned 409. Shows op's expected base vs server's current revision and both content lengths. |
| `acknowledgeOperation.match` | client | Ack matched the pending op's `opId`. Snapshot base is advanced. |
| `acknowledgeOperation.stale` | client | Ack arrived after the pending op was replaced; snapshot advanced but pending op preserved. |
| `saveServerFileSnapshot` | client | Server-base snapshot write. `advanceBase`, `preserveLocalContent`, and the prev/next revisions are shown. |
| `[ops] recv` | server | Op received. Shows `baseRev`, `targetLen`, `patchOps`, and whether the `opId` was already recorded. |
| `[ops] dedup` | server | `opId` matched the dedup table and the file matches the recorded revision — returned `duplicate` without touching the working tree. |
| `[ops] applied` | server | Patch applied cleanly (base matched). |
| `[ops] converged` | server | Base mismatched but target already equals current — recorded as `duplicate`. |
| `[ops] CONFLICT` | server | 409 thrown. Shows `expectedBaseRev` vs `currentRev` and both content lengths. This is the signal to look for. |

## What to paste when reporting a self-conflict

1. The last ~50 lines of `journalctl --user -u github-note-sync-server.service`
   before and including an `[ops] CONFLICT` line.
2. A brief description of what you did in the browser (the sequence of edits
   that triggered the conflict).

The correlation by `opId` across `[client] [sync]` and `[ops]` lines is
enough to identify which path the offending op came from.
