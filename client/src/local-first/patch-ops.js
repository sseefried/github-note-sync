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
