import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as query} from '@/app/a/[id]/query/route';
import {POST as tableQuery} from '@/app/a/[id]/tables/route';
import {GET as getArtifact} from '@/app/api/artifacts/[id]/route';
import {POST as mutateRows} from '@/app/api/artifacts/[id]/mutate/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
it('publishes a multi-schema dataset and queries it through source, including a dependent local query',async()=>{
 const token=await mintToken('owner');
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:{kind:'stored',defaultSchema:'sales',tables:[{schema:'sales',name:'orders',rows:[{id:1,total:12},{id:2,total:8}]},{schema:'support',name:'tickets',rows:[{order_id:1,subject:'Help'}]}]}}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const source=`<Helmet><Query name="orders" source="ref:${id}">{\`select * from orders\`}</Query><Query name="summary">{\`select sum(total) as total from orders\`}</Query></Helmet><DataTable data="$summary" />`;
 const doc=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:source}}));
 expect(doc.status,await doc.clone().text()).toBe(201);const docId=(await doc.json()).id;
 const result=await query(request(`/a/${docId}/query`,{method:'POST',token:token.token,json:{}}),ctx(docId));
 expect(result.status,await result.clone().text()).toBe(200);expect((await result.json()).tables.summary.rows).toEqual([{total:20}]);
 const page=await query(request(`/a/${docId}/query`,{method:'POST',token:token.token,json:{page:{name:'orders',offset:1,limit:1,sort:{col:'total',dir:'desc'}}}}),ctx(docId));
 expect(page.status,await page.clone().text()).toBe(200);expect((await page.json()).tables.orders.rows).toEqual([{id:2,total:8}]);
 const joined=await tableQuery(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select o.total, t.subject from sales.orders o join support.tickets t on o.id=t.order_id'}}),ctx(id));
 expect(joined.status,await joined.clone().text()).toBe(200);expect((await joined.json()).rows).toEqual([{total:12,subject:'Help'}]);
 const wire=await getArtifact(request(`/api/artifacts/${id}`,{token:token.token}),ctx(id));expect((await wire.json()).meta.catalog.tables).toHaveLength(2);
});
it('mutates only the explicitly named stored table without changing public.rows',async()=>{
 const token=await mintToken('owner');
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{access:'readwrite',dataset:{kind:'stored',tables:[{schema:'public',name:'rows',rows:[{n:1}]},{schema:'public',name:'other',rows:[{n:10}]}]}}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const doc=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet><Mutation name="edit" source="ref:${id}">{\`update public.other set n=11\`}</Mutation></Helmet><Button run="$edit">Edit</Button>`}}));
 expect(doc.status,await doc.clone().text()).toBe(201);const did=(await doc.json()).id;
 expect((await mutate(request(`/a/${did}/mutate`,{method:'POST',token:token.token,json:{mutation:'edit'}}),ctx(did))).status).toBe(200);
 const rows=await tableQuery(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select * from public.rows'}}),ctx(id));expect((await rows.json()).rows).toEqual([{n:1}]);
 const other=await tableQuery(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select * from public.other'}}),ctx(id));expect((await other.json()).rows).toEqual([{n:11}]);
});

it('queries a folder through the same source syntax, including pagination', async () => {
 const token = await mintToken('folder owner');
 const publish = async (json: Record<string, unknown>) => {
  const response = await create(request('/api/artifacts', {method:'POST', token:token.token, json}));
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).id as string;
 };
 const folder = await publish({format:'folder', title:'Reports', visibility:'public'});
 await publish({markup:'<p>One</p>', title:'One', parent_id:folder, visibility:'public'});
 await publish({markup:'<p>Two</p>', title:'Two', parent_id:folder, visibility:'public'});
 const doc = await publish({markup:`<Helmet><Query name="children" source="ref:${folder}">{\`select title from public.rows\`}</Query></Helmet><DataTable data="$children" />`});
 const response = await query(request(`/a/${doc}/query`, {method:'POST', token:token.token, json:{page:{name:'children',offset:1,limit:1,sort:{col:'title',dir:'asc'}}}}), ctx(doc));
 expect(response.status, await response.clone().text()).toBe(200);
 expect((await response.json()).tables.children.rows).toEqual([{title:'Two'}]);
});

it('uses catalog table names at the direct mutation HTTP boundary and refuses implicit aliases', async () => {
 const token = await mintToken('writer');
 const response = await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));
 expect(response.status).toBe(201);
 const id = (await response.json()).id;
 const valid = await mutateRows(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:token.token,json:{sql:'update public.rows set n=2'}}),ctx(id));
 expect(valid.status,await valid.clone().text()).toBe(200);
 const retired = await mutateRows(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:token.token,json:{sql:`update ref_${id} set n=3`}}),ctx(id));
 expect(retired.status).toBe(400);
 const rows = await tableQuery(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select n from public.rows'}}),ctx(id));
 expect((await rows.json()).rows).toEqual([{n:2}]);
});
