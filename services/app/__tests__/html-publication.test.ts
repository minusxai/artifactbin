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
