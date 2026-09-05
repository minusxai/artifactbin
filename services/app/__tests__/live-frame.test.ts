/**
 * THE FRAME IS STATELESS AND COMPLETE, AND THE STREAM CARRIES ONLY PINGS.
 *
 * Before: `/a/<id>/events` re-ran the whole story pipeline (parse, SSR nodes,
 * DuckDB) PER CONNECTION on every wakeup, and omitted CSS/dataflow "when
 * unchanged since the last frame on this connection" — which made the frame
 * uncacheable and the stream unrelayable by anything blind to content.
 *
 * Now: the stream says "version N happened" (`{editId, version, by}`), a
 * client fetches `GET /a/<id>/events/frame`, which answers the WHOLE frame —
 * CSS always, the declarations' signature always, never dataflow rows (the
 * client re-runs its queries through the transport it already has when the
 * signature moves) — under the read ACL, cached per (id, edit_id). A relay
 * that can only forward `{channel, edit_id}` is now enough.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as authorizeRoute } from '@/app/a/[id]/events/authorize/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';


import { resetLiveSubscriptions } from '@/lib/story/live';
import { resetFrameCache, frameBuilds } from '@/lib/story/frame';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (path: string, method = 'GET', body?: unknown, token?: string) =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const DOC = (ds: string) => `<div><Helmet><Query name="q">{\`select count(*) as n from ref_${ds}\`}</Query></Helmet><p>hello</p><Number data="$q" /></div>`;

async function firstEvent(body: ReadableStream<Uint8Array>): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const line = new TextDecoder().decode(value).split('\n').find((l) => l.startsWith('data:'))!;
  return JSON.parse(line.slice(5));
}

beforeEach(async () => { resetFrameCache();
  sessionUser.id = ''; sessionUser.email = '';
  await resetLiveSubscriptions();
});
afterAll(async () => { await resetLiveSubscriptions(); });

async function publicDoc() {
  const t = await mintToken('t');
  const ds = await (await createArtifactRoute(jreq('/api/artifacts', 'POST', { dataset: [{ a: 1 }, { a: 2 }] }, t.token))).json();
  const doc = await (await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: DOC(ds.id) }, t.token))).json();
  return { t, ds, doc };
}

describe('GET /a/<id>/events/frame', () => {
  it('answers the COMPLETE frame: nodes, CSS (always), author CSS, design, the declarations signature — and never dataflow rows', async () => {
    const { doc, ds } = await publicDoc();
    const res = await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const frame = await res.json();
    expect(frame).toMatchObject({ editId: doc.edit_id, version: 1, format: 'markup' });
    expect(Array.isArray(frame.nodes)).toBe(true);
    expect(frame).toHaveProperty('compiledCss');
    expect(frame).toHaveProperty('authorCss');
    expect(typeof frame.declarations).toBe('string');
    expect(frame.dataflow?.flow, 'the FLOW travels so a client can rebind').toBeTruthy();
    expect(frame.dataflow?.state, 'rows never travel — the client re-runs').toBeUndefined();
    expect(frame.datasets).toEqual([ds.id]);
  });

  it('is cached per (id, edit_id): two readers cost one build, and an edit costs one more', async () => {
    const { t, doc } = await publicDoc();
    const before = frameBuilds();
    await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id));
    await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id));
    expect(frameBuilds() - before).toBe(1);
    const edit = await editsRoute(jreq(`/api/artifacts/${doc.id}/edits`, 'POST', { edit_id: doc.edit_id, source: '<div><p>changed</p></div>' }, t.token), params(doc.id));
    expect(edit.status).toBe(200);
    const fresh = await (await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id))).json();
    expect(fresh.version).toBe(2);
    expect(frameBuilds() - before).toBe(2);
  });

  it('runs the read ACL: a private document is the uniform 404 to a stranger and a frame to its owner', async () => {
    const owner = await createUser({ email: 'mxmx_test_owner@example.com' });
    const t = await mintToken('o'); await claimToken(owner.id, t.token);
    const doc = await (await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: '<div><p>secret</p></div>', visibility: 'private' }, t.token))).json();
    expect((await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id))).status).toBe(404);
    expect((await frameRoute(jreq(`/a/nope00/events/frame`), params('nope00'))).status).toBe(404);
    sessionUser.id = owner.id; sessionUser.email = owner.email;
    expect((await frameRoute(jreq(`/a/${doc.id}/events/frame`), params(doc.id))).status).toBe(200);
  });
});

describe('GET /a/<id>/events/authorize', () => {
  it('names the channels a relay must subscribe — the document and every dataset it reads — under the read ACL', async () => {
    const { doc, ds } = await publicDoc();
    const res = await authorizeRoute(jreq(`/a/${doc.id}/events/authorize`), params(doc.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.editId).toBe(doc.edit_id);
    expect(body.channels).toEqual([`artifact_${doc.id.toLowerCase()}`, `artifact_${ds.id.toLowerCase()}`]);
    expect((await authorizeRoute(jreq(`/a/nope00/events/authorize`), params('nope00'))).status).toBe(404);
  });
});

describe('GET /a/<id>/events is a PING stream', () => {
  it('sends the current head as {editId, version, by} and nothing a relay would have to understand', async () => {
    const { doc } = await publicDoc();
    const res = await eventsRoute(jreq(`/a/${doc.id}/events`), params(doc.id));
    const ping = await firstEvent(res.body!);
    expect(ping).toEqual({ editId: doc.edit_id, version: 1, by: null });
    expect(ping).not.toHaveProperty('nodes');
    expect(ping).not.toHaveProperty('source');
  });
});
