/**
 * THE COMPOSITION'S SQL EXTENSIONS, from one declaration. A composition root
 * names one module (`AppHostOptions.sqlExtensions`, the specifier its SQL pool
 * receives): the engine threads install it on every write, and the app's own
 * analysis of a <Mutation> — publish checks, the owner's direct write — installs
 * it too, so a statement the engine will run is never refused for calling one of
 * its functions. Reads never see them. The fixture's `fixture_generate` aborts a
 * real run to demand an external result and is a NULL stub in a dry run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { services, setServices } from '@/lib/platform';
import { useSqlExtensions } from '@/lib/sql';
import { mintAccountToken as mintToken, params } from '@/__tests__/harness';
import { createAppHost } from '@/server/host';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const FIXTURE = new URL('../../sql/__tests__/fixtures/fixture-extension.ts', import.meta.url).href;
const ROWS = [{ choice: 'ramen', who: 'seed' }];

const previous = services().sql;
const pool = createSql({}, { workers: 1, extensions: FIXTURE });
let host: Awaited<ReturnType<typeof createAppHost>> | undefined;
beforeAll(async () => {
  host = await createAppHost({ ownsDatabase: false, sqlExtensions: FIXTURE, services: { sql: pool } });
});
afterAll(async () => {
  try { await host?.close(); }
  finally { setServices({ sql: previous }); await useSqlExtensions(undefined); await pool.close(); }
});

const create = (token: string, body: Record<string, unknown>) => createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
async function dataset() {
  const t = await mintToken('t');
  const res = await create(t.token, { dataset: ROWS, access: 'readwrite' });
  expect(res.status, await res.clone().text()).toBe(201);
  return { token: t.token, ds: ((await res.json()) as { id: string }).id };
}

describe('composition SQL extensions and the native admission boundary', () => {
  it('the owner\'s direct write is analyzed with it and reaches the engine, which demands the result', async () => {
    const { token, ds } = await dataset();
    const res = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token, json: { sql: `insert into public.rows (choice, who) values (fixture_generate('x'), 'y')` } }), params({ id: ds }));
    const body = await res.text();
    expect(res.status).not.toBe(200);
    expect(body).not.toMatch(/no such function/);
    expect(body).toMatch(/Execution requires continuation/);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });
});
