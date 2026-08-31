/**
 * The recording proxy's ledger is the per-run request log. These pin how the
 * scorer reads it — on the REAL ledger the spike produced (fixtures/ledger.jsonl):
 *   GET /docs/llm · POST /api/start · PUT 400 · PUT 200 · GET export
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ledgerMetrics, parseLedger, scoredArtifactId, targetArtifactId } from '../lib/ledger';
import type { LedgerEntry } from '../lib/contracts';

const text = fs.readFileSync(path.join(__dirname, 'fixtures/ledger.jsonl'), 'utf8');

describe('parseLedger', () => {
  it('parses one entry per line and tolerates a torn last line', () => {
    const entries = parseLedger(text + '{"t":1,"ms"');
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/docs/llm', status: 200, ua: 'eval-spike/1' });
    expect(entries[2]).toMatchObject({ method: 'PUT', status: 400, auth: 'bearer' });
  });
});

describe('ledgerMetrics', () => {
  const entries = parseLedger(text).map((e, i) => (e.status === 400 ? { ...e, error: 'invalid_jsx' } : e));

  it('counts calls, write attempts, 4xx, and names the first error code', () => {
    const m = ledgerMetrics(entries);
    expect(m.httpCalls).toBe(5);
    expect(m.writeAttempts).toBe(2);
    expect(m.fourXx).toBe(1);
    expect(m.firstError).toBe('invalid_jsx');
    expect(m.inventedEndpoints).toBe(0);
  });

  it('read_docs_before_write: a docs or start-link GET must precede the first write', () => {
    expect(ledgerMetrics(entries).readDocsBeforeWrite).toBe(true);
    const noDocs = entries.filter((e) => e.path !== '/docs/llm');
    expect(ledgerMetrics(noDocs).readDocsBeforeWrite).toBe(false);
    const startLink: LedgerEntry = { t: 0, ms: 1, method: 'GET', path: '/a/x/start?k=abc', status: 200, ua: null, auth: null, error: null };
    expect(ledgerMetrics([startLink, ...noDocs]).readDocsBeforeWrite).toBe(true);
  });

  it('treats POST /api/artifacts, PUT, /edits and /mcp as writes; a first-try publish has one attempt and no 4xx', () => {
    const w = (method: string, p: string, status = 200): LedgerEntry => ({ t: 0, ms: 1, method, path: p, status, ua: null, auth: 'bearer', error: null });
    const m = ledgerMetrics([w('GET', '/docs/llm'), w('POST', '/api/artifacts', 201), w('POST', '/api/artifacts/abc123/edits'), w('POST', '/mcp'), w('GET', '/api/artifacts/abc123')]);
    expect(m.writeAttempts).toBe(3);
    expect(m.firstError).toBeNull();
    expect(m.publishedFirstTry).toBe(true);
    expect(ledgerMetrics(entries).publishedFirstTry).toBe(false);
  });

  it('canonical_stable compares the markup sent with the markup echoed on the LAST successful write', () => {
    const w = (status: number, req: string, res?: string): LedgerEntry => ({ t: 0, ms: 1, method: 'PUT', path: '/api/artifacts/abc123', status, ua: null, auth: 'bearer', error: null, reqMarkup: req, resMarkup: res });
    expect(ledgerMetrics([w(200, '<h1>a</h1>', '<h1>a</h1>')]).canonicalStable).toBe(true);
    expect(ledgerMetrics([w(200, '<p><div>x</div></p>', '<div>x</div>')]).canonicalStable).toBe(false);
    expect(ledgerMetrics([w(200, '<h1>a</h1>', '<h1>a</h1>'), w(400, '<Bogus/>')]).canonicalStable).toBe(true);
    expect(ledgerMetrics([]).canonicalStable).toBeNull();
  });
});

describe('endpoint and transport metrics', () => {
  const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ t: 0, ms: 1, method: 'GET', path: '/x', status: 200, ua: null, auth: null, error: null, ...over });

  it('a 404 on a real route is a missing RESOURCE, not an invented endpoint', () => {
    // Deleting an artifact that is not there 404s; that is the product working.
    expect(ledgerMetrics([e({ method: 'DELETE', path: '/api/artifacts/abc123', status: 404 })]).inventedEndpoints).toBe(0);
    expect(ledgerMetrics([e({ path: '/a/abc123/versions/2', status: 404 })]).inventedEndpoints).toBe(1);
    expect(ledgerMetrics([e({ path: '/api/v1/documents', status: 404 })]).inventedEndpoints).toBe(1);
  });

  it('knows every route the docs teach', () => {
    for (const p of ['/docs/llm', '/docs/markup', '/api/tokens/anonymous', '/api/start', '/api/preview', '/api/artifacts', '/api/artifacts/abc123', '/api/artifacts/abc123/edits', '/api/artifacts/abc123/versions', '/api/artifacts/abc123/versions/3', '/mcp', '/a/abc123', '/a/abc123/start?k=x', '/a/abc123/export?format=png', '/a/abc123/raw?chrome=0']) {
      expect(ledgerMetrics([e({ path: p, status: 404 })]).inventedEndpoints).toBe(0);
    }
  });

  it('reports which transport and which write shape the agent used', () => {
    const m = ledgerMetrics([
      e({ method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset' }),
      e({ method: 'POST', path: '/api/artifacts/abc123/edits', status: 200 }),
      e({ method: 'POST', path: '/mcp', status: 200 }),
    ]);
    expect(m.datasetCreated).toBe(true);
    expect(m.usedEditsEndpoint).toBe(true);
    expect(m.usedMcp).toBe(true);
    const none = ledgerMetrics([e({ method: 'PUT', path: '/api/artifacts/abc123', status: 200, reqFormat: 'markup' })]);
    expect(none).toMatchObject({ datasetCreated: false, usedEditsEndpoint: false, usedMcp: false });
  });

  it('a FAILED write does not count as having used the transport', () => {
    expect(ledgerMetrics([e({ method: 'POST', path: '/mcp', status: 500 })]).usedMcp).toBe(false);
  });
});

describe('a ledger that saw NOTHING knows nothing', () => {
  /**
   * An agent whose HTTP calls happen server-side (codex reaches a public URL
   * through OpenAI's own browsing tool) leaves an empty ledger. Reporting
   * `read_docs_before_write: false` there asserts the agent skipped the docs,
   * when the truth is that we could not watch. Null renders "—".
   */
  it('reports its judgements as null rather than false', () => {
    const m = ledgerMetrics([]);
    expect(m.observed).toBe(false);
    expect(m.readDocsBeforeWrite).toBeNull();
    expect(m.publishedFirstTry).toBeNull();
    expect(m.datasetCreated).toBeNull();
    expect(m.usedEditsEndpoint).toBeNull();
    expect(m.usedMcp).toBeNull();
    expect(m.canonicalStable).toBeNull();
  });

  it('still reports the counts, which are literally what was seen', () => {
    const m = ledgerMetrics([]);
    expect(m.httpCalls).toBe(0);
    expect(m.writeAttempts).toBe(0);
    expect(m.inventedEndpoints).toBe(0);
    expect(m.firstError).toBeNull();
  });

  it('a ledger with entries still answers with booleans', () => {
    const m = ledgerMetrics(parseLedger(text));
    expect(m.observed).toBe(true);
    expect(typeof m.readDocsBeforeWrite).toBe('boolean');
  });
});

describe('docs cost', () => {
  const e = (over: Partial<LedgerEntry>): LedgerEntry =>
    ({ t: 1, ms: 1, method: 'GET', path: '/', status: 200, ua: null, auth: null, error: null, ...over });

  it('counts /docs/* GETs and sums their bytes', () => {
    const m = ledgerMetrics([
      e({ path: '/docs/llm', bytes: 23590 }),
      e({ path: '/docs/markup?x=1', bytes: 26921 }),
      e({ path: '/a/abc123/start?k=s', bytes: 2100 }), // the start brief is the handoff, not the docs path
      e({ method: 'PUT', path: '/api/artifacts/abc123', bytes: 400 }),
    ]);
    expect(m.docsFetches).toBe(2);
    expect(m.docsBytes).toBe(23590 + 26921);
  });

  it('a ledger written before `bytes` existed still counts fetches but reports bytes as null', () => {
    const m = ledgerMetrics([e({ path: '/docs/llm' }), e({ path: '/docs/themes' })]);
    expect(m.docsFetches).toBe(2);
    expect(m.docsBytes).toBeNull();
  });

  it('an unobserved ledger knows neither', () => {
    const m = ledgerMetrics([]);
    expect(m.docsFetches).toBeNull();
    expect(m.docsBytes).toBeNull();
  });
});

describe('canonical_stable when the echo is skipped', () => {
  const e = (over: Partial<LedgerEntry>): LedgerEntry =>
    ({ t: 1, ms: 1, method: 'PUT', path: '/api/artifacts/abc123', status: 200, ua: null, auth: 'bearer', error: null, ...over });

  it('reads markup_changed:false as stable — the product now skips echoing an unchanged document', () => {
    const m = ledgerMetrics([e({ reqMarkup: '<div>x</div>', markupUnchanged: true })]);
    expect(m.canonicalStable).toBe(true);
  });

  it('still compares the echo when the document WAS rewritten', () => {
    expect(ledgerMetrics([e({ reqMarkup: '<p><div>x</div></p>', resMarkup: '<div>x</div>', markupUnchanged: false })]).canonicalStable).toBe(false);
    expect(ledgerMetrics([e({ reqMarkup: '<div>x</div>', resMarkup: '<div>x</div>' })]).canonicalStable).toBe(true);
  });
});

describe('targetArtifactId', () => {
  const e = (method: string, path: string, status: number, artifactId?: string): LedgerEntry =>
    ({ t: 0, ms: 1, method, path, status, ua: null, auth: 'bearer', error: null, ...(artifactId ? { artifactId } : {}) });

  it('is the last artifact written successfully', () => {
    expect(targetArtifactId([e('PUT', '/api/artifacts/aaaaaa', 200, 'aaaaaa'), e('POST', '/api/artifacts', 201, 'bbbbbb')])).toBe('bbbbbb');
    expect(targetArtifactId([e('PUT', '/api/artifacts/aaaaaa', 400, 'aaaaaa')])).toBeNull();
  });

  it('skips an artifact the agent later DELETEd — Claude Opus 5 makes a scratch document, exports it to look, and deletes it', () => {
    const entries = [
      e('PUT', '/api/artifacts/cvPGM1', 200, 'cvPGM1'),
      e('POST', '/api/artifacts', 201, 'YWro81'),
      e('GET', '/a/YWro81/export', 200),
      e('DELETE', '/api/artifacts/YWro81', 200, 'YWro81'),
    ];
    expect(targetArtifactId(entries)).toBe('cvPGM1');
    // A DELETE that failed removed nothing.
    expect(targetArtifactId([...entries.slice(0, 3), e('DELETE', '/api/artifacts/YWro81', 404, 'YWro81')])).toBe('YWro81');
  });

  it('on the REAL ledger of that run (fixtures/ledger-scratch-delete.jsonl) — the proxy stamps the id on a DELETE from its path', () => {
    const real = parseLedger(fs.readFileSync(path.join(__dirname, 'fixtures/ledger-scratch-delete.jsonl'), 'utf8'));
    expect(real.filter((e) => e.method === 'DELETE')).toHaveLength(1);
    expect(targetArtifactId(real)).toBe('cvPGM1');
  });
});

describe('scoredArtifactId', () => {
  const written = [{ t: 0, ms: 1, method: 'POST', path: '/api/artifacts', status: 201, ua: null, auth: 'bearer', error: null, artifactId: 'ledger1' } as LedgerEntry];

  it('scores what the agent SAYS it made, then what the ledger saw it write, then the start document', () => {
    expect(scoredArtifactId({ finalMessage: 'Done: https://artifactbin.dev/a/stated1', ledger: written, startId: 'start1' })).toBe('stated1');
    expect(scoredArtifactId({ finalMessage: 'Done.', ledger: written, startId: 'start1' })).toBe('ledger1');
    expect(scoredArtifactId({ finalMessage: null, ledger: [], startId: 'start1' })).toBe('start1');
  });
});
