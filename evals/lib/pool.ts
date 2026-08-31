/**
 * Run an async map with a ceiling on how many are in flight.
 *
 * A leg's tasks are independent — each has its own workspace, its own start
 * document and (since the ledger became per-task) its own proxy — so the only
 * reason to run them one at a time was that they shared a ledger attributed by
 * wall clock. They no longer do, and a leg's wall time is now its LONGEST task
 * rather than the sum of all of them.
 *
 * Results keep the INPUT's order however the work interleaves: a verdict is
 * matched to its task by index.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
