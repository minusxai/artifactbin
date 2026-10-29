import {expect,it,vi} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion,getHtmlBackendStore,setHtmlBackendStore} from '@/lib/html-backends';
import { identityForUser } from '@/lib/accounts';
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>{
 if(source==='bad')throw Error('invalid backend schema');
 return {typeDefs:'type Query { greeting: String }',compiled:source};
}}));
const harness=useAppHarness();
const html='<html><head><link rel="af-backend" data-af-name="db" href="./backend.ts"></head><body><p>Hello</p></body></html>';
const params=(id:string)=>({params:Promise.resolve({id})});
it('commits immutable backend version pointers together with the owning page and retains backend state',async()=>{
 const actor=await mintAccountToken('backend');
 const published=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html,backendSources:{db:'first'}}}));expect(published.status).toBe(201);const created=await published.json();
 const identity=identityForUser(actor.userId,actor.id);
 const first=await readHtmlPage(identity,created.id);const link=first.links[0];expect(link?.kind).toBe('backend');if(link?.kind!=='backend')throw Error('missing backend');
 expect((await getHtmlBackendVersion(link.backendId,link.version))?.source).toBe('first');
 expect(await getHtmlBackendStore(link.backendId)).toEqual({value:null,version:0});
 expect(await setHtmlBackendStore(link.backendId,{count:1},0)).toEqual({ok:true,version:1});
 expect(await setHtmlBackendStore(link.backendId,{count:2},0)).toEqual({ok:false,version:1});
 const head=await (await GET(request(`/api/artifacts/${created.id}`,{token:actor.token}),params(created.id))).json();
 const updated=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:actor.token,json:{html:head.html,backendSources:{db:'second'},expectedVersion:head.version,expectedState:head.state}}),params(created.id));expect(updated.status).toBe(200);
 const next=await readHtmlPage(identity,created.id);const second=next.links[0];expect(second?.kind).toBe('backend');if(second?.kind!=='backend')throw Error('missing backend');
 expect(second.backendId).toBe(link.backendId);expect(second.version).not.toBe(link.version);
 const retainedHead=await (await GET(request(`/api/artifacts/${created.id}`,{token:actor.token}),params(created.id))).json();
 const retained=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:actor.token,json:{html:retainedHead.html,expectedVersion:retainedHead.version,expectedState:retainedHead.state}}),params(created.id));
 expect(retained.status).toBe(200);expect((await readHtmlPage(identity,created.id)).links).toEqual(next.links);

 expect((await readHtmlPage(identity,created.id,'1')).links).toEqual(first.links);
 expect((await getHtmlBackendVersion(link.backendId,link.version))?.source).toBe('first');expect(await getHtmlBackendStore(link.backendId)).toEqual({value:{count:1},version:1});
});
it('invalid backend or unresolved HTML links leave no partial artifacts or backend modules',async()=>{
 const actor=await mintAccountToken('backend');
 const invalid=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html,backendSources:{db:'bad'}}}));expect(invalid.status).toBe(400);
 const missing=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html}}));expect(missing.status).toBe(400);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(0);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM html_backend_versions')).rows[0]?.n).toBe(0);
});
