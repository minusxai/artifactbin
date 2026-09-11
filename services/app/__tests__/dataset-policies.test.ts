import { getDb } from '@/lib/db';
import { createUser, claimToken } from '@/lib/users';
import { it, expect, vi } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { GET as query } from '@/app/a/[id]/query/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import {
  getArtifactById,
  replaceArtifactFor,
  setAccessFor,
  updateSharingFor,
} from '@/lib/artifacts';
import { GET as readPolicy } from '@/app/api/my/artifacts/[id]/policy/route';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { mintToken } from '@/lib/tokens';
import { agentCookie, request, useAppHarness } from './harness';
useAppHarness();
async function fixture() {
  const owner = await mintToken('policy-owner');
  const actor = { tokenId: owner.id, userId: null };
  const publish = async (body: object) => {
    const r = await create(
      request('/api/artifacts', {
        method: 'POST',
        token: owner.token,
        json: body,
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return (await r.json()).id as string;
  };
  const ds = await publish({ dataset: [{ n: 1 }], access: 'readwrite' });
  const doc = await publish({
    markup: `<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values ($n)\`}</Mutation><Mutation name="remove" source="ref:${ds}">{\`delete from public.rows\`}</Mutation><Value name="n" type="number" default={2} /></Helmet><Button run="$add">Add</Button><DataTable data="$rows" />`,
  });
  const policy = {
    version: 1,
    enforcement: 'enabled',
    tables: [
      {
        table: { schema: 'public', name: 'rows' },
        insert_permissions: [
          {
            role: 'viewer',
            permission: { columns: '*', check: { n: { _gt: 0 } } },
          },
        ],
      },
    ],
  };
  const write = (mutation = 'add', n = 2) =>
    mutate(
      request(`/a/${doc}/mutate`, {
        method: 'POST',
        json: { mutation, values: { n } },
      }),
      { params: Promise.resolve({ id: doc }) },
    );
  return { owner, actor, ds, doc, policy, write };
}
it('applies one data policy to everyone with view access', async () => {
  const f = await fixture();
  expect((await f.write()).status).toBe(403);
  expect(await setDatasetPolicy(f.actor, f.ds, f.policy, 0)).toMatchObject({
    revision: 1,
  });
  expect((await f.write()).status).toBe(200);
  expect((await f.write('remove')).status).toBeGreaterThanOrEqual(400);
  expect((await f.write('add', -1)).status).toBeGreaterThanOrEqual(400);
  expect((await getArtifactById(f.ds))?.version).toBe(2);
  await setAccessFor(f.actor, f.ds, 'read');
  expect((await f.write()).status).toBe(403);
});
it('fences administration by owner and revision, and removing a policy revokes viewer writes', async () => {
  const f = await fixture();
  const stranger = await mintToken('stranger');
  expect(
    await setDatasetPolicy(
      { tokenId: stranger.id, userId: null },
      f.ds,
      f.policy,
      0,
    ),
  ).toBeNull();
  expect(await setDatasetPolicy(f.actor, f.ds, f.policy, 0)).toMatchObject({
    revision: 1,
  });
  expect(await setDatasetPolicy(f.actor, f.ds, f.policy, 0)).toMatchObject({
    conflict: true,
  });
  expect(await setDatasetPolicy(f.actor, f.ds, null, 1)).toMatchObject({
    revision: 2,
  });
  expect((await f.write()).status).toBe(403);
});
it('cannot evade active policy through ordinary file replacement', async () => {
  const f = await fixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const row = (await getArtifactById(f.ds))!;
  expect(
    await replaceArtifactFor(f.actor, f.ds, {
      format: 'dataset',
      content: '',
      source: null,
      meta: row.meta,
    }),
  ).toBeNull();
});
it('returns per-mutation capability previews without executing a write', async () => {
  const f = await fixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const response = await query(request(`/a/${f.doc}/query?q=%7B%7D`), {
    params: Promise.resolve({ id: f.doc }),
  });
  const body = await response.json();
  expect(body.mutationAccess.add).toBeNull();
  expect(body.mutationAccess.remove).toBeTruthy();
  expect((await getArtifactById(f.ds))?.version).toBe(1);
});

async function sharedFixture(
  role: 'viewer' | 'commenter' | 'editor' = 'viewer',
) {
  const f = await fixture();
  const owner = await createUser({ email: 'mxmx_test_data_owner@example.com' });
  await claimToken(owner.id, f.owner.token);
  const actor = { tokenId: f.owner.id, userId: owner.id };
  const user = await createUser({ email: 'mxmx_test_data_reader@example.com' }),
    token = await mintToken('reader');
  await claimToken(user.id, token.token);
  const cookie = await agentCookie([token.id]);
  await updateSharingFor(actor, f.ds, {
    visibility: 'private',
    shares: [{ email: user.email, role }],
  });
  const write = () =>
    mutate(
      request(`/a/${f.doc}/mutate`, {
        method: 'POST',
        cookie,
        json: { mutation: 'add', values: { n: 3 } },
      }),
      { params: Promise.resolve({ id: f.doc }) },
    );
  return { ...f, actor, user, token, cookie, write };
}
it.each(['viewer', 'commenter', 'editor'] as const)(
  'lets a shared %s use the same policy without a separate grant',
  async (role) => {
    const f = await sharedFixture(role);
    await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
    expect((await f.write()).status).toBe(200);
    expect(
      await setDatasetPolicy(
        { tokenId: f.token.id, userId: f.user.id },
        f.ds,
        null,
        1,
      ),
    ).toBeNull();
    const ownerResponse = await mutate(
      request(`/a/${f.doc}/mutate`, {
        method: 'POST',
        cookie: await agentCookie([f.owner.id]),
        json: { mutation: 'remove' },
      }),
      { params: Promise.resolve({ id: f.doc }) },
    );
    expect(ownerResponse.status).toBe(403);
    await updateSharingFor(f.actor, f.ds, { shares: [] });
    expect((await f.write()).status).toBe(403);
  },
);
it('requires dataset view access even when its declared app is public', async () => {
  const f = await sharedFixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const response = await mutate(
    request(`/a/${f.doc}/mutate`, {
      method: 'POST',
      json: { mutation: 'add', values: { n: 3 } },
    }),
    { params: Promise.resolve({ id: f.doc }) },
  );
  expect(response.status).toBe(403);
});
it('rechecks dataset sharing inside the commit even after successful execution', async () => {
  const f = await sharedFixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const db = await getDb(),
    original = db.query.bind(db);
  let revoked = false;
  const spy = vi
    .spyOn(db, 'query')
    .mockImplementation(async (sql: string, values?: unknown[]) => {
      if (
        !revoked &&
        sql.includes('WITH updated AS') &&
        sql.includes('actor_user_id = $13')
      ) {
        revoked = true;
        await original('DELETE FROM artifact_shares WHERE artifact_id=$1', [
          f.ds,
        ]);
      }
      return original(sql, values);
    });
  try {
    expect((await f.write()).status).toBe(403);
    expect(revoked).toBe(true);
    expect((await getArtifactById(f.ds))?.version).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

it('lets editors inspect policies without granting policy administration', async () => {
  const f = await sharedFixture('editor');
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const response = await readPolicy(
    request(`/api/my/artifacts/${f.ds}/policy`, { cookie: f.cookie }),
    { params: Promise.resolve({ id: f.ds }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    canManage: false,
    policy: f.policy,
  });
});
