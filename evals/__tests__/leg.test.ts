/**
 * A run is ONE leg, described entirely on the command line.
 *
 * This repo deliberately knows nothing about which harnesses or models are being
 * compared, or what the sets are called — that is a deployment concern, and the
 * report merges N run directories without knowing why there are N. minusx draws
 * the line in the same place: the word "leg" appears only in its deploys
 * workflow, never in the app repo.
 */
import { describe, it, expect } from 'vitest';
import { legFromArgs } from '../lib/leg';
import { parseArgs } from '../lib/args';

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
