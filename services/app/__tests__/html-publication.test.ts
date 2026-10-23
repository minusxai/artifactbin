import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT,DELETE} from '@/app/api/artifacts/[id]/route';
import {GET as versionGET} from '@/app/api/artifacts/[id]/versions/[version]/route';
const harness=useAppHarness();
const html='<html><head><script>window.ready=true</script></head><body><p data-af-id="text">Hello</p></body></html>';
const params=(id:string)=>({params:Promise.resolve({id})});
const publish=(token:string,source=html)=>POST(request('/api/artifacts',{method:'POST',token,json:{html:source},headers:{'Idempotency-Key':'html-create-0123456789'}}));
it('publishes canonical HTML through the original artifact API and preserves source in immutable history',async()=>{
 const actor=await mintAccountToken('html');const created=await publish(actor.token);expect(created.status).toBe(201);const first=await created.json();
 const read=await GET(request(`/api/artifacts/${first.id}`,{token:actor.token}),params(first.id));const head=await read.json();expect(head.format).toBe('html');expect(head.html).toContain('data-af-id="text"');
 const source=head.html.replace('Hello','Updated');
 const updated=await PUT(request(`/api/artifacts/${first.id}`,{method:'PUT',token:actor.token,json:{html:source,expectedVersion:head.version,expectedState:head.state},headers:{'Idempotency-Key':'html-update-0123456789'}}),params(first.id));expect(updated.status).toBe(200);
 const archived=await versionGET(request(`/api/artifacts/${first.id}/versions/1`,{token:actor.token}),{params:Promise.resolve({id:first.id,version:'1'})});expect(archived.status).toBe(200);expect((await archived.json()).html).toBe(head.html);
});
it('replays the committed update exactly and refuses a stale writer without changing history',async()=>{
 const actor=await mintAccountToken('html');const first=await (await publish(actor.token)).json();
 const head=await (await GET(request(`/api/artifacts/${first.id}`,{token:actor.token}),params(first.id))).json();
 const body={html:head.html.replace('Hello','New'),expectedVersion:head.version,expectedState:head.state};
 const send=()=>PUT(request(`/api/artifacts/${first.id}`,{method:'PUT',token:actor.token,json:body,headers:{'Idempotency-Key':'html-update-0123456789'}}),params(first.id));
 const updated=await send();expect(updated.status).toBe(200);expect(await (await send()).json()).toEqual(await updated.json());
 const stale=await PUT(request(`/api/artifacts/${first.id}`,{method:'PUT',token:actor.token,json:body}),params(first.id));expect(stale.status).toBe(409);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[first.id])).rows[0]?.n).toBe(1);
});
it('rejects retired IDs under the locked head and never writes a foreign or deleted page',async()=>{
 const actor=await mintAccountToken('html');const stranger=await mintAccountToken('other');const first=await (await publish(actor.token)).json();
 const read=async()=>await (await GET(request(`/api/artifacts/${first.id}`,{token:actor.token}),params(first.id))).json();
 let head=await read();const send=(token:string,source:string)=>PUT(request(`/api/artifacts/${first.id}`,{method:'PUT',token,json:{html:source,expectedVersion:head.version,expectedState:head.state}}),params(first.id));
 expect((await send(stranger.token,html)).status).toBe(404);
 expect((await send(actor.token,head.html.replace(/<p[^>]*>Hello<\/p>/,''))).status).toBe(200);head=await read();
 expect((await send(actor.token,head.html.replace('</body>','<p data-af-id="text">reborn</p></body>'))).status).toBe(400);
 await DELETE(request(`/api/artifacts/${first.id}`,{method:'DELETE',token:actor.token}),params(first.id));expect((await send(actor.token,html)).status).toBe(404);
});
it('authorizes dataset declarations and snapshots explicit live and pinned bindings',async()=>{
 const owner=await mintAccountToken('dataset-owner');const outsider=await mintAccountToken('dataset-other');
 const datasetReply=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{name:'One',value:1}],visibility:'private'}}));expect(datasetReply.status).toBe(201);const dataset=await datasetReply.json();
 const source=`<html><head><link rel="af-dataset" data-af-name="live" href="ref:${dataset.id}"><link rel="af-dataset" data-af-name="old" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"></head><body>Data</body></html>`;
 const denied=await POST(request('/api/artifacts',{method:'POST',token:outsider.token,json:{html:source}}));expect(denied.status).toBe(400);
 const saved=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:source}}));expect(saved.status).toBe(201);const page=await saved.json();
 const db=await harness.db();const row=(await db.query<{meta:{htmlLinks:unknown[]}}>('SELECT meta FROM artifacts WHERE id=$1',[page.id])).rows[0];expect(row?.meta.htmlLinks).toEqual([{kind:'dataset',name:'live',datasetId:dataset.id,mode:'live'},{kind:'dataset',name:'old',datasetId:dataset.id,mode:'pinned',revision:'1'}]);
});
it('serializes concurrent HTML saves at one observed head',async()=>{
 const actor=await mintAccountToken('concurrent-html');const created=await (await publish(actor.token)).json();
 const head=await (await GET(request(`/api/artifacts/${created.id}`,{token:actor.token}),params(created.id))).json();
 const send=(text:string,key:string)=>PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:actor.token,json:{html:head.html.replace('Hello',text),expectedVersion:head.version,expectedState:head.state},headers:{'Idempotency-Key':key}}),params(created.id));
 const results=await Promise.all([send('One','concurrent-one-0123456789'),send('Two','concurrent-two-0123456789')]);expect(results.map(result=>result.status).sort()).toEqual([200,409]);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[created.id])).rows[0]?.n).toBe(1);
});
