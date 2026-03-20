import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFetchedFileSync } from '../src/local-first/file-sync.js';

test('classifyFetchedFileSync adopts the server version when nothing is cached yet', () => {
  assert.equal(
    classifyFetchedFileSync({
      cachedSnapshot: null,
      nextContent: 'alpha',
      nextRevision: 'sha256:alpha',
    }),
    'adopt_remote',
  );
});

test('classifyFetchedFileSync keeps local content for dirty files', () => {
  assert.equal(
    classifyFetchedFileSync({
      cachedSnapshot: {
        content: 'alpha local',
        revision: 'sha256:alpha',
        serverContent: 'alpha',
      },
      nextContent: 'alpha remote',
      nextRevision: 'sha256:remote',
    }),
    'keep_local',
  );
});

test('classifyFetchedFileSync keeps local content when the server revision matches cache', () => {
  assert.equal(
    classifyFetchedFileSync({
      cachedSnapshot: {
        content: 'alpha',
        revision: 'sha256:alpha',
        serverContent: 'alpha',
      },
      nextContent: 'alpha',
      nextRevision: 'sha256:alpha',
    }),
    'keep_local',
  );
});

test('classifyFetchedFileSync prompts before adopting a newer clean server version', () => {
  assert.equal(
    classifyFetchedFileSync({
      cachedSnapshot: {
        content: 'alpha',
        revision: 'sha256:alpha',
        serverContent: 'alpha',
      },
      nextContent: 'alpha remote',
      nextRevision: 'sha256:remote',
    }),
    'prompt_remote_adopt',
  );
});

test('classifyFetchedFileSync can explicitly allow immediate adoption', () => {
  assert.equal(
    classifyFetchedFileSync({
      allowImmediateAdopt: true,
      cachedSnapshot: {
        content: 'alpha',
        revision: 'sha256:alpha',
        serverContent: 'alpha',
      },
      nextContent: 'alpha remote',
      nextRevision: 'sha256:remote',
    }),
    'adopt_remote',
  );
});
