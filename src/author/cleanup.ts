/** Drain every owned cleanup, including when an untrusted component cleanup throws. */
export function drainAuthorCleanups(cleanups: Array<() => void>): void {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0))
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length)
    throw new AggregateError(failures, "Author cleanup failed");
}
