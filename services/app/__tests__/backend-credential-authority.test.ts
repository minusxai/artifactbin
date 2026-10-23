import {expect,it,vi} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {GET as secretGET,PUT as secretPUT} from '@/app/api/my/backends/[id]/[version]/secrets/route';
import {getHtmlBackendVersion,getHtmlBackendStore,setHtmlBackendStore} from '@/lib/html-backends';
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>({typeDefs:'type Query { value: String }',compiled:source,secretBindings:source.includes('credential')?['TOKEN']:[]})}));
const harness=useAppHarness(),html='<html><head><link rel="af-backend" data-af-name="db" href="./db.ts"></head><body>App</body></html>';
const params=(id:string)=>({params:Promise.resolve({id})});
it('rejects editor replacement of owner credential code without committing code or history',async()=>{
 const owner=await mintAccountToken('secret-owner'),editor=await mintAccountToken('secret-editor');
 const created=await(await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html,backendSources:{db:'owner credential'}}}))).json();
 const db=await harness.db();await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[created.id,editor.userId,editor.email]);
 const head=await(await GET(request(`/api/artifacts/${created.id}`,{token:editor.token}),params(created.id))).json();
 const attack=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:editor.token,json:{html:head.html,backendSources:{db:'credential exfiltration'},expectedVersion:head.version,expectedState:head.state}}),params(created.id));
 expect(attack.status).toBe(403);
 const stripped=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:editor.token,json:{html:head.html,backendSources:{db:'removed declarations'},expectedVersion:head.version,expectedState:head.state}}),params(created.id));expect(stripped.status).toBe(403);
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM html_backend_versions WHERE page_id=$1',[created.id])).rows[0]?.n).toBe(1);
 const saved=await(await GET(request(`/api/artifacts/${created.id}`,{token:owner.token}),params(created.id))).json();expect(saved.version).toBe(head.version);
});
it('explicit new-owner republish creates an independent credential identity while retaining store data',async()=>{
 const owner=await mintAccountToken('old-owner'),next=await mintAccountToken('next-owner');
 const created=await(await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html,backendSources:{db:'owner credential'}}}))).json();
 const db=await harness.db();const row=(await db.query<{meta:{htmlLinks:{backendId:string;version:string}[]}}>('SELECT meta FROM artifacts WHERE id=$1',[created.id])).rows[0]!;const first=row.meta.htmlLinks[0]!;
 await setHtmlBackendStore(first.backendId,{count:7},0);
 const secrets=(link:typeof first)=>({params:Promise.resolve({id:link.backendId,version:link.version})});
 expect((await secretPUT(request('/api/my/backends/secrets',{method:'PUT',token:owner.token,json:{name:'TOKEN',value:'old-private-value'}}),secrets(first))).status).toBe(200);
 // Model the committed ownership transition; publication must recheck the locked current owner.
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[created.id,next.userId]);
 const head=await(await GET(request(`/api/artifacts/${created.id}`,{token:next.token}),params(created.id))).json();
 const updated=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:next.token,json:{html:head.html,backendSources:{db:'owner credential'},expectedVersion:head.version,expectedState:head.state}}),params(created.id));expect(updated.status).toBe(200);
 const after=(await db.query<{meta:typeof row.meta}>('SELECT meta FROM artifacts WHERE id=$1',[created.id])).rows[0]!.meta.htmlLinks[0]!;
 expect((await secretGET(request('/api/my/backends/secrets',{token:next.token}),secrets(after))).status).toBe(200);
 expect(await(await secretGET(request('/api/my/backends/secrets',{token:next.token}),secrets(after))).json()).toEqual({names:[]});
 expect((await secretPUT(request('/api/my/backends/secrets',{method:'PUT',token:next.token,json:{name:'TOKEN',value:'new-private-value'}}),secrets(after))).status).toBe(200);
 expect(after.backendId).not.toBe(first.backendId);expect((await getHtmlBackendVersion(after.backendId,after.version))?.ownerId).toBe(next.userId);
 expect(await getHtmlBackendStore(after.backendId)).toEqual({value:{count:7},version:1});expect(await getHtmlBackendStore(first.backendId)).toEqual({value:{count:7},version:1});
});
