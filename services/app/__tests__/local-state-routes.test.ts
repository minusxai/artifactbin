import { describe, expect, it } from 'vitest';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { POST as query } from '@/app/a/[id]/query/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { createUser, claimToken } from '@/lib/users';
import { request, useAppHarness } from './harness';

useAppHarness();
const markup = `<Helmet>
<Value name="count" type="number" default={0} />
<Value name="drafts" type="table" value={[{id: 1}]} />
<Query name="current">{\`select id, count from drafts cross join _signals\`}</Query>
<Mutation name="inc">{\`update _signals set count=count+1\`}</Mutation>
<Mutation name="add">{\`insert into drafts values (2)\`}</Mutation>
</Helmet><Button run="$inc">Increment</Button><DataTable data="$current" />`;
async function fixture(visibility = 'unlisted') {
  const token = (await mintToken('local-state-test')).token;
  if (visibility === 'private') await claimToken((await createUser({email: 'local-state-owner@example.test'})).id, token);
  const response = await createArtifact(request('/api/artifacts', {method: 'POST', token, json: {title: 'Local state', markup, visibility}}));
  expect(response.status, await response.clone().text()).toBe(201);
  return {token, id: (await response.json()).id as string};
}
const context = (id: string) => ({params: Promise.resolve({id})});
describe('document-local SQL HTTP boundary', () => {
  it('runs a public reader mutation without dataset write permission or persistence', async () => {
    const {id} = await fixture();
    const before = await getArtifactById(id);
    const response = await mutate(request(`/a/${id}/mutate`, {method: 'POST', json: {mutation: 'inc', values: {count: 4}, sql: 'delete from _signals'}}), context(id));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ok: true, local: {target: '_signals', table: {rows: [{count: 5}]}}});
    expect(await getArtifactById(id)).toEqual(before);
    const fresh = await mutate(request(`/a/${id}/mutate`, {method: 'POST', json: {mutation: 'inc'}}), context(id));
    expect(await fresh.json()).toMatchObject({local: {table: {rows: [{count: 1}]}}});
  });
  it('mutates supplied inline rows and re-queries them through a no-credentials POST', async () => {
    const {id} = await fixture();
    const response = await mutate(request(`/a/${id}/mutate`, {method: 'POST', json: {mutation: 'add', localTables: {drafts: [{id: 9}]}}}), context(id));
    expect(response.status, await response.clone().text()).toBe(200);
    const added = await response.json();
    expect(added.local.table.rows).toEqual([{id: 9}, {id: 2}]);
    const read = await query(request(`/a/${id}/query`, {method: 'POST', json: {only: ['current'], values: {count: 7}, localTables: {drafts: added.local.table.rows}}}), context(id));
    expect(read.status, await read.clone().text()).toBe(200);
    expect(read.headers.get('access-control-allow-origin')).toBe('*');
    expect(await read.json()).toMatchObject({tables: {current: {rows: [{id: 9, count: 7}, {id: 2, count: 7}]}}, mutationAccess: {inc: null, add: null}});
  });
  it('rejects forged table names, schemas, types, and excessive row counts', async () => {
    const {id} = await fixture();
    for (const localTables of [{ref_abc123: [{id: 1}]}, {drafts: [{id: 'bad'}]}, {drafts: {rows: [], columns: []}}, {drafts: Array.from({length: 10001}, () => ({id: 1}))}]) {
      for (const [path, route] of [['mutate', mutate], ['query', query]] as const) {
        const response = await route(request(`/a/${id}/${path}`, {method: 'POST', json: {mutation: 'add', localTables}}), context(id));
        expect(response.status, await response.clone().text()).toBe(400);
      }
    }
  });
  it('does not expose a private document through local execution', async () => {
    const {id, token} = await fixture('private');
    const anonymous = await mutate(request(`/a/${id}/mutate`, {method: 'POST', json: {mutation: 'inc'}}), context(id));
    expect(anonymous.status).toBe(404);
    const owner = await mutate(request(`/a/${id}/mutate`, {method: 'POST', token, json: {mutation: 'inc'}}), context(id));
    expect(owner.status, await owner.clone().text()).toBe(200);
  });
});
