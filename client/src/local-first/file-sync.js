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

  if (matchesCachedServer || hasLocalChanges) {
    return 'keep_local';
  }

  return 'prompt_remote_adopt';
}
