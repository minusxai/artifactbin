/**
 * A MALFORMED BODY IS THE CALLER'S MISTAKE, NEVER THE SERVICE'S DEATH. The shell (`serveSql`) hands the worker pool
 * whatever JSON arrived; a body missing the arrays the pool reads itself (its watchdog budget, its failure answers,
 * its affinity key) once threw outside any awaited chain and took the whole process down, so the next caller found
 * nothing listening. Each one is answered `bad_request`, promptly, and the pool keeps answering.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { SQL_ROUTES, serveSql } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';

const pool = createSql({ timeoutMs: 2000 }, { workers: 1 });
const server = serveSql(pool);
const { url } = server.listen(0);
afterAll(async () => { await server.close(); await pool.close(); });

const post = (route: string, body: string) => fetch(`${url}${route}`, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
const valid = { tables: {}, queries: [{ name: 'q', sql: 'select 2 as v' }], params: {} };

const MALFORMED: Array<[string, unknown]> = [
  [SQL_ROUTES.run, {}],
  [SQL_ROUTES.run, null],
  [SQL_ROUTES.run, { queries: [null] }],
  [SQL_ROUTES.run, { queries: 'select 1' }],
  [SQL_ROUTES.run, { ...valid, catalog: {} }],
  [SQL_ROUTES.run, { ...valid, catalog: { tables: [null] } }],
  [SQL_ROUTES.mutate, null],
  [SQL_ROUTES.mutate, { mounted: { catalog: {} } }],
  [SQL_ROUTES.dryRunMutations, {}],
  [SQL_ROUTES.dryRunMutations, { mutations: [null] }],
];

describe('the SQL service shell over the worker pool', () => {
  it.each(['/run-many', '/dry-run'])('does not serve the retired %s route', async (route) => {
    const response = await post(route, '{}');
    expect([response.status, await response.json()]).toEqual([404, { error: 'not_found' }]);
  });

  it.each(MALFORMED)('%s answers %j with bad_request', async (route, body) => {
    const res = await post(route, JSON.stringify(body));
    expect([res.status, await res.json()]).toEqual([400, { error: 'bad_request' }]);
  });

  it('keeps answering a well-formed read after every malformed one', async () => {
    for (const [route, body] of MALFORMED) await (await post(route, JSON.stringify(body))).text();
    // No abort here: this read starts the pool's first thread, which a loaded runner may take a while to do.
    const res = await fetch(`${url}${SQL_ROUTES.run}`, { method: 'POST', body: JSON.stringify(valid) });
    expect(res.status).toBe(200);
    expect((await res.json()).results.q).toMatchObject({ rows: [{ v: 2 }] });
  }, 30_000);
});
