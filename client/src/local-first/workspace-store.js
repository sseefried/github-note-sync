const DATABASE_NAME = 'github-note-sync-local-first';
const DATABASE_VERSION = 1;
const STORE_REPOS = 'repos';
const STORE_FILES = 'files';
const STORE_WRITES = 'writes';
const STORE_NAMES = [STORE_REPOS, STORE_FILES, STORE_WRITES];

const SYNC_LOG_ENABLED =
  typeof import.meta !== 'undefined' &&
  import.meta?.env?.VITE_SYNC_LOG === '1';

function syncLog(event, fields = {}) {
  if (!SYNC_LOG_ENABLED || typeof fetch !== 'function') {
    return;
  }

  try {
    fetch('/api/client-log', {
      body: JSON.stringify({ event, fields }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    }).catch(() => {});
  } catch {}
}

function shortId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '-';
  }
  return value.slice(0, 8);
}

function shortRev(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '-';
  }
  return value.slice(0, 10);
}

export { syncLog, shortId, shortRev };

function normalizeRepoAlias(repoAlias) {
  return typeof repoAlias === 'string' ? repoAlias.trim() : '';
}

function normalizeFilePath(filePath) {
  return typeof filePath === 'string'
    ? filePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    : '';
}

function makeTimestamp() {
  return new Date().toISOString();
}

function createOperationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFileRecordId(repoAlias, filePath) {
  return `${normalizeRepoAlias(repoAlias)}:${normalizeFilePath(filePath)}`;
}

function compareOperations(left, right) {
  const timestampComparison = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function normalizeLegacyFileSnapshot(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  if (typeof record.serverContent === 'string') {
    return record;
  }

  return {
    ...record,
    content: typeof record.content === 'string' ? record.content : '',
    revision: typeof record.revision === 'string' ? record.revision : null,
    serverContent: typeof record.content === 'string' ? record.content : '',
  };
}

function normalizeLegacyPendingOperation(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  if (typeof record.kind === 'string') {
    return record;
  }

  if (
    typeof record.content === 'string' &&
    typeof record.path === 'string' &&
    typeof record.repoAlias === 'string'
  ) {
    return {
      attemptCount: Number.isInteger(record.attemptCount) ? record.attemptCount : 0,
      baseCommit: typeof record.baseCommit === 'string' ? record.baseCommit : null,
      baseRevision: typeof record.baseRevision === 'string' ? record.baseRevision : null,
      createdAt: typeof record.updatedAt === 'string' ? record.updatedAt : makeTimestamp(),
      id: createFileRecordId(record.repoAlias, record.path),
      kind: 'legacy_full_content',
      lastError:
        typeof record.lastError === 'string' && record.lastError.trim() !== ''
          ? record.lastError
          : 'This cached write predates revision tracking. Refresh the file before syncing again.',
      opId:
        typeof record.writeId === 'string' && record.writeId.trim() !== ''
          ? record.writeId
          : createOperationId(),
      path: record.path,
      payload: null,
      repoAlias: record.repoAlias,
      status: 'blocked_invalid',
      targetContent: record.content,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : makeTimestamp(),
    };
  }

  return record;
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_REPOS)) {
        database.createObjectStore(STORE_REPOS, { keyPath: 'repoAlias' });
      }

      if (!database.objectStoreNames.contains(STORE_FILES)) {
        database.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains(STORE_WRITES)) {
        database.createObjectStore(STORE_WRITES, { keyPath: 'id' });
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB.'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function createIndexedDbAdapter(database) {
  function runTransaction(storeName, mode, executor) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = executor(store);

      transaction.oncomplete = () => {
        resolve(request?.result);
      };

      transaction.onerror = () => {
        reject(transaction.error ?? request?.error ?? new Error(`Failed ${mode} transaction.`));
      };

      transaction.onabort = () => {
        reject(transaction.error ?? request?.error ?? new Error(`Aborted ${mode} transaction.`));
      };
    });
  }

  return {
    async clear(storeName) {
      await runTransaction(storeName, 'readwrite', (store) => store.clear());
    },
    close() {
      database.close();
    },
    async delete(storeName, key) {
      await runTransaction(storeName, 'readwrite', (store) => store.delete(key));
    },
    async get(storeName, key) {
      return runTransaction(storeName, 'readonly', (store) => store.get(key));
    },
    async list(storeName) {
      return runTransaction(storeName, 'readonly', (store) => store.getAll());
    },
    async put(storeName, value) {
      await runTransaction(storeName, 'readwrite', (store) => store.put(value));
    },
  };
}

export function createMemoryWorkspaceAdapter() {
  const stores = new Map(STORE_NAMES.map((storeName) => [storeName, new Map()]));

  return {
    async clear(storeName) {
      stores.get(storeName)?.clear();
    },
    close() {},
    async delete(storeName, key) {
      stores.get(storeName)?.delete(key);
    },
    async get(storeName, key) {
      return stores.get(storeName)?.get(key) ?? null;
    },
    async list(storeName) {
      return [...(stores.get(storeName)?.values() ?? [])];
    },
    async put(storeName, value) {
      const key = storeName === STORE_REPOS ? value.repoAlias : value.id;
      stores.get(storeName)?.set(key, value);
    },
  };
}

async function createWorkspaceAdapter() {
  if (typeof globalThis.indexedDB === 'undefined') {
    return createMemoryWorkspaceAdapter();
  }

  try {
    const database = await openIndexedDb();
    return createIndexedDbAdapter(database);
  } catch {
    return createMemoryWorkspaceAdapter();
  }
}

export function createWorkspaceStoreWithAdapter(adapter) {
  async function getRepoSnapshot(repoAlias) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);

    if (!normalizedRepoAlias) {
      return null;
    }

    return adapter.get(STORE_REPOS, normalizedRepoAlias);
  }

  async function saveRepoSnapshot({
    headRevision,
    repoAlias,
    selectedPath,
    status,
    tree,
    updatedAt = makeTimestamp(),
  }) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);

    if (!normalizedRepoAlias) {
      return null;
    }

    const currentSnapshot = await getRepoSnapshot(normalizedRepoAlias);
    const nextSnapshot = {
      headRevision:
        typeof headRevision === 'string' ? headRevision : currentSnapshot?.headRevision ?? null,
      repoAlias: normalizedRepoAlias,
      selectedPath:
        typeof selectedPath === 'string'
          ? normalizeFilePath(selectedPath)
          : selectedPath === null
            ? null
            : currentSnapshot?.selectedPath ?? null,
      status: status ?? currentSnapshot?.status ?? null,
      tree: tree ?? currentSnapshot?.tree ?? null,
      updatedAt,
    };

    await adapter.put(STORE_REPOS, nextSnapshot);
    return nextSnapshot;
  }

  async function rememberSelectedPath(repoAlias, selectedPath) {
    return saveRepoSnapshot({
      repoAlias,
      selectedPath,
    });
  }

  async function getFileSnapshot(repoAlias, filePath) {
    const recordId = createFileRecordId(repoAlias, filePath);
    const record = recordId.includes(':') ? await adapter.get(STORE_FILES, recordId) : null;
    return normalizeLegacyFileSnapshot(record);
  }

  async function saveServerFileSnapshot({
    advanceBase = false,
    content,
    filePath,
    preserveLocalContent = false,
    repoAlias,
    revision,
    updatedAt = makeTimestamp(),
  }) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const normalizedFilePath = normalizeFilePath(filePath);

    if (!normalizedRepoAlias || !normalizedFilePath || typeof content !== 'string') {
      return null;
    }

    const currentSnapshot = await getFileSnapshot(normalizedRepoAlias, normalizedFilePath);
    const hasLocalChanges =
      currentSnapshot &&
      currentSnapshot.content !== currentSnapshot.serverContent;
    const shouldAdvanceBase = advanceBase || !hasLocalChanges;

    const nextSnapshot = {
      content:
        shouldAdvanceBase && !preserveLocalContent
          ? content
          : currentSnapshot?.content ?? content,
      id: createFileRecordId(normalizedRepoAlias, normalizedFilePath),
      path: normalizedFilePath,
      repoAlias: normalizedRepoAlias,
      revision:
        shouldAdvanceBase && typeof revision === 'string'
          ? revision
          : currentSnapshot?.revision ?? null,
      serverContent:
        shouldAdvanceBase
          ? content
          : typeof currentSnapshot?.serverContent === 'string'
            ? currentSnapshot.serverContent
            : currentSnapshot?.content ?? content,
      updatedAt,
    };

    syncLog('saveServerFileSnapshot', {
      path: normalizedFilePath,
      advanceBase,
      preserveLocalContent,
      hadLocalChanges: Boolean(hasLocalChanges),
      shouldAdvanceBase,
      prevRev: shortRev(currentSnapshot?.revision),
      nextRev: shortRev(nextSnapshot.revision),
      prevServerLen: currentSnapshot?.serverContent?.length ?? 0,
      nextServerLen: nextSnapshot.serverContent?.length ?? 0,
      contentLen: nextSnapshot.content?.length ?? 0,
    });
    await adapter.put(STORE_FILES, nextSnapshot);
    return nextSnapshot;
  }

  async function saveLocalFileContent({
    content,
    filePath,
    repoAlias,
    updatedAt = makeTimestamp(),
  }) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const normalizedFilePath = normalizeFilePath(filePath);

    if (!normalizedRepoAlias || !normalizedFilePath || typeof content !== 'string') {
      return null;
    }

    const currentSnapshot = await getFileSnapshot(normalizedRepoAlias, normalizedFilePath);
    const nextSnapshot = {
      content,
      id: createFileRecordId(normalizedRepoAlias, normalizedFilePath),
      path: normalizedFilePath,
      repoAlias: normalizedRepoAlias,
      revision: currentSnapshot?.revision ?? null,
      serverContent:
        typeof currentSnapshot?.serverContent === 'string'
          ? currentSnapshot.serverContent
          : currentSnapshot?.content ?? '',
      updatedAt,
    };

    syncLog('saveLocalFileContent', {
      path: normalizedFilePath,
      contentLen: content.length,
      revision: shortRev(nextSnapshot.revision),
      serverLen: nextSnapshot.serverContent?.length ?? 0,
      dirty: nextSnapshot.content !== nextSnapshot.serverContent,
    });
    await adapter.put(STORE_FILES, nextSnapshot);
    return nextSnapshot;
  }

  async function getPendingOperation(repoAlias, filePath) {
    const recordId = createFileRecordId(repoAlias, filePath);
    const record = recordId.includes(':') ? await adapter.get(STORE_WRITES, recordId) : null;
    return normalizeLegacyPendingOperation(record);
  }

  async function upsertPendingOperation({
    baseCommit,
    baseRevision,
    filePath,
    kind,
    lastError = '',
    opId = createOperationId(),
    payload,
    repoAlias,
    status = 'pending',
    targetContent,
    updatedAt = makeTimestamp(),
  }) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const normalizedFilePath = normalizeFilePath(filePath);

    if (!normalizedRepoAlias || !normalizedFilePath || typeof kind !== 'string') {
      return null;
    }

    const currentOperation = await getPendingOperation(normalizedRepoAlias, normalizedFilePath);
    const nextOperation = {
      attemptCount:
        currentOperation?.status === 'pending' && currentOperation.opId === opId
          ? currentOperation.attemptCount
          : 0,
      baseCommit: typeof baseCommit === 'string' ? baseCommit : currentOperation?.baseCommit ?? null,
      baseRevision: typeof baseRevision === 'string' ? baseRevision : null,
      createdAt: currentOperation?.createdAt ?? updatedAt,
      id: createFileRecordId(normalizedRepoAlias, normalizedFilePath),
      kind,
      lastError,
      opId,
      path: normalizedFilePath,
      payload,
      repoAlias: normalizedRepoAlias,
      status,
      targetContent: typeof targetContent === 'string' ? targetContent : '',
      updatedAt,
    };

    syncLog('upsertPendingOperation', {
      path: normalizedFilePath,
      prevOpId: shortId(currentOperation?.opId),
      nextOpId: shortId(opId),
      baseRev: shortRev(nextOperation.baseRevision),
      status,
      targetLen: nextOperation.targetContent.length,
    });
    await adapter.put(STORE_WRITES, nextOperation);
    return nextOperation;
  }

  async function markOperationSent(repoAlias, filePath, updatedAt = makeTimestamp()) {
    const currentOperation = await getPendingOperation(repoAlias, filePath);

    if (!currentOperation) {
      return null;
    }

    const nextOperation = {
      ...currentOperation,
      attemptCount: (currentOperation.attemptCount ?? 0) + 1,
      lastError: '',
      status: 'sent',
      updatedAt,
    };

    await adapter.put(STORE_WRITES, nextOperation);
    return nextOperation;
  }

  async function markOperationError(repoAlias, filePath, { lastError, status = 'sent' } = {}) {
    const currentOperation = await getPendingOperation(repoAlias, filePath);

    if (!currentOperation) {
      return null;
    }

    const nextOperation = {
      ...currentOperation,
      lastError: typeof lastError === 'string' ? lastError : currentOperation.lastError ?? '',
      status,
      updatedAt: makeTimestamp(),
    };

    await adapter.put(STORE_WRITES, nextOperation);
    return nextOperation;
  }

  async function blockOperationConflict(repoAlias, filePath, conflict) {
    const currentOperation = await getPendingOperation(repoAlias, filePath);

    if (!currentOperation) {
      return null;
    }

    const nextOperation = {
      ...currentOperation,
      conflict: conflict ?? null,
      lastError: 'Conflict detected.',
      status: 'blocked_conflict',
      updatedAt: makeTimestamp(),
    };

    await adapter.put(STORE_WRITES, nextOperation);
    return nextOperation;
  }

  async function clearPendingOperation(repoAlias, filePath) {
    const recordId = createFileRecordId(repoAlias, filePath);

    if (!recordId.includes(':')) {
      return;
    }

    await adapter.delete(STORE_WRITES, recordId);
  }

  async function acknowledgeOperation({
    content,
    filePath,
    opId,
    repoAlias,
    revision,
  }) {
    const currentOperation = await getPendingOperation(repoAlias, filePath);
    const currentSnapshot = await getFileSnapshot(repoAlias, filePath);

    if (!currentOperation || currentOperation.opId !== opId) {
      syncLog('acknowledgeOperation.stale', {
        path: normalizeFilePath(filePath),
        ackOpId: shortId(opId),
        currentOpId: shortId(currentOperation?.opId),
        revision: shortRev(revision),
      });
      await saveServerFileSnapshot({
        advanceBase: true,
        content,
        filePath,
        preserveLocalContent: true,
        repoAlias,
        revision,
      });
      return false;
    }

    const preserveLocalContent =
      typeof currentSnapshot?.content === 'string' &&
      currentSnapshot.content !== currentOperation.targetContent;

    syncLog('acknowledgeOperation.match', {
      path: currentOperation.path,
      opId: shortId(opId),
      revision: shortRev(revision),
      preserveLocalContent,
    });
    await Promise.all([
      clearPendingOperation(repoAlias, filePath),
      saveServerFileSnapshot({
        advanceBase: true,
        content,
        filePath: currentOperation.path,
        preserveLocalContent,
        repoAlias: currentOperation.repoAlias,
        revision,
      }),
    ]);

    return true;
  }

  async function listPendingOperations(repoAlias = '') {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const operations = await adapter.list(STORE_WRITES);

    return operations
      .map((entry) => normalizeLegacyPendingOperation(entry))
      .filter(Boolean)
      .filter((operation) =>
        normalizedRepoAlias === '' ? true : operation.repoAlias === normalizedRepoAlias,
      )
      .sort(compareOperations);
  }

  async function countPendingOperations(repoAlias = '') {
    return (
      await listPendingOperations(repoAlias)
    ).filter((operation) => operation.status === 'pending' || operation.status === 'sent').length;
  }

  async function countBlockedConflicts(repoAlias = '') {
    return (
      await listPendingOperations(repoAlias)
    ).filter((operation) => operation.status === 'blocked_conflict').length;
  }

  async function listKnownRepoAliases() {
    const [repoSnapshots, fileSnapshots, pendingOperations] = await Promise.all([
      adapter.list(STORE_REPOS),
      adapter.list(STORE_FILES),
      adapter.list(STORE_WRITES),
    ]);

    return [...new Set([
      ...repoSnapshots.map((entry) => entry.repoAlias),
      ...fileSnapshots.map((entry) => entry.repoAlias),
      ...pendingOperations.map((entry) => normalizeLegacyPendingOperation(entry)?.repoAlias),
    ])]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  async function clearAll() {
    await Promise.all(STORE_NAMES.map((storeName) => adapter.clear(storeName)));
  }

  async function clearRepoAliasData(repoAlias) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);

    if (!normalizedRepoAlias) {
      return;
    }

    const [fileSnapshots, pendingOperations] = await Promise.all([
      adapter.list(STORE_FILES),
      adapter.list(STORE_WRITES),
    ]);
    const normalizedPendingOperations = pendingOperations
      .map((entry) => normalizeLegacyPendingOperation(entry))
      .filter(Boolean);

    await Promise.all([
      adapter.delete(STORE_REPOS, normalizedRepoAlias),
      ...fileSnapshots
        .filter((entry) => entry?.repoAlias === normalizedRepoAlias && typeof entry?.id === 'string')
        .map((entry) => adapter.delete(STORE_FILES, entry.id)),
      ...normalizedPendingOperations
        .filter((entry) => entry.repoAlias === normalizedRepoAlias && typeof entry.id === 'string')
        .map((entry) => adapter.delete(STORE_WRITES, entry.id)),
    ]);
  }

  return {
    acknowledgeOperation,
    blockOperationConflict,
    clearAll,
    clearRepoAliasData,
    clearPendingOperation,
    countBlockedConflicts,
    countPendingOperations,
    dispose() {
      adapter.close?.();
    },
    getFileSnapshot,
    getPendingOperation,
    getRepoSnapshot,
    listKnownRepoAliases,
    listPendingOperations,
    markOperationError,
    markOperationSent,
    rememberSelectedPath,
    saveLocalFileContent,
    saveRepoSnapshot,
    saveServerFileSnapshot,
    upsertPendingOperation,
  };
}

export async function createWorkspaceStore() {
  return createWorkspaceStoreWithAdapter(await createWorkspaceAdapter());
}
