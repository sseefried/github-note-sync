import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepoPath,
  getRepoAliasFromPathname,
  resolveInitialRepoAlias,
} from '../src/local-first/route-state.js';

test('getRepoAliasFromPathname decodes the first path segment', () => {
  assert.equal(getRepoAliasFromPathname('/personal-notes'), 'personal-notes');
  assert.equal(getRepoAliasFromPathname('/notes%2F2026'), 'notes/2026');
  assert.equal(getRepoAliasFromPathname('/'), '');
});

test('buildRepoPath encodes repo aliases for routing', () => {
  assert.equal(buildRepoPath('personal-notes'), '/personal-notes');
  assert.equal(buildRepoPath('notes/2026'), '/notes%2F2026');
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
