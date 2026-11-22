/**
 * `SQL__SERVICE_URL` MUST MOVE EVERY ENGINE CALL, NOT MOST OF THEM.
 *
 * A dry run runs on every write that can resolve its refs, so an entry
 * point without a remote branch opens a local DuckDB instance on the most
 * ordinary request the app serves. In-process that is invisible (it works, on a
 * module the deployment believes it has moved); on an image built without the
 * engine it is `ERR_MODULE_NOT_FOUND` on `POST /api/artifacts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SERVICE = 'http://sql.test:8080';

const withService = async () => {
  vi.resetModules();
  process.env.SQL__SERVICE_URL = SERVICE;
  return import('../engine');
};

afterEach(() => { delete process.env.SQL__SERVICE_URL; vi.restoreAllMocks(); vi.resetModules(); });

describe('every engine entry point, not most of them', () => {
  /*
   * One entry point without a remote branch only shows up as a full gate run
   * against an image built without DuckDB. This case fails when one appears:
   * with a service configured, no entry point may reach the native module —
   * proven by behaviour (every call goes out over fetch), not by reading the
   * source.
   */
  const CALLS: Array<[string, (m: any) => Promise<unknown>]> = [
    ['runQueries', (m) => m.runQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], params: {} })],
    ['runMutation', (m) => m.runMutation({ table: { name: 't', rows: [], columns: [] }, sql: 'delete from t', params: {} })],
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
