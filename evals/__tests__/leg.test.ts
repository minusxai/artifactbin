import {describe,it,expect} from 'vitest';
import {legFromArgs} from '../lib/leg';
import {parseArgs,USAGE} from '../lib/args';
import {costUsd,taskCost} from '../lib/price';

/**
 * A run is ONE leg, described entirely on the command line.
 *
 * This repo deliberately knows nothing about which harnesses or models are being
 * compared, or what the sets are called — that is a deployment concern, and the
 * report merges N run directories without knowing why there are N. minusx draws
 * the line in the same place: the word "leg" appears only in its deploys
 * workflow, never in the app repo.
 */

const base = ['--harness', 'pi', '--model', 'fireworks/accounts/fireworks/models/deepseek-v4-flash-0731', '--api-key-env', 'FIREWORKS_API_KEY'];

describe('legFromArgs', () => {
  it('builds the leg from flags, labelling it by harness when nothing else is given', () => {
    const leg = legFromArgs(parseArgs(base), { FIREWORKS_API_KEY: 'fw-secret' });
    expect(leg).toMatchObject({ harness: 'pi', apiKey: 'fw-secret', label: 'pi' });
    expect(leg.model).toContain('deepseek-v4-flash-0731');
  });

  it('takes an explicit label — the report column\'s name comes from the caller', () => {
    expect(legFromArgs(parseArgs([...base, '--label', 'pi · deepseek-v4-flash']), { FIREWORKS_API_KEY: 'k' }).label)
      .toBe('pi · deepseek-v4-flash');
  });

  it('carries prices when given, and reports no cost rather than a wrong one when not', () => {
    const priced = legFromArgs(parseArgs([...base, '--price-in=0.22', '--price-out=0.66']), { FIREWORKS_API_KEY: 'k' });
    expect(priced.price).toEqual({ in: 0.22, out: 0.66 });
    expect(legFromArgs(parseArgs(base), { FIREWORKS_API_KEY: 'k' }).price).toBeNull();
  });

  it('takes the published cache rates when a provider has them', () => {
    const leg = legFromArgs(parseArgs([...base, '--price-in=15', '--price-out=75', '--price-cache-read=1.5', '--price-cache-write=18.75']), { FIREWORKS_API_KEY: 'k' });
    expect(leg.price).toEqual({ in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 });
  });

  it('marks a text-only model, so the prompt says not to fetch the rendered PNG', () => {
    expect(legFromArgs(parseArgs([...base, '--no-vision']), { FIREWORKS_API_KEY: 'k' }).vision).toBe(false);
    expect(legFromArgs(parseArgs(base), { FIREWORKS_API_KEY: 'k' }).vision).toBe(true);
  });

  it('reads the key by the NAME given, and fails naming the variable — never echoing a value', () => {
    expect(() => legFromArgs(parseArgs(base), {})).toThrow(/FIREWORKS_API_KEY/);
    expect(() => legFromArgs(parseArgs(base), { FIREWORKS_API_KEY: '' })).toThrow(/FIREWORKS_API_KEY/);
  });

  it('refuses an unknown harness, naming the ones that exist', () => {
    expect(() => legFromArgs(parseArgs(['--harness', 'nope', '--model', 'm', '--api-key-env', 'K']), { K: 'k' }))
      .toThrow(/unknown harness "nope".*claude-code/);
  });

  it('requires harness, model and key name — a partial leg is a usage error, not a default', () => {
    expect(() => legFromArgs(parseArgs(['--model', 'm', '--api-key-env', 'K']), { K: 'k' })).toThrow(/--harness/);
    expect(() => legFromArgs(parseArgs(['--harness', 'pi', '--api-key-env', 'K']), { K: 'k' })).toThrow(/--model/);
    expect(() => legFromArgs(parseArgs(['--harness', 'pi', '--model', 'm']), {})).toThrow(/--api-key-env/);
  });
});

describe('--help', () => {
  it('is a request for the usage, not an unknown argument', () => {
    for (const flag of ['--help', '-h']) expect(parseArgs([flag]).help).toBe(true);
    expect(USAGE).toMatch(/^usage: npm run eval -- /);
    for (const flag of ['--harness', '--model', '--api-key-env', '--shard', '--tasks', '--ci'])
      expect(USAGE, flag).toContain(flag);
  });
});

describe('pricing a leg', () => {
  describe('costUsd', () => {
    it('prices input and output per 1M; cache reads/writes default to the INPUT rate (no discount)', () => {
      const cost = costUsd({ input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 1_000_000 }, { in: 2, out: 10 });
      expect(cost).toBe(12);
      expect(costUsd({ input: 500_000, cacheRead: 250_000, cacheWrite: 250_000, output: 0 }, { in: 2, out: 10 })).toBe(2);
    });
    it('uses the leg\'s published cache rates when given — a Claude Code turn is mostly cache reads at 10%', () => {
      const tokens = { input: 0, cacheRead: 1_000_000, cacheWrite: 100_000, output: 0 };
      expect(costUsd(tokens, { in: 15, out: 75 })).toBe(16.5);
      expect(costUsd(tokens, { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 })).toBe(3.375);
    });
    it('rounds to 6 decimals so small runs do not collapse to 0', () => {
      expect(costUsd({ input: 2, cacheRead: 0, cacheWrite: 1646, output: 4 }, { in: 15, out: 75 })).toBe(0.025020);
    });
    it('is null when the harness gave no telemetry', () => {
      expect(costUsd(null, { in: 1, out: 1 })).toBeNull();
    });
  });

  /**
   * The cost CELL: the harness's own figure when it reports one, else our tokens × rates.
   * Three of four harnesses price their own runs against the provider they are native to —
   * Claude Code's figure matched ours to 0.1%, Pi's matched LiteLLM's table to the cent — and
   * the one that does not (Codex) is priced from OpenAI's published rates, including the
   * per-call web-search fee no usage object carries.
   */
  describe('taskCost', () => {
    const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 };
    const price = { in: 2, out: 12, cacheRead: 0.2, cacheWrite: 2.5, webSearchCall: 0.01 };

    it('takes the harness\'s own figure first, even when rates were given', () => {
      expect(taskCost({ reportedCostUsd: 0.09, tokens, webSearchCalls: 5 }, price)).toEqual({ usd: 0.09, source: 'harness' });
      // OpenCode sums per-step floats: 0.013478160000000001 is a real figure, and the cell is a number not a float dump.
      expect(taskCost({ reportedCostUsd: 0.013478160000000001, tokens, webSearchCalls: null }, null)).toEqual({ usd: 0.013478, source: 'harness' });
    });
    it('otherwise prices tokens at the leg\'s rates plus the per-call web-search fee', () => {
      expect(taskCost({ reportedCostUsd: null, tokens, webSearchCalls: 96 }, price)).toEqual({ usd: 2.96, source: 'priced' });
      expect(taskCost({ reportedCostUsd: null, tokens, webSearchCalls: null }, price)).toEqual({ usd: 2, source: 'priced' });
    });
    it('is unknown — never 0 — with neither a figure nor rates, or with no tokens to price', () => {
      expect(taskCost({ reportedCostUsd: null, tokens, webSearchCalls: 0 }, null)).toEqual({ usd: null, source: null });
      expect(taskCost({ reportedCostUsd: null, tokens: null, webSearchCalls: 0 }, price)).toEqual({ usd: null, source: null });
    });
  });
});
