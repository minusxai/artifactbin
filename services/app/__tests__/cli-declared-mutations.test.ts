/** Declared mutations on the bearer door: exposed on the wire, run by name, one effect per operation key. */
import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {loadDatasetRows} from '@/lib/story/dataset-store';
import {getArtifactById} from '@/lib/artifacts';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
it('exposes declared mutations on the artifact wire and runs one by name durably',async()=>{
 const owner=await mintToken('mxmx_test_declared');
 const publish=async(body:object)=>{const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(r.status,await r.clone().text()).toBe(201);return (await r.json()).id as string;};
 const ds=await publish({dataset:[{n:1}],access:'readwrite'});
 const doc=await publish({markup:`<Helmet><Value name="n" type="number" default={5} /><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values ($n)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const head=await read(request(`/api/artifacts/${doc}`,{token:owner.token}),ctx(doc));expect(head.status).toBe(200);
 expect((await head.json()).mutations).toEqual([{name:'add',params:[{name:'n'}]}]);
 const key='declared-mutation-key-0001';
 const run=()=>mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:owner.token,json:{name:'add',values:{n:7}},headers:{'Idempotency-Key':key}}),ctx(doc));
 const first=await run();expect(first.status,await first.clone().text()).toBe(200);const body=await first.json();expect(body.affected).toBe(1);
 const replay=await run();expect(replay.status).toBe(200);expect(await replay.json()).toEqual(body);
 const rows=await loadDatasetRows((await getArtifactById(ds))!);expect(rows.map(r=>r.n).sort()).toEqual([1,7]);
 const unknown=await mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:owner.token,json:{name:'nope'}}),ctx(doc));expect(unknown.status).toBe(400);expect((await unknown.json()).error).toBe('unknown_mutation');
 const outsider=await mintToken('mxmx_test_declared_outsider');
 const denied=await mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:outsider.token,json:{name:'add'}}),ctx(doc));expect([403,404]).toContain(denied.status);
});
it('filters version history by author and time interval',async()=>{
 const owner=await mintToken('mxmx_test_history');
 const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>v1</p>'}}));expect(r.status).toBe(201);const id=(await r.json()).id as string;
 const all=await versions(request(`/api/artifacts/${id}/versions`,{token:owner.token}),ctx(id));expect(all.status).toBe(200);expect((await all.json()).versions.length).toBeGreaterThanOrEqual(1);
 const nobody=await versions(request(`/api/artifacts/${id}/versions?author=mxmx_nobody`,{token:owner.token}),ctx(id));expect((await nobody.json()).versions).toHaveLength(0);
 const future=await versions(request(`/api/artifacts/${id}/versions?since=2099-01-01T00:00:00Z`,{token:owner.token}),ctx(id));expect((await future.json()).versions).toHaveLength(0);
 const bad=await versions(request(`/api/artifacts/${id}/versions?since=yesterday`,{token:owner.token}),ctx(id));expect(bad.status).toBe(400);
});
