import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as grant,DELETE as revoke} from '@/app/api/local-connection/route';
import {POST as execute} from '@/app/api/local-connection/[id]/graphql/route';
import {readHtmlPage} from '@/lib/html-publication';
import {request,useAppHarness,mintAccountToken} from './harness';
const harness=useAppHarness();
it('keeps local grants anonymous read-only and refuses account upgrades',async()=>{
 const owner=await mintAccountToken('local-connection');
 const created=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head></head><body>Hello</body></html>',visibility:'public'}}));expect(created.status).toBe(201);
 const {id}=await created.json();const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);
 const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};
 const makeGrant=(extra:Record<string,unknown>={})=>grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity,...extra}}));
 const guestResponse=await makeGrant();expect(guestResponse.status).toBe(200);const guest=await guestResponse.json();expect(guest.role).toBe('viewer');expect(guest.authenticated).toBe(false);expect(guest).not.toHaveProperty('actor');
 const operation=(capability:string,pageId=id)=>{const req=request(`/api/local-connection/${pageId}/graphql`,{method:'POST',token:owner.token,json:{revision:'1',query:'{ __typename }'}});req.headers.set('X-Af-Local-Capability',capability);return execute(req,{params:Promise.resolve({id:pageId})});};
 expect((await operation(guest.capability,'different')).status).toBe(410);
 expect((await makeGrant({checkSession:true})).status).toBe(403);
 expect((await makeGrant({authorizePrivate:true})).status).toBe(403);
 expect(guest.readOnly).toBe(true);
 expect((await operation(guest.capability)).status).toBe(200);
 const stop=request('/api/local-connection',{method:'DELETE'});stop.headers.set('X-Af-Local-Capability',guest.capability);expect((await revoke(stop)).status).toBe(200);expect((await operation(guest.capability)).status).toBe(410);
 const fresh=await (await makeGrant()).json();
 await (await harness.db()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[id,'private']);
 expect((await operation(fresh.capability)).status).toBe(404);
});
it('rejects cross-origin grants and mismatched or stale source identity',async()=>{
 const bad=request('/api/local-connection',{method:'POST',json:{identity:{}}});bad.headers.set('origin','https://untrusted.example');expect((await grant(bad)).status).toBe(403);
 const owner=await mintAccountToken('local-stale');const created=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><head></head><body>Current</body></html>'}}));const {id}=await created.json();
 const stale=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity:{platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:'1',sourceDigest:'0'.repeat(64)}}}));expect(stale.status).toBe(409);
});
it('never lets an ambient bearer elevate guest reads of a linked private dataset',async()=>{
 const owner=await mintAccountToken('local-private-data');
 const dataset=await (await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{secret:'private value'}],visibility:'private'}}))).json();
 const made=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${dataset.id}"></head><body>Public</body></html>`}}));expect(made.status).toBe(201);const {id}=await made.json();
 const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);
 const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};
 const open=async(authorizePrivate:boolean)=>{const response=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity,authorizePrivate}}));expect(response.status).toBe(200);return (await response.json()).capability;};
 const run=async(cap:string)=>{const req=request(`/api/local-connection/${id}/graphql`,{method:'POST',token:owner.token,json:{revision:page.revision,query:'{ data { schema { tables { id } } } }'}});req.headers.set('X-Af-Local-Capability',cap);const response=await execute(req,{params:Promise.resolve({id})});return response.json();};
 const guest=await run(await open(false));expect(guest.errors).toHaveLength(1);expect(JSON.stringify(guest)).not.toContain(dataset.id);
 const denied=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity,authorizePrivate:true}}));expect(denied.status).toBe(403);
});
it('observes stale source metadata without granting operations or leaking private heads',async()=>{
 const {POST:observe}=await import('@/app/api/local-connection/observe-source/route');
 const owner=await mintAccountToken('local-observation');
 const made=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><body>Remote head</body></html>'}}));expect(made.status).toBe(201);const {id}=await made.json();
 const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);
 const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:'99',sourceDigest:'0'.repeat(64)};
 const read=(extra:Record<string,unknown>={})=>observe(request('/api/local-connection/observe-source',{method:'POST',token:owner.token,json:{identity,...extra}}));
 const response=await read();expect(response.status).toBe(200);expect(await response.json()).toEqual({remoteDigest:createHash('sha256').update(page.html).digest('hex'),remoteRevision:page.revision});
 const validIdentity={...identity,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};
 const live=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity:validIdentity}}));const cap=(await live.json()).capability;
 await(await harness.db()).query('UPDATE artifacts SET version=version+1 WHERE id=$1',[id]);
 const observedNew=await read();expect((await observedNew.json()).remoteRevision).toBe('2');
 const mutation=request(`/api/local-connection/${id}/graphql`,{method:'POST',token:owner.token,json:{revision:page.revision,query:'mutation { tasks { add } }'}});mutation.headers.set('X-Af-Local-Capability',cap);
 expect((await execute(mutation,{params:Promise.resolve({id})})).status).toBe(409);
 const admission=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity}}));expect(admission.status).toBe(409);
 await(await harness.db()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
 const denied=await read();expect(denied.status).toBe(404);expect(await denied.json()).not.toHaveProperty('remoteDigest');
 expect((await read({checkSession:true})).status).toBe(403);
 const allowed=await read({authorizePrivate:true});expect(allowed.status).toBe(403);
 const stranger=await mintAccountToken('local-observation-stranger');
 const revoked=await observe(request('/api/local-connection/observe-source',{method:'POST',token:stranger.token,json:{identity,authorizePrivate:true}}));expect(revoked.status).toBe(403);expect(await revoked.json()).not.toHaveProperty('remoteRevision');
});
it('validates idle grants against current source and original account without exposing metadata after account switch',async()=>{
 const {GET:status}=await import('@/app/api/local-connection/[id]/status/route');
 const owner=await mintAccountToken('idle-owner'),stranger=await mintAccountToken('idle-stranger');const made=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><body>Idle</body></html>'}}));const {id}=await made.json();
 const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};
 const open=async(account:boolean)=>{const res=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity,authorizePrivate:account}}));expect(res.status).toBe(200);return (await res.json()).capability;};
 const inspect=(cap:string,token=owner.token)=>{const req=request(`/api/local-connection/${id}/status`,{token});req.headers.set('X-Af-Local-Capability',cap);return status(req,{params:Promise.resolve({id})});};
 const guest=await open(false);const switched=await inspect(guest,stranger.token);expect(switched.status).toBe(200);
 await(await harness.db()).query('UPDATE artifacts SET version=version+1 WHERE id=$1',[id]);
 const changed=await inspect(guest);expect(changed.status).toBe(200);expect(await changed.json()).toMatchObject({compatible:false,remoteRevision:'2'});expect((await inspect(guest)).status).toBe(410);
});

it('rejects every selected mutation before backend dispatch, including named operations and fragments',async()=>{
 const owner=await mintAccountToken('local-read-only');const made=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><body>Read only</body></html>'}}));const {id}=await made.json();const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};const cap=(await(await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity}}))).json()).capability;
 for(const payload of [{query:'mutation { missing { write } }'},{query:'query Read { __typename } mutation Write($n:Int!) { alias:missing { write(n:$n) } }',operationName:'Write',variables:{n:2}},{query:'mutation Write { ...Fields } fragment Fields on Mutation { missing { write } }',operationName:'Write'}]){const req=request(`/api/local-connection/${id}/graphql`,{method:'POST',token:owner.token,json:{revision:page.revision,...payload}});req.headers.set('X-Af-Local-Capability',cap);const response=await execute(req,{params:Promise.resolve({id})});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:null,errors:[{message:expect.stringContaining('read-only')}]});}
 for(const query of ['not graphql','query A { __typename } mutation B { missing { write } }']){const req=request(`/api/local-connection/${id}/graphql`,{method:'POST',token:owner.token,json:{revision:page.revision,query}});req.headers.set('X-Af-Local-Capability',cap);expect((await execute(req,{params:Promise.resolve({id})})).status).toBe(400);}
});
it('never accepts the local capability as authentication at comment or source write doors',async()=>{
 const owner=await mintAccountToken('local-other-doors');const made=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><body>Original</body></html>'}}));const {id}=await made.json();const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};const cap=(await(await grant(request('/api/local-connection',{method:'POST',json:{identity}}))).json()).capability;
 const {POST:comment}=await import('@/app/api/my/artifacts/[id]/annotations/route');const {PUT:replace}=await import('@/app/api/artifacts/[id]/route');
 for(const [path,method,handler] of [[`/api/my/artifacts/${id}/annotations`,'POST',comment],[`/api/artifacts/${id}`,'PUT',replace]] as const){const req=request(path,{method,json:{body:'No write',html:'<html><body>Changed</body></html>'}});req.headers.set('X-Af-Local-Capability',cap);const response=await handler(req,{params:Promise.resolve({id})});expect([401,403]).toContain(response.status);}
 expect((await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id)).html).toBe(page.html);
});
