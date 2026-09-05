/**
 * A document's live stream hears its DATASETS, not only itself. Every write to
 * a dataset already ends in a NOTIFY on that dataset's channel; the stream of
 * a document that reads it now LISTENs there too and sends a small `data`
 * frame naming the dataset — the runtime store re-runs the queries reading
 * it. A separate SSE event name, so the document frame and its editId guard
 * are untouched. The document's ACL is re-checked on the wakeup like any other.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { liveChannelCount, resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
const ROWS = [{ choice: 'ramen' }];

interface SseEvent { event: string; data: Record<string, unknown> }
/** Read SSE events (named or default) until `count` arrive or the budget runs out. */
async function readEvents(body: ReadableStream<Uint8Array>, count: number, budgetMs = 3000): Promise<SseEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const out: SseEvent[] = [];
  let buffer = '';
  const deadline = Date.now() + budgetMs;
  while (out.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())),
    ]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) out.push({ event, data: JSON.parse(data) });
    }
  }
  void reader.cancel().catch(() => {});
  return out;
}

beforeEach(async () => {
  await resetLiveSubscriptions();
});

describe('GET /a/<id>/events hears the document\'s datasets', () => {
  it('a write to a dataset the document reads arrives as an `event: data` frame naming it', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, access: 'readwrite' })).id;
    const doc = (await create(t.token, {
      markup: `<Helmet><Query name="q">{\`select * from ref_${ds}\`}</Query></Helmet><div><Question data="$q" viz={{"kind":"table"}} /></div>`,
    })).id;
    const res = await eventsRoute(request(`/a/${doc}/events`), params({ id: doc }));
    expect(res.status).toBe(200);
    // The document and its one dataset: two channels for one stream.
    expect(liveChannelCount()).toBe(2);
    const write = mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `insert into ref_${ds} (choice) values ('tacos')` } }), params({ id: ds }));
    const events = await readEvents(res.body!, 2);
    expect((await write).status).toBe(200);
    // Both arrive; their ORDER is not a promise the stream makes (the opening
    // document frame is queued behind an object-store read, a data wakeup is not).
    expect(events.some((e) => e.event === 'message')).toBe(true);
    const data = events.find((e) => e.event === 'data');
    expect(data).toBeTruthy();
    expect(data!.data).toMatchObject({ datasets: [ds] });
    expect(typeof data!.data.version).toBe('number');
  });

  it('a FOLDER hears its own children, because its one dependency is itself', async () => {
    /*
     * The folder's scaffold reads `ref_<its own id>`, so the folder is a data
     * dependency of ITSELF — which is the whole reason a child's publish
     * reaches an open folder page with no route of its own. It missed for one
     * clause: the stream followed a document's dependencies only when the
     * format was `markup`, so a folder subscribed to nothing, the write woke
     * only the DOCUMENT channel, and the version ping that came out carried an
     * unchanged version. The listing sat still and nothing anywhere failed.
     */
    const t = await mintToken('t');
    const folder = (await create(t.token, { format: 'folder', title: 'Live folder' })).id;
    const res = await eventsRoute(request(`/a/${folder}/events`), params({ id: folder }));
    expect(res.status).toBe(200);
    // ONE channel for two subscriptions: a folder is both the document and the
    // table it reads, so the id — and therefore the channel — is the same one
    // twice. That coincidence is exactly why this went unnoticed: the stream
    // was already awake on that channel, so the write DID wake it, and what
    // came out was a version ping carrying an unchanged version.
    expect(liveChannelCount()).toBe(1);
    const child = create(t.token, { markup: '<p>filed</p>', parent_id: folder });
    // THREE: the opening frame, the version ping the shared channel also wakes,
    // and the `data` frame that is the point. Reading two would stop on the
    // ping — which is precisely what the broken version sent and nothing else.
    const events = await readEvents(res.body!, 3);
    await child;
    const data = events.find((e) => e.event === 'data');
    expect(data, 'the folder never heard its own child').toBeTruthy();
    expect(data!.data).toMatchObject({ datasets: [folder] });
  });

  it('a document that does not read the dataset hears nothing; a whole-dataset PUT wakes readers too', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const reader = (await create(t.token, {
      markup: `<Helmet><Query name="q">{\`select * from ref_${ds}\`}</Query></Helmet><div><Question data="$q" viz={{"kind":"table"}} /></div>`,
    })).id;
    const bystander = (await create(t.token, { markup: '<div><p>nothing here</p></div>' })).id;
    const a = await eventsRoute(request(`/a/${reader}/events`), params({ id: reader }));
    const b = await eventsRoute(request(`/a/${bystander}/events`), params({ id: bystander }));
    const refresh = putArtifactRoute(request(`/api/artifacts/${ds}`, { method: 'PUT', token: t.token, json: { dataset: [...ROWS, { choice: 'salad' }] } }), params({ id: ds }));
    const [ea, eb] = await Promise.all([readEvents(a.body!, 2), readEvents(b.body!, 2, 800)]);
    expect((await refresh).status).toBe(200);
    expect(ea.some((e) => e.event === 'data' && (e.data.datasets as string[]).includes(ds))).toBe(true);
    expect(eb.filter((e) => e.event === 'data')).toEqual([]);
  });

  it('follows the document: a version that starts reading a dataset subscribes to it', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: '<div><p>prose</p></div>' })).id;
    const res = await eventsRoute(request(`/a/${doc}/events`), params({ id: doc }));
    expect(liveChannelCount()).toBe(1);
    const edit = await putArtifactRoute(request(`/api/artifacts/${doc}`, { method: 'PUT', token: t.token, json: { markup: `<Helmet><Query name="q">{\`select * from ref_${ds}\`}</Query></Helmet><div><Question data="$q" viz={{"kind":"table"}} /></div>` } }), params({ id: doc }));
    expect(edit.status).toBe(200);
    // The opening frame, then the edit's frame; by then the stream follows the dataset.
    const first = await readEvents(res.body!, 2);
    expect(first.filter((e) => e.event === 'message')).toHaveLength(2);
    expect(liveChannelCount()).toBe(2);
  });
});
