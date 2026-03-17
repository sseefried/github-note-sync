import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyncState } from '../src/local-first/sync-state.js';

test('deriveSyncState surfaces offline local edits first', () => {
  const syncState = deriveSyncState({
    connectivity: 'offline',
    pendingWriteCount: 2,
  });

  assert.equal(syncState.badgeStatus, 'offline');
  assert.match(syncState.detail, /2 local edits waiting to sync/);
});

test('deriveSyncState reports queued local edits while online', () => {
  const syncState = deriveSyncState({
    connectivity: 'online',
    pendingWriteCount: 1,
    status: { lastSyncStatus: 'ready' },
  });

  assert.equal(syncState.badgeStatus, 'pending_local');
  assert.equal(syncState.badgeLabel, 'Local');
});

test('deriveSyncState falls back to the last known synced server state', () => {
  const syncState = deriveSyncState({
    connectivity: 'online',
    pendingWriteCount: 0,
    status: {
      lastSyncMessage: 'Pushed local edits to origin/main.',
      lastSyncStatus: 'pushed',
    },
  });

  assert.equal(syncState.badgeStatus, 'pushed');
  assert.equal(syncState.detail, 'Pushed local edits to origin/main.');
});
