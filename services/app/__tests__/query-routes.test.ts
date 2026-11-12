import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }))).json();

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];
// Saved JSX query/value/hold/people transports are retired. Saved pages execute
// their declared dataset namespace through the native GraphQL boundary instead.
describe('native saved-page dataset queries',()=>{
 async function fixture(visibility='public'){
  const owner=await mintToken('native-query');const ds=await create(owner.token,{dataset:ROWS,visibility});
  const page=await create(owner.token,{html:`<html><head><link rel="af-dataset" data-af-name="sales" href="ref:${ds.id}"></head><body>Sales</body></html>`,visibility});
  const call=async(query:string,variables={},token?:string)=>await(await graphql(request(`/api/artifacts/${page.id}/graphql`,{method:'POST',token,json:{revision:'1',query,variables}}),params({id:page.id}))).json();
  return {owner,call,page};
 }
 it('projects typed columns and pages with limit and offset under a stable order',async()=>{
  const f=await fixture();
  const query='query($offset:Int){sales(order_by:{revenue:asc},limit:2,offset:$offset){_id revenue}}';
  const first=await f.call(query,{offset:0});expect(first.errors).toBeUndefined();expect(first.data.sales).toHaveLength(2);
  const next=await f.call(query,{offset:2});expect(next.data.sales).toHaveLength(1);
  expect(Object.keys(first.data.sales[0]).sort()).toEqual(['_id','revenue']);
  expect([...first.data.sales,...next.data.sales].map((row:{revenue:number})=>row.revenue)).toEqual([3,837,1200]);
 });
 it('runs variable filters and whole-source totals through the page SQL door',async()=>{
  const f=await fixture();
  const result=await f.call('query($p:JSON){_sql(sql:"select sum(revenue) as total from sales where revenue >= $minimum",params:$p){rows}}',{p:{minimum:10}});
  expect(result.errors).toBeUndefined();expect(result.data._sql.rows).toEqual([{total:2037}]);
 });
 it('keeps private page and dataset reads behind the original reader identity',async()=>{
  const f=await fixture('private');expect(await f.call('{sales{region}}')).toEqual({error:'page_operation_unavailable'});
  expect((await f.call('{sales{region}}',{},f.owner.token)).data.sales).toHaveLength(3);
 });
 it('rejects undeclared roots and invalid page bounds before returning rows',async()=>{
  const f=await fixture();expect((await f.call('{guessed{region}}')).errors).toBeDefined();
  const negative=await f.call('{sales(limit:-1){_id}}');expect(negative.errors).toBeDefined();expect(negative.data?.sales??null).toBeNull();
  // A limit above the 1000-row cap is cut to it, never an unbounded read.
  expect((await f.call('{sales(limit:5000){_id}}')).data.sales).toHaveLength(3);
 });
});
