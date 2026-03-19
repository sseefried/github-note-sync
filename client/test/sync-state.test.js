import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyncState } from '../src/local-first/sync-state.js';

test('deriveSyncState surfaces blocked conflicts before normal sync progress', () => {
  const syncState = deriveSyncState({
    blockedConflictCount: 2,
    connectivity: 'online',
    pendingOperationCount: 1,
  });

  assert.equal(syncState.badgeStatus, 'conflict');
  assert.match(syncState.detail, /2 conflicts need manual resolution/i);
});

test('deriveSyncState surfaces offline local edits first', () => {
  const syncState = deriveSyncState({
    connectivity: 'offline',
    pendingOperationCount: 2,
  });

  assert.equal(syncState.badgeStatus, 'offline');
  assert.match(syncState.detail, /2 local edits waiting to sync/);
});

test('deriveSyncState reports queued local edits while online', () => {
  const syncState = deriveSyncState({
    connectivity: 'online',
    pendingOperationCount: 1,
    status: { lastSyncStatus: 'ready' },
  });

  assert.equal(syncState.badgeStatus, 'pending_local');
  assert.equal(syncState.badgeLabel, 'Local');
});

test('deriveSyncState treats dirty server status as a local pending state', () => {
  const syncState = deriveSyncState({
    connectivity: 'online',
    pendingOperationCount: 0,
    status: {
      lastSyncMessage: 'Unsynced edits in journal.md.',
      lastSyncStatus: 'dirty',
    },
  });

  assert.equal(syncState.badgeStatus, 'pending_local');
  assert.equal(syncState.badgeLabel, 'Local');
  assert.equal(syncState.detail, 'Unsynced edits in journal.md.');
});

test('deriveSyncState falls back to the last known synced server state', () => {
  const syncState = deriveSyncState({
    connectivity: 'online',
    pendingOperationCount: 0,
    status: {
      lastSyncMessage: 'Pushed local edits to origin/main.',
      lastSyncStatus: 'pushed',
    },
  });

  assert.equal(syncState.badgeStatus, 'pushed');
  assert.equal(syncState.detail, 'Pushed local edits to origin/main.');
});
