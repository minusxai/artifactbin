/**
 * `SQL__SERVICE_URL` MUST MOVE EVERY ENGINE CALL, NOT MOST OF THEM.
 *
 * `dryRunQueries` had no remote branch, and it runs on every write that can
 * resolve its refs — so an app pointed at a service still opened a local DuckDB
 * instance on the most ordinary request it serves. In-process that is invisible
 * (it works, on a module the deployment believed it had moved); on an image built
 * without the engine it is `ERR_MODULE_NOT_FOUND` on `POST /api/artifacts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SERVICE = 'http://sql.test:8080';

const withService = async () => {
  vi.resetModules();
  process.env.SQL__SERVICE_URL = SERVICE;
  return import('../engine');
};

afterEach(() => { delete process.env.SQL__SERVICE_URL; vi.restoreAllMocks(); vi.resetModules(); });

describe('dryRunQueries with a service configured', () => {
  it('asks the service instead of opening an instance here', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [], columns: { q: [{ name: 'n', type: 'number' }] } }), { status: 200 }),
    );
    const { dryRunQueries } = await withService();
    const out = await dryRunQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1 as n' }], paramNames: [] });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(`${SERVICE}/dry-run`);
    expect(out.columns.q).toEqual([{ name: 'n', type: 'number' }]);
  });

  it('sends paramNames as an ARRAY — a Set JSON-stringifies to {} and binds nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [], columns: {} }), { status: 200 }),
    );
    const { dryRunQueries } = await withService();
    await dryRunQueries({ tables: {}, queries: [], paramNames: new Set(['from', 'to']) as unknown as string[] });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.paramNames).toEqual(['from', 'to']);
  });

  it('reports a service that cannot answer as the queries failing, never as clean', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { dryRunQueries } = await withService();
    const out = await dryRunQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], paramNames: [] });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].error).toMatch(/ECONNREFUSED/);
  });
});

describe('every engine entry point, not most of them', () => {
  /*
   * The miss that produced this file was ONE function without a remote branch,
   * and finding it cost a full gate run against an image built without DuckDB.
   * `dryRunMutations` was the second. This case fails if a third appears: with a
   * service configured, no entry point may reach the native module — proven by
   * behaviour (every call goes out over fetch), not by reading the source.
   */
  const CALLS: Array<[string, (m: any) => Promise<unknown>]> = [
    ['runQueries', (m) => m.runQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], params: {} })],
    ['runMutation', (m) => m.runMutation({ table: { name: 't', rows: [], columns: [] }, sql: 'delete from t', params: {} })],
    ['dryRunQueries', (m) => m.dryRunQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], paramNames: [] })],
    ['dryRunMutations', (m) => m.dryRunMutations({ tables: {}, mutations: [{ name: 'm', sql: 'delete from t', target: 't' }], paramNames: [] })],
  ];

  it.each(CALLS)('%s asks the service', async (_name, call) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: {}, result: {}, errors: [], columns: {} }), { status: 200 }),
    );
    const mod = await withService();
    await call(mod);
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(new RegExp(`^${SERVICE}/`));
  });
});
