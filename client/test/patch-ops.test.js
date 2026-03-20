import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatchOperations,
  createReplacePatchOperations,
  tryRebaseNonOverlappingChanges,
} from '../src/local-first/patch-ops.js';

test('createReplacePatchOperations returns no ops when the content is unchanged', () => {
  assert.deepEqual(createReplacePatchOperations('alpha', 'alpha'), []);
});

test('createReplacePatchOperations generates a valid single replace span for inserts, deletes, and replacements', () => {
  const cases = [
    ['alpha', 'alpha beta'],
    ['alpha beta', 'alpha'],
    ['alpha beta', 'alpha gamma'],
  ];

  for (const [baseContent, nextContent] of cases) {
    const patchOps = createReplacePatchOperations(baseContent, nextContent);

    assert.equal(patchOps.length, 1);
    assert.equal(patchOps[0].type, 'replace');
    assert.equal(applyPatchOperations(baseContent, patchOps), nextContent);
  }
});

test('createReplacePatchOperations collapses multi-span edits into one ordered replace operation', () => {
  const baseContent = 'abc123xyz';
  const nextContent = 'abZ123Qyz';
  const patchOps = createReplacePatchOperations(baseContent, nextContent);

  assert.equal(patchOps.length, 1);
  assert.equal(patchOps[0].type, 'replace');
  assert.ok(patchOps[0].from <= patchOps[0].to);
  assert.equal(applyPatchOperations(baseContent, patchOps), nextContent);
});

test('tryRebaseNonOverlappingChanges reapplies local edits onto newer remote content', () => {
  const result = tryRebaseNonOverlappingChanges(
    'alpha\nbeta\ngamma\n',
    'alpha\nbeta local\ngamma\n',
    'alpha\nbeta\ngamma\nremote tail\n',
  );

  assert.ok(result);
  assert.equal(result.mergedContent, 'alpha\nbeta local\ngamma\nremote tail\n');
});

test('tryRebaseNonOverlappingChanges rejects overlapping local and remote edits', () => {
  const result = tryRebaseNonOverlappingChanges(
    'alpha\nbeta\ngamma\n',
    'alpha\nbeta local\ngamma\n',
    'alpha\nbeta remote\ngamma\n',
  );

  assert.equal(result, null);
});

test('tryRebaseNonOverlappingChanges rejects same-position inserts', () => {
  const result = tryRebaseNonOverlappingChanges('alpha', 'alpha local', 'alpha remote');

  assert.equal(result, null);
});
