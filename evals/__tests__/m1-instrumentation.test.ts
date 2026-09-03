/**
 * M1 — what the eval must be able to WATCH.
 *
 * Two things the driver has never observed, because it always handed the agent a credential and always
 * measured from the first HTTP call: whether an agent mints its own token when nobody gives it one, and
 * how long its human waited before a URL existed. These pin both, plus the guardrail that stops a fast
 * empty stub from beating a real skeleton.
 */
import { describe, it, expect } from 'vitest';
import { ledgerMetrics, scoredArtifactId } from '../lib/ledger';
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

describe('the edges the seed did not pin', () => {
  it('selfMinted counts the ATTEMPT, not the grant — a refused mint is still an agent taking a token', () => {
    // The OSS default caps anonymous minting at 0/hour, so a self-minting agent's first sign is a 429.
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/tokens/anonymous', status: 429, error: 'rate_limited' })]);
    expect(m.selfMinted).toBe(true);
  });

  it('msToFirstPublish counts an MCP write, because `isWrite` does', () => {
    const m = ledgerMetrics([
      entry({ t: 3_000, method: 'POST', path: '/mcp', status: 200, artifactId: 'ab3cd9' }),
    ], { startedAtMs: 1_000 });
    expect(m.msToFirstPublish).toBe(2_000);
  });

  it('msToFirstPublish is null when the ledger saw nothing at all', () => {
    expect(ledgerMetrics([]).msToFirstPublish).toBeNull();
  });

  it('skeletonSections is null when the FIRST successful write was a dataset, even though a later one has markup', () => {
    // The data task writes its dataset first. The brief pins the FIRST successful write, so this reads
    // null rather than borrowing the document's headings — the guardrail refuses to guess.
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset', artifactId: 'ds1111' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1><h2>b</h2>', artifactId: 'ab3cd9' }),
    ]);
    expect(m.skeletonSections).toBeNull();
  });

  it('skeletonSections skips the FAILED first attempt and counts the first write that worked', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 400, reqMarkup: '<h1>a</h1><h2>b</h2><h3>c</h3>' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1>' }),
    ]);
    expect(m.skeletonSections).toBe(1);
  });

  it('skeletonSections counts opening h1–h3 only: attributes yes, </h1> and <h4> and <header> no', () => {
    const markup = '<header><h1 class="t" id="x">T</h1></header><h2\n  data-a="1">A</h2><h3>B</h3><h4>C</h4><hgroup></hgroup>';
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: markup })]);
    expect(m.skeletonSections).toBe(3);
  });

  it('skeletonSections is 0, not null, for a real but heading-less document', () => {
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<p>just a paragraph</p>' })]);
    expect(m.skeletonSections).toBe(0);
  });

  it('leaves every neighbouring metric exactly as it was', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'GET', path: '/docs/artifactbin/SKILL.md', bytes: 10 }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1>', markupUnchanged: true, artifactId: 'ab3cd9' }),
    ], { startedAtMs: 500 });
    expect(m.readDocsBeforeWrite).toBe(true);
    expect(m.publishedFirstTry).toBe(true);
    expect(m.canonicalStable).toBe(true);
    expect(m.docsFetches).toBe(1);
    expect(m.docsBytes).toBe(10);
    expect(m.httpCalls).toBe(2);
  });
});

describe('the no-credential access line', () => {
  const NONE = { kind: 'none', base: 'https://x.test' } as const;

  it('points a FETCHED-skill agent at the docs, names no document, and claims no saved connection', () => {
    const line = buildPrompt(TASK, NONE, { mode: 'fetched_skill+api_action' as never });
    expect(line).toContain('https://x.test/docs/artifactbin/SKILL.md');
    expect(line).not.toContain('.artifactbin.env');
    expect(line).not.toMatch(/document [A-Za-z0-9]{6,12}/);
    expect(line).not.toMatch(/mx_[A-Za-z0-9_-]+/);
  });

  it('names the INSTALLED skill but never claims a connection file that was deliberately not written', () => {
    const line = buildPrompt(TASK, NONE, { mode: 'installed_skill+api_action' as never });
    expect(line).toContain('https://x.test');
    expect(line).toMatch(/skill is installed/i);
    // The whole point of the leg: no token anywhere, and no lie about one being on disk.
    expect(line).not.toContain('.artifactbin.env');
    expect(line).not.toMatch(/mx_[A-Za-z0-9_-]+/);
  });

  it('refuses an MCP mode outright — the MCP config IS a token handoff', () => {
    expect(() => buildPrompt(TASK, NONE, { mode: 'installed_skill+mcp_action' as never })).toThrow(/token/i);
  });
});

describe('scoring a run that was never given a document', () => {
  it('falls through to null instead of a start document that does not exist', () => {
    // The token-less leg mints no start document, so the third fallback has nothing to name. Null means
    // "there is no artifact to score" — the honest answer for an agent that published nothing at all.
    expect(scoredArtifactId({ finalMessage: null, ledger: [], startId: null })).toBeNull();
  });

  it('still scores what the agent made, or what the ledger watched it write', () => {
    const written = [entry({ method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ledger1' })];
    expect(scoredArtifactId({ finalMessage: 'Done: https://x.test/a/stated1', ledger: [], startId: null })).toBe('stated1');
    expect(scoredArtifactId({ finalMessage: 'Done.', ledger: written, startId: null })).toBe('ledger1');
  });
});
