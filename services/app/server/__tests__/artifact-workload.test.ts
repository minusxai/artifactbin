/** Workloads create only new private static pages under the callback's current group folder. */
import {it,expect,vi} from 'vitest';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {APP_ARTIFACT_WORKLOAD_PATH} from '@artifactbin/contracts';
import {mintAccountToken,useAppHarness} from '../../__tests__/harness';
import {nativeHtml} from '../../__tests__/native-html-fixture';
useAppHarness();
it('creates group-owned private HTML atomically, replays, conflicts and never recreates deleted results',async()=>{
 const owner=await mintAccountToken('mxmx_test_network_workload'),group=await createGroup(owner.userId!,{handle:'network_workload',name:'Workload group'});
 const host=await createAppHost(),human={credential:'bearer' as const,userId:owner.userId!,tokenId:owner.id};
 const req=(path:string,body:unknown)=>new Request('http://127.0.0.1'+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
 const folderReply=await host.request(req('/api/artifacts',{format:'folder',title:'Outputs',destination:{type:'group',id:group.id}}),human);
 const folder=(await folderReply.json()).id;
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:group.id,executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 let allowed=true,calls=0,denyFinal=false,key='stable-slot-action',root=folder;const reads:string[]=[];
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  expect(String(input)).toBe('http://127.0.0.1/authorize');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer callback-secret-test');
  const envelope=JSON.parse(String(init?.body));calls++;
  return Response.json({digest:envelope.digest,nonce:envelope.nonce,scope:allowed&&!(denyFinal&&envelope.phase==='final')?{allowed:true,principal,role:'editor',readArtifactIds:reads,rootFolderId:root,visibility:'private',creationKey:key}:{allowed:false}});
 });
 const config=await import('@/lib/platform');vi.spyOn(config,'serviceAudiences').mockReturnValue([{id:'worker',origin:'https://worker.example',introspectionSecretSha256:'0'.repeat(64),artifactWorkloads:{authorizationUrl:'http://127.0.0.1/authorize',authorizationSecret:'callback-secret-test'}}]);
 const operation={kind:'artifact-create',title:'Scheduled report',html:nativeHtml('<p>Static result</p>')};
 const create=(op=operation)=>host.request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation:op}),{credential:'workload',workload:principal});
 try{
  const created=await create();expect(created.status,await created.clone().text()).toBe(201);const {id}=await created.json();
  const db=await getDb(),row=(await db.query('SELECT * FROM artifacts WHERE id=$1',[id])).rows[0];
  expect(row).toMatchObject({group_id:group.id,user_id:null,token_id:null,visibility:'private',ancestor_ids:[folder]});expect(calls).toBe(2);
  reads.push(id);
  const read=()=>host.request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation:{kind:'artifact-read',artifactId:id,source:'canonical'}}),{credential:'workload',workload:principal});
  expect(await(await read()).json()).toMatchObject({id,html:expect.stringContaining('Static result')});
  await db.query("UPDATE artifacts SET visibility='unlisted' WHERE id=$1",[id]);expect((await read()).status).toBe(200);
  denyFinal=true;expect((await read()).status).toBe(403);expect((await create()).status).toBe(403);denyFinal=false;
  expect((await create({...operation,html:nativeHtml('<link rel="af-dataset" data-af-name="data" href="default:db">')})).status).toBe(400);
  expect((await create({...operation,html:nativeHtml('<img src="ref:abcdef">')})).status).toBe(400);
  key='concurrent-slot';const concurrent=await Promise.all([create(),create()]);const results=await Promise.all(concurrent.map(result=>result.json()));expect(results[0].id).toBe(results[1].id);expect(results[0].id).not.toBe(id);key='stable-slot-action';
  root='missing-folder';expect((await create()).status).toBe(403);root=folder;
  const foreign=await createGroup(owner.userId!,{handle:'foreign_workload',name:'Other group'});
  const foreignFolder=await host.request(req('/api/artifacts',{format:'folder',title:'Other',destination:{type:'group',id:foreign.id}}),human);
  root=(await foreignFolder.json()).id;expect((await create()).status).toBe(403);root=folder;
  reads.push(root);const folderRead=await host.request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation:{kind:'artifact-read',artifactId:root,source:'canonical'}}),{credential:'workload',workload:principal});expect(folderRead.status).toBe(404);
  for(const html of ['<script>fetch("https://remote.example/data")</script>','<img src="https://remote.example/a.png">','<iframe src="https://remote.example"></iframe>','<style>@import "https://remote.example/style";</style>','<div style="background:url(https://remote.example/a)">x</div>',`<p onclick="fetch('https://remote.example')">x</p>`,'<meta http-equiv="refresh" content="0;url=https://remote.example">'])expect((await create({...operation,html:nativeHtml(html)})).status).toBe(400);
  const cancelled=req(APP_ARTIFACT_WORKLOAD_PATH,{operation});const controller=new AbortController();controller.abort();
  expect((await host.request(new Request(cancelled,{signal:controller.signal}),{credential:'workload',workload:principal})).status).toBe(403);
  expect((await(await create()).json()).id).toBe(id);
  expect((await create({...operation,title:'Different'})).status).toBe(409);
  await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[id]);expect((await create()).status).toBe(410);
  allowed=false;expect((await create()).status).toBe(403);
 }finally{fetch.mockRestore();vi.restoreAllMocks();}
});
