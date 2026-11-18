/** Parent acceptance seed: receipt metadata requires exact execution and fresh read admission. */
import {it,expect,vi} from 'vitest';
import { trashRow } from '@/__tests__/artifact-fixtures';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {APP_ARTIFACT_WORKLOAD_PATH} from '@artifactbin/contracts';
import {mintAccountToken,useAppHarness} from '../../__tests__/harness';
import {nativeHtml} from '../../__tests__/native-html-fixture';
useAppHarness();
it('recovers only committed outputs from this exact execution with no source or write authority',async()=>{
 const owner=await mintAccountToken('mxmx_test_receipt_reader'),group=await createGroup(owner.userId!,{handle:'receipt_reader',name:'Receipt group'});
 const host=await createAppHost(),human={credential:'bearer' as const,userId:owner.userId!,tokenId:owner.id};
 const req=(path:string,body:unknown)=>new Request('http://127.0.0.1'+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
 const folder=(await(await host.request(req('/api/artifacts',{format:'folder',title:'Outputs',destination:{type:'group',id:group.id}}),human)).json()).id;
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:group.id,executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 const credential='q'.repeat(43);let revoke=false,denyFinal=false,key='slot-one';
 const config=await import('@/lib/platform');vi.spyOn(config,'serviceAudiences').mockReturnValue([{id:'worker',origin:'https://worker.example',introspectionSecretSha256:'0'.repeat(64),artifactWorkloads:{authorizationUrl:'http://127.0.0.1/authorize',authorizationSecret:'callback-secret-test'}}]);
 const calls:string[]=[];
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  expect(String(input)).toBe('http://127.0.0.1/authorize');const b=JSON.parse(String(init?.body));calls.push(b.phase);
  const listing=b.operation.kind==='artifact-outputs';
  const allowed=!revoke&&!(denyFinal&&b.phase==='final')&&(!listing||b.operation.credential===credential);
  return Response.json({digest:b.digest,nonce:b.nonce,scope:allowed?{allowed:true,principal:b.principal,role:listing?'viewer':'editor',readArtifactIds:[],rootFolderId:listing?null:folder,visibility:'private',...(listing?{outputLookup:true}:{creationKey:key,publication:{maxArtifacts:100,maxBytes:16777216}})}:{allowed:false}});
 });
 const call=(operation:unknown,binding=principal)=>host.request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation}),{credential:'workload',workload:binding});
 const list=(binding=principal)=>call({kind:'artifact-outputs',credential,after:null},binding);
 try{
  const created=await call({kind:'artifact-create',title:'Checked report',html:nativeHtml('<p>Private checked result</p>')});expect(created.status).toBe(201);const id=(await created.json()).id;
  const db=await getDb(),audit=(await db.query('SELECT * FROM workload_publication_audit')).rows,outputs=(await db.query('SELECT * FROM workload_publication_outputs')).rows;
  calls.length=0;const result=await list();expect(result.status,await result.clone().text()).toBe(200);const page=await result.json();
  expect(page).toEqual({items:[{id,title:'Checked report',format:'html',url:expect.stringContaining('/a/'+id)}],nextCursor:null,hasMore:false});expect(calls).toEqual(['admission','final']);
  for(const field of ['issuerId','subjectId','grantId','groupId','executionId','environmentId','intentHash','epoch'] as const){const wrong={...principal,[field]:field==='epoch'?2:'unrelated'};const r=await list(wrong);expect([200,403]).toContain(r.status);if(r.status===200)expect((await r.json()).items).toEqual([]);}
  expect(JSON.stringify(page)).not.toContain('Private checked result');expect(JSON.stringify(page)).not.toContain(credential);
  expect((await db.query('SELECT * FROM workload_publication_audit')).rows).toEqual(audit);expect((await db.query('SELECT * FROM workload_publication_outputs')).rows).toEqual(outputs);
  denyFinal=true;expect((await list()).status).toBe(403);denyFinal=false;
  expect((await call({kind:'artifact-outputs',credential:'x'.repeat(43),after:null})).status).toBe(403);
  await trashRow(id);expect((await(await list()).json()).items).toEqual([]);
  await db.query('UPDATE artifacts SET deleted_at=NULL,group_id=NULL WHERE id=$1',[id]);expect((await(await list()).json()).items).toEqual([]);
  revoke=true;expect((await list()).status).toBe(403);
 }finally{fetch.mockRestore();vi.restoreAllMocks();}
});
it('paginates distinct receipts, refuses writer scopes and rereads after the final fence',async()=>{
 const owner=await mintAccountToken('mxmx_test_output_pages'),group=await createGroup(owner.userId!,{handle:'output_pages',name:'Outputs'});
 const host=await createAppHost(),db=await getDb();
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:group.id,executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 const credential='q'.repeat(43),operation={kind:'artifact-outputs',credential,after:null as string|null};
 const req=(op:unknown=operation)=>new Request('http://127.0.0.1'+APP_ARTIFACT_WORKLOAD_PATH,{method:'POST',body:JSON.stringify({operation:op})});
 const call=(op:unknown=operation)=>host.request(req(op),{credential:'workload',workload:principal});
 vi.spyOn(await import('@/lib/platform'),'serviceAudiences').mockReturnValue([{id:'worker',origin:'https://worker.example',introspectionSecretSha256:'0'.repeat(64),artifactWorkloads:{authorizationUrl:'http://127.0.0.1/authorize',authorizationSecret:'callback-secret-test'}}]);
 let patch:Record<string,unknown>={},change:(()=>Promise<unknown>)|null=null;const phases:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{
  const b=JSON.parse(String(init?.body));phases.push(b.phase);
  if(b.phase==='final'&&change)await change();
  return Response.json({digest:b.digest,nonce:b.nonce,scope:{allowed:true,principal,role:'viewer',readArtifactIds:[],rootFolderId:null,visibility:'private',outputLookup:true,...patch}});
 });
 try{
  for(let n=0;n<52;n++){
   const id='output_'+String(n).padStart(3,'0');
   await db.query("INSERT INTO artifacts(id,title,format,group_id,visibility) VALUES($1,$1,'html',$2,'private')",[id,group.id]);
   await db.query('INSERT INTO workload_publication_outputs(namespace,artifact_id) VALUES($1,$2)',['slot',id]);
   await db.query('INSERT INTO workload_publication_audit(namespace,grant_namespace,group_id,artifact_id,bytes,binding) VALUES($1,$1,$2,$3,1,$4::jsonb),($1,$1,$2,$3,1,$4::jsonb)',['slot',group.id,id,JSON.stringify(principal)]);
  }
  const first=await(await call()).json();expect(first.items).toHaveLength(50);expect(first.nextCursor).toBe('output_049');expect(first.hasMore).toBe(true);
  const last=await(await call({...operation,after:first.nextCursor})).json();expect(last.items.map((x:{id:string})=>x.id)).toEqual(['output_050','output_051']);expect(last).toMatchObject({hasMore:false,nextCursor:null});
  phases.length=0;expect((await(await call({...operation,after:'z'})).json()).items).toEqual([]);expect(phases).toEqual(['admission','final']);
  for(const invalid of [{outputLookup:undefined},{role:'editor'},{readArtifactIds:['output_000']},{rootFolderId:'folder'},{creationKey:'slot'},{publication:{maxArtifacts:1,maxBytes:1}},{writeArtifactIds:[]}]){patch=invalid;expect((await call()).status).toBe(403);}patch={};
  expect((await host.fetch(req())).status).toBe(403);
  expect((await host.request(req(),{credential:'bearer',userId:owner.userId!,tokenId:owner.id})).status).toBe(403);
  expect((await host.request(req(),{credential:'workload',workload:{...principal,issuerId:'other'}})).status).toBe(403);
  for(const invalid of [{...operation,after:'a/b'},{...operation,credential:'short'},{...operation,extra:true}])expect((await call(invalid)).status).toBe(400);
  for(const sql of ["UPDATE artifacts SET title='Changed' WHERE id='output_000'","UPDATE artifacts SET group_id=NULL WHERE id='output_001'","UPDATE artifacts SET deleted_at=now() WHERE id='output_002'"]){change=()=>db.query(sql);expect((await call()).status).toBe(403);change=null;}
  change=()=>db.query('UPDATE groups SET deleted_at=now() WHERE id=$1',[group.id]);expect((await call()).status).toBe(403);change=null;
  expect((await(await call()).json()).items).toEqual([]);
 }finally{vi.restoreAllMocks();}
});
