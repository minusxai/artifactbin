/**
 * ONE SHARD-SPEC PARSER. `i/n`, 1-based, the shape every CI matrix writes.
 *
 * Two runners divide work here — the gate set (`scripts/gates.shard.mjs`) and
 * the eval task set (`evals/lib/task-set.ts`) — and each used to parse the
 * spec itself. A shard that cannot exist has to be LOUD: a sharded CI job that
 * silently selects nothing goes green having tested nothing at all, which is
 * the failure both copies were written to prevent and neither could guarantee
 * for the other.
 *
 * Only the spec is shared. How a runner is TOLD the spec (a `--shard=` flag, a
 * matrix value) and what it does with the two numbers (weighted bin packing,
 * round-robin) stay with the runner.
 *
 * @param {string} spec  e.g. `"2/3"`
 * @param {string} [label]  how the caller names the spec in its error text
 * @returns {{index: number, total: number}}
 */
export function parseShardSpec(spec, label = 'shard') {
  const match = /^(\d+)\/(\d+)$/.exec(String(spec).trim());
  if (!match) throw new Error(`${label} must be written i/n (got "${spec}")`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1) throw new Error(`${label} ${spec}: total must be at least 1`);
  if (index < 1 || index > total) throw new Error(`${label} ${spec}: index must be within 1..${total}`);
  return { index, total };
}
