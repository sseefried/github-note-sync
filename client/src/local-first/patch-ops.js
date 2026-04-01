export function createReplacePatchOperations(baseContent, nextContent) {
  if (baseContent === nextContent) {
    return [];
  }

  const normalizedBaseContent = typeof baseContent === 'string' ? baseContent : '';
  const normalizedNextContent = typeof nextContent === 'string' ? nextContent : '';
  const sharedPrefixLengthLimit = Math.min(
    normalizedBaseContent.length,
    normalizedNextContent.length,
  );
  let start = 0;

  while (
    start < sharedPrefixLengthLimit &&
    normalizedBaseContent[start] === normalizedNextContent[start]
  ) {
    start += 1;
  }

  let baseEnd = normalizedBaseContent.length;
  let nextEnd = normalizedNextContent.length;

  while (
    baseEnd > start &&
    nextEnd > start &&
    normalizedBaseContent[baseEnd - 1] === normalizedNextContent[nextEnd - 1]
  ) {
    baseEnd -= 1;
    nextEnd -= 1;
  }

  return [
    {
      from: start,
      text: normalizedNextContent.slice(start, nextEnd),
      to: baseEnd,
      type: 'replace',
    },
  ];
}

export function applyPatchOperations(content, patchOps) {
  let cursor = 0;
  let nextContent = '';

  for (const patchOp of patchOps) {
    nextContent += content.slice(cursor, patchOp.from);
    nextContent += patchOp.text;
    cursor = patchOp.to;
  }

  return nextContent + content.slice(cursor);
}

function rangesOverlap(left, right) {
  if (left.from === left.to && right.from === right.to) {
    return left.from === right.from;
  }

  if (left.from === left.to) {
    return left.from >= right.from && left.from <= right.to;
  }

  if (right.from === right.to) {
    return right.from >= left.from && right.from <= left.to;
  }

  return left.from < right.to && right.from < left.to;
}

export function tryRebaseNonOverlappingChanges(baseContent, localContent, remoteContent) {
  const localPatchOps = createReplacePatchOperations(baseContent, localContent);
  const remotePatchOps = createReplacePatchOperations(baseContent, remoteContent);

  if (localPatchOps.length === 0) {
    return {
      mergedContent: remoteContent,
      localPatchOps,
      remotePatchOps,
    };
  }

  if (remotePatchOps.length === 0) {
    return {
      mergedContent: localContent,
      localPatchOps,
      remotePatchOps,
    };
  }

  const [localPatch] = localPatchOps;
  const [remotePatch] = remotePatchOps;

  if (rangesOverlap(localPatch, remotePatch)) {
    return null;
  }

  let rebasedLocalPatch = localPatch;

  if (remotePatch.to <= localPatch.from) {
    const remoteDelta = remotePatch.text.length - (remotePatch.to - remotePatch.from);
    rebasedLocalPatch = {
      ...localPatch,
      from: localPatch.from + remoteDelta,
      to: localPatch.to + remoteDelta,
    };
  }

  return {
    mergedContent: applyPatchOperations(remoteContent, [rebasedLocalPatch]),
    localPatchOps,
    remotePatchOps,
  };
}
