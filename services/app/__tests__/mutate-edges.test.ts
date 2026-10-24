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


import { liveSubscriptionSnapshot, resetLiveSubscriptions } from '@/lib/publish/realtime/live';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { useAppHarness, request } from '@/__tests__/harness';
import {sseStream} from '@/__tests__/sse';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
import { artifactChannel, annotationsChannel } from '@artifactbin/contracts';
import { presenceChannel } from '@/lib/html-presence/channel.server';
const subscriptions = () => Object.fromEntries(liveSubscriptionSnapshot().map(({ channel, subscribers }) => [channel, subscribers]));
const documentSubscriptions = (id: string) => ({ [artifactChannel(id)]: 2, [annotationsChannel(id)]: 1, [presenceChannel(id)]: 1 });

const ROWS = [{ choice: 'ramen' }];
const DOC = (ds: string) => `<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds}"></head><body>Votes</body></html>`;

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
  it('does not execute retired declared mutations from a native page', async () => {
    const t=await mintToken('t'),ds=(await create(t.token,{dataset:ROWS,access:'readwrite'})).id;
    const doc=(await create(t.token,{html:DOC(ds)})).id;
    const before=await getArtifactById(ds);
    const res=await mutateDocRoute(request(`/a/${doc}/mutate`,{method:'POST',token:t.token,json:{mutation:'vote'}}),params({id:doc}));
    expect(res.status).toBe(400);expect(await res.json()).toMatchObject({error:'unknown_mutation'});expect(await getArtifactById(ds)).toEqual(before);
  });

  it('answers the same on the owner door', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    await alwaysContended(ds);
    const res = await mutateDatasetRoute(
      request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `insert into public.rows (choice) values ('y')` } }),
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
    const doc = (await create(t.token, { html: DOC(ds) })).id;
    const controller = new AbortController();
    const request = new Request(`${BASE}/a/${doc}/events`, { signal: controller.signal });
    const res = await eventsRoute(request, params({ id: doc }));
    expect(res.status).toBe(200);
    const stream=sseStream(res.body!);await stream.named('message');
    // Presence also holds an ACL subscriber on the document's shared channel.
    expect(subscriptions()).toEqual({ ...documentSubscriptions(doc), [artifactChannel(ds)]: 1 });
    stream.close();
    controller.abort();
    await vi.waitFor(()=>expect(subscriptions()).toEqual({}));
  });

  it('two streams over the same dataset SHARE its channel, and one leaving keeps the other watching', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const a = (await create(t.token, { html: DOC(ds) })).id;
    const b = (await create(t.token, { html: DOC(ds) })).id;
    const first = new AbortController();
    const resA = await eventsRoute(new Request(`${BASE}/a/${a}/events`, { signal: first.signal }), params({ id: a }));
    const second=new AbortController();
    const resB = await eventsRoute(new Request(`${BASE}/a/${b}/events`,{signal:second.signal}), params({ id: b }));
    const streamA=sseStream(resA.body!),streamB=sseStream(resB.body!);
    await Promise.all([streamA.named('message'),streamB.named('message')]);
    // One dataset transport has two subscribers; each page keeps its own comment and presence channels.
    expect(subscriptions()).toEqual({ ...documentSubscriptions(a), ...documentSubscriptions(b), [artifactChannel(ds)]: 2 });
    streamA.close();
    first.abort();
    // Only page b remains, with one subscriber left on the shared dataset transport.
    await vi.waitFor(()=>expect(subscriptions()).toEqual({ ...documentSubscriptions(b), [artifactChannel(ds)]: 1 }));
    streamB.close();second.abort();
    await vi.waitFor(()=>expect(subscriptions()).toEqual({}));
    expect((await getArtifactById(ds))!.access).toBe('readwrite');
  });
});
