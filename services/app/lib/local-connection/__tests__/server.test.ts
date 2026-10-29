import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {mintAccountToken,request,useAppHarness} from '@/__tests__/harness';
import {identityForUser} from '@/lib/accounts';
import {readHtmlPage} from '@/lib/html-publication';
import {createArtifactFromBody} from '@/lib/publish';
import {grantLocalConnection,localConnectionGraphql,localConnectionStatus,observeLocalSource,revokeLocalConnection} from '..';
const harness=useAppHarness();
const ORIGIN='http://localhost:3000';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
async function page(visibility='public'){
 const owner=await mintAccountToken('local-connection-module');
 const actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id};
 const created=await createArtifactFromBody({html:'<html><head></head><body><p>Hello</p></body></html>',visibility},actor,ORIGIN);
 expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
 const current=await readHtmlPage(actor,id);
 return {id,identity:{platformOrigin:ORIGIN,artifactId:id,baseRevision:current.revision,sourceDigest:sha(current.html)}};
}
const post=(path:string,json:unknown,headers:Record<string,string>={})=>request(path,{method:'POST',json,headers});
const grant=async(identity:unknown,extra:Record<string,unknown>={})=>grantLocalConnection(post('/api/local-connection',{identity,...extra}));
const capabilityOf=async(identity:unknown)=>((await (await grant(identity)).json()) as {capability:string}).capability;
const graphql=(id:string,capability:string,body:Record<string,unknown>,headers:Record<string,string>={})=>localConnectionGraphql(post(`/api/local-connection/${id}/graphql`,body,{'X-Af-Local-Capability':capability,...headers}),id);

it('grants an anonymous read-only capability for the exact current source, never cross-site or upgraded',async()=>{
 const {identity}=await page();
 const granted=await grant(identity);
 expect(granted.status).toBe(200);expect(granted.headers.get('cache-control')).toBe('no-store');
 const body=await granted.json();
 expect(body).toEqual({readOnly:true,capability:expect.any(String),expires:expect.any(Number),role:'viewer',authenticated:false});
 expect((await grantLocalConnection(post('/api/local-connection',{identity},{origin:'https://evil.example'}))).status).toBe(403);
 expect((await grantLocalConnection(post('/api/local-connection',{identity},{'sec-fetch-site':'cross-site'}))).status).toBe(403);
 for(const [bad,status,error] of [[{},400,'invalid_identity'],[{...identity,sourceDigest:'0'.repeat(64)},409,'stale'],[{...identity,baseRevision:'99'},409,'stale'],[{...identity,platformOrigin:'https://other.example'},400,'invalid_identity'],[{...identity,artifactId:'Missing123'},404,'unavailable']] as const){
  const refused=await grant(bad);expect(refused.status).toBe(status);expect(await refused.json()).toEqual({error});
 }
 for(const extra of [{authorizePrivate:true},{checkSession:true}]){const refused=await grant(identity,extra);expect(refused.status).toBe(403);expect(await refused.json()).toEqual({error:'local_read_only'});}
});
it('refuses a private page as unavailable without saying whether it exists',async()=>{
 const {identity}=await page('private');
 const refused=await grant(identity);expect(refused.status).toBe(404);expect(await refused.json()).toEqual({error:'unavailable'});
});
it('runs queries at the granted revision, rejects every mutation before dispatch, and stops at revocation',async()=>{
 const {id,identity}=await page(),capability=await capabilityOf(identity);
 const read=await graphql(id,capability,{revision:identity.baseRevision,query:'{ __typename }'});
 expect(read.status).toBe(200);
 expect((await graphql(id,capability,{revision:'99',query:'{ __typename }'})).status).toBe(409);
 const invalid=await graphql(id,capability,{revision:identity.baseRevision,query:'not graphql'});expect(invalid.status).toBe(400);expect(await invalid.json()).toEqual({error:'invalid_operation'});
 expect((await graphql(id,capability,{revision:identity.baseRevision})).status).toBe(400);
 const write=await graphql(id,capability,{revision:identity.baseRevision,query:'mutation { tasks { add } }'});
 expect(write.status).toBe(200);expect(await write.json()).toMatchObject({data:null,errors:[{path:['tasks','add'],message:expect.stringContaining('read-only')}],extensions:{outcomes:{'tasks.add':'rejected'}}});
 expect((await graphql(id,capability,{revision:identity.baseRevision,query:'{ __typename }'},{origin:'https://evil.example'})).status).toBe(403);
 expect((await graphql('Other123',capability,{revision:identity.baseRevision,query:'{ __typename }'})).status).toBe(410);
 const stop=request('/api/local-connection',{method:'DELETE',headers:{'X-Af-Local-Capability':capability}});
 const stopped=await revokeLocalConnection(stop);expect(stopped.status).toBe(200);expect(await stopped.json()).toEqual({disconnected:true});
 expect((await graphql(id,capability,{revision:identity.baseRevision,query:'{ __typename }'})).status).toBe(410);
 expect((await revokeLocalConnection(request('/api/local-connection',{method:'DELETE',origin:'https://evil.example'}))).status).toBe(403);
 expect((await graphql(id,'',{revision:identity.baseRevision,query:'{ __typename }'})).status).toBe(410);
});
it('observes the current head of a readable page without granting anything',async()=>{
 const {id,identity}=await page();
 const observe=(body:Record<string,unknown>,headers:Record<string,string>={})=>observeLocalSource(post('/api/local-connection/observe-source',body,headers));
 const stale={...identity,baseRevision:'7',sourceDigest:'0'.repeat(64)};
 const seen=await observe({identity:stale});expect(seen.status).toBe(200);
 expect(await seen.json()).toEqual({remoteDigest:identity.sourceDigest,remoteRevision:identity.baseRevision});
 expect((await observe({identity:{...stale,platformOrigin:'https://other.example'}})).status).toBe(400);
 expect((await observe({identity:{}})).status).toBe(400);
 expect((await observe({identity:stale,checkSession:true})).status).toBe(403);
 expect((await observe({identity:stale},{origin:'https://evil.example'})).status).toBe(403);
 await (await harness.db()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
 const hidden=await observe({identity:stale});expect(hidden.status).toBe(404);expect(await hidden.json()).toEqual({error:'unavailable'});
});
it('reports an idle grant compatible until the head moves, then revokes it',async()=>{
 const {id,identity}=await page(),capability=await capabilityOf(identity);
 const status=(cap=capability,artifact=id,headers:Record<string,string>={})=>localConnectionStatus(request(`/api/local-connection/${artifact}/status`,{headers:{'X-Af-Local-Capability':cap,...headers}}),artifact);
 const live=await status();expect(live.status).toBe(200);
 expect(await live.json()).toEqual({compatible:true,role:'viewer',remoteDigest:identity.sourceDigest,remoteRevision:identity.baseRevision});
 expect((await status(capability,id,{origin:'https://evil.example'})).status).toBe(403);
 expect((await status('unknown')).status).toBe(410);
 await (await harness.db()).query('UPDATE artifacts SET version=version+1 WHERE id=$1',[id]);
 const moved=await status();expect(moved.status).toBe(200);expect(await moved.json()).toMatchObject({compatible:false,remoteRevision:String(Number(identity.baseRevision)+1)});
 expect((await status()).status).toBe(410);
});
