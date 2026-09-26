import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as query} from '@/app/a/[id]/query/route';
import {POST as tableQuery} from '@/app/a/[id]/tables/route';
import {GET as getArtifact} from '@/app/api/artifacts/[id]/route';
import {POST as mutateRows} from '@/app/api/artifacts/[id]/mutate/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {convertDocument} from '@/lib/migrate/sqlite/convert';
import {MAX_QUERY_ROWS} from '@/lib/config';
import {runDocumentDataflow} from '@/lib/artifacts';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});

it('preserves legacy DuckDB computations and parameters through conversion to SQLite', async () => {
 const token=await mintToken('migration owner');
 const rows=[{hours:1,day:'2026-01-01'},{hours:5,day:'2026-01-03'},{hours:null,day:'2026-01-05'}];
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:rows}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const sql=`select median(hours)::double as hours, min(day) as first_day, strftime(strptime(min(day)::varchar, '%Y-%m-%d'), '%Y-%m') as month from ref_${id} where hours >= $minimum`;
 const legacy=`<Helmet><Value name="minimum" type="number" default={0} /><Query name="stats">{\`${sql}\`}</Query></Helmet><DataTable data="$stats" />`;
 const converted=convertDocument(legacy,{importName:()=>'hours_log',kind:()=>'dataset'});
 expect(converted.manual).toEqual([]);
 expect(convertDocument(converted.source,{importName:()=>'hours_log',kind:()=>'dataset'}).changes).toEqual([]);
 const doc=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:converted.source}}));
 expect(doc.status,await doc.clone().text()).toBe(201);const docId=(await doc.json()).id;
 // What DuckDB answered for the legacy statement, per minimum.
 const expected:Record<number,unknown>={
  0:{hours:3,first_day:'2026-01-01',month:'2026-01'},
  4:{hours:5,first_day:'2026-01-03',month:'2026-01'},
  10:{hours:null,first_day:null,month:null},
 };
 for(const minimum of [0,4,10]) {
  const response=await query(request(`/a/${docId}/query`,{method:'POST',token:token.token,json:{values:{minimum},only:['stats']}}),ctx(docId));
  expect(response.status,await response.clone().text()).toBe(200);
  const state=await response.json();expect(state.errors).toEqual({});
  expect(state.tables.stats.rows).toEqual([expected[minimum]]);
 }
});

it('aggregates complete stored source inputs beyond both source page limits while bounding displayed rows', async () => {
 const token=await mintToken('large migration owner');
 const rows=Array.from({length:10005},(_,i)=>({n:i+1}));
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:rows}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const markup=`<Helmet><Import name="upstream_data" src="ref:${id}" /><Query name="upstream">{\`select * from upstream_data.rows\`}</Query><Import name="filtered_data" src="ref:${id}" /><Query name="filtered">{\`select * from filtered_data.rows where n > 10000\`}</Query><Query name="stats">{\`select count(*) as n, median(n) as middle, sum(n) as total from upstream_data.rows\`}</Query><Query name="tail">{\`select sum(n) as total from filtered_data.rows where n > 10000\`}</Query></Helmet><DataTable data="$stats" />`;
 const doc=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup}}));
 expect(doc.status,await doc.clone().text()).toBe(201);const docId=(await doc.json()).id;
 const response=await query(request(`/a/${docId}/query`,{method:'POST',token:token.token,json:{}}),ctx(docId));
 expect(response.status,await response.clone().text()).toBe(200);const state=await response.json();
 expect(state.errors).toEqual({});
 expect(state.tables.stats.rows).toEqual([{n:10005,middle:5003,total:50055015}]);
 // Displayed rows stop at the engine's row cap; the aggregate above read every stored row.
 expect(state.tables.upstream.rows).toHaveLength(MAX_QUERY_ROWS);
 expect(state.tables.upstream.truncated).toBe(true);
 expect(state.tables.tail.rows).toEqual([{total:50015}]);
});

it('does not return complete source inputs after document authorization is revoked', async () => {
 const source='<Helmet><Import name="upstream_data" src="ref:abc123" /><Query name="upstream">{`select * from upstream_data.rows`}</Query><Query name="stats">{`select median(n) as n from upstream_data.rows`}</Query></Helmet>';
 const columns=[{name:'n',type:'number' as const}];
 const load=async(id:string)=>({id,format:'dataset',columns});
 const table={tables:{rows:{rows:[{n:1},{n:3}],columns}}};
 await expect(runDocumentDataflow(source,load,async()=>table,{authorize:async()=>{throw new Error('revoked');}})).rejects.toThrow('revoked');
 let reads=0;
 await expect(runDocumentDataflow(source,load,async()=>++reads===1?table:null)).rejects.toThrow('Dataset source is unavailable');
 const missing=await runDocumentDataflow(source,load,async()=>null);
 expect(missing?.state.tables.stats).toBeUndefined();
 expect(missing?.state.errors.upstream).toMatch(/upstream_data/);
});
it('publishes a multi-schema dataset and queries it through source, including a dependent local query',async()=>{
 const token=await mintToken('owner');
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:{kind:'stored',defaultSchema:'sales',tables:[{schema:'sales',name:'orders',rows:[{id:1,total:12},{id:2,total:8}]},{schema:'support',name:'tickets',rows:[{order_id:1,subject:'Help'}]}]}}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const source=`<Helmet><Import name="orders_data" src="ref:${id}" /><Query name="orders">{\`select * from orders_data.orders\`}</Query><Query name="summary">{\`select sum(total) as total from orders\`}</Query></Helmet><DataTable data="$summary" />`;
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
 const doc=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet><Import name="edit_data" src="ref:${id}" /><Mutation name="edit">{\`update edit_data.other set n=11\`}</Mutation></Helmet><Button run="$edit">Edit</Button>`}}));
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
 const doc = await publish({markup:`<Helmet><Import name="children_data" src="ref:${folder}" /><Query name="children">{\`select title from children_data.rows\`}</Query></Helmet><DataTable data="$children" />`});
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

it('refuses the retired source= form and DuckDB SQL at publish, by name',async()=>{
 const token=await mintToken('legacy query owner');
 const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{hours:1},{hours:2},{hours:3},{hours:10}]}}));
 expect(ds.status,await ds.clone().text()).toBe(201);const id=(await ds.json()).id;
 const publish=async(helmet:string)=>{const r=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet>${helmet}</Helmet><DataTable data="$legacy" />`}}));expect(r.status).toBe(400);return JSON.stringify(await r.json());};
 // A stored dataset is imported, never queried with source=: the refusal names the Import to write.
 expect(await publish(`<Query name="legacy" source="ref:${id}">{\`select median(hours) as median from public.rows\`}</Query>`)).toMatch(/Import/);
 // DuckDB-only syntax is SQLite's own refusal of the statement, located at the Query.
 expect(await publish(`<Import name="legacy_data" src="ref:${id}" /><Query name="legacy">{\`select median(hours::double) as median from legacy_data.rows\`}</Query>`)).toMatch(/<Query name=\\"legacy\\">.*unrecognized token/);
});
