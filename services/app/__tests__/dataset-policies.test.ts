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
    markup: `<Helmet><Query name="rows">{\`select * from ref_${ds}\`}</Query><Mutation name="add">{\`insert into ref_${ds} values ($n)\`}</Mutation><Mutation name="remove">{\`delete from ref_${ds}\`}</Mutation><Value name="n" type="number" default={2} /></Helmet><Button run="$add">Add</Button><DataTable data="$rows" />`,
  });
  const policy = {
    version: 1,
    enforcement: 'enabled',
    tables: [
      {
        table: { schema: 'public', name: 'rows' },
        insert_permissions: [
          {
            role: 'visitor',
            permission: { columns: '*', check: { n: { _gt: 0 } } },
          },
        ],
      },
    ],
    delegated_mutations: {
      audience: 'anyone',
      operations: ['insert'],
      via: 'declared_mutation',
    },
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
it('requires explicit public mutation authority, then applies row and operation constraints', async () => {
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
it('fences administration by owner and revision, and removing delegation revokes writes', async () => {
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
  expect(
    await setDatasetPolicy(
      f.actor,
      f.ds,
      { ...f.policy, delegated_mutations: undefined },
      1,
    ),
  ).toMatchObject({ revision: 2 });
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

it('does not reuse editor policy after demotion to a delegated visitor at commit', async () => {
  const f = await fixture(),
    friend = await mintToken('policy-editor'),
    user = await createUser({ email: 'mxmx_test_policy_editor@example.com' });
  await claimToken(user.id, friend.token);
  const cookie = await agentCookie([friend.id]);
  await updateSharingFor(f.actor, f.ds, {
    shares: [{ email: user.email, role: 'editor' }],
  });
  await setDatasetPolicy(
    f.actor,
    f.ds,
    {
      ...f.policy,
      tables: [
        {
          ...f.policy.tables[0],
          delete_permissions: [{ role: 'editor', permission: { filter: {} } }],
        },
      ],
    },
    0,
  );
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
    const response = await mutate(
      request(`/a/${f.doc}/mutate`, {
        method: 'POST',
        cookie,
        json: { mutation: 'remove' },
      }),
      { params: Promise.resolve({ id: f.doc }) },
    );
    expect(response.status).toBe(403);
    expect((await getArtifactById(f.ds))?.version).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
