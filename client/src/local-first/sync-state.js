function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function deriveSyncState({
  connectivity = 'online',
  pendingWriteCount = 0,
  repoError = '',
  syncingWrites = false,
  status = null,
}) {
  if (repoError) {
    return {
      badgeStatus: 'remote_error',
      badgeLabel: 'Remote',
      detail: repoError,
    };
  }

  if (connectivity === 'offline') {
    return {
      badgeStatus: 'offline',
      badgeLabel: 'Offline',
      detail:
        pendingWriteCount > 0
          ? `${pluralize(pendingWriteCount, 'local edit')} waiting to sync.`
          : 'Offline. Cached notes remain editable.',
    };
  }

  if (connectivity === 'degraded') {
    return {
      badgeStatus: 'remote_error',
      badgeLabel: 'Remote',
      detail:
        pendingWriteCount > 0
          ? `${pluralize(pendingWriteCount, 'local edit')} waiting for the server.`
          : 'The server is unreachable right now.',
    };
  }

  if (syncingWrites) {
    return {
      badgeStatus: 'syncing',
      badgeLabel: 'Syncing',
      detail:
        pendingWriteCount > 0
          ? `Syncing ${pluralize(pendingWriteCount, 'local edit')}.`
          : status?.lastSyncMessage ?? 'Syncing with the server.',
    };
  }

  if (pendingWriteCount > 0) {
    return {
      badgeStatus: 'pending_local',
      badgeLabel: 'Local',
      detail: `${pluralize(pendingWriteCount, 'local edit')} queued for sync.`,
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
