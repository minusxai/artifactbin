/** Refill a bounded offline preparation slot as soon as its previous artifact completes. */
export async function runMigrationBoundedWork<T>(
  items: readonly T[],
  limit: number,
  operation: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8)
    throw Error("Invalid migration work bound");
  let cursor = 0,
    failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          await operation(items[index]!, index);
        } catch (error) {
          failed = true;
          failure = error;
          return;
        }
      }
    }),
  );
  if (failed) throw failure;
}
