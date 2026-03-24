import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appMachineReducer,
  buildResolutionState,
  createInitialAppMachineState,
  deriveFilePhase,
  deriveWorkspacePhase,
} from '../src/state-machine/app-machine.js';

test('deriveWorkspacePhase distinguishes none, hydrating, ready, and unavailable', () => {
  assert.equal(
    deriveWorkspacePhase({ hasActiveRepoAlias: false, loading: false }),
    'none',
  );
  assert.equal(
    deriveWorkspacePhase({ hasActiveRepoAlias: true, loading: true }),
    'hydrating',
  );
  assert.equal(
    deriveWorkspacePhase({ error: '', hasActiveRepoAlias: true, loading: false }),
    'ready',
  );
  assert.equal(
    deriveWorkspacePhase({ error: 'Offline.', hasActiveRepoAlias: true, loading: false }),
    'unavailable',
  );
});

test('deriveFilePhase distinguishes none, loading, and ready', () => {
  assert.equal(deriveFilePhase({ loading: false, path: null }), 'none');
  assert.equal(deriveFilePhase({ loading: true, path: 'notes/today.md' }), 'loading');
  assert.equal(deriveFilePhase({ loading: false, path: 'notes/today.md' }), 'ready');
});

test('createInitialAppMachineState nests workspace-owned slices', () => {
  const initialState = createInitialAppMachineState();

  assert.deepEqual(initialState.workspace.file, {
    content: '',
    debugBaseCommit: null,
    path: null,
    phase: 'none',
    saveError: '',
  });
  assert.deepEqual(initialState.workspace.interaction, {
    phase: 'browsing',
    resolution: null,
  });
  assert.deepEqual(initialState.workspace.replica, {
    blockedConflictCount: 0,
    pendingOperationCount: 0,
  });
  assert.deepEqual(initialState.workspace.sync, {
    phase: 'idle',
  });
});

test('buildResolutionState prefers reload prompts over fast-forward and conflicts', () => {
  const interaction = buildResolutionState({
    fastForward: { strategy: 'preserve_local_and_replay', path: 'a.md', repoAlias: 'notes' },
    reloadPrompt: { path: 'b.md', repoAlias: 'notes' },
    selectedConflict: { opId: '1', path: 'c.md', repoAlias: 'notes' },
  });

  assert.deepEqual(interaction, {
    phase: 'resolving',
    resolution: {
      busy: false,
      kind: 'reload_from_server',
      prompt: { path: 'b.md', repoAlias: 'notes' },
    },
  });
});

test('buildResolutionState preserves busy state for the same prompt identity', () => {
  const currentInteraction = {
    phase: 'resolving',
    resolution: {
      busy: true,
      kind: 'merge_with_remote',
      prompt: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
    },
  };

  const nextInteraction = buildResolutionState(
    {
      selectedConflict: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
    },
    currentInteraction,
  );

  assert.deepEqual(nextInteraction, {
    phase: 'resolving',
    resolution: {
      busy: true,
      kind: 'merge_with_remote',
      prompt: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
    },
  });
});

test('reducer clears busy when the resolution prompt is cleared', () => {
  const initialState = {
    ...createInitialAppMachineState(),
    workspace: {
      ...createInitialAppMachineState().workspace,
      interaction: {
        phase: 'resolving',
        resolution: {
          busy: true,
          kind: 'fast_forward',
          prompt: { strategy: 'preserve_local_and_replay', path: 'todo.md', repoAlias: 'notes' },
        },
      },
    },
  };

  const nextState = appMachineReducer(initialState, {
    type: 'RESOLUTION_SET',
    resolution: buildResolutionState({}, initialState.workspace.interaction),
  });

  assert.deepEqual(nextState.workspace.interaction, {
    phase: 'browsing',
    resolution: null,
  });
});

test('reducer writes file, sync, and replica state inside workspace', () => {
  const initialState = createInitialAppMachineState();

  const afterFilePatch = appMachineReducer(initialState, {
    type: 'FILE_PATCH',
    patch: { path: 'notes/today.md', phase: 'ready' },
  });
  const afterSyncPatch = appMachineReducer(afterFilePatch, {
    type: 'SYNC_SET_PHASE',
    phase: 'syncing',
  });
  const afterReplicaPatch = appMachineReducer(afterSyncPatch, {
    type: 'REPLICA_PATCH',
    patch: { blockedConflictCount: 2, pendingOperationCount: 3 },
  });

  assert.equal(afterReplicaPatch.workspace.file.path, 'notes/today.md');
  assert.equal(afterReplicaPatch.workspace.file.phase, 'ready');
  assert.equal(afterReplicaPatch.workspace.sync.phase, 'syncing');
  assert.deepEqual(afterReplicaPatch.workspace.replica, {
    blockedConflictCount: 2,
    pendingOperationCount: 3,
  });
});
