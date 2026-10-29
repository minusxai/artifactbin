import {nativeHtml} from './native-html-fixture';
import {observedRequest} from '@/__tests__/conditional-request';
/**
 * The single-identifier contract: an artifact has ONE id — 6 chars of
 * [a-zA-Z0-9] — which is the API handle, the ref:<id> target, and the URL
 * address. There is no slug anywhere on the wire, and /a/<id> is the
 * namespace for the page, raw bytes, and events.
 *
 * Also pins the PGLite LISTEN case-folding hazard: pg_notify is exact-text
 * while PGLite's listen() lowercases unquoted channel names, so a mixed-case
 * id would silently never wake its watchers unless the channel name is
 * lowercased at every site. The mixed-case tests here are deterministic
 * (the id is forced), not left to the RNG.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listArtifactsRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken } from '@/__tests__/harness';


import { ID_RE } from '@/lib/platform';
import { useAppHarness, request } from '@/__tests__/harness';
import { sseStream } from '@/__tests__/sse';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function mint(): Promise<string> {
  return (await mintAccountToken('mxmx_test_fixture')).token;
}

async function create(token: string, body: Record<string, unknown>) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }));
  expect(res.status).toBe(201);
  return res.json() as Promise<Record<string, unknown> & { id: string; url: string; edit_id: string }>;
}

/** Force a KNOWN id (the RNG can't be trusted to produce a mixed-case one). */
async function renameArtifact(oldId: string, newId: string): Promise<void> {
  const db = await harness.db();
  await db.query('UPDATE artifact_edits SET artifact_id = $2 WHERE artifact_id = $1', [oldId, newId]);
  await db.query('UPDATE artifacts SET id = $2 WHERE id = $1', [oldId, newId]);
}

/** Read SSE data frames until `count` arrive or the budget runs out. */

describe('the one identifier', () => {
  it('create returns a 6-char [a-zA-Z0-9] id, a /a/<id> url, and NO slug', async () => {
    const token = await mint();
    const body = await create(token, { title: 'x', html:nativeHtml('<h1>hi</h1>') });
    expect(body.id).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(body.id).toMatch(ID_RE);
    expect(body.url).toBe(`${BASE}/a/${body.id}`);
    expect('slug' in body).toBe(false);
  });

  it('list and single-read carry url = /a/<id> and no slug field', async () => {
    const token = await mint();
    const created = await create(token, { title: 'x', html:nativeHtml('<h1>hi</h1>') });

    const single = await (await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: token }), params({ id: created.id }))).json();
    expect(single.url).toBe(`${BASE}/a/${created.id}`);
    expect('slug' in single).toBe(false);

    const list = await (await listArtifactsRoute(request('/api/artifacts', { token: token }))).json();
    expect(list.artifacts).toHaveLength(1);
    expect(list.artifacts[0].url).toBe(`${BASE}/a/${created.id}`);
    expect('slug' in list.artifacts[0]).toBe(false);
  });

  it('the id is the ref target: ref_<id> binds in SQL, ref_<unknown> 400s as unresolvable', async () => {
    const token = await mint();
    const ds = await create(token, {
      title: 'sales',
      dataset: [{ region: 'east', total: 1 }, { region: 'west', total: 2 }],
    });
    const chart=(dsId:string)=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="rows_data" href="ref:${dsId}" data-af-mode="live"></head><body><h1>Sales</h1></body></html>`;

    const ok = await create(token, { title: 'doc', html: chart(ds.id) });
    const wire = await (await getArtifactRoute(request(`/api/artifacts/${ok.id}`, { token: token }), params({ id: ok.id }))).json();
    expect(wire.html).toContain(`href="ref:${ds.id}"`);

    const bad = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'doc', html: chart('zzzzzzzz') } }),
    );
    expect(bad.status).toBe(400);
    const err = await bad.json();
    expect(err.error).toBe('invalid_dataset_binding');
  });
});

describe('/a/<id> namespace', () => {
  it('serves raw bytes for MIXED-CASE ids and 404s malformed ones', async () => {
    const token = await mint();
    const created = await create(token, { title: 'x', html:nativeHtml('<h1>mixed</h1>') });
    await renameArtifact(created.id, 'AbC123');

    const ok = await rawRoute(request('/a/AbC123/raw'), params({ id: 'AbC123' }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('mixed');
    expect(ok.headers.get('Content-Security-Policy')).toContain("default-src 'none'");

    for (const bad of ['abc12', 'art_abc123', 'abc-12', 'abc_12', 'AbC124']) {
      const res = await rawRoute(request(`/a/${bad}/raw`), params({ id: bad }));
      expect(res.status).toBe(404);
    }
  });

  it('delivers live wakeups for a MIXED-CASE id on PGLite (the case-folding hazard)', async () => {
    const token = await mint();
    const created = await create(token, { title: 'doc', html:nativeHtml('<section><p>alpha</p></section>') });
    await renameArtifact(created.id, 'AbC123');

    const stream = await eventsRoute(request('/a/AbC123/events'), params({ id: 'AbC123' }));
    expect(stream.status).toBe(200);

    const reader = sseStream(stream.body!);
    expect((await reader.named('message'))[0]?.data.version).toBe(1);
    // Comment wakeups may interleave with version pings; only message events carry versions.
    const put = await putArtifact(
      await observedRequest('/api/artifacts/AbC123', { method: 'PUT', token: token, json: { visibility: 'public', html:nativeHtml('<section><p>beta</p></section>') } }),
      params({ id: 'AbC123' }),
    );
    expect(put.status).toBe(200);

    const frames = await reader.named('message');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data.version).toBe(2); // the wakeup arrived — the frame is fetched separately
    const frame = await (await frameRoute(request('/a/AbC123/events/frame'), params({ id: 'AbC123' }))).json();
    expect(frame).toMatchObject({version:2});
    const head=await getArtifactRoute(request('/api/artifacts/AbC123',{token}),params({id:'AbC123'}));expect((await head.json()).html).toContain('beta');
    reader.close();
  });
});
