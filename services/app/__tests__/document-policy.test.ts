import {documentEditBody} from './prepared-document';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {setDocumentEditorPolicy} from '@/lib/document-policy';
import type {Actor} from '@artifactbin/contracts';
import {GET,PUT,DELETE} from '@/app/api/my/artifacts/[id]/route';
import {POST as edit} from '@/app/api/my/artifacts/[id]/edits/route';
import {GET as page} from '@/app/api/page/artifact/[id]/route';
import {canReadArtifact,getArtifactById} from '@/lib/artifacts';
import {roleFor,sessionActor} from '@/lib/viewer';
import {request,useAppHarness} from './harness';
import {observedRequest} from './conditional-request';

const harness=useAppHarness();
const admin:Actor={credential:'session',userId:'usr_admin',email:'Admin@Example.com',emailVerified:true};
const options={actor:admin,origin:'same'};
const path='/api/my/artifacts/abc123';
const context={params:Promise.resolve({id:'abc123'})};
beforeEach(async()=>{
 setDocumentEditorPolicy(actor=>actor.userId==='usr_admin' && actor.emailVerified===true);
 await (await harness.db()).query(`INSERT INTO artifacts(id,token_id,user_id,title,source,content,format,visibility,edit_id) VALUES ('abc123','tok_owner','usr_owner','Private document','<p id="intro">Before</p>','','markup','private','base-edit')`);
});
it('opens private documents in the ordinary editor with server-provided editor permission',async()=>{
 const req=request(path,options),actor=await sessionActor(req),row=(await getArtifactById('abc123'))!;
 expect(await canReadArtifact(row,actor.viewer)).toBe(true);
 expect(await roleFor(row,actor)).toBe('editor');
 expect((await GET(req,context)).status).toBe(200);
 expect((await page(request('/api/page/artifact/abc123',options),context)).status).toBe(200);
 expect((await DELETE(request(path,{...options,method:'DELETE'}),context)).status).toBe(404);
});
it('saves through the normal edit and replacement routes with real actor attribution and history',async()=>{
 const response=await edit(request(path+'/edits',{...options,method:'POST',json:documentEditBody((await getArtifactById('abc123'))!,{source:'<p id="intro">Edited</p>',whole:true})}),context);
 expect(response.status,await response.clone().text()).toBe(200);
 const replaced=await PUT(await observedRequest(path,{...options,method:'PUT',json:{markup:'<p id="intro">Replaced</p>'}}),context);
 expect(replaced.status,await replaced.clone().text()).toBe(200);
 const outdated=documentEditBody((await getArtifactById('abc123'))!,{source:'<p>Stale</p>',whole:true});outdated.document_update.patch.baseVersion=1;
 const stale=await PUT(request(path,{...options,method:'PUT',json:outdated}),context);
 expect(stale.status).toBe(409);
 const row=(await getArtifactById('abc123'))!;
 expect(row).toMatchObject({user_id:'usr_owner',actor_user_id:'usr_admin',visibility:'private',version:3});
 expect((await (await harness.db()).query('SELECT 1 FROM artifact_versions WHERE artifact_id=$1',['abc123'])).rows).toHaveLength(2);
});
it('does not elevate other users, unverified identities, agent cookies or forged headers',async()=>{
 for(const actor of [{...admin,userId:'usr_other',email:'other@example.com'},{...admin,emailVerified:false},{...admin,credential:'agent-cookie' as const,tokenId:'tok_admin'}]){
  expect((await GET(request(path,{actor}),context)).status).toBe(404);
 }
 expect((await GET(request(path,{actor:{...admin,userId:'usr_other',email:'other@example.com'},headers:{'x-admin-email':admin.email!,'X-Artifactbin-Admin':'1'}}),context)).status).toBe(404);
 expect((await GET(request(path,{...options,headers:{'x-mx-browser-session':'1'}}),context)).status).toBe(401);
 setDocumentEditorPolicy();
 expect((await GET(request(path,options),context)).status).toBe(404);
});
it('keeps cross-site writes and private datasets outside the grant',async()=>{
 expect((await edit(request(path+'/edits',{actor:admin,origin:'https://evil.test',method:'POST',json:{edit_id:'base-edit',source:'<p>Attack</p>'}}),context)).status).toBe(403);
 await (await harness.db()).query("UPDATE artifacts SET format='dataset' WHERE id='abc123'");
 expect((await GET(request(path,options),context)).status).toBe(404);
 const actor=await sessionActor(request(path,options));
 expect(await canReadArtifact((await getArtifactById('abc123'))!,actor.viewer)).toBe(false);
});
afterEach(()=>setDocumentEditorPolicy());
it('does not elevate a verified account without a host policy', async () => {
 setDocumentEditorPolicy();
 expect((await GET(request(path,options),context)).status).toBe(404);
});
