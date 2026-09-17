/**
 * REMOTE DUCKDB. `SQL__SERVICE_URL` moves the engine out of this process:
 * the same `runQueries`/`runMutation` inputs travel as JSON to a service that
 * runs them under the SAME guards and answers the same outcomes. Unset — the
 * self-host default — the native engine runs in-process exactly as before.
 *
 * The seam matters for two reasons: the native module is the heaviest thing
 * in the image, and it is the one piece that keeps the app off a FaaS. What
 * it must NOT become is a second implementation: the service runs this same
 * module, so everything asserted here is about the TRANSPORT — the request
 * shape, the caps travelling with it, and what happens when it is unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERVICE = 'http://sql-service.internal:8080';

let sent: Array<{ url: string; body: Record<string, unknown> }>;
let answer: { status: number; body: unknown };

beforeEach(() => {
  sent = [];
  answer = { status: 200, body: { results: { q: { rows: [{ n: 2 }], columns: [{ name: 'n', type: 'number' }] } } } };
  vi.resetModules();
  vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

const TABLES = { ref_ab3xk9: { rows: [{ a: 1 }, { a: 2 }], columns: [{ name: 'a', type: 'number' as const }] } };
const QUERIES = [{ name: 'q', sql: 'select count(*) as n from ref_ab3xk9', params: [], refs: ['ab3xk9'], start: 0, end: 0 }];

describe('with SQL__SERVICE_URL set', () => {
  it('sends the run to the service and returns its outcomes', async () => {
    vi.stubEnv('SQL__SERVICE_URL', SERVICE);
    const { runQueries } = await import('../engine');
    const out = await runQueries({ tables: TABLES, queries: QUERIES, params: { region: 'EU' } });
    expect(out.q).toEqual({ rows: [{ n: 2 }], columns: [{ name: 'n', type: 'number' }] });
    expect(sent[0].url).toBe(`${SERVICE}/run`);
    expect(sent[0].body).toMatchObject({ tables: TABLES, queries: QUERIES, params: { region: 'EU' } });
  });

  it('carries the caps, so the service enforces the same limits this process would', async () => {
    vi.stubEnv('SQL__SERVICE_URL', SERVICE);
    const { runQueries } = await import('../engine');
    await runQueries({ tables: TABLES, queries: QUERIES, params: {}, limit: 7, timeoutMs: 250, page: { name: 'q', offset: 10, limit: 5 } });
    expect(sent[0].body).toMatchObject({ limit: 7, timeoutMs: 250, page: { name: 'q', offset: 10, limit: 5 } });
  });

  it('reports an unreachable or refusing service as a query FAILURE, never as an empty result', async () => {
    vi.stubEnv('SQL__SERVICE_URL', SERVICE);
    const { isQueryFailure, runQueries } = await import('../engine');
    answer = { status: 502, body: { error: 'upstream is down' } };
    const out = await runQueries({ tables: TABLES, queries: QUERIES, params: {} });
    expect(isQueryFailure(out.q)).toBe(true);
    // A chart drawn from a silent empty result is the failure the row cap and
    // this branch both exist to avoid.
    expect((out.q as { rows?: unknown[] }).rows).toBeUndefined();
  });

  it('sends a mutation the same way and returns its outcome', async () => {
    vi.stubEnv('SQL__SERVICE_URL', SERVICE);
    answer = { status: 200, body: { result: { rows: [{ a: 1 }, { a: 2 }, { a: 3 }], columns: [{ name: 'a', type: 'number' }], affected: 1 } } };
    const { runMutation } = await import('../engine');
    const out = await runMutation({ table: { name: 'ref_ab3xk9', ...TABLES.ref_ab3xk9 }, sql: 'insert into ref_ab3xk9 values ($a)', params: { a: 3 } });
    expect(sent[0].url).toBe(`${SERVICE}/mutate`);
    expect(out).toMatchObject({ affected: 1 });
    expect((out as { rows: unknown[] }).rows).toHaveLength(3);
  });
});

describe('unset', () => {
  it('runs in-process, and nothing leaves the machine', async () => {
    vi.stubEnv('SQL__SERVICE_URL', '');
    const { runQueries } = await import('../engine');
    const out = await runQueries({ tables: TABLES, queries: QUERIES, params: {} });
    expect(out.q).toMatchObject({ rows: [{ n: 2 }] });
    expect(sent).toEqual([]);
  });
});
