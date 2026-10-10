import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createTeamApplication} from '../server/team-host';
import {AUTH_SECRET} from '@/lib/platform';
import * as preparedPages from '@/lib/publish/prepared/prepared-page.server';
import {drainPreparedPageWarmups} from '@/lib/publish/prepared/prepared-page.server';
import {installStoryCommitHooks} from '@/lib/publish/prepared/commit-hooks.server';
import {drainSnapshotRevalidations} from '@/lib/publish/prepared/snapshots.server';
import type {DocumentUpdate} from '@artifactbin/contracts';
import {useAppHarness,request} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import type { TokenActor } from '@/lib/accounts/actors';
import {getDb} from '@/lib/platform';
import {prepareClientDocumentPublication,type ClientDocumentChange} from '@/lib/document/document-update-client';
import {prepareDocumentAuthoringContext} from '@/lib/publish/publish';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_operation_api');
 const created=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));
 const {id}=await created.json();return {token,id,actor:{tokenId:token.id,userId:token.userId},row:(await getArtifactById(id))!};
}
async function prepare(row:ArtifactRow,actor:TokenActor,change:ClientDocumentChange){
 if(row.document?.kind!=='graph')throw new Error('Missing authoring snapshot');
 const document_update=await prepareClientDocumentPublication({...row,document:row.document},change,async source=>{
  const context=await prepareDocumentAuthoringContext(actor,row.id,{source});
  if(!context.ok)throw new Error(await context.text());
 });
 return {edit_id:row.edit_id,document_update};
}
it('accepts a client-prepared composite through the real route with one permission/document/history query',async()=>{
 installStoryCommitHooks();
 const {token,id,row,actor}=await setup(),db=await getDb();
 const body=await prepare(row,actor,{operations:[{kind:'setAttribute',path:[0],name:'className',value:'p-4'},{kind:'insert',parent:[0],index:1,source:'<h2>Heading</h2>'},{kind:'move',path:[0,2],parent:[0],index:0},{kind:'setText',path:[0,0,0],value:'Moved β'}]});
 // Preparation belongs to the post-commit worker, not the measured permission/
 // document/history transaction. Its scheduling must not race the query spy.
 await drainPreparedPageWarmups();await drainSnapshotRevalidations();
 const warmPage=preparedPages.warmPreparedPage,warmups:Array<Parameters<typeof warmPage>>=[];
 const warmupSpy=vi.spyOn(preparedPages,'warmPreparedPage').mockImplementation((...args)=>{warmups.push(args);});
 const spy=vi.spyOn(db,'query');
 try{
  const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id})});
  expect(response.status,await response.clone().text()).toBe(200);
  const artifactQueries=spy.mock.calls.filter(([sql])=>/\b(?:FROM|UPDATE) artifacts\b/.test(sql));
  expect(artifactQueries,artifactQueries.map(([sql])=>sql).join('\n\n')).toHaveLength(1);
  expect(warmups.map(([artifactId])=>artifactId)).toEqual([id]);
 }finally{
  spy.mockRestore();warmupSpy.mockRestore();
  // Exercise the real queued preparation after measuring the foreground commit.
  for(const args of warmups)warmPage(...args);
  await drainPreparedPageWarmups();await drainSnapshotRevalidations();
 }
 const head=(await getArtifactById(id))!;expect(head.source).toContain('Moved β');expect(head.source).toContain('Heading');expect(head.source).toContain('className="p-4"');
 expect((await db.query('SELECT document,source FROM artifacts WHERE id=$1',[id])).rows[0]).toMatchObject({source:null,document:{kind:'graph'}});
});
it('rejects an invalid composite in the legitimate client before submitting any write',async()=>{
 const {id,row,actor}=await setup();
 await expect(prepare(row,actor,{operations:[{kind:'setText',path:[0,0,0],value:'Must not save'},{kind:'setAttribute',path:[0],name:'onClick',value:'run()'}]})).rejects.toThrow();
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('two agents preparing against the same version retain independent paragraph edits',async()=>{
 const {token,id,row,actor}=await setup();
 for(const [index,text] of [[0,'First'],[1,'Second']] as const){
  const body=await prepare(row,actor,{operations:[{kind:'setText',path:[0,index,0],value:text}]});
  const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id})});expect(response.status).toBe(200);
 }
 const head=(await getArtifactById(id))!;expect(head.source).toContain('First');expect(head.source).toContain('Second');
});
it('whole replacement and restoration use the same JSONB protocol through PUT and edits',async()=>{
 const {token,id,row,actor}=await setup();
 const replacement=await prepare(row,actor,{source:'<h1>Replacement</h1>',whole:true});
 const replaced=await replaceRoute(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:replacement}),{params:Promise.resolve({id})});expect(replaced.status).toBe(200);
 const current=(await getArtifactById(id))!;
 const restored=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:await prepare(current,actor,{source:row.source!,whole:true})}),{params:Promise.resolve({id})});expect(restored.status).toBe(200);
 expect((await getArtifactById(id))?.source).toBe(row.source);
});
it.each([
 '<script>run()</script>', '<p onClick="run()">x</p>', '<a href="javascript:alert(1)">x</a>',
 '<form><button>x</button></form>', '<Helmet /><Helmet />', '<p>{process.exit()}</p>',
 '<Column col="x">x</Column>', '<Grid mode="wrong" />', '<p>{$_row.missing}</p>',
 '<Helmet><Value name="x" type="number" default="wrong" /></Helmet>', '<img src="ref:zzzzzz" />',
 '<p>\0</p>', '<Icon name="nonexistent-xyz" />',
])('the shared authoring client refuses an invalid replacement: %s',async source=>{
 const {id,row,actor}=await setup();
 await expect(prepare(row,actor,{operations:[{kind:'replaceDocument',source}]})).rejects.toThrow();
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('refuses retired text-write bodies instead of silently using a read/retry fallback',async()=>{
 const {token,id,row}=await setup();
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,source:'<p>Text fallback</p>'}}),{params:Promise.resolve({id})});
 expect(response.status).toBe(400);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});

it('the published direct HTTP example edits JSX with an email bearer, reserved identity and graph conflicts',async()=>{
 const guide=await readFile(join(process.cwd(),'skills/artifactbin/references/http-authoring.md'),'utf8');
 const code=/```js\n(\/\/ BEGIN HTTP TEXT EDIT[\s\S]*?\/\/ END HTTP TEXT EDIT)\n```/.exec(guide)?.[1];
 expect(code,'HTTP authoring guide needs an executable JSON graph example').toBeTruthy();
 const build=runInNewContext(code+'\nbuildPlainTextUpdate',{TextEncoder}) as (snapshot:Record<string,unknown>,nodeId:string,before:string,after:string)=>DocumentUpdate;
 const directory=await mkdtemp(join(tmpdir(),'http-authoring-')),base='http://localhost:3000';
 const host=await createTeamApplication({APP__PUBLIC_BASE_URL:base,AUTH__SECRET:AUTH_SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')},process.cwd());
 try{
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>host.fetch(new Request(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  const email='mxmx_test_direct_http_authoring@example.test';
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const mail=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:mail.find(message=>message.to===email).otp});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const issued=await post('/api/authentication/token',{}, {cookie});expect(issued.status).toBe(201);
  const auth={authorization:'Bearer '+(await issued.json()).access_token};
  const reserved=await post('/api/artifacts/reservations',{}, {...auth,'Idempotency-Key':'http_authoring_batch_001'});expect(reserved.status).toBe(200);
  const ids=(await reserved.json()).ids;expect(ids).toHaveLength(100);
  const body={reserved_id:ids[0],markup:'<p id="message">Alpha</p>',title:'HTTP example',visibility:'unlisted'};
  const created=await post('/api/artifacts',body,{...auth,'Idempotency-Key':'http_authoring_create_001'});expect(created.status,await created.clone().text()).toBe(201);
  const {id}=await created.json();expect(id).toBe(ids[0]);
  const read=()=>host.fetch(new Request(base+'/api/artifacts/'+id,{headers:auth}));
  const snapshot=await(await read()).json();expect(snapshot.markup).toBe(body.markup);
  const document_update=build(snapshot,'message','Alpha','Updated HTTP text 😀');
  const prepared=await post('/api/artifacts/'+id+'/prepare',{source:'<p id="message">Updated HTTP text 😀</p>'},auth);expect(prepared.status).toBe(200);expect(await prepared.json()).toMatchObject({valid:true});
  const edited=await post('/api/artifacts/'+id+'/edits',{edit_id:snapshot.edit_id,document_update},auth);expect(edited.status,await edited.clone().text()).toBe(200);
  const head=await(await read()).json();expect(head.markup).toBe('<p id="message">Updated HTTP text 😀</p>');expect(head.version).toBe(snapshot.version+1);
  const stale=await post('/api/artifacts/'+id+'/edits',{edit_id:snapshot.edit_id,document_update},auth);expect(stale.status).toBe(409);expect((await(await read()).json()).markup).toBe(head.markup);
  // Execute the recommended source-authoring guide verbatim with the same email bearer.
  const sourceCode=/```js\n(\/\/ BEGIN HTTP SOURCE EDIT[\s\S]*?\/\/ END HTTP SOURCE EDIT)\n```/.exec(guide)?.[1];
  expect(sourceCode,'HTTP guide needs an executable source preparation example').toBeTruthy();
  const fresh=await post('/api/artifacts',{markup:body.markup,title:'Source example'},auth);
  expect(fresh.status).toBe(201);const original=await fresh.json();
  const run=runInNewContext('(async()=>{'+sourceCode+'\n;return edited;})',{
   fetch:(url:string,init:RequestInit)=>host.fetch(new Request(url,init)),base,artifactId:original.id,accessToken:auth.authorization.slice('Bearer '.length),
  }) as ()=>Promise<Record<string,unknown>>;
  const sourceEdited=await run();expect(sourceEdited.id).toBe(original.id);
  const sourceHead=await(await host.fetch(new Request(base+'/api/artifacts/'+original.id,{headers:auth}))).json();
  expect(sourceHead.markup).toBe('<p id="message">Updated HTTP text</p>');
  expect(sourceHead.title).toBe('Updated HTTP example');expect(sourceHead.version).toBe(original.version+1);

 }finally{await drainPreparedPageWarmups();await drainSnapshotRevalidations();await host.close();await rm(directory,{recursive:true,force:true});}
});
