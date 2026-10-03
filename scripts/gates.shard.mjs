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
 * the manifest's measured CI `seconds` (`shardWeight`): it lives beside the row
 * it describes, so re-measuring a gate re-balances the shards with no second
 * list to keep in step.
 *
 * Longest-first greedy: deterministic, within 4/3 of optimal, and it cannot
 * put the two heaviest gates in one shard.
 */
import { parseShardSpec } from './lib/shard.mjs';

/**
 * `--shard=1/2` → `{index: 1, total: 2}`; absent → null; anything else throws.
 *
 * The FLAG's grammar is this runner's; what `i/n` means is everyone's, so the
 * pair itself is parsed by lib/shard.mjs. A shard that cannot exist must be
 * loud either way: silently running nothing is how a sharded CI job goes green
 * having tested nothing at all.
 */
export function parseShard(arg) {
  if (arg === undefined || arg === null) return null;
  const match = /^--shard=(.+)$/.exec(arg);
  if (!match) throw new Error(`bad --shard: ${arg} (expected --shard=<index>/<total>, 1-based)`);
  return parseShardSpec(match[1], `--shard=${match[1]}`);
}

/**
 * The names belonging to one shard, in the order they were given.
 *
 * @param {readonly string[]} names  every gate in the set
 * @param {{index: number, total: number}} shard  1-based
 * @param {(name: string) => number} weight  how long the gate is expected to take
 * @param {{ isolated?: readonly string[], serialGroup?: (name: string) => string | undefined }} [options]
 *   `isolated`: names that share one bin, alone, whenever another bin remains.
 *   `serialGroup`: gates of one group run one at a time even across a runner's servers
 *   (scripts/gates.mjs), so two in one bin add up rather than overlap: each goes to the lightest bin
 *   that holds no other member of its group, while one exists.
 * @returns {string[]}
 */
export function shardOf(names, { index, total }, weight, { isolated = [], serialGroup = () => undefined } = {}) {
  if (total === 1) return [...names];
  const bins = Array.from({ length: total }, () => ({ load: 0, names: new Set() }));
  // Gates whose first attempt loses races under a neighbour's browser load share ONE runner, alone:
  // scripts/gates.mjs runs a set made only of them on one server, one at a time (gates.servers.mjs
  // `serversFor`), so they never meet each other's load either. The other bins hold every ordinary gate.
  const exclusive = [...new Set(isolated)].filter(name => names.includes(name));
  for (const name of exclusive) {
    bins[0].names.add(name);
    bins[0].load += weight(name);
  }
  const shared = exclusive.length > 0 ? bins.slice(1) : bins;
  // Heaviest first, name as the tie-break so the split never depends on the
  // order the filesystem happened to hand back.
  const ordered = names.filter(name => !exclusive.includes(name)).sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const lightestOf = (bins) => bins.reduce((min, bin) => (bin.load < min.load ? bin : min), bins[0]);
  for (const name of ordered) {
    const group = serialGroup(name);
    const apart = group === undefined ? shared : shared.filter((bin) => ![...bin.names].some((other) => serialGroup(other) === group));
    const lightest = lightestOf(apart.length > 0 ? apart : shared);
    lightest.names.add(name);
    lightest.load += weight(name);
  }
  // Filtered from the original order, so a shard's own run order is the set's.
  return names.filter((name) => bins[index - 1].names.has(name));
}
