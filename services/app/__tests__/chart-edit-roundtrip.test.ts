/** The in-app JSX Question editor is retired. Native chart source now travels through
 * conditional HTML replacement; spec fidelity, repeated edits, IDs and history remain covered. */
import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {GET as versionGET} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {POST as retiredEdit} from '@/app/api/artifacts/[id]/edits/route';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
it('preserves nested native chart data and node identities across two conditional replacements and immutable history',async()=>{
 const actor=await mintAccountToken('native-chart'),spec={mark:'bar',encoding:{x:{field:'region',type:'nominal'},y:{field:'revenue',type:'quantitative'}}};
 const html=`<html><head><title>Revenue</title></head><body><h1 data-af-id="heading">Revenue</h1><div data-af-id="chart"></div><script type="application/json" data-af-id="spec" id="chart-spec">${JSON.stringify(spec)}</script></body></html>`;
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html}}));expect(created.status).toBe(201);const first=await created.json();
 const read=async()=>await(await GET(request(`/api/artifacts/${first.id}`,{token:actor.token}),params(first.id))).json();
 let head=await read();const canonical=head.html;const next=canonical.replace('"mark":"bar"','"mark":"line"');
 const save=async(source:string)=>{const response=await PUT(request(`/api/artifacts/${first.id}`,{method:'PUT',token:actor.token,json:{html:source,expectedVersion:head.version,expectedState:head.state}}),params(first.id));expect(response.status).toBe(200);head=await read();};
 await save(next);expect(head.html).toBe(next);await save(head.html.replace('"field":"revenue"','"field":"profit"'));expect(head.html).toContain('"field":"profit"');expect(head.html).toContain('data-af-id="chart"');expect(head.html).toContain('<h1 data-af-id="heading">Revenue</h1>');expect(head.version).toBe(3);
 const archived=await versionGET(request(`/api/artifacts/${first.id}/versions/1`,{token:actor.token}),{params:Promise.resolve({id:first.id,version:'1'})});expect(archived.status).toBe(200);expect((await archived.json()).html).toBe(canonical);
});
it('retains the retired editor boundary while permitting ordinary native chart scripts',async()=>{
 const actor=await mintAccountToken('native-chart-boundary');const res=await retiredEdit(request('/api/artifacts/missing/edits',{method:'POST',token:actor.token,json:{source:'<Question viz={{mark:"bar"}} />'}}),params('missing'));expect(res.status).toBe(404);
});
