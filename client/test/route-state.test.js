import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepoPath,
  getFilePathFromPathname,
  getRepoAliasFromPathname,
  parseRepoRoute,
  resolveInitialRepoAlias,
} from '../src/local-first/route-state.js';

test('parseRepoRoute decodes repo alias and readable file path routes', () => {
  assert.deepEqual(parseRepoRoute('/personal-notes'), {
    filePath: '',
    repoAlias: 'personal-notes',
  });
  assert.deepEqual(parseRepoRoute('/personal-notes/file/notes/today.md'), {
    filePath: 'notes/today.md',
    repoAlias: 'personal-notes',
  });
  assert.deepEqual(parseRepoRoute('/notes%2F2026/file/drafts/hello%20world.md'), {
    filePath: 'drafts/hello world.md',
    repoAlias: 'notes/2026',
  });
});

test('getRepoAliasFromPathname and getFilePathFromPathname read the current route parts', () => {
  assert.equal(getRepoAliasFromPathname('/personal-notes/file/notes/today.md'), 'personal-notes');
  assert.equal(getFilePathFromPathname('/personal-notes/file/notes/today.md'), 'notes/today.md');
  assert.equal(getRepoAliasFromPathname('/'), '');
  assert.equal(getFilePathFromPathname('/'), '');
});

test('buildRepoPath encodes repo aliases and per-segment file paths for routing', () => {
  assert.equal(buildRepoPath('personal-notes'), '/personal-notes');
  assert.equal(buildRepoPath('notes/2026'), '/notes%2F2026');
  assert.equal(
    buildRepoPath('personal-notes', 'drafts/hello world.md'),
    '/personal-notes/file/drafts/hello%20world.md',
  );
  assert.equal(buildRepoPath(''), '/');
});

test('resolveInitialRepoAlias restores the last opened alias on the root route', () => {
  assert.equal(
    resolveInitialRepoAlias({
      lastOpenedRepoAlias: 'work',
      pathnameAlias: '',
      repoAliases: ['personal', 'work'],
    }),
    'work',
  );
});

test('resolveInitialRepoAlias does not override an explicit unknown route', () => {
  assert.equal(
    resolveInitialRepoAlias({
      lastOpenedRepoAlias: 'work',
      pathnameAlias: 'missing',
      repoAliases: ['personal', 'work'],
    }),
    '',
  );
});
