/**
 * Both spellings of an option, because a workflow writes `--shard=${{ matrix.shard }}/2`
 * while a person types `--shard 2/2`, and only accepting one of them fails in CI at the
 * point where it costs a whole job to find out.
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../lib/args';

describe('parseArgs', () => {
  it('accepts the space form and the equals form alike', () => {
    expect(parseArgs(['--shard', '2/2']).shard).toBe('2/2');
    expect(parseArgs(['--shard=2/2']).shard).toBe('2/2');
    expect(parseArgs(['--harness=pi']).harness).toBe('pi');
    expect(parseArgs(['--api-key-env=FIREWORKS_API_KEY']).envVar).toBe('FIREWORKS_API_KEY');
    expect(parseArgs(['--harness', 'pi']).harness).toBe('pi');
    expect(parseArgs(['--label=pi · deepseek']).label).toBe('pi · deepseek');
    expect(parseArgs(['--tasks=scrolly,report']).tasks).toEqual(['scrolly', 'report']);
    // The isolation flag exists FOR a workflow, which writes the equals form.
    expect(parseArgs(['--run-as=agent']).runAs).toBe('agent');
    expect(parseArgs(['--run-as', 'agent']).runAs).toBe('agent');
    expect(parseArgs([]).runAs).toBeUndefined();
  });

  it('handles the flags with no value', () => {
    expect(parseArgs(['--ci']).ci).toBe(true);
    expect(parseArgs(['--no-report']).report).toBe(false);
    expect(parseArgs(['--no-vision']).vision).toBe(false);
    expect(parseArgs([]).report).toBe(true);
    expect(parseArgs([]).vision).toBe(true);
  });

  it('reads prices as dollars per 1M tokens, and refuses nonsense', () => {
    expect(parseArgs(['--price-in=0.22', '--price-out=0.66']).priceIn).toBe(0.22);
    expect(parseArgs(['--price-cache-read=1.5']).priceCacheRead).toBe(1.5);
    // Dollars per CALL, not per token: a server-side web search is a flat fee beside the tokens it returns.
    expect(parseArgs(['--price-web-search=0.01']).priceWebSearch).toBe(0.01);
    for (const bad of ['abc', '-1']) expect(() => parseArgs([`--price-in=${bad}`])).toThrow(/price/i);
  });

  it('keeps a value containing an equals sign intact', () => {
    expect(parseArgs(['--out=/tmp/a=b']).out).toContain('a=b');
  });

  it('names an unknown argument rather than ignoring it', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument --nope/);
    expect(() => parseArgs(['--nope=1'])).toThrow(/unknown argument --nope/);
  });
});

describe('parseArgs — targeting a deployment', () => {
  it('takes a deployment URL in either spelling', () => {
    expect(parseArgs(['--deployment', 'https://artifactbin.dev']).deployment).toBe('https://artifactbin.dev');
    expect(parseArgs(['--deployment=https://artifactbin.dev']).deployment).toBe('https://artifactbin.dev');
    expect(parseArgs([]).deployment).toBeUndefined();
  });

  it('refuses anything that is not an absolute http(s) URL — a bare host would silently boot a local server instead', () => {
    for (const bad of ['artifactbin.dev', 'ftp://x', '/local', '']) {
      expect(() => parseArgs([`--deployment=${bad}`])).toThrow(/deployment/i);
    }
  });
});

describe('parseArgs — port base', () => {
  it('can be moved, so two runs on one machine do not collide', () => {
    expect(parseArgs(['--port-base=3200']).portBase).toBe(3200);
    expect(parseArgs(['--port-base', '3200']).portBase).toBe(3200);
    expect(parseArgs([]).portBase).toBeUndefined();
  });
  it('refuses a port that is not a usable number', () => {
    for (const bad of ['0', 'abc', '70000', '-1']) expect(() => parseArgs([`--port-base=${bad}`])).toThrow(/port/i);
  });
});

describe('--concurrency', () => {
  it('parses both spellings', () => {
    expect(parseArgs(['--concurrency', '4']).concurrency).toBe(4);
    expect(parseArgs(['--concurrency=1']).concurrency).toBe(1);
  });

  it('is absent by default, so config.json decides', () => {
    expect(parseArgs([]).concurrency).toBeUndefined();
  });

  it('refuses a value that is not a small positive integer — each one holds a proxy and an agent process', () => {
    for (const bad of ['0', '-1', '2.5', 'lots', '99']) {
      expect(() => parseArgs(['--concurrency', bad])).toThrow(/--concurrency/);
    }
  });
});
