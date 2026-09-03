/**
 * M1 — what the eval must be able to WATCH.
 *
 * Two things the driver has never observed, because it always handed the agent a credential and always
 * measured from the first HTTP call: whether an agent mints its own token when nobody gives it one, and
 * how long its human waited before a URL existed. These pin both, plus the guardrail that stops a fast
 * empty stub from beating a real skeleton.
 */
import { describe, it, expect } from 'vitest';
import { ledgerMetrics } from '../lib/ledger';
import type { LedgerEntry } from '../lib/contracts';
import { acquireCredential, credentialSourceFor, parseCredentialSource } from '../lib/credential';
import { buildPrompt } from '../lib/tasks';
import type { Task } from '../lib/contracts';

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  t: 1_000, ms: 5, method: 'GET', path: '/docs', status: 200, ua: null, auth: null, error: null, ...over,
});

const TASK = { id: 'demo', brief: 'Publish something.' } as unknown as Task;

describe('selfMinted — did the agent take a token instead of asking for one', () => {
  it('is true when the agent posted the anonymous mint', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000 }),
      entry({ t: 1_200, method: 'POST', path: '/api/tokens/anonymous', status: 201 }),
    ]);
    expect(m.selfMinted).toBe(true);
  });

  it('is false when it never did', () => {
    expect(ledgerMetrics([entry({})]).selfMinted).toBe(false);
  });

  it('is null when nothing was observed at all — silence is not innocence', () => {
    expect(ledgerMetrics([]).selfMinted).toBeNull();
  });
});

describe('msToFirstPublish — how long the human waited for a link', () => {
  const ledger = [
    entry({ t: 10_000, method: 'GET', path: '/docs/artifactbin/SKILL.md' }),
    entry({ t: 12_000, method: 'POST', path: '/api/artifacts', status: 400 }),
    entry({ t: 15_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9' }),
  ];

  it('measures from the spawn anchor, so agent boot is inside the number', () => {
    expect(ledgerMetrics(ledger, { startedAtMs: 4_000 }).msToFirstPublish).toBe(11_000);
  });

  it('falls back to the first entry when no anchor is given — a floor, not the truth', () => {
    expect(ledgerMetrics(ledger).msToFirstPublish).toBe(5_000);
  });

  it('is null when nothing ever published', () => {
    expect(ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 400 })]).msToFirstPublish).toBeNull();
  });
});

describe('skeletonSections — was the early publish a document or a placeholder', () => {
  it('counts the headings of the FIRST successful write', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201,
        reqMarkup: '<div><h1>Support load</h1><h2>Volume</h2><h2>Resolution</h2><h3>By team</h3></div>' }),
      entry({ t: 2_000, method: 'PUT', path: '/api/artifacts/ab3cd9', status: 200, reqMarkup: '<div><h1>x</h1></div>' }),
    ]);
    expect(m.skeletonSections).toBe(4);
  });

  it('is null when that write carried no markup', () => {
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset' })]);
    expect(m.skeletonSections).toBeNull();
  });
});

describe('the token-less leg', () => {
  it('parses `none` as a credential source', () => {
    expect(parseCredentialSource('none')).toBe('none');
  });

  it('acquires nothing, and does not throw doing it', async () => {
    await expect(acquireCredential('none', { base: 'https://x.test', env: {} } as never)).resolves.toBeNull();
  });

  it('is never chosen automatically — only an explicit --credential picks it', () => {
    const source = credentialSourceFor('fetched_skill+api_action' as never, {} as never, {});
    expect(source).not.toBe('none');
  });

  it('builds a prompt that names the store and hands over NO credential', () => {
    const prompt = buildPrompt(TASK, { kind: 'none', base: 'https://x.test' }, { mode: 'installed_skill+api_action' as never });
    expect(prompt).toContain('https://x.test');
    expect(prompt).not.toMatch(/mx_[A-Za-z0-9_-]+/);
    expect(prompt).not.toContain('/start?k=');
  });
});
