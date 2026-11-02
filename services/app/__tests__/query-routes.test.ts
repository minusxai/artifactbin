// Pages here exercise the frozen generic dataset API: their links opt in with data-af-api="legacy" (new links default to the generated API, Hasura PR 6).
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import { POST as draftQueryRoute } from '@/app/api/query/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';

const BASE = 'http://localhost:3000';
useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }))).json();

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];
describe('retired draft compiler boundary', () => {
 it('authenticates and enforces same-origin sessions before refusing legacy markup',async()=>{
  const t=await mintToken('draft');
  const call=(options:Parameters<typeof request>[1])=>draftQueryRoute(request('/api/query',{method:'POST',...options}));
  expect((await call({json:{markup:'<p>x</p>'}})).status).toBe(401);
  const actor={credential:'session' as const,userId:t.userId!,email:t.email!,emailVerified:true};
  expect((await call({actor,origin:'https://evil.example',json:{markup:'<p>x</p>'}})).status).toBe(403);
  for(const auth of [{token:t.token},{actor,origin:BASE}]){
   const response=await call({...auth,json:{markup:'<Helmet><Query name="secret">select * from secret</Query></Helmet>'}});
   expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'native_html_required'});
   expect(response.headers.get('cache-control')).toBe('no-store');
  }
  expect((await call({token:t.token,json:{}})).status).toBe(400);
 });
});

// Saved JSX query/value/hold/people transports are retired. Saved pages execute
// their declared dataset namespace through the native GraphQL boundary instead.
describe('native saved-page dataset queries',()=>{
 async function fixture(visibility='public'){
  const owner=await mintToken('native-query');const ds=await create(owner.token,{dataset:ROWS,visibility});
  const page=await create(owner.token,{html:`<html><head><link rel="af-dataset" data-af-api="legacy" data-af-name="sales" href="ref:${ds.id}"></head><body>Sales</body></html>`,visibility});
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
