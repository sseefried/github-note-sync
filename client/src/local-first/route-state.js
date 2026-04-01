function normalizeRepoAlias(repoAlias) {
  return typeof repoAlias === 'string' ? repoAlias.trim() : '';
}

function normalizeFilePath(filePath) {
  return typeof filePath === 'string'
    ? filePath
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join('/')
    : '';
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

export function parseRepoRoute(pathname = '/') {
  const segments = String(pathname ?? '')
    .split('/')
    .filter(Boolean);
  const repoAlias = normalizeRepoAlias(decodePathSegment(segments[0] ?? ''));

  if (repoAlias === '') {
    return {
      filePath: '',
      repoAlias: '',
    };
  }

  if (segments[1] !== 'file') {
    return {
      filePath: '',
      repoAlias,
    };
  }

  return {
    filePath: normalizeFilePath(segments.slice(2).map(decodePathSegment).join('/')),
    repoAlias,
  };
}

export function getRepoAliasFromPathname(pathname = '/') {
  return parseRepoRoute(pathname).repoAlias;
}

export function getFilePathFromPathname(pathname = '/') {
  return parseRepoRoute(pathname).filePath;
}

export function buildRepoPath(repoAlias = '', filePath = '') {
  const normalizedAlias = normalizeRepoAlias(repoAlias);

  if (!normalizedAlias) {
    return '/';
  }

  const normalizedFilePath = normalizeFilePath(filePath);

  if (!normalizedFilePath) {
    return `/${encodeURIComponent(normalizedAlias)}`;
  }

  return `/${encodeURIComponent(normalizedAlias)}/file/${normalizedFilePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
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
