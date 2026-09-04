/**
 * SHARDING THE GATE SET ACROSS RUNNERS.
 *
 * The set already fans out over SERVERS inside one machine, and that took it
 * from ~25 minutes to ~3. The remaining floor is the machine: four workers on
 * four vCPUs, 40 gates, 192s. To go below that the set has to run on more than
 * one runner, which means splitting it — and a split by index would be
 * arbitrary, because the gates are not the same size (app-flows 75s against
 * annotations 9s).
 *
 * So the split is BALANCED by the weight the manifest already records.
 * `timeoutMs` is derived from each gate's measured seconds and kept beside
 * every row, so it is a real duration estimate that is updated whenever a gate
 * is re-measured — there is no second list to keep in step.
 *
 * Longest-first greedy, which is deterministic and within 4/3 of optimal:
 * every gate lands in exactly one shard, and the heaviest gate never decides
 * the split alone.
 */
import { describe, it, expect } from 'vitest';
import { GATE_SPECS } from '../gates.manifest.mjs';
import { parseShard, shardOf } from '../gates.shard.mjs';

const NAMES = GATE_SPECS.map((s) => s.name);
const weight = (name) => GATE_SPECS.find((s) => s.name === name).timeoutMs;

describe('parseShard', () => {
  it('reads i/n', () => {
    expect(parseShard('--shard=1/2')).toEqual({ index: 1, total: 2 });
    expect(parseShard('--shard=3/3')).toEqual({ index: 3, total: 3 });
  });
  it('is absent when the flag is', () => {
    expect(parseShard(undefined)).toBeNull();
  });
  it('refuses a shard that cannot exist, rather than silently running nothing', () => {
    for (const bad of ['--shard=0/2', '--shard=3/2', '--shard=1/0', '--shard=x/2', '--shard=1', '--shard=-1/2'])
      expect(() => parseShard(bad), bad).toThrow();
  });
});

describe('shardOf', () => {
  it('is the whole set when there is one shard', () => {
    expect(shardOf(NAMES, { index: 1, total: 1 }, weight)).toEqual(NAMES);
  });

  it.each([2, 3, 4])('covers every gate exactly once across %i shards', (total) => {
    const seen = [];
    for (let index = 1; index <= total; index++) seen.push(...shardOf(NAMES, { index, total }, weight));
    expect(seen.slice().sort()).toEqual(NAMES.slice().sort());
    expect(new Set(seen).size).toBe(NAMES.length);
  });

  it('balances by weight rather than by count', () => {
    // The check that matters: the heaviest shard is close to the mean, so a
    // sharded run is bounded by the balance and not by one unlucky split.
    const totals = [1, 2].map((index) =>
      shardOf(NAMES, { index, total: 2 }, weight).reduce((sum, n) => sum + weight(n), 0),
    );
    const mean = (totals[0] + totals[1]) / 2;
    expect(Math.max(...totals)).toBeLessThanOrEqual(mean * 1.25);
  });

  it('is deterministic — the same shard twice is the same list', () => {
    expect(shardOf(NAMES, { index: 1, total: 3 }, weight)).toEqual(shardOf(NAMES, { index: 1, total: 3 }, weight));
  });

  it('puts the heaviest gate in the lightest shard first, so no shard is left holding two giants', () => {
    const heaviest = [...NAMES].sort((a, b) => weight(b) - weight(a)).slice(0, 2);
    const first = shardOf(NAMES, { index: 1, total: 2 }, weight);
    expect(first.includes(heaviest[0])).toBe(true);
    expect(first.includes(heaviest[1])).toBe(false);
  });
});
