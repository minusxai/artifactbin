/**
 * THE APP REACHES A SPAWNED SERVICE, and gets what in-process gives.
 *
 * The service and the app run the SAME module (`@artifactbin/sql`), so this
 * drives its process entry over a real socket — through the app's own
 * `lib/sql/engine` shim and the services registry, not a client built by
 * hand — and compares against the engine registered in this process. The
 * package's own `services/sql/__tests__/contract.test.ts` runs the contract
 * over both transports; what this adds is the PROCESS: an entry point that
 * reads its env, binds a port and answers is a different claim from a server
 * shell constructed in the test.
 */
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { freePort } from '@/__tests__/net';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');

let child: ReturnType<typeof spawn>;
let serviceUrl: string;

beforeAll(async () => {
  const PORT = await freePort();
  serviceUrl = `http://127.0.0.1:${PORT}`;
  child = spawn('npx', ['tsx', 'services/sql/src/server.ts'], { cwd: ROOT, env: { ...process.env, APP__PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${serviceUrl}/run`, { method: 'POST', body: '{}' }).then(() => true).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the sql service did not start');
}, 30_000);
afterAll(() => { child?.kill(); vi.resetModules(); vi.unstubAllEnvs(); });

const input = {
  tables: { ref_ab3xk9: { rows: [{ region: 'EU', v: 5 }, { region: 'US', v: 1 }], columns: [{ name: 'region', type: 'string' as const }, { name: 'v', type: 'number' as const }] } },
  queries: [{ name: 'total', sql: 'select sum(v) as t from ref_ab3xk9 where region = $region', params: ['region'], refs: ['ab3xk9'], start: 0, end: 0 }],
  params: { region: 'EU' },
};

describe('the reference SQL service', () => {
  it('answers exactly what the in-process engine answers', async () => {
    vi.resetModules(); vi.stubEnv('SQL__SERVICE_URL', '');
    const local = await (await import('../engine')).runQueries(input);
    vi.resetModules(); vi.stubEnv('SQL__SERVICE_URL', serviceUrl);
    const remote = await (await import('../engine')).runQueries(input);
    expect(remote).toEqual(local);
    expect((remote.total as unknown as { rows: Array<{ t: number }> }).rows[0].t).toBe(5);
  }, 30_000);

  /**
   * The service is handed a body by whatever can reach it. A malformed one is
   * the caller's mistake and it is told so — but the JSON parser's own message
   * describes OUR internals (position, the surrounding bytes) and CodeQL reads
   * it as stack-trace exposure. It answers with a name, and the detail goes to
   * the service's log where the operator can see it.
   */
  it('answers a malformed body with a NAME, never the parser\'s own words', async () => {
    const res = await fetch(`${serviceUrl}/run`, { method: 'POST', body: 'not json at all' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'bad_request' });
  }, 30_000);

  it('keeps the guards: a second statement is refused there too', async () => {
    vi.resetModules(); vi.stubEnv('SQL__SERVICE_URL', serviceUrl);
    const { isQueryFailure, runQueries } = await import('../engine');
    const out = await runQueries({ ...input, queries: [{ ...input.queries[0], sql: 'select 1 as a; drop table ref_ab3xk9' }] });
    expect(isQueryFailure(out.total)).toBe(true);
  }, 30_000);
});
