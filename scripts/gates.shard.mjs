/**
 * SPLITTING THE GATE SET ACROSS RUNNERS — the pure half, so it can be tested
 * without booting a server or a browser.
 *
 * The runner already fans out over SERVERS within one machine, which is what
 * took the set from ~25 minutes to ~3. Below that the machine itself is the
 * floor: four workers on four vCPUs. Going further means more than one runner,
 * and that means dividing the set.
 *
 * Dividing it BY INDEX would be arbitrary, because gates are not the same size
 * — app-flows runs 75s and annotations 9s — so an unlucky split leaves one
 * runner holding every slow gate and saves nothing. The weight used instead is
 * `timeoutMs` from the manifest: it is derived from each gate's measured
 * seconds and lives beside the row it describes, so re-measuring a gate
 * re-balances the shards with no second list to keep in step.
 *
 * Longest-first greedy: deterministic, within 4/3 of optimal, and it cannot
 * put the two heaviest gates in one shard.
 */

/** `--shard=1/2` → `{index: 1, total: 2}`; absent → null; anything else throws. */
export function parseShard(arg) {
  if (arg === undefined || arg === null) return null;
  const match = /^--shard=(\d+)\/(\d+)$/.exec(arg);
  if (!match) throw new Error(`bad --shard: ${arg} (expected --shard=<index>/<total>, 1-based)`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  // A shard that cannot exist must be loud. Silently running nothing is how a
  // sharded CI job goes green having tested nothing at all.
  if (total < 1) throw new Error(`bad --shard: ${arg} (total must be at least 1)`);
  if (index < 1 || index > total) throw new Error(`bad --shard: ${arg} (index must be within 1..${total})`);
  return { index, total };
}

/**
 * The names belonging to one shard, in the order they were given.
 *
 * @param {readonly string[]} names  every gate in the set
 * @param {{index: number, total: number}} shard  1-based
 * @param {(name: string) => number} weight  how long the gate is expected to take
 * @returns {string[]}
 */
export function shardOf(names, { index, total }, weight) {
  if (total === 1) return [...names];
  const bins = Array.from({ length: total }, () => ({ load: 0, names: new Set() }));
  // Heaviest first, name as the tie-break so the split never depends on the
  // order the filesystem happened to hand back.
  const ordered = [...names].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const name of ordered) {
    const lightest = bins.reduce((min, bin) => (bin.load < min.load ? bin : min), bins[0]);
    lightest.names.add(name);
    lightest.load += weight(name);
  }
  // Filtered from the original order, so a shard's own run order is the set's.
  return names.filter((name) => bins[index - 1].names.has(name));
}
