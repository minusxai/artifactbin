import { getDb } from '@/lib/platform';
import { identityForUser, createUser, ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import { it, expect, vi } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { artifactState, getArtifactById, replaceArtifactFor, updateSharingFor } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import {linkedGql,liveLink} from '@/__tests__/linked-datasets';
// The policy API serves the app's editor and the read-only view since the old app policy route was retired.
import { GET as readPolicy, PUT as writePolicy } from '@/app/api/artifacts/[id]/policy/route';
import { setDatasetPolicy } from '@/lib/document-data/dataset-policy';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { request, useAppHarness } from '@/__tests__/harness';
useAppHarness();
async function fixture() {
  const owner = await mintToken('policy-owner');
  const actor = identityForUser(owner.userId, owner.id);
  const publish = async (body: object) => {
    const r = await create(
      request('/api/artifacts', {
        method: 'POST',
        token: owner.token,
        json: { visibility: 'public', ...body },
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return (await r.json()).id as string;
  };
  const ds = await publish({ dataset: [{ n: 1 }], access: 'readwrite' });
  const doc = await publish({html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds}"></head><body>Rows</body></html>`});
  // Version 3 (the door refuses v1/v2): every rule role reads and inserts.
  const policy = {
    version: 3,
    tables: [
      {
        table: { schema: 'public', name: 'rows' },
        select_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: { columns: '*', filter: {}, allow_aggregations: true } })),
        insert_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({
          role,
          permission: { columns: '*', check: { n: { _gt: 0 } } },
        })),
      },
    ],
  };
  // A write through the page's generated API: committed only when every root it names answered.
  const link=liveLink(ds);
  const writeAs=async(caller:AccessActor,mutation='add',n=2)=>{
    const row=((await linkedGql(actor,link,'{ data(limit: 1) { _id } }')).data!.data as Array<{_id:string}>)[0]!;
    const reply=mutation==='remove'
      ?await linkedGql(caller,link,'mutation($id: ID!) { delete_data_by_pk(_id: $id) { _id } }',{variables:{id:row._id},pageId:doc})
      :await linkedGql(caller,link,'mutation($n: Float) { insert_data_one(object: {n: $n}) { _id } }',{variables:{n},pageId:doc});
    return {outcome:!reply.errors?.length&&reply.data&&Object.values(reply.data).every(value=>value!==null)?'committed':'rejected'};
  };
  const write=(mutation='add',n=2)=>writeAs(ANONYMOUS_ACTOR,mutation,n);
  return {owner,actor,ds,doc,policy,write,writeAs,link};
}
it('applies one data policy to everyone with view access', async () => {
  const f = await fixture();
  expect((await f.write()).outcome).toBe('rejected');
  expect(await setDatasetPolicy(f.actor, f.ds, f.policy, 0)).toMatchObject({
    revision: 1,
  });
  expect((await f.write()).outcome).toBe('committed');
  expect((await f.write('remove')).outcome).toBe('rejected');
  expect((await f.write('add', -1)).outcome).toBe('rejected');
  expect((await getArtifactById(f.ds))?.version).toBe(2);
  await updateSharingFor(f.actor, f.ds, { access: 'read' });
  expect((await f.write()).outcome).toBe('rejected');
});
it('fences administration by edit access and revision, and removing a policy revokes viewer writes', async () => {
  const f = await fixture();
  const stranger = await mintToken('stranger');
  expect(
    await setDatasetPolicy(
      identityForUser(stranger.userId, stranger.id),
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
  expect((await f.write()).outcome).toBe('rejected');
});
/**
 * THE SECURITY INTENT IS UNCHANGED: a governed dataset's rows are not rewritable
 * by whoever happens to hold edit access — replacing the file is not a side door
 * around the policy. What changed is WHO is refused and WHAT they are told. The
 * OWNER may republish (the dataset would otherwise be frozen the moment it was
 * made writable); a named editor may not, and now hears `policy_locked` instead
 * of a `not_found` about a dataset they are looking straight at.
 */
it('cannot evade active policy through ordinary file replacement', async () => {
  const f = await sharedFixture('editor');
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const row = (await getArtifactById(f.ds))!;
  const editor = identityForUser(f.user.id, f.token.id);
  const refused = await replaceArtifactFor(editor, f.ds, {
    format: 'dataset',
    source: null,
    meta: row.meta,
  });
  expect(refused).toBeInstanceOf(Response);
  expect((refused as Response).status).toBe(409);
  expect(await (refused as Response).json()).toMatchObject({
    error: 'policy_locked',
  });
  const unchanged = (await getArtifactById(f.ds))!;
  expect(unchanged.version).toBe(1);
  expect(unchanged.dataset_policy).toMatchObject({ version: 3 });
});
/**
 * THE DATA-LOSS CHECK. Viewers write rows into this dataset, so the owner's
 * re-push must not be able to overwrite rows it never saw. A viewer's write
 * moves the head; a replacement naming the OLD head is refused, and the rows
 * survive. The CLI names its observed base on every tracked push, which is what
 * makes this the ordinary path rather than a precaution nobody takes.
 */
it('refuses an owner re-push from a stale base, so rows written by viewers survive', async () => {
  const f = await fixture();
  expect(await setDatasetPolicy(f.actor, f.ds, f.policy, 0)).toMatchObject({
    revision: 1,
  });
  const observed = (await getArtifactById(f.ds))!;
  const base = {
    expectedVersion: observed.version,
    expectedState: artifactState(observed),
  };
  const push = (dataset: object[], from: object) =>
    replace(
      request(`/api/artifacts/${f.ds}`, {
        method: 'PUT',
        token: f.owner.token,
        json: { dataset, ...from },
      }),
      { params: Promise.resolve({ id: f.ds }) },
    );
  expect((await f.write()).outcome).toBe('committed');
  const written = (await getArtifactById(f.ds))!;
  expect(written.version).toBe(2);
  const stale = await push([{ n: 1 }], base);
  expect(stale.status).toBe(409);
  expect((await getArtifactById(f.ds))!.version).toBe(2);
  expect(await loadDatasetRows((await getArtifactById(f.ds))!)).toHaveLength(2);
  const fresh = await push([{ n: 1 }, { n: 2 }, { n: 3 }], {
    expectedVersion: written.version,
    expectedState: artifactState(written),
  });
  expect(fresh.status, await fresh.clone().text()).toBe(200);
});
// Legacy saved-JSX mutationAccess previews were removed with that transport.
// Writes below go through the page's generated API under the retained policy and executor.

async function sharedFixture(
  role: 'viewer' | 'commenter' | 'editor' = 'viewer',
) {
  const f = await fixture();
  const actor = f.actor;
  const user = await createUser({ email: 'mxmx_test_data_reader@example.com' }),
    token = await mintToken('reader', user.id);
  const session = { userId: user.id, email: user.email, emailVerified: true, credential: 'session' as const };
  await updateSharingFor(actor, f.ds, {
    visibility: 'private',
    shares: [{ email: user.email, role }],
  });
  const write=()=>f.writeAs(identityForUser(user.id,token.id),'add',3);
  // Private: the rules name shared viewers only (signed_in and anonymous page readers get nothing), as the v1 policy did.
  const viewers = <E extends { role: string }>(entries: E[]) => entries.filter((e) => e.role === 'viewer');
  const policy = { ...f.policy, tables: f.policy.tables.map((t) => ({ ...t, select_permissions: viewers(t.select_permissions), insert_permissions: viewers(t.insert_permissions) })) };
  return { ...f, actor, user, token, session, write, policy };
}
it.each(['viewer', 'commenter', 'editor'] as const)(
  'lets a shared %s use the same policy without a separate grant',
  async (role) => {
    const f = await sharedFixture(role);
    await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
    expect((await f.write()).outcome).toBe('committed');
    // The owner is admin-equivalent: the policy's rules (insert only) never restrict the owner.
    expect((await f.writeAs(f.actor,'remove')).outcome).toBe('committed');
    await updateSharingFor(f.actor, f.ds, { shares: [] });
    expect((await f.write()).outcome).toBe('rejected');
  },
);
it('requires dataset view access even when its declared app is public', async () => {
  const f = await sharedFixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  expect((await f.writeAs(ANONYMOUS_ACTOR)).outcome).toBe('rejected');
});

it('lets editors open the visual policy editor', async () => {
  const f = await sharedFixture('editor');
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  const response = await readPolicy(
    request(`/api/artifacts/${f.ds}/policy`, { actor: f.session, origin: 'same' }),
    { params: Promise.resolve({ id: f.ds }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    source: 'v3',
    policy: f.policy,
  });
});


it.each(['viewer', 'commenter', 'editor'] as const)(
  'allows policy administration only with edit access: %s',
  async (role) => {
    const f = await sharedFixture(role);
    const save = (policy: unknown, revision: number) => writePolicy(
      request(`/api/artifacts/${f.ds}/policy`, {method:'PUT', actor:f.session, origin:'same',
        json:{policy,expectedPolicyRevision:revision}}),
      {params:Promise.resolve({id:f.ds})},
    );
    const created = await save(f.policy, 0);
    expect(created.status).toBe(role === 'editor' ? 200 : 404);
    if (role !== 'editor') {
      expect((await getArtifactById(f.ds))?.policy_revision).toBe(0);
      return;
    }
    expect((await save(f.policy, 0)).status).toBe(409);
    const changed = {...f.policy, tables:[{...f.policy.tables[0]!, delete_permissions:[{role:'viewer',permission:{filter:{}}}]}]};
    expect((await save(changed, 1)).status).toBe(200);
    expect((await getArtifactById(f.ds))?.dataset_policy).toEqual(changed);
    expect((await save(null, 2)).status).toBe(200);
    const audit = await (await getDb()).query('SELECT actor_user_id FROM dataset_policy_audit WHERE dataset_id=$1 ORDER BY revision',[f.ds]);
    expect(audit.rows).toEqual(Array(3).fill({actor_user_id:f.user.id}));
    await updateSharingFor(f.actor,f.ds,{shares:[{email:f.user.email,role:'viewer'}]});
    expect((await save(f.policy, 3)).status).toBe(404);
  },
);
it('rechecks edit access when committing a policy change', async () => {
  const f = await sharedFixture('editor');
  const db = await getDb(), original = db.query.bind(db);
  let revoked = false;
  const spy = vi.spyOn(db,'query').mockImplementation(async (sql:string,values?:unknown[]) => {
    if (!revoked && sql.includes('UPDATE artifacts SET dataset_policy=')) {
      revoked = true;
      await original('DELETE FROM artifact_shares WHERE artifact_id=$1',[f.ds]);
    }
    return original(sql,values);
  });
  try {
    const result = await setDatasetPolicy(identityForUser(f.user.id, f.token.id),f.ds,f.policy,0);
    expect(revoked).toBe(true);
    expect(result).toEqual({conflict:true});
    expect((await getArtifactById(f.ds))?.policy_revision).toBe(0);
  } finally {spy.mockRestore();}
});

it('refuses a policy validated against dataset content that changed before its commit',async()=>{
 const f=await fixture();const db=await getDb(),original=db.query.bind(db);let changed=false;
 const spy=vi.spyOn(db,'query').mockImplementation(async(sql:string,values?:unknown[])=>{
  if(!changed&&sql.includes('UPDATE artifacts SET dataset_policy=')){
   changed=true;await original('UPDATE artifacts SET version=version+1,edit_id=$2 WHERE id=$1',[f.ds,'mxmx_test_new_content']);
  }
  return original(sql,values);
 });
 try{
  expect(await setDatasetPolicy(f.actor,f.ds,f.policy,0)).toEqual({conflict:true});expect(changed).toBe(true);
  expect((await getArtifactById(f.ds))?.policy_revision).toBe(0);
  expect((await original('SELECT revision FROM dataset_policy_audit WHERE dataset_id=$1',[f.ds])).rows).toEqual([]);
 }finally{spy.mockRestore();}
});
