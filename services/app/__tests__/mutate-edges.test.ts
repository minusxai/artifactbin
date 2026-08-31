/**
 * The write path's edges — the outcomes that are neither "it worked" nor "the
 * author's SQL is wrong", and the housekeeping a long-lived stream owes.
 *
 *  - CONTENTION is not an author error. When a write cannot land inside its
 *    retry budget the honest answer is "try again", not "fix your SQL": a 400
 *    would send a caller looking for a bug in a statement that is perfectly
 *    good. (Unreachable on PGLite, which serializes every operation — so it is
 *    driven here by making the CAS impossible to win.)
 *  - A stream that ends must release its DATASET channels as well as its own,
 *    or a process slowly pins channels for documents nobody is reading.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';


import { liveChannelCount, resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts?v=2', { method: 'POST', token: token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
const ROWS = [{ choice: 'ramen' }];
const DOC = (ds: string) =>
  `<Helmet><Query name="q">{\`select * from ref_${ds}\`}</Query>`
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice) values ('x')\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button><Question data="$q" viz={{"kind":"table"}} /></div>';

beforeEach(async () => {
  await resetLiveSubscriptions();
});
afterAll(async () => { vi.restoreAllMocks(); });

/**
 * Make every compare-and-swap lose: the row's `edit_id` moves between the read
 * and the write, on every attempt. That is what real contention looks like to
 * this code, without needing two processes.
 */
async function alwaysContended(datasetId: string) {
  const db = await harness.db();
  const original = db.query.bind(db);
  vi.spyOn(db, 'query').mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql.includes('UPDATE artifacts') && sql.includes('edit_id = $2')) {
      // Someone else landed first — rotate the head pointer, then let the
      // guarded update run and find nothing to update.
      await original(`UPDATE artifacts SET edit_id = md5(random()::text) WHERE id = $1`, [datasetId]);
    }
    return original(sql, values) as ReturnType<typeof original>;
  });
}

describe('contention', () => {
  it('answers 503 dataset_busy with Retry-After on the document door — never a 400 about SQL', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    await alwaysContended(ds);
    const res = await mutateDocRoute(request(`/a/${doc}/mutate`, { method: 'POST', json: { mutation: 'vote' } }), params({ id: doc }));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe('dataset_busy');
    expect(body.detail).toMatch(/try again/i);
    vi.restoreAllMocks();
  });

  it('answers the same on the owner door', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    await alwaysContended(ds);
    const res = await mutateDatasetRoute(
      request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `insert into ref_${ds} (choice) values ('y')` } }),
      params({ id: ds }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('dataset_busy');
    vi.restoreAllMocks();
  });
});

describe('the stream releases what it watched', () => {
  it('drops the document AND dataset channels when the client goes away', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const controller = new AbortController();
    const request = new Request(`${BASE}/a/${doc}/events`, { signal: controller.signal });
    const res = await eventsRoute(request, params({ id: doc }));
    expect(res.status).toBe(200);
    expect(liveChannelCount()).toBe(2);
    void res.body?.cancel().catch(() => {});
    controller.abort();
    // The close path awaits each unsubscribe; give it a turn to finish.
    await new Promise((r) => setTimeout(r, 100));
    expect(liveChannelCount()).toBe(0);
  });

  it('two streams over the same dataset SHARE its channel, and one leaving keeps the other watching', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const a = (await create(t.token, { markup: DOC(ds) })).id;
    const b = (await create(t.token, { markup: DOC(ds) })).id;
    const first = new AbortController();
    const resA = await eventsRoute(new Request(`${BASE}/a/${a}/events`, { signal: first.signal }), params({ id: a }));
    const resB = await eventsRoute(new Request(`${BASE}/a/${b}/events`), params({ id: b }));
    // doc a, doc b, and ONE shared dataset channel.
    expect(liveChannelCount()).toBe(3);
    void resA.body?.cancel().catch(() => {});
    first.abort();
    await new Promise((r) => setTimeout(r, 100));
    // b's document channel and the still-shared dataset channel.
    expect(liveChannelCount()).toBe(2);
    void resB.body?.cancel().catch(() => {});
    expect((await getArtifactById(ds))!.access).toBe('readwrite');
  });
});
