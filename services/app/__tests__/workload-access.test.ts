/** Host-resolved workloads read only their explicitly bound output graph. */
import {expect,it} from 'vitest';
import type {Actor,WorkloadActor,WorkloadAuthorization} from '@artifactbin/contracts';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {effectiveRole,reactionScope,editorScope,ownerScope,ownsArtifact} from '@/lib/artifact-access';
import {getArtifactById} from '@/lib/artifacts';
import {signActor,verifyActor} from '@artifactbin/utils';
import {services,getDb} from '@/lib/platform';
import {mintAccountToken,useAppHarness} from './harness';
import {nativeHtml} from './native-html-fixture';
useAppHarness();
const origin='http://127.0.0.1:7451';
async function fixture(){
 const owner=await mintAccountToken('mxmx_test_workload_owner');
 const group=await createGroup(owner.userId!,{handle:'workload_team',name:'Workload team'});
 const other=await createGroup(owner.userId!,{handle:'workload_other',name:'Other team'});
 const binding={issuerId:'local_fixture',subjectId:'scheduled_fixture',grantId:'grant_fixture',
  groupId:group.id,executionId:'execution_fixture',environmentId:'environment_fixture',
  intentHash:'intent_fixture',epoch:1};
 let live=true,fail=false,calls=0;
 let transform=(grant:WorkloadAuthorization):WorkloadAuthorization=>grant;const readArtifactIds:string[]=[];
 const options={workloadAuthority:{authorize:async(offered:unknown)=>{
  if(fail)throw new Error('Fixture authority unavailable');
  if(!live||JSON.stringify(offered)!==JSON.stringify(binding))return {allowed:false as const};
  calls++;return transform({allowed:true as const,principal:binding,role:'viewer' as const,
   readArtifactIds:[...readArtifactIds],writeArtifactIds:[],rootFolderId:null,
   visibility:'private' as const});
 }}};
 const host=await createAppHost(options);
 const human:Actor={credential:'bearer',userId:owner.userId!,tokenId:owner.id};
 const actor:WorkloadActor={credential:'workload',workload:binding} satisfies Actor;
 const request=(path:string,method='GET',body?:object)=>new Request(origin+path,{method,
  headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const create=async(title:string,groupId=group.id,visibility='private')=>{
  const r=await host.request(request('/api/artifacts','POST',{html:nativeHtml(`<p>${title}</p>`),
   visibility,destination:{type:'group',id:groupId}}),human);
  expect(r.status,await r.clone().text()).toBe(201);return (await r.json()).id as string;
 };
 const own=await create('Accepted output'),foreign=await create('Foreign group',other.id),
  unrelated=await create('Unrelated same group',''+group.id,'unlisted');
 readArtifactIds.push(own,foreign); // Exact ID never overrides the bound group.
 return {host,own,foreign,unrelated,binding,actor,request,group,readArtifactIds,
  archive:async()=>{
   const head=await (await host.request(request(`/api/artifacts/${own}`),human)).json();
   const saved=await host.request(request(`/api/artifacts/${own}`,'PUT',{html:nativeHtml('<p>Changed output</p>'),expectedVersion:head.version,expectedState:head.state}),human);
   expect(saved.status,await saved.clone().text()).toBe(200);
  },
  removeGroup:()=>services().identity.deleteGroup({actorId:owner.userId!,groupId:group.id,handle:group.handle}),
  transform:(fn:typeof transform)=>{transform=fn;},calls:()=>calls,
  call:(path:string,method='GET',body?:object)=>host.request(request(path,method,body),actor),
  revoke:()=>{live=false;},breakAuthority:()=>{fail=true;}};
}
it('reads a private output without borrowing a human token or granting ownership',async()=>{
 const f=await fixture(),db=await getDb();
 const before=(await db.query('SELECT id FROM tokens')).rows;
 const r=await f.call(`/api/artifacts/${f.own}`);
 expect(r.status,await r.clone().text()).toBe(200);
 expect(await r.json()).toMatchObject({id:f.own,capabilities:{edit:false,delete:false}});
 expect((await db.query('SELECT id FROM tokens')).rows).toEqual(before);
});
it('never widens to foreign groups, unrelated link-visible files or arbitrary mutations',async()=>{
 const f=await fixture();
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
 for(const id of [f.foreign,f.unrelated]){
  expect([403,404]).toContain((await f.call(`/api/artifacts/${id}`)).status);
  expect([403,404]).toContain((await f.call(`/a/${id}/raw`)).status);
 }
 for(const [path,method,body] of [
  [`/api/artifacts/${f.own}`,'DELETE',undefined],
  ['/api/artifacts','POST',{html:nativeHtml('<p>Not approved</p>')}],
  [`/api/groups/${f.group.id}/members`,'POST',{email:'outsider@example.test',role:'admin'}],
 ] as const)expect([401,403,404,405]).toContain((await f.call(path,method,body)).status);
});
it('denies after live revocation and on authority failure',async()=>{
 const f=await fixture();expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
 f.revoke();expect([401,403,404]).toContain((await f.call(`/api/artifacts/${f.own}`)).status);
 f.breakAuthority();expect([401,403,404,503]).toContain((await f.call(`/api/artifacts/${f.own}`)).status);
});
it('rejects a substituted binding and workload-shaped public headers',async()=>{
 const f=await fixture();expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
 const forged={...f.actor,workload:{...f.binding,executionId:'other_execution'}} satisfies Actor;
 expect([401,403,404]).toContain((await f.host.request(f.request(`/api/artifacts/${f.own}`),forged)).status);
 const req=f.request(`/api/artifacts/${f.own}`);
 req.headers.set('x-mx-actor',JSON.stringify(f.actor));req.headers.set('authorization','Bearer not_a_workload_token');
 expect([401,403,404]).toContain((await f.host.fetch(req)).status);
});

it('fails closed without an adapter and isolates host instances',async()=>{
 const f=await fixture(),other=await createAppHost();
 expect((await other.request(f.request(`/api/artifacts/${f.own}`),f.actor)).status).toBe(403);
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
});
it('denies malformed grants, substituted principals and stale epochs',async()=>{
 const f=await fixture();
 for(const transform of [
  (g:WorkloadAuthorization)=>({...g,role:'owner'}),
  (g:WorkloadAuthorization)=>({...g,readArtifactIds:'all'}),
  (g:WorkloadAuthorization)=>({...g,principal:{...f.binding,epoch:0}}),
  (g:WorkloadAuthorization)=>({...g,principal:{...f.binding,subjectId:'substituted'}}),
 ]){
  f.transform(g=>transform(g) as WorkloadAuthorization);
  expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(403);
 }
 const stale:Actor={credential:'workload',workload:{...f.binding,epoch:0}};
 expect((await f.host.request(f.request(`/api/artifacts/${f.own}`),stale)).status).toBe(403);
});
it('reads raw and version sources, with the same exact scope',async()=>{
 const f=await fixture();await f.archive();
 for(const path of [`/a/${f.own}/raw`,`/api/artifacts/${f.own}/versions`,`/api/artifacts/${f.own}/versions/1`]){
  const r=await f.call(path);expect(r.status,path+await r.clone().text()).toBe(200);
 }
 for(const id of [f.foreign,f.unrelated])for(const suffix of ['/versions','/versions/1'])
  expect([403,404]).toContain((await f.call(`/api/artifacts/${id}${suffix}`)).status);
 for(const [path,method] of [[`/api/artifacts/${f.own}/annotations`,'POST'],['/api/artifacts','GET'],['/api/tokens','POST'],['/api/browser/sessions','POST']] as const)
  expect((await f.call(path,method)).status).toBe(403);
});
it('rechecks before delivery and refuses a deleted identity group',async()=>{
 const f=await fixture();
 f.transform(g=>f.calls()>=2?{allowed:false}:g);
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(403);
 f.transform(g=>g);
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
 await f.removeGroup();
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(403);
});
it('keeps SQL and JavaScript read scope identical and never confers writer or owner scope',async()=>{
 const f=await fixture(),db=await getDb();
 const actor={userId:null,tokenId:null,email:null,documentEditor:false,workload:{allowed:true as const,
  principal:f.binding,role:'editor' as const,readArtifactIds:f.readArtifactIds,writeArtifactIds:[f.own],rootFolderId:null,visibility:'private' as const}};
 for(const id of [f.own,f.foreign,f.unrelated]){
  const row=(await getArtifactById(id))!,scope=reactionScope(actor);
  const sql=(await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).rows.length>0;
  expect(sql).toBe(id===f.own);expect(await effectiveRole(row,actor)).toBe(sql?'viewer':'none');
  expect(ownsArtifact(row,actor)).toBe(false);
  for(const denied of [editorScope(actor),ownerScope(actor)])
   expect((await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${denied.where('$2')}`,[id,denied.val])).rows).toEqual([]);
 }
});
it('refuses even correctly signed workload transport claims',async()=>{
 const f=await fixture();
 const signed=signActor(f.actor,'fixture_signing_secret');
 expect(verifyActor(signed,'fixture_signing_secret')).toBeNull();
 const req=f.request(`/api/artifacts/${f.own}`);req.headers.set('x-mx-actor',signed);
 expect([401,403,404]).toContain((await f.host.fetch(req)).status);
});

it('denies a newly failed authority and a separately configured denying host',async()=>{
 const f=await fixture();
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(200);
 f.breakAuthority();
 expect((await f.call(`/api/artifacts/${f.own}`)).status).toBe(403);
 const separate=await createAppHost({workloadAuthority:{authorize:async()=>({allowed:false})}});
 expect((await separate.request(f.request(`/api/artifacts/${f.own}`),f.actor)).status).toBe(403);
});
