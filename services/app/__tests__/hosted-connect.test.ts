import {describe,it,expect,vi} from 'vitest';
import * as annotations from '@/lib/annotations';
import * as artifactStore from '@/lib/artifacts/store';
import {useAppHarness,request} from './harness';
import {mintToken,createUser} from '@/lib/accounts';
import {getArtifactById,applyEditFor} from '@/lib/artifacts';
import {createAnnotationFor,listAnnotationsFor} from '@/lib/annotations';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as inspect} from '@/app/connect/inspect/route';
import {POST as apply} from '@/app/connect/import/route';
import {GET as redirect} from '@/app/workspace/[id]/route';
import {artifactFile} from '@/lib/offline/__tests__/fixture';
import {prepareClientDocumentUpdate} from '@/lib/story/graph/document-update-client';
import type {ArtifactFile} from '@/lib/offline/file-format';
import {assembleArtifactFile} from '@/lib/offline/assemble.server';
useAppHarness();
const html=(file:ArtifactFile)=>`<script id="afbin-file" type="application/json">${JSON.stringify(file).replaceAll('<','\\u003c')}</script><script>throw Error('must not execute')</script>`;
async function setup(){
 const user=await createUser({email:'mxmx_test_hosted_connect@example.com'}),token=await mintToken('mxmx_test_hosted_connect',user.id);
 const actor={credential:'session' as const,userId:user.id,email:user.email!,emailVerified:true};
 const created=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<main id="root"><p id="first">One</p><p id="second">Two</p></main>',title:'Report',theme:'manuscript'}}));
 expect(created.status,await created.clone().text()).toBe(201);
 const doc=await created.json(),row=(await getArtifactById(doc.id))!;
 if(row.document?.kind!=='graph')throw Error('Expected a graph document');
 const file=artifactFile({origin:'http://localhost:3000',artifactId:doc.id,base:{version:row.version,editId:row.edit_id,source:row.source!},source:row.source!,metadata:{title:row.title??'',description:row.description,theme:row.meta.theme as string??null,template:row.meta.template as string??null,colorMode:row.meta.colorMode as 'light'|'dark'??null}});
 const send=(mode:'update'|'copy'='update',override=actor)=>apply(request('/connect/import',{method:'POST',actor:override,origin:'same',json:{html:html(file),filename:'Report.jsx.html',mode,operationId:'00000000-0000-4000-8000-000000000000'}}));
 return {actor,file,row,document:row.document,send,scope:{userId:user.id,tokenId:token.id}};
}
describe('hosted portable file handoff',()=>{
 it.each([false,true])('can apply a real download between coalesced saves (save interleaves with download: %s)',async(interleave)=>{
  const {row,scope,actor}=await setup();
  async function online(from:string,to:string){
   const head=(await getArtifactById(row.id))!;
   if(head.document?.kind!=='graph')throw Error('Expected a graph document');
   expect(await applyEditFor(scope,row.id,{baseEditId:head.edit_id,documentUpdate:prepareClientDocumentUpdate({...head,document:head.document},{source:head.source!.replace(from,to)})})).toMatchObject({applied:true});
  }
  await online('Two','Online two');
  const captured=(await getArtifactById(row.id))!;
  const read=artifactStore.getArtifactById;
  const boundary=interleave?vi.spyOn(artifactStore,'getArtifactById').mockImplementationOnce(async(id)=>{
   const admitted=await read(id);
   await online('Online two','Online three');
   return admitted;
  }):null;
  const downloaded=await assembleArtifactFile({id:row.id,actor:scope,origin:'http://localhost:3000'});
  boundary?.mockRestore();
  expect((await artifactStore.getVersionFor(scope,row.id,2))?.document).toEqual(captured.document);
  if('refused' in downloaded)throw Error(downloaded.message);
  expect(downloaded.base.version).toBe(2);
  downloaded.source=downloaded.source.replace('One','Offline one');
  if(!interleave)await online('Online two','Online three');
  const result=await inspect(request('/connect/inspect',{method:'POST',actor,origin:'same',json:{html:html(downloaded),filename:'Report.jsx.html'}}));
  expect(await result.json()).toMatchObject({kind:'update',target:row.id});
  const applied=await apply(request('/connect/import',{method:'POST',actor,origin:'same',json:{html:html(downloaded),filename:'Report.jsx.html',mode:'update'}}));
  expect(applied.status,await applied.clone().text()).toBe(200);
  const head=(await getArtifactById(row.id))!;
  expect(head.source).toContain('Offline one');expect(head.source).toContain('Online three');
 });

 it('does not mint a content version for a comments-only handoff',async()=>{
  const {file,row,scope,send}=await setup();
  const server=await createAnnotationFor(scope,row.id,{nodeId:'first',body:'Existing'},{kind:'human',label:'Account',transport:'browser'});
  if(!server||server instanceof Response||'refused' in server)throw Error('Expected a comment');
  file.threads=[{...server,id:'offline_note',thread:[{...server.thread[0]!,id:'offline_note',body:'Only a comment'}]}];file.localIds=['offline_note'];
  const before=(await getArtifactById(row.id))!.version;
  const result=await send();expect(result.status,await result.clone().text()).toBe(200);expect((await getArtifactById(row.id))!.version).toBe(before);
 });
 it('applies to the original ID, recovers a lost reply without another version, and keeps unrelated concurrent edits',async()=>{
  const {file,row,document,scope,send}=await setup();
  file.source=file.source.replace('One','Offline');
  const base={document,version:row.version,meta:row.meta,title:row.title,description:row.description};
  expect(await applyEditFor(scope,row.id,{baseEditId:row.edit_id,documentUpdate:prepareClientDocumentUpdate(base,{source:row.source!.replace('Two','Online')})})).toMatchObject({applied:true});
  const result=await send();expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toMatchObject({artifactId:row.id,path:`/workspace/${row.id}`});
  const head=(await getArtifactById(row.id))!;expect(head.source).toContain('Offline');expect(head.source).toContain('Online');
  expect((await send()).status).toBe(200);expect((await getArtifactById(row.id))!.version).toBe(head.version);
 });
 it('rejects overlapping edits and forged baselines without writing the original',async()=>{
  const {file,row,document,scope,send}=await setup();file.source=file.source.replace('One','Offline');
  await applyEditFor(scope,row.id,{baseEditId:row.edit_id,documentUpdate:prepareClientDocumentUpdate({document,version:row.version,meta:row.meta},{source:row.source!.replace('One','Online')})});
  const head=(await getArtifactById(row.id))!,conflict=await send();expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({code:'doc_changed',error:'Your offline changes overlap with newer server edits.',hint:'Your changes were not applied. Keep this file and reconcile the edited blocks, or create an independent copy.'});
  expect((await getArtifactById(row.id))!.version).toBe(head.version);
  file.base.source='forged';expect((await send()).status).toBe(409);expect((await getArtifactById(row.id))!.source).toBe(head.source);
 });
 it('rechecks account edit access and same-origin mutations, and offers copies explicitly',async()=>{
  const {file,row,send,actor}=await setup(),other=await createUser({email:'mxmx_test_hosted_stranger@example.com'});
  const stranger={...actor,userId:other.id,email:other.email!};
  expect((await send('update',stranger)).status).toBe(409);
  const inspected=await inspect(request('/connect/inspect',{method:'POST',actor:stranger,origin:'same',json:{html:html(file),filename:'Report.jsx.html'}}));expect(await inspected.json()).toMatchObject({kind:'copy'});
  expect((await apply(request('/connect/import',{method:'POST',actor,origin:'https://evil.test',json:{html:html(file),filename:'Report.jsx.html',mode:'update'}}))).status).toBe(403);
  const noAuth=await inspect(request('/connect/inspect',{method:'POST',json:{html:html(file),filename:'Report.jsx.html'}}));expect(await noAuth.json()).toMatchObject({requiresAuth:true});
  const copy=await send('copy');expect(copy.status,await copy.clone().text()).toBe(200);const made=await copy.json();expect(made.artifactId).not.toBe(row.id);
  expect(await (await send('copy')).json()).toMatchObject({artifactId:made.artifactId});
  const landed=await redirect(request(`/workspace/${row.id}`,{actor}),{params:Promise.resolve({id:row.id})});expect(landed.status).toBe(303);expect(landed.headers.get('location')).toBe(`http://localhost:3000/a/${row.id}/edit`);
  expect((await redirect(request(`/workspace/${row.id}`,{actor:stranger}),{params:Promise.resolve({id:row.id})})).status).toBe(404);
 });
 it.each(['app.artifactbin.dev','custom.artifactbin.example'])('redirects the verified original through the public proxy origin %s',async(host)=>{
  const {row,actor}=await setup();
  const landed=await redirect(request(`/workspace/${row.id}`,{actor,headers:{host:'artifactbin-app:5000','x-forwarded-host':host,'x-forwarded-proto':'https'}}),{params:Promise.resolve({id:row.id})});
  expect(landed.status).toBe(303);expect(landed.headers.get('location')).toBe(`https://${host}/a/${row.id}/edit`);
 });
 it('preserves server threads, adds stable local comments and replies once, and refuses edited server comments',async()=>{
  const {file,row,scope,send}=await setup();
  const server=await createAnnotationFor(scope,row.id,{nodeId:'first',body:'Existing'},{kind:'human',label:'Account',transport:'browser'});expect(server&&!(server instanceof Response)&&!('refused' in server)).toBe(true);
  const original=(await listAnnotationsFor(scope,row.id,{status:'all'}))![0]!;
  const reply={...original.thread[0]!,id:'offline_reply',body:'Offline reply'};
  const local={...original,id:'offline_thread',thread:[{...reply,id:'offline_thread',body:'Local note'}]};
  file.threads=[{...original,thread:[...original.thread,reply]},local];file.localIds=['offline_thread','offline_reply'];
  file.source=file.source.replace('One','Offline');
  const applied=await send();expect(applied.status,await applied.clone().text()).toBe(200);
  expect((await send()).status).toBe(200);
  const threads=(await listAnnotationsFor(scope,row.id,{status:'all'}))!;expect(threads).toHaveLength(2);expect(threads.find(t=>t.id===original.id)!.thread).toHaveLength(2);
  expect(threads.flatMap(t=>t.thread).filter(c=>c.body.includes('Local note'))).toHaveLength(1);
  const before=(await getArtifactById(row.id))!.version;
  file.threads[0]!.thread[0]!.body='Forged edit';expect((await send()).status).toBe(409);expect((await getArtifactById(row.id))!.version).toBe(before);
 });
 it('reports partial progress and retries confirmed source plus pending comments without duplicate versions or notes',async()=>{
  const {file,row,scope,send}=await setup();
  const first=await createAnnotationFor(scope,row.id,{nodeId:'first',body:'Seed'},{kind:'human',label:'Account',transport:'browser'});
  if(!first||first instanceof Response||'refused' in first)throw Error('Expected a comment');
  file.threads=[{...first,id:'offline_thread',thread:[{...first.thread[0]!,id:'offline_thread',body:'Retry me'}]}];file.localIds=['offline_thread'];file.source=file.source.replace('One','Offline');
  const create=annotations.createAnnotationFor;
  const failure=vi.spyOn(annotations,'createAnnotationFor').mockImplementationOnce(async(...args)=>{await create(...args);throw Error('The annotation reply was lost after commit');});
  const partial=await send();expect(partial.status).toBe(409);expect(await partial.json()).toMatchObject({sourceApplied:true,artifactId:row.id});
  const version=(await getArtifactById(row.id))!.version;failure.mockRestore();
  const recovered=await send();expect(recovered.status,await recovered.clone().text()).toBe(200);expect((await getArtifactById(row.id))!.version).toBe(version);
  expect((await listAnnotationsFor(scope,row.id,{status:'all'}))!.flatMap(t=>t.thread).filter(c=>c.body.includes('Retry me'))).toHaveLength(1);
 });
 it('rejects malformed comments and unavailable references before publishing anything',async()=>{
  const {file,row,send}=await setup();file.source=file.source.replace('One','Offline');
  file.threads=[{id:'invalid'}] as ArtifactFile['threads'];expect((await send()).status).toBe(409);expect((await getArtifactById(row.id))!.version).toBe(row.version);
  file.threads=[];file.source='<img id="image" src="ref:Unknown1"/>';
  const copy=await send('copy');expect(copy.status).toBeGreaterThanOrEqual(400);expect((await getArtifactById(row.id))!.version).toBe(row.version);
 });
});
