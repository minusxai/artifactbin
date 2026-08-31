/**
 * `access` — the WRITE ACL on a dataset, the sibling of `visibility`:
 * `'read'` (the default, every existing dataset) or `'readwrite'` (documents
 * the owner publishes may write rows through a `<Mutation>`). Set where
 * visibility is set — create, PUT, the session PATCH, the sharing surface —
 * and echoed wherever a dataset is read back, so an agent knows before it
 * writes a mutation. Datasets only: nothing else is writable.
 */
import { describe, expect, it } from 'vitest';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { GET as listRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PATCH as sessionPatchRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as sharingGet, PUT as sharingPut } from '@/app/api/my/artifacts/[id]/sharing/route';
import { getArtifactById } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts?v=2', { method: 'POST', token: token, json: body }));
const ROWS = [{ choice: 'ramen', who: 'seed' }];

describe('access on the bearer API', () => {
  it('a dataset is born read-only, and says so on create, read-back and list', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { dataset: ROWS });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; access: string };
    expect(body.access).toBe('read');
    const read = (await (await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }))).json()) as { access: string };
    expect(read.access).toBe('read');
    const list = (await (await listRoute(request('/api/artifacts', { token: t.token }))).json()) as { artifacts: Array<{ id: string; access: string }> };
    expect(list.artifacts.find((a) => a.id === body.id)?.access).toBe('read');
  });

  it('access: readwrite on create is stored and echoed, with a Mutation in the usage hint', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { dataset: ROWS, access: 'readwrite' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; access: string; usage: string };
    expect(body.access).toBe('readwrite');
    expect(body.usage).toContain('<Mutation');
    expect((await getArtifactById(body.id))!.access).toBe('readwrite');
  });

  it('PUT flips access alongside a refresh; absent keeps it', async () => {
    const t = await mintToken('t');
    const id = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const flip = await putArtifactRoute(request(`/api/artifacts/${id}?v=2`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'readwrite' } }), params({ id }));
    expect(flip.status).toBe(200);
    expect((await getArtifactById(id))!.access).toBe('readwrite');
    const keep = await putArtifactRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: t.token, json: { dataset: [...ROWS, { choice: 'tacos', who: 'x' }] } }), params({ id }));
    expect(keep.status).toBe(200);
    expect((await getArtifactById(id))!.access).toBe('readwrite');
  });

  it('refuses an unknown value, and access on anything that is not a dataset', async () => {
    const t = await mintToken('t');
    const bad = await create(t.token, { dataset: ROWS, access: 'write' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_access');
    const doc = await create(t.token, { markup: '<p>hi</p>', access: 'readwrite' });
    expect(doc.status).toBe(400);
    expect(((await doc.json()) as { error: string }).error).toBe('access_datasets_only');
  });
});

describe('access on the browser surfaces', () => {
  it('PATCH /api/my/artifacts/<id> { access } flips it with no version bump; a document answers access_datasets_only', async () => {
    const t = await mintToken('t');
    const cookie = await agentCookie([t.id]);
    const id = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const res = await sessionPatchRoute(request(`/api/my/artifacts/${id}?v=2`, { method: 'PATCH', cookie: cookie, json: { access: 'readwrite' } }), params({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ id, access: 'readwrite' });
    const row = (await getArtifactById(id))!;
    expect(row.access).toBe('readwrite');
    expect(row.version).toBe(1);

    const doc = ((await (await create(t.token, { markup: '<p>hi</p>' })).json()) as { id: string }).id;
    const nope = await sessionPatchRoute(request(`/api/my/artifacts/${doc}`, { method: 'PATCH', cookie: cookie, json: { access: 'readwrite' } }), params({ id: doc }));
    expect(nope.status).toBe(400);
  });

  it('the sharing surface carries access and the documents that write here, for an account owner', async () => {
    const t = await mintToken('t');
    const user = await createUser({ email: 'owner@x.com' });
    await claimToken(user.id, t.token);
    const cookie = await agentCookie([t.id]);
    const ds = ((await (await create(t.token, { dataset: ROWS, access: 'readwrite' })).json()) as { id: string }).id;
    const doc = await create(t.token, {
      title: 'Lunch poll',
      markup: `<Helmet><Value name="c" /><Mutation name="vote">{\`insert into ref_${ds} (choice, who) values ($c, 'x')\`}</Mutation></Helmet><div><Button run="$vote">Vote</Button></div>`,
    });
    expect(doc.status).toBe(201);

    const got = await sharingGet(request(`/api/my/artifacts/${ds}/sharing`, { cookie: cookie }), params({ id: ds }));
    expect(got.status).toBe(200);
    const state = (await got.json()) as { visibility: string; access: string; writtenBy: Array<{ id: string; title: string | null; mutations: string[] }> };
    expect(state.access).toBe('readwrite');
    expect(state.writtenBy).toEqual([{ id: ((await doc.json()) as { id: string }).id, title: 'Lunch poll', mutations: ['vote'] }]);

    const put = await sharingPut(request(`/api/my/artifacts/${ds}/sharing`, { method: 'PUT', cookie: cookie, json: { access: 'read' } }), params({ id: ds }));
    expect(put.status).toBe(200);
    expect(((await put.json()) as { access: string }).access).toBe('read');
    expect((await getArtifactById(ds))!.access).toBe('read');
  });

  it('every door refuses `access` on a NON-dataset the same way — 400, never a silent 200', async () => {
    // The sharing door validated `access` itself instead of through the shared
    // parser, and had no format check: the SQL guard (`AND format='dataset'`)
    // dropped the write and the caller got 200 for a change that never
    // happened, where create/PUT/PATCH answer 400. One rule, one answer.
    const t = await mintToken('t');
    const cookie = await agentCookie([t.id]);
    const doc = ((await (await create(t.token, { markup: '<p>not a dataset</p>' })).json()) as { id: string }).id;

    const viaSharing = await sharingPut(
      request(`/api/my/artifacts/${doc}/sharing?v=2`, { method: 'PUT', cookie: cookie, json: { access: 'readwrite' } }),
      params({ id: doc }),
    );
    const viaPatch = await sessionPatchRoute(
      request(`/api/my/artifacts/${doc}?v=2`, { method: 'PATCH', cookie: cookie, json: { access: 'readwrite' } }),
      params({ id: doc }),
    );
    expect([viaSharing.status, viaPatch.status]).toEqual([400, 400]);
    expect(((await viaSharing.json()) as { error: string }).error).toBe('access_datasets_only');
    expect(((await viaPatch.json()) as { error: string }).error).toBe('access_datasets_only');
  });

  it('the preview refusal reads the same at every door', async () => {
    const t = await mintToken('t');
    const cookie = await agentCookie([t.id]);
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    // No ?v=2 anywhere: both doors must refuse, and name the same way out.
    const sharing = await sharingPut(request(`/api/my/artifacts/${ds}/sharing`, { method: 'PUT', cookie: cookie, json: { access: 'readwrite' } }), params({ id: ds }));
    const patch = await sessionPatchRoute(request(`/api/my/artifacts/${ds}`, { method: 'PATCH', cookie: cookie, json: { access: 'readwrite' } }), params({ id: ds }));
    expect([sharing.status, patch.status]).toEqual([400, 400]);
    expect(await sharing.json()).toEqual(await patch.json());
  });

  it('an ANONYMOUS owner manages sharing too — writes anchor on the token, not an account; only private needs one', async () => {
    const t = await mintToken('t');
    const cookie = await agentCookie([t.id]);
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const got = await sharingGet(request(`/api/my/artifacts/${ds}/sharing`, { cookie: cookie }), params({ id: ds }));
    expect(got.status).toBe(200);
    expect((await got.json()) as object).toMatchObject({ visibility: 'public', access: 'read', shares: [] });
    const rw = await sharingPut(request(`/api/my/artifacts/${ds}/sharing?v=2`, { method: 'PUT', cookie: cookie, json: { access: 'readwrite', visibility: 'unlisted' } }), params({ id: ds }));
    expect(rw.status).toBe(200);
    expect((await getArtifactById(ds))!).toMatchObject({ access: 'readwrite', visibility: 'unlisted' });
    const priv = await sharingPut(request(`/api/my/artifacts/${ds}/sharing`, { method: 'PUT', cookie: cookie, json: { visibility: 'private' } }), params({ id: ds }));
    expect(priv.status).toBe(400);
    expect(((await priv.json()) as { error: string }).error).toBe('private_requires_account');
    // A stranger's cookie is the uniform 404.
    const other = await mintToken('o');
    const strangers = await agentCookie([other.id]);
    expect((await sharingGet(request(`/api/my/artifacts/${ds}/sharing`, { cookie: strangers }), params({ id: ds }))).status).toBe(404);
  });
});
