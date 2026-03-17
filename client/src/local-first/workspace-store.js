const DATABASE_NAME = 'github-note-sync-local-first';
const DATABASE_VERSION = 1;
const STORE_REPOS = 'repos';
const STORE_FILES = 'files';
const STORE_WRITES = 'writes';
const STORE_NAMES = [STORE_REPOS, STORE_FILES, STORE_WRITES];

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

function createWriteId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFileRecordId(repoAlias, filePath) {
  return `${normalizeRepoAlias(repoAlias)}:${normalizeFilePath(filePath)}`;
}

function comparePendingWrites(left, right) {
  const timestampComparison = String(left.updatedAt).localeCompare(String(right.updatedAt));

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return left.id.localeCompare(right.id);
}

export function createPendingWrite({
  content,
  filePath,
  repoAlias,
  updatedAt = makeTimestamp(),
  writeId = createWriteId(),
}) {
  const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
  const normalizedFilePath = normalizeFilePath(filePath);

  return {
    content,
    id: createFileRecordId(normalizedRepoAlias, normalizedFilePath),
    path: normalizedFilePath,
    repoAlias: normalizedRepoAlias,
    updatedAt,
    writeId,
  };
}

export function upsertPendingWriteRecords(existingWrites, nextWrite) {
  return [...existingWrites.filter((write) => write.id !== nextWrite.id), nextWrite].sort(
    comparePendingWrites,
  );
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
  const stores = new Map(
    STORE_NAMES.map((storeName) => [storeName, new Map()]),
  );

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
      const key =
        storeName === STORE_REPOS ? value.repoAlias : value.id;
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
    return recordId.includes(':') ? adapter.get(STORE_FILES, recordId) : null;
  }

  async function saveFileSnapshot({
    content,
    filePath,
    origin = 'server',
    repoAlias,
    updatedAt = makeTimestamp(),
  }) {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const normalizedFilePath = normalizeFilePath(filePath);

    if (!normalizedRepoAlias || !normalizedFilePath) {
      return null;
    }

    const record = {
      content,
      id: createFileRecordId(normalizedRepoAlias, normalizedFilePath),
      origin,
      path: normalizedFilePath,
      repoAlias: normalizedRepoAlias,
      updatedAt,
    };

    await adapter.put(STORE_FILES, record);
    return record;
  }

  async function getPendingWrite(repoAlias, filePath) {
    const recordId = createFileRecordId(repoAlias, filePath);
    return recordId.includes(':') ? adapter.get(STORE_WRITES, recordId) : null;
  }

  async function listPendingWrites(repoAlias = '') {
    const normalizedRepoAlias = normalizeRepoAlias(repoAlias);
    const pendingWrites = await adapter.list(STORE_WRITES);

    return pendingWrites
      .filter((pendingWrite) =>
        normalizedRepoAlias === '' ? true : pendingWrite.repoAlias === normalizedRepoAlias,
      )
      .sort(comparePendingWrites);
  }

  async function countPendingWrites(repoAlias = '') {
    return (await listPendingWrites(repoAlias)).length;
  }

  async function queueWrite({
    content,
    filePath,
    repoAlias,
    updatedAt = makeTimestamp(),
  }) {
    const pendingWrite = createPendingWrite({
      content,
      filePath,
      repoAlias,
      updatedAt,
    });

    if (!pendingWrite.repoAlias || !pendingWrite.path) {
      return null;
    }

    await Promise.all([
      adapter.put(STORE_WRITES, pendingWrite),
      saveFileSnapshot({
        content,
        filePath: pendingWrite.path,
        origin: 'local',
        repoAlias: pendingWrite.repoAlias,
        updatedAt,
      }),
      rememberSelectedPath(pendingWrite.repoAlias, pendingWrite.path),
    ]);

    return pendingWrite;
  }

  async function acknowledgeWrite({
    content,
    filePath,
    repoAlias,
    writeId,
  }) {
    const currentPendingWrite = await getPendingWrite(repoAlias, filePath);

    if (!currentPendingWrite || currentPendingWrite.writeId !== writeId) {
      return false;
    }

    await Promise.all([
      adapter.delete(STORE_WRITES, currentPendingWrite.id),
      saveFileSnapshot({
        content,
        filePath: currentPendingWrite.path,
        origin: 'server',
        repoAlias: currentPendingWrite.repoAlias,
      }),
    ]);

    return true;
  }

  async function listKnownRepoAliases() {
    const [repoSnapshots, fileSnapshots, pendingWrites] = await Promise.all([
      adapter.list(STORE_REPOS),
      adapter.list(STORE_FILES),
      adapter.list(STORE_WRITES),
    ]);

    return [...new Set([
      ...repoSnapshots.map((entry) => entry.repoAlias),
      ...fileSnapshots.map((entry) => entry.repoAlias),
      ...pendingWrites.map((entry) => entry.repoAlias),
    ])]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  async function clearAll() {
    await Promise.all(STORE_NAMES.map((storeName) => adapter.clear(storeName)));
  }

  return {
    acknowledgeWrite,
    clearAll,
    countPendingWrites,
    dispose() {
      adapter.close?.();
    },
    getFileSnapshot,
    getPendingWrite,
    getRepoSnapshot,
    listKnownRepoAliases,
    listPendingWrites,
    queueWrite,
    rememberSelectedPath,
    saveFileSnapshot,
    saveRepoSnapshot,
  };
}

export async function createWorkspaceStore() {
  return createWorkspaceStoreWithAdapter(await createWorkspaceAdapter());
}
