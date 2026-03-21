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

test('buildResolutionState prefers reload prompts over fast-forward and conflicts', () => {
  const resolution = buildResolutionState({
    fastForward: { strategy: 'preserve_local_and_replay', path: 'a.md', repoAlias: 'notes' },
    reloadPrompt: { path: 'b.md', repoAlias: 'notes' },
    selectedConflict: { opId: '1', path: 'c.md', repoAlias: 'notes' },
  });

  assert.deepEqual(resolution, {
    busy: false,
    kind: 'reload_from_server',
    prompt: { path: 'b.md', repoAlias: 'notes' },
  });
});

test('buildResolutionState preserves busy state for the same prompt identity', () => {
  const currentResolution = {
      busy: true,
      kind: 'merge_with_remote',
      prompt: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
    };

  const nextResolution = buildResolutionState(
    {
      selectedConflict: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
    },
    currentResolution,
  );

  assert.deepEqual(nextResolution, {
    busy: true,
    kind: 'merge_with_remote',
    prompt: { opId: '123', path: 'todo.md', repoAlias: 'notes' },
  });
});

test('reducer clears busy when the resolution prompt is cleared', () => {
  const initialState = {
    ...createInitialAppMachineState(),
    resolution: {
      busy: true,
      kind: 'fast_forward',
      prompt: { strategy: 'preserve_local_and_replay', path: 'todo.md', repoAlias: 'notes' },
    },
  };

  const nextState = appMachineReducer(initialState, {
    type: 'RESOLUTION_SET',
    resolution: buildResolutionState({}),
  });

  assert.deepEqual(nextState.resolution, {
    busy: false,
    kind: 'none',
    prompt: null,
  });
});
