import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceStoreWithAdapter,
} from '../src/local-first/workspace-store.js';

function createStore() {
  return createWorkspaceStoreWithAdapter(createMemoryWorkspaceAdapter());
}

test('queueWrite persists the latest content and keeps one pending record per file', async () => {
  const store = createStore();

  const firstWrite = await store.queueWrite({
    content: 'alpha',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:00.000Z',
  });

  const secondWrite = await store.queueWrite({
    content: 'beta',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:01.000Z',
  });

  const pendingWrite = await store.getPendingWrite('personal', 'notes/today.md');
  const fileSnapshot = await store.getFileSnapshot('personal', 'notes/today.md');

  assert.notEqual(firstWrite.writeId, secondWrite.writeId);
  assert.equal(await store.countPendingWrites(), 1);
  assert.equal(pendingWrite.content, 'beta');
  assert.equal(fileSnapshot.content, 'beta');
  assert.equal(fileSnapshot.origin, 'local');
});

test('acknowledgeWrite ignores stale write ids and keeps newer local edits queued', async () => {
  const store = createStore();

  const firstWrite = await store.queueWrite({
    content: 'draft one',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:00.000Z',
  });

  const secondWrite = await store.queueWrite({
    content: 'draft two',
    filePath: 'notes/today.md',
    repoAlias: 'personal',
    updatedAt: '2026-03-17T10:00:01.000Z',
  });

  assert.equal(
    await store.acknowledgeWrite({
      content: firstWrite.content,
      filePath: 'notes/today.md',
      repoAlias: 'personal',
      writeId: firstWrite.writeId,
    }),
    false,
  );

  assert.equal(await store.countPendingWrites(), 1);
  assert.equal(
    (
      await store.getPendingWrite('personal', 'notes/today.md')
    ).content,
    'draft two',
  );

  assert.equal(
    await store.acknowledgeWrite({
      content: secondWrite.content,
      filePath: 'notes/today.md',
      repoAlias: 'personal',
      writeId: secondWrite.writeId,
    }),
    true,
  );

  assert.equal(await store.countPendingWrites(), 0);
  assert.equal(
    (
      await store.getFileSnapshot('personal', 'notes/today.md')
    ).origin,
    'server',
  );
});

test('listKnownRepoAliases combines cached repo snapshots and queued writes', async () => {
  const store = createStore();

  await store.saveRepoSnapshot({
    repoAlias: 'personal',
    status: { lastSyncStatus: 'ready' },
    tree: { children: [], name: 'personal', path: '', type: 'directory' },
  });
  await store.queueWrite({
    content: '# todo',
    filePath: 'todo.md',
    repoAlias: 'work',
  });

  assert.deepEqual(await store.listKnownRepoAliases(), ['personal', 'work']);
});
