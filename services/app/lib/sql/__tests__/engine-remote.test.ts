/** App SQL engine calls go through the configured remote SQL service. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SERVICE = 'http://sql.test:8080';

const withService = async () => {
  vi.resetModules();
  process.env.SQL__SERVICE_URL = SERVICE;
  return import('../engine');
};

afterEach(() => { delete process.env.SQL__SERVICE_URL; vi.restoreAllMocks(); vi.resetModules(); });

describe('remote SQL engine', () => {
  const CALLS: Array<[string, (m: Awaited<ReturnType<typeof withService>>) => Promise<unknown>]> = [
    ['runQueries', (m) => m.runQueries({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], params: {} })],
    ['runMutation', (m) => m.runMutation({ table: { name: 't', rows: [], columns: [] }, sql: 'delete from t', params: {} })],
    ['dryRunMutations', (m) => m.dryRunMutations({ tables: {}, mutations: [{ name: 'm', sql: 'delete from t', target: 't' }], paramNames: [] })],
  ];

  it.each(CALLS)('%s asks the service', async (_name, call) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: {}, result: {}, errors: [] }), { status: 200 }),
    );
    const mod = await withService();
    await call(mod);
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(new RegExp(`^${SERVICE}/`));
  });
});
