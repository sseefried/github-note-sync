export function classifyFetchedFileSync({
  allowImmediateAdopt = false,
  cachedSnapshot,
  nextContent,
  nextRevision,
}) {
  if (allowImmediateAdopt || !cachedSnapshot) {
    return 'adopt_remote';
  }

  const hasLocalChanges = cachedSnapshot.content !== cachedSnapshot.serverContent;
  const matchesCachedServer =
    cachedSnapshot.revision === nextRevision && cachedSnapshot.serverContent === nextContent;
  const matchesCachedLocal = cachedSnapshot.content === nextContent;

  if (matchesCachedServer) {
    return 'keep_local';
  }

  if (matchesCachedLocal) {
    return 'adopt_remote';
  }

  if (hasLocalChanges) {
    return 'keep_local';
  }

  return 'prompt_remote_adopt';
}
