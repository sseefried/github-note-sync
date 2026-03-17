function normalizeRepoAlias(repoAlias) {
  return typeof repoAlias === 'string' ? repoAlias.trim() : '';
}

export function getRepoAliasFromPathname(pathname = '/') {
  const [firstSegment = ''] = String(pathname ?? '')
    .split('/')
    .filter(Boolean);

  try {
    return normalizeRepoAlias(decodeURIComponent(firstSegment));
  } catch {
    return '';
  }
}

export function buildRepoPath(repoAlias = '') {
  const normalizedAlias = normalizeRepoAlias(repoAlias);
  return normalizedAlias ? `/${encodeURIComponent(normalizedAlias)}` : '/';
}

export function resolveInitialRepoAlias({
  lastOpenedRepoAlias = '',
  pathnameAlias = '',
  repoAliases = [],
}) {
  const normalizedPathnameAlias = normalizeRepoAlias(pathnameAlias);
  const normalizedLastOpenedRepoAlias = normalizeRepoAlias(lastOpenedRepoAlias);
  const normalizedRepoAliases = [...new Set(repoAliases.map(normalizeRepoAlias).filter(Boolean))];

  if (
    normalizedPathnameAlias !== '' &&
    normalizedRepoAliases.includes(normalizedPathnameAlias)
  ) {
    return normalizedPathnameAlias;
  }

  if (
    normalizedPathnameAlias === '' &&
    normalizedLastOpenedRepoAlias !== '' &&
    normalizedRepoAliases.includes(normalizedLastOpenedRepoAlias)
  ) {
    return normalizedLastOpenedRepoAlias;
  }

  return '';
}
