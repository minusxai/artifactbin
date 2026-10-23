/** Native dataset aliases invalidate readers; reconnect always refetches authoritative revisions. */
import { beforeEach, expect, it } from 'vitest';
import { identityForUser, createUser, claimToken } from '@/lib/accounts';
import { changeMembership, getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import { observedRequest } from './conditional-request';
import { nativeHtml } from './native-html-fixture';
import { request, useAppHarness, mintAccountToken } from './harness';
import { sseStream } from './sse';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as mutate } from '@/app/api/artifacts/[id]/mutate/route';
import { PUT } from '@/app/api/artifacts/[id]/route';
import { POST } from '@/app/api/artifacts/route';
import {
  resetLiveSubscriptions,
  liveChannelCount,
} from '@/lib/publish/realtime/live';
useAppHarness();
beforeEach(resetLiveSubscriptions);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const linked = (id: string) =>
  `<!doctype html><html><head><link rel="af-dataset" data-af-name="choices" href="ref:${id}"></head><body><p>Choices</p></body></html>`;
async function fixture() {
  const token = await mintAccountToken('live-data');
  const create = async (json: object) => {
    const r = await POST(
      request('/api/artifacts', {
        method: 'POST',
        token: token.token,
        json: { visibility: 'public', ...json },
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return await r.json();
  };
  const ds = await create({
    dataset: [{ choice: 'ramen' }],
    access: 'readwrite',
  });
  return { token, create, ds };
}
const connect = async (id: string) => {
  const r = await eventsRoute(request(`/a/${id}/events`), params(id));
  expect(r.status).toBe(200);
  return sseStream(r.body!);
};
it('refreshes membership and action permissions without publishing a version', async () => {
  const owner = await createUser({
      email: 'mxmx_test_member_stream@example.com',
    }),
    token = await mintAccountToken('members', owner.id);
  await claimToken(owner.id, token.token);
  const made = await POST(
    request('/api/artifacts', {
      method: 'POST',
      token: token.token,
      json: { html: nativeHtml('<p>Members</p>'), visibility: 'public' },
    }),
  );
  expect(made.status).toBe(201);
  const doc = await made.json();
  const stream = await connect(doc.id);
  try {
    await stream.named('message');
    await changeMembership(identityForUser(owner.id, token.id), doc.id, {
      action: 'leave',
    });
    expect(
      (await stream.next(2)).find((e) => e.event === 'data')?.data,
    ).toMatchObject({ datasets: ['_members'], version: 1 });
  } finally {
    stream.close();
  }
});
it('names the native alias after committed dataset mutation, retaining one subscription per dependency', async () => {
  const { token, create, ds } = await fixture(),
    doc = await create({ html: linked(ds.id) }),
    stream = await connect(doc.id);
  try {
    expect(
      (await stream.next(2)).find((e) => e.event === 'data')?.data,
    ).toMatchObject({
      datasets: ['choices'],
      revisions: { choices: expect.stringContaining(`dataset:${ds.id}:1:`) },
    });
    expect(liveChannelCount()).toBe(3);
    const written = await mutate(
      request(`/api/artifacts/${ds.id}/mutate`, {
        method: 'POST',
        token: token.token,
        json: { sql: "insert into public.rows (choice) values ('tacos')" },
      }),
      params(ds.id),
    );
    expect(written.status).toBe(200);
    expect((await stream.named('data'))[0]?.data).toMatchObject({
      datasets: ['choices'],
      revisions: { choices: expect.stringContaining(`dataset:${ds.id}:2:`) },
    });
  } finally {
    stream.close();
  }
});
it('a folder hears its own child without adding a second channel', async () => {
  const { create } = await fixture(),
    folder = await create({ format: 'folder', title: 'Folder' }),
    stream = await connect(folder.id);
  try {
    await stream.named('message');
    expect(liveChannelCount()).toBe(1);
    await create({ html: nativeHtml('<p>Filed</p>'), parent_id: folder.id });
    expect(
      (await stream.next(2)).find((e) => e.event === 'data')?.data.datasets,
    ).toEqual([folder.id]);
  } finally {
    stream.close();
  }
});
it('reconnect refetches the current revision including missed writes without replaying mutation', async () => {
  const { token, create, ds } = await fixture(),
    doc = await create({ html: linked(ds.id) }),
    first = await connect(doc.id);
  const opening = await first.next(2);
  first.close();
  const before = opening.find((e) => e.event === 'data')!.data.revisions;
  expect(
    (
      await mutate(
        request(`/api/artifacts/${ds.id}/mutate`, {
          method: 'POST',
          token: token.token,
          json: { sql: "insert into public.rows (choice) values ('tacos')" },
        }),
        params(ds.id),
      )
    ).status,
  ).toBe(200);
  const again = await connect(doc.id);
  try {
    const data = (await again.next(2)).find((e) => e.event === 'data')!.data;
    expect(data.datasets).toEqual(['choices']);
    expect(data.revisions).not.toEqual(before);
    expect(data.revisions).toMatchObject({
      choices: expect.stringContaining(`dataset:${ds.id}:2:`),
    });
    expect(await loadDatasetRows((await getArtifactById(ds.id))!)).toEqual([
      { choice: 'ramen' },
      { choice: 'tacos' },
    ]);
  } finally {
    again.close();
  }
});
it('whole-dataset replacement invalidates aliases while unrelated pages hear nothing', async () => {
  const { token, create, ds } = await fixture(),
    reader = await create({ html: linked(ds.id) }),
    other = await create({ html: nativeHtml('<p>Unrelated</p>') }),
    a = await connect(reader.id),
    b = await connect(other.id);
  try {
    await a.named('data');
    await b.named('message');
    expect(
      (
        await PUT(
          await observedRequest(`/api/artifacts/${ds.id}`, {
            method: 'PUT',
            token: token.token,
            json: { dataset: [{ choice: 'salad' }] },
          }),
          params(ds.id),
        )
      ).status,
    ).toBe(200);
    expect((await a.named('data'))[0]?.data.datasets).toEqual(['choices']);
    expect((await b.next(1, 300)).filter((e) => e.event === 'data')).toEqual(
      [],
    );
  } finally {
    a.close();
    b.close();
  }
});
it('a newly published native link is subscribed before its version is announced', async () => {
  const { token, create, ds } = await fixture(),
    doc = await create({ html: nativeHtml('<p>Prose</p>') }),
    stream = await connect(doc.id);
  try {
    await stream.named('message');
    expect(liveChannelCount()).toBe(2);
    expect(
      (
        await PUT(
          await observedRequest(`/api/artifacts/${doc.id}`, {
            method: 'PUT',
            token: token.token,
            json: { html: linked(ds.id) },
          }),
          params(doc.id),
        )
      ).status,
    ).toBe(200);
    const events = [...await stream.named('data'),...await stream.named('message')];
    expect(events.find((e) => e.event === 'data')?.data.datasets).toEqual([
      'choices',
    ]);
    expect(events.find((e) => e.event === 'message')?.data.version).toBe(2);
    expect(liveChannelCount()).toBe(3);
  } finally {
    stream.close();
  }
});
