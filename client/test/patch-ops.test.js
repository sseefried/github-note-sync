import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplacePatchOperations } from '../src/local-first/patch-ops.js';

function applyPatchOperations(content, patchOps) {
  let cursor = 0;
  let nextContent = '';

  for (const patchOp of patchOps) {
    nextContent += content.slice(cursor, patchOp.from);
    nextContent += patchOp.text;
    cursor = patchOp.to;
  }

  return nextContent + content.slice(cursor);
}

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
