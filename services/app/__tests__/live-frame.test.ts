/** Retained dataset viewer frames and native publication pings. Native pages reload raw HTML;
 * compiler nodes/CSS/dataflow projections are replaced by native-html-serving/core tests. */
import { afterAll, beforeEach, expect, it } from 'vitest';
import { POST } from '@/app/api/artifacts/route';
import { PUT } from '@/app/api/artifacts/[id]/route';
import { POST as mutate } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as authorize } from '@/app/a/[id]/events/authorize/route';
import { GET as frame } from '@/app/a/[id]/events/frame/route';
import { GET as events } from '@/app/a/[id]/events/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { resetLiveSubscriptions } from '@/lib/publish/realtime/live';
import { resetFrameCache, frameBuilds } from '@/lib/publish/data/frame';
import { request, useAppHarness, mintAccountToken } from './harness';
import { observedRequest } from './conditional-request';
import { nativeHtml } from './native-html-fixture';
import { readNamed } from './sse';
useAppHarness();
beforeEach(async () => {
  resetFrameCache();
  await resetLiveSubscriptions();
});
afterAll(resetLiveSubscriptions);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function fixture() {
  const owner = await mintAccountToken('frames');
  const create = async (json: object) => {
    const r = await POST(
      request('/api/artifacts', {
        method: 'POST',
        token: owner.token,
        json: { visibility: 'public', ...json },
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return r.json();
  };
  return { owner, create };
}
it('serves the latest native headings and full HTML after a whole-source publication', async () => {
  const { owner, create } = await fixture(),
    doc = await create({
      html: nativeHtml('<h1>First heading</h1><p>Details</p>'),
    });
  expect(
    await (await raw(request(`/a/${doc.id}/raw`), params(doc.id))).text(),
  ).toContain('First heading');
  const changed = await PUT(
    await observedRequest(`/api/artifacts/${doc.id}`, {
      method: 'PUT',
      token: owner.token,
      json: { html: nativeHtml('<h1>Updated heading</h1><p>Details</p>') },
    }),
    params(doc.id),
  );
  expect(changed.status).toBe(200);
  const next = await raw(request(`/a/${doc.id}/raw`), params(doc.id));
  expect(next.status).toBe(200);
  expect(await next.text()).toContain('Updated heading');
});
it('dataset frames contain complete preview data and no compiler flow', async () => {
  const { create } = await fixture(),
    ds = await create({ dataset: [{ a: 1 }, { a: 2 }] }),
    response = await frame(request(`/a/${ds.id}/events/frame`), params(ds.id));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json();
  expect(body).toMatchObject({
    editId: ds.edit_id,
    version: 1,
    format: 'dataset',
    source: null,
  });
  expect(JSON.parse(body.dataPreview)).toEqual([{ a: 1 }, { a: 2 }]);
  expect(body.dataflow).toBeUndefined();
});
it('caches dataset frames per committed edit head and refreshes after a mutation', async () => {
  const { owner, create } = await fixture(),
    ds = await create({ dataset: [{ a: 1 }], access: 'readwrite' });
  const before = frameBuilds();
  await frame(request(`/a/${ds.id}/events/frame`), params(ds.id));
  await frame(request(`/a/${ds.id}/events/frame`), params(ds.id));
  expect(frameBuilds() - before).toBe(1);
  expect(
    (
      await mutate(
        request(`/api/artifacts/${ds.id}/mutate`, {
          method: 'POST',
          token: owner.token,
          json: { sql: 'insert into public.rows (a) values (2)' },
        }),
        params(ds.id),
      )
    ).status,
  ).toBe(200);
  const next = await (
    await frame(request(`/a/${ds.id}/events/frame`), params(ds.id))
  ).json();
  expect(next.version).toBe(2);
  expect(JSON.parse(next.dataPreview)).toEqual([{ a: 1 }, { a: 2 }]);
  expect(frameBuilds() - before).toBe(2);
});
it('dataset frame access is the same uniform private-resource boundary', async () => {
  const { owner, create } = await fixture(),
    ds = await create({ dataset: [{ secret: 1 }], visibility: 'private' });
  expect(
    (await frame(request(`/a/${ds.id}/events/frame`), params(ds.id))).status,
  ).toBe(404);
  expect(
    (await frame(request('/a/nope00/events/frame'), params('nope00'))).status,
  ).toBe(404);
  expect(
    (
      await frame(
        request(`/a/${ds.id}/events/frame`, {
          actor: {
            credential: 'session',
            userId: owner.userId!,
            email: owner.email!,
            emailVerified: true,
          },
        }),
        params(ds.id),
      )
    ).status,
  ).toBe(200);
});
it('authorizes the native page and every live dataset dependency for a relay', async () => {
  const { create } = await fixture(),
    ds = await create({ dataset: [{ a: 1 }] }),
    doc = await create({
      html: `<!doctype html><html><head><link rel="af-dataset" data-af-name="rows" href="ref:${ds.id}"></head><body>Rows</body></html>`,
    });
  const response = await authorize(
    request(`/a/${doc.id}/events/authorize`),
    params(doc.id),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    editId: doc.edit_id,
    channels: [
      `artifact_${doc.id.toLowerCase()}`,
      `artifact_${ds.id.toLowerCase()}`,
    ],
  });
  expect(
    (await authorize(request('/a/nope00/events/authorize'), params('nope00')))
      .status,
  ).toBe(404);
});
it('native source publication streams only a head ping, not HTML or compiler nodes', async () => {
  const { create } = await fixture(),
    doc = await create({ html: nativeHtml('<p>Hello</p>') }),
    response = await events(request(`/a/${doc.id}/events`), params(doc.id));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const [ping] = await readNamed(response.body!, 'message');
  expect(ping?.event).toBe('message');
  expect(ping?.data).toEqual({ editId: doc.edit_id, version: 1, by: null });
});
