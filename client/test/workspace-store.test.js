import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceStoreWithAdapter,
} from '../src/local-first/workspace-store.js';

function createStore() {
  return createWorkspaceStoreWithAdapter(createMemoryWorkspaceAdapter());
}

test('acknowledgeOperation ignores stale op ids and keeps newer local edits queued', async () => {
  const store = createStore();

  await store.saveServerFileSnapshot({
    content: 'draft zero',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    revision: 'sha256:zero',
    updatedAt: '2026-03-17T10:00:00.000Z',
  });

  await store.saveLocalFileContent({
    content: 'draft one',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:01.000Z',
  });

  const firstOperation = await store.upsertPendingOperation({
    baseRevision: 'sha256:zero',
    filePath: 'notes/today.md',
    kind: 'patch',
    payload: {
      ops: [{ from: 6, text: 'one', to: 10, type: 'replace' }],
    },
    repoAlias: 'personal',
    targetContent: 'draft one',
    updatedAt: '2026-03-17T10:00:01.000Z',
  });

  await store.saveLocalFileContent({
    content: 'draft two',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:02.000Z',
  });

  const secondOperation = await store.upsertPendingOperation({
    baseRevision: 'sha256:zero',
    filePath: 'notes/today.md',
    kind: 'patch',
    payload: {
      ops: [{ from: 6, text: 'two', to: 10, type: 'replace' }],
    },
    repoAlias: 'personal',
    targetContent: 'draft two',
    updatedAt: '2026-03-17T10:00:02.000Z',
  });

  assert.equal(
    await store.acknowledgeOperation({
      content: 'draft one',
      filePath: 'notes/today.md',
      opId: firstOperation.opId,
      repoAlias: 'personal',
      revision: 'sha256:one',
    }),
    false,
  );

  assert.equal(await store.countPendingOperations(), 1);
  assert.equal(
    (
      await store.getPendingOperation('personal', 'notes/today.md')
    ).opId,
    secondOperation.opId,
  );

  assert.equal(
    await store.acknowledgeOperation({
      content: 'draft two',
      filePath: 'notes/today.md',
      opId: secondOperation.opId,
      repoAlias: 'personal',
      revision: 'sha256:two',
    }),
    true,
  );

  assert.equal(await store.countPendingOperations(), 0);

  const fileSnapshot = await store.getFileSnapshot('personal', 'notes/today.md');
  assert.equal(fileSnapshot.content, 'draft two');
  assert.equal(fileSnapshot.serverContent, 'draft two');
  assert.equal(fileSnapshot.revision, 'sha256:two');
});

test('saveServerFileSnapshot preserves newer local content while refreshing server revision', async () => {
  const store = createStore();

  await store.saveServerFileSnapshot({
    content: 'alpha',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    revision: 'sha256:alpha',
  });
  await store.saveLocalFileContent({
    content: 'beta',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
  });

  const fileSnapshot = await store.saveServerFileSnapshot({
    content: 'gamma',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    revision: 'sha256:gamma',
  });

  assert.equal(fileSnapshot.content, 'beta');
  assert.equal(fileSnapshot.serverContent, 'gamma');
  assert.equal(fileSnapshot.revision, 'sha256:gamma');
});

test('blocked conflicts are excluded from pending counts', async () => {
  const store = createStore();

  await store.saveServerFileSnapshot({
    content: 'alpha',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    revision: 'sha256:alpha',
  });
  await store.saveLocalFileContent({
    content: 'beta',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
  });
  await store.upsertPendingOperation({
    baseRevision: 'sha256:alpha',
    filePath: 'notes/today.md',
    kind: 'patch',
    payload: {
      ops: [{ from: 0, text: 'beta', to: 5, type: 'replace' }],
    },
    repoAlias: 'personal',
    targetContent: 'beta',
  });
  await store.blockOperationConflict('personal', 'notes/today.md', {
    currentRevision: 'sha256:server',
    path: 'notes/today.md',
  });

  assert.equal(await store.countPendingOperations(), 0);
  assert.equal(await store.countBlockedConflicts(), 1);
});

test('listKnownRepoAliases combines cached repo snapshots and pending operations', async () => {
  const store = createStore();

  await store.saveRepoSnapshot({
    repoAlias: 'personal',
    status: { lastSyncStatus: 'ready' },
    tree: { children: [], name: 'personal', path: '', type: 'directory' },
  });
  await store.upsertPendingOperation({
    filePath: 'todo.md',
    kind: 'legacy_full_content',
    payload: null,
    repoAlias: 'work',
    targetContent: '# todo',
  });

  assert.deepEqual(await store.listKnownRepoAliases(), ['personal', 'work']);
});
