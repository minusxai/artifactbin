import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {POST as start} from '@/app/api/start/route';
import {GET,PUT} from '@/app/api/artifacts/[id]/route';
import {POST as browserCreate} from '@/app/api/my/artifacts/route';
import {artifactStarter,ARTIFACT_STARTERS} from '@/lib/workspace/artifact-starters';
import { createUser } from '@/lib/accounts';
const harness=useAppHarness();
const html='<!doctype html><html><head><title>Native &amp; clear</title><meta name="description" content="Page description"></head><body><h1>Native</h1></body></html>';
const params=(id:string)=>({params:Promise.resolve({id})});
it('refuses every former JSX publication envelope before creating or replacing a page',async()=>{
 const actor=await mintAccountToken('native-only');
 for(const field of ['markup','jsx','markdown','document_update']){
  const refused=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{[field]:'<p>Old</p>'}}));expect(refused.status).toBe(400);
 }
 const created=await (await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html}}))).json();
 const head=await (await GET(request(`/api/artifacts/${created.id}`,{token:actor.token}),params(created.id))).json();
 for(const field of ['markup','document_update']){
  const refused=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:actor.token,json:{[field]:field==='markup'?'<p>Old</p>':{},expectedVersion:head.version,expectedState:head.state}}),params(created.id));expect(refused.status).toBe(400);
 }
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(1);
});
it('derives native title and description from head and honors explicit API overrides',async()=>{
 const actor=await mintAccountToken('html-metadata');
 const created=await (await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html}}))).json();
 const read=async()=>await (await GET(request(`/api/artifacts/${created.id}`,{token:actor.token}),params(created.id))).json();
 let head=await read();expect(head.title).toBe('Native & clear');expect(head.description).toBe('Page description');
 const updated=await PUT(request(`/api/artifacts/${created.id}`,{method:'PUT',token:actor.token,json:{html:head.html.replace('Native &amp; clear','Next title'),expectedVersion:head.version,expectedState:head.state}}),params(created.id));expect(updated.status).toBe(200);head=await read();expect(head.title).toBe('Next title');
 const overridden=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html,title:'API title',description:'API description'}}));expect(overridden.status).toBe(201);const override=await overridden.json();expect(override.title).toBe('API title');expect(override.description).toBe('API description');
});
it('creates every New artifact choice as private native HTML through the original browser API',async()=>{
 const user=await createUser({email:'mxmx_test_native_starters@example.com'});const actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
 for(const {template} of ARTIFACT_STARTERS){
  const response=await browserCreate(request('/api/my/artifacts',{method:'POST',actor,json:artifactStarter(template)}));expect(response.status).toBe(201);const saved=await response.json();
  const db=await harness.db();const row=(await db.query<{format:string;source:string;user_id:string;visibility:string}>('SELECT format,source,user_id,visibility FROM artifacts WHERE id=$1',[saved.id])).rows[0];expect(row?.format).toBe('html');expect(row?.source).toContain('/af/core.js');expect(row?.source).not.toMatch(/<Markdown|className=|<Helmet/);expect(row?.user_id).toBe(user.id);expect(row?.visibility).toBe('private');
 }
});
it('preserves original dataset and byte-file publication beside native pages',async()=>{
 const actor=await mintAccountToken('retained-tiers');
 const dataset=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{dataset:[{name:'A',value:1}]}}));expect(dataset.status).toBe(201);
 const file=await POST(new Request('http://localhost/api/artifacts?format=file&filename=note.txt',{method:'POST',headers:{authorization:`Bearer ${actor.token}`,'content-type':'text/plain'},body:'native publication keeps files'}));expect(file.status).toBe(201);
 const db=await harness.db();expect((await db.query<{format:string}>('SELECT format FROM artifacts ORDER BY format')).rows.map(row=>row.format)).toEqual(['dataset','file']);
});

it('starts the original handoff flow with a native HTML document',async()=>{
 const user=await createUser({email:'mxmx_test_native_handoff@example.com'});const actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
 const response=await start(request('/api/start',{method:'POST',actor,json:{}}));expect(response.status).toBe(201);const saved=await response.json();
 const db=await harness.db();const row=(await db.query<{format:string;source:string}>('SELECT format,source FROM artifacts WHERE id=$1',[saved.id])).rows[0];expect(row?.format).toBe('html');expect(row?.source).toContain('/af/core.js');expect(saved.url).toContain(`/a/${saved.id}`);expect(saved).not.toHaveProperty('token');
});
