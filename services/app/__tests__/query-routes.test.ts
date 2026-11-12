import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import {POST as sqlDoor} from '@/app/api/artifacts/[id]/sql/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }))).json();

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];
// Saved JSX query/value/hold/people transports are retired. Saved pages execute
// their declared dataset namespace through the native SQL boundary instead.
describe('native saved-page dataset queries',()=>{
 async function fixture(visibility='public'){
  const owner=await mintToken('native-query');const ds=await create(owner.token,{dataset:ROWS,visibility});
  const page=await create(owner.token,{html:`<html><head><link rel="af-dataset" data-af-name="sales" href="ref:${ds.id}"></head><body>Sales</body></html>`,visibility});
  const call=async(query:string,variables={},token?:string)=>await(await sqlDoor(request(`/api/artifacts/${page.id}/sql`,{method:'POST',token,json:{revision:'1',sql:query,params:variables}}),params({id:page.id}))).json();
  return {owner,call,page};
 }
 it('projects typed columns and pages with limit and offset under a stable order',async()=>{
  const f=await fixture();
  const query=(offset:number)=>`select _id, revenue from sales order by revenue limit 2 offset ${offset}`;
  const first=await f.call(query(0));expect(first.error,JSON.stringify(first)).toBeUndefined();expect(first.rows).toHaveLength(2);
  const next=await f.call(query(2));expect(next.rows).toHaveLength(1);
  expect(Object.keys(first.rows[0]).sort()).toEqual(['_id','revenue']);
  expect([...first.rows,...next.rows].map((row:{revenue:number})=>row.revenue)).toEqual([3,837,1200]);
 });
 it('runs variable filters and whole-source totals through the page SQL door',async()=>{
  const f=await fixture();
  const result=await f.call('select sum(revenue) as total from sales where revenue >= $minimum',{minimum:10});
  expect(result.error).toBeUndefined();expect(result.rows).toEqual([{total:2037}]);
 });
 it('keeps private page and dataset reads behind the original reader identity',async()=>{
  const f=await fixture('private');expect(await f.call('select region from sales')).toEqual({error:'not_found'});
  expect((await f.call('select region from sales',{},f.owner.token)).rows).toHaveLength(3);
 });
 it('rejects undeclared roots and invalid page bounds before returning rows',async()=>{
  const f=await fixture();expect((await f.call('select region from guessed')).error).toBeDefined();
  expect((await f.call('select _id from sales limit 5000')).rows).toHaveLength(3);
 });
});
