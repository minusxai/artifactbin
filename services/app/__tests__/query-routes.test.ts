import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import { POST as draftQueryRoute } from '@/app/api/query/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';

const BASE = 'http://localhost:3000';
useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }))).json();

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];
const DOC = (ds: string) =>
  '<Helmet><Value name="region" type="string" /><Value name="min" type="number" default={0} />' +
  `<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where ($region is null or region = $region) and revenue >= $min group by 1 order by 1\`}</Query>` +
  `<Import name="regions_data" src="ref:${ds}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>` +
  '</Helmet><div><select value="$region" options="$regions" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

describe('POST /api/query (owner path — a draft)', () => {
  it('runs a draft over the caller\'s own datasets, bearer-authed', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: DOC(ds), values: { region: 'EU' } } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }>; errors: Record<string, string> };
    expect(body.tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }]);
  });

  it('runs a draft under the owner\'s verified email browser session', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', actor: actor, origin: BASE, json: { markup: DOC(ds), values: { region: 'EU' } } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tables: Record<string, { rows: unknown[] }> }).tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }]);
  });

  it('refuses a cross-site actor call, and never blocks a bearer agent', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', actor: actor, origin: 'https://evil.example', json: { markup: DOC(ds) } }))).status).toBe(403);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: DOC(ds) } }))).status).toBe(200);
  });

  it('a PRIVATE dataset of another owner reads as a missing table — never as data', async () => {
    // Public/unlisted foreign datasets resolve now (refs-readable.test.ts);
    // private is the boundary that must hold in the draft path too.
    const mine = await mintToken('mine');
    const owner = await createUser({ email: 'query-owner@example.com' });
    const theirs = await mintToken('theirs', owner.id);
    await claimToken(owner.id, theirs.token);
    const foreign = (await create(theirs.token, { dataset: ROWS, visibility: 'private' })).id;
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', token: mine.token, json: { markup: DOC(foreign) } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, unknown>; errors: Record<string, string> };
    expect(body.tables.sales).toBeUndefined();
    expect(body.errors.sales).toMatch(new RegExp(`ref:${foreign}`));
  });

  it('requires a credential and a markup body', async () => {
    const t = await mintToken('t');
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', json: { markup: '<p>x</p>' } }))).status).toBe(401);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: {} }))).status).toBe(400);
  });

  it('a draft that declares nothing answers empty; a draft whose Helmet is malformed answers 400 with the grammar errors', async () => {
    const t = await mintToken('t');
    const empty = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: '<p>x</p>' } }));
    expect(await empty.json()).toEqual({ tables: {}, errors: {}, flow: null });
    const bad = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: '<Helmet><Value name="n" type="number" default="lots" /></Helmet><p>x</p>' } }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toMatch(/default/);
  });
});


// Saved JSX query/value/hold/people transports are retired. Saved pages execute
// their declared dataset namespace through the native GraphQL boundary instead.
describe('native saved-page dataset queries',()=>{
 async function fixture(visibility='public'){
  const owner=await mintToken('native-query');const ds=await create(owner.token,{dataset:ROWS,visibility});
  const page=await create(owner.token,{html:`<html><head><link rel="af-dataset" data-af-name="sales" href="ref:${ds.id}"></head><body>Sales</body></html>`,visibility});
  const call=async(query:string,variables={},token?:string)=>await(await graphql(request(`/api/artifacts/${page.id}/graphql`,{method:'POST',token,json:{revision:'1',query,variables}}),params({id:page.id}))).json();
  const result=await call('{sales{schema{revision tables{id columns{id label}}}}}',{},owner.token);
  return {owner,call,page,table:result.data.sales.schema.tables[0]};
 }
 it('discovers stable IDs, projects typed cells, and follows bounded revision-bound pages',async()=>{
  const f=await fixture();const revenue=f.table.columns.find((c:{label:string})=>c.label==='revenue').id;
  const query='query($table:ID!,$columns:[ID!],$after:String){sales{rows(tableId:$table,columnIds:$columns,first:2,after:$after){revision rows{id cells{columnId value{type number}}} pageInfo{hasNextPage endCursor}}}}';
  const first=await f.call(query,{table:f.table.id,columns:[revenue]});expect(first.errors).toBeUndefined();expect(first.data.sales.rows.rows).toHaveLength(2);expect(first.data.sales.rows.pageInfo.hasNextPage).toBe(true);
  const next=await f.call(query,{table:f.table.id,columns:[revenue],after:first.data.sales.rows.pageInfo.endCursor});expect(next.data.sales.rows.rows).toHaveLength(1);expect(next.data.sales.rows.pageInfo.hasNextPage).toBe(false);
  expect(first.data.sales.rows.rows[0].cells).toEqual([{columnId:revenue,value:{type:'NUMBER',number:expect.any(Number)}}]);
  expect([...first.data.sales.rows.rows,...next.data.sales.rows.rows].map(row=>row.cells[0].value.number).sort((a,b)=>a-b)).toEqual([3,837,1200]);
 });
 it('runs parameterized filters and whole-source aggregates through the constant schema',async()=>{
  const f=await fixture();const revenue=f.table.columns.find((c:{label:string})=>c.label==='revenue').id;
  const result=await f.call('query($table:ID!,$revenue:ID!){sales{query(tableId:$table,first:1,filters:[{columnId:$revenue,operator:GTE,parameter:"minimum"}],parameters:[{name:"minimum",value:{type:NUMBER,number:10}}],aggregates:[{id:"total",operation:SUM,columnId:$revenue}]){rows{cells{value{number}}}}}}',{table:f.table.id,revenue});
  expect(result.errors).toBeUndefined();expect(result.data.sales.query.rows[0].cells[0].value.number).toBe(2037);
 });
 it('keeps private page and dataset reads behind the original reader identity',async()=>{
  const f=await fixture('private');expect(await f.call('{sales{schema{revision}}}')).toEqual({error:'page_operation_unavailable'});
  expect((await f.call('{sales{schema{revision}}}',{},f.owner.token)).data.sales.schema.revision).toBe('1');
 });
 it('rejects undeclared namespaces and invalid page bounds before returning rows',async()=>{
  const f=await fixture();expect((await f.call('{guessed{schema{revision}}}')).errors).toBeDefined();
  expect((await f.call('query($t:ID!){sales{rows(tableId:$t,first:101){rows{id}}}}',{t:f.table.id})).errors).toBeDefined();
 });
});
