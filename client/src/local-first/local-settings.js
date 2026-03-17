const LAST_OPENED_REPO_ALIAS_KEY = 'github-note-sync.local-first.last-opened-repo-alias';
const CACHED_REPO_ALIASES_KEY = 'github-note-sync.local-first.repo-aliases';
const CACHED_SESSION_STATE_KEY = 'github-note-sync.local-first.session-state';

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key, fallbackValue) {
  const storage = getStorage();

  if (!storage) {
    return fallbackValue;
  }

  try {
    const rawValue = storage.getItem(key);
    return rawValue === null ? fallbackValue : JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

function writeJson(key, value) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {}
}

function removeValue(key) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {}
}

export function getLastOpenedRepoAlias() {
  const value = readJson(LAST_OPENED_REPO_ALIAS_KEY, '');
  return typeof value === 'string' ? value.trim() : '';
}

export function setLastOpenedRepoAlias(repoAlias) {
  const normalizedAlias = typeof repoAlias === 'string' ? repoAlias.trim() : '';

  if (normalizedAlias === '') {
    removeValue(LAST_OPENED_REPO_ALIAS_KEY);
    return;
  }

  writeJson(LAST_OPENED_REPO_ALIAS_KEY, normalizedAlias);
}

export function getCachedRepoAliases() {
  const value = readJson(CACHED_REPO_ALIASES_KEY, []);
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

export function setCachedRepoAliases(repoAliases) {
  const normalizedAliases = Array.isArray(repoAliases)
    ? [...new Set(repoAliases.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))]
    : [];

  writeJson(CACHED_REPO_ALIASES_KEY, normalizedAliases);
}

export function getCachedSessionState() {
  const value = readJson(CACHED_SESSION_STATE_KEY, null);

  if (!value || typeof value !== 'object') {
    return null;
  }

  return value;
}

export function setCachedSessionState(sessionState) {
  if (!sessionState || typeof sessionState !== 'object') {
    removeValue(CACHED_SESSION_STATE_KEY);
    return;
  }

  writeJson(CACHED_SESSION_STATE_KEY, sessionState);
}

export function clearLocalFirstSettings() {
  removeValue(LAST_OPENED_REPO_ALIAS_KEY);
  removeValue(CACHED_REPO_ALIASES_KEY);
  removeValue(CACHED_SESSION_STATE_KEY);
}
