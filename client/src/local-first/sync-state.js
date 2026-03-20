function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function deriveSyncState({
  blockedConflictCount = 0,
  connectivity = 'online',
  pendingOperationCount,
  pendingWriteCount = 0,
  repoError = '',
  syncingOperations,
  syncingWrites = false,
  status = null,
}) {
  const localPendingCount =
    typeof pendingOperationCount === 'number' ? pendingOperationCount : pendingWriteCount;
  const localSyncing = typeof syncingOperations === 'boolean' ? syncingOperations : syncingWrites;

  if (repoError) {
    return {
      badgeStatus: 'remote_error',
      badgeLabel: 'Remote',
      detail: repoError,
    };
  }

  if (blockedConflictCount > 0) {
    return {
      badgeStatus: 'conflict',
      badgeLabel: 'Conflict',
      detail: `${pluralize(blockedConflictCount, 'conflict')} waiting for confirmation before a merged version is created.`,
    };
  }

  if (connectivity === 'offline') {
    return {
      badgeStatus: 'offline',
      badgeLabel: 'Offline',
      detail:
        localPendingCount > 0
          ? `${pluralize(localPendingCount, 'local edit')} waiting to sync.`
          : 'Offline. Cached notes remain editable.',
    };
  }

  if (connectivity === 'degraded') {
    return {
      badgeStatus: 'remote_error',
      badgeLabel: 'Remote',
      detail:
        localPendingCount > 0
          ? `${pluralize(localPendingCount, 'local edit')} waiting for the server.`
          : 'The server is unreachable right now.',
    };
  }

  if (localSyncing) {
    return {
      badgeStatus: 'syncing',
      badgeLabel: 'Syncing',
      detail:
        localPendingCount > 0
          ? `Syncing ${pluralize(localPendingCount, 'local edit')}.`
          : status?.lastSyncMessage ?? 'Syncing with the server.',
    };
  }

  if (localPendingCount > 0) {
    return {
      badgeStatus: 'pending_local',
      badgeLabel: 'Local',
      detail: `${pluralize(localPendingCount, 'local edit')} queued for sync.`,
    };
  }

  if (status?.lastSyncStatus === 'dirty') {
    return {
      badgeStatus: 'pending_local',
      badgeLabel: 'Local',
      detail: status?.lastSyncMessage ?? 'Local edits are waiting to sync.',
    };
  }

  if (status?.lastSyncStatus === 'error' || status?.lastSyncStatus === 'overwritten') {
    return {
      badgeStatus: 'remote_error',
      badgeLabel: 'Remote',
      detail: status?.lastSyncMessage ?? 'The server reported a sync problem.',
    };
  }

  if (status?.lastSyncStatus === 'starting') {
    return {
      badgeStatus: 'starting',
      badgeLabel: 'Starting',
      detail: status?.lastSyncMessage ?? 'Preparing the workspace.',
    };
  }

  return {
    badgeStatus: 'pushed',
    badgeLabel: 'Synced',
    detail: status?.lastSyncMessage ?? 'Local cache matches the last known server state.',
  };
}
