import {nativeHtml} from './native-html-fixture';
import {artifactState} from '@/lib/artifacts/state';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {setDocumentEditorPolicy} from '@/lib/accounts';
import type {Actor} from '@artifactbin/contracts';
import {GET,PUT,DELETE} from '@/app/api/my/artifacts/[id]/route';
import {POST as edit} from '@/app/api/my/artifacts/[id]/edits/route';
import {GET as page} from '@/app/api/page/artifact/[id]/route';
import {canReadArtifact,effectiveRole,getArtifactById} from '@/lib/artifacts';
import { sessionActor } from '@/lib/accounts';
import {request,useAppHarness} from './harness';
import {observedRequest} from './conditional-request';

/**
 * The host's document-editor grant at the BROWSER doors (the session the proxy attaches): an admin edits any
 * native HTML document that is not private, exactly as a link could reach it, and reaches no private artifact.
 */
const harness=useAppHarness();
const admin:Actor={credential:'session',userId:'usr_admin',email:'Admin@Example.com',emailVerified:true};
const options={actor:admin,origin:'same'};
const path='/api/my/artifacts/abc123',privatePath='/api/my/artifacts/prv123';
const context={params:Promise.resolve({id:'abc123'})},privateContext={params:Promise.resolve({id:'prv123'})};
beforeEach(async()=>{
 // Session claims name persisted accounts; profile sync may already have cached them.
 await (await harness.db()).query("INSERT INTO users(id,email,kind) VALUES ('usr_admin','admin@example.com','account'),('usr_other','other@example.com','account'),('usr_owner','owner@example.com','account')");
 setDocumentEditorPolicy(actor=>actor.userId==='usr_admin' && actor.emailVerified===true);
 for(const [id,title,visibility] of [['abc123','Unlisted document','unlisted'],['prv123','Private document','private']])
  await (await harness.db()).query(`INSERT INTO artifacts(id,token_id,user_id,title,source,meta,format,visibility,edit_id) VALUES ($1,'tok_owner','usr_owner',$2,$3,'{}','html',$4,'base-edit')`,[id,title,nativeHtml('<p data-af-id="intro">Before</p>'),visibility]);
});
it('opens non-private documents with native publication authority with server-provided editor permission',async()=>{
 const req=request(path,options),actor=await sessionActor(req),row=(await getArtifactById('abc123'))!;
 expect(actor.documentEditor).toBe(true);
 expect(await canReadArtifact(row,actor)).toBe(true);
 expect(await effectiveRole(row,actor)).toBe('editor');
 expect((await GET(req,context)).status).toBe(200);
 expect((await page(request('/api/page/artifact/abc123',options),context)).status).toBe(200);
 expect((await DELETE(request(path,{...options,method:'DELETE'}),context)).status).toBe(404);
});
it('refuses an admin every browser door to a private document, leaking nothing and writing nothing',async()=>{
 const actor=await sessionActor(request(privatePath,options)),row=(await getArtifactById('prv123'))!;
 expect(actor.documentEditor,'the grant is the actor\'s; the private document is what it never reaches').toBe(true);
 expect(await canReadArtifact(row,actor)).toBe(false);
 expect(await effectiveRole(row,actor)).toBe('none');
 const doors:Array<[string,Response]>=[
  ['read',await GET(request(privatePath,options),privateContext)],
  ['page',await page(request('/api/page/artifact/prv123',options),privateContext)],
  ['edit',await edit(request(privatePath+'/edits',{...options,method:'POST',json:{source:'retired editor request'}}),privateContext)],
  ['replace',await PUT(await observedRequest(privatePath,{...options,method:'PUT',json:{html:nativeHtml('<p data-af-id="intro">Admin</p>')}}),privateContext)],
  ['delete',await DELETE(request(privatePath,{...options,method:'DELETE'}),privateContext)],
 ];
 for(const [door,response] of doors){
  const text=await response.text();
  expect(response.status,`${door}: ${text}`).toBe(404);
  expect(text,door).not.toContain('Private document');
 }
 expect(await getArtifactById('prv123')).toMatchObject({version:1,actor_user_id:null,visibility:'private'});
});
it('conditionally saves native HTML with real actor attribution, archived history and stale-write refusal',async()=>{
 const initial=(await getArtifactById('abc123'))!;
 const first=await PUT(await observedRequest(path,{...options,method:'PUT',json:{html:nativeHtml('<p data-af-id="intro">Edited</p>')}}),context);
 expect(first.status,await first.clone().text()).toBe(200);
 const replaced=await PUT(await observedRequest(path,{...options,method:'PUT',json:{html:nativeHtml('<p data-af-id="intro">Replaced</p>')}}),context);
 expect(replaced.status,await replaced.clone().text()).toBe(200);
 const stale=await PUT(request(path,{...options,method:'PUT',json:{html:nativeHtml('<p data-af-id="intro">Stale</p>'),expectedVersion:initial.version,expectedState:artifactState(initial)}}),context);
 expect(stale.status).toBe(409);
 const row=(await getArtifactById('abc123'))!;
 expect(row).toMatchObject({user_id:'usr_owner',actor_user_id:'usr_admin',visibility:'unlisted',version:3});
 expect(row.source).toContain('Replaced');
 expect((await (await harness.db()).query('SELECT 1 FROM artifact_versions WHERE artifact_id=$1',['abc123'])).rows).toHaveLength(2);
});
it('does not elevate other users, unverified identities, agent cookies or forged headers',async()=>{
 for(const actor of [{...admin,userId:'usr_other',email:'other@example.com'},{...admin,emailVerified:false},{...admin,credential:'agent-cookie' as const,tokenId:'tok_admin'}]){
  expect((await GET(request(path,{actor}),context)).status).toBe(actor.credential === 'agent-cookie' ? 401 : 404);
 }
 expect((await GET(request(path,{actor:{...admin,userId:'usr_other',email:'other@example.com'},headers:{'x-admin-email':admin.email!,'X-Artifactbin-Admin':'1'}}),context)).status).toBe(404);
 expect((await GET(request(path,{headers:{'x-mx-browser-session':'1'}}),context)).status).toBe(401);
 setDocumentEditorPolicy();
 expect((await GET(request(path,options),context)).status).toBe(404);
});
it('keeps cross-site writes and private datasets outside the grant',async()=>{
 expect((await PUT(await observedRequest(path,{actor:admin,origin:'https://evil.test',method:'PUT',json:{html:nativeHtml('<p>Attack</p>')}}),context)).status).toBe(403);
 await (await harness.db()).query("UPDATE artifacts SET format='dataset' WHERE id='prv123'");
 expect((await GET(request(privatePath,options),privateContext)).status).toBe(404);
 const actor=await sessionActor(request(privatePath,options));
 expect(await canReadArtifact((await getArtifactById('prv123'))!,actor)).toBe(false);
});
afterEach(()=>setDocumentEditorPolicy());
it('does not elevate a verified account without a host policy', async () => {
 setDocumentEditorPolicy();
 expect((await GET(request(path,options),context)).status).toBe(404);
});
