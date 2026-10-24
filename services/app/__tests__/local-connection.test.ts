import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as grant,DELETE as revoke} from '@/app/api/local-connection/route';
import {POST as execute} from '@/app/api/local-connection/[id]/graphql/route';
import {readHtmlPage} from '@/lib/html-publication';
import {request,useAppHarness,mintAccountToken} from './harness';
const harness=useAppHarness();
it('keeps automatic connection anonymous, scopes grants and requires explicit account authority',async()=>{
 const owner=await mintAccountToken('local-connection');
 const created=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head></head><body>Hello</body></html>',visibility:'public'}}));expect(created.status).toBe(201);
 const {id}=await created.json();const page=await readHtmlPage({userId:owner.userId,tokenId:null,email:owner.email,documentEditor:false},id);
 const identity={platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')};
 const makeGrant=(extra:Record<string,unknown>={})=>grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{identity,...extra}}));
 const guestResponse=await makeGrant();expect(guestResponse.status).toBe(200);const guest=await guestResponse.json();expect(guest.role).toBe('viewer');expect(guest).not.toHaveProperty('actor');
 const operation=(capability:string,pageId=id)=>{const req=request(`/api/local-connection/${pageId}/graphql`,{method:'POST',token:owner.token,json:{revision:'1',query:'{ __typename }'}});req.headers.set('X-Af-Local-Capability',capability);return execute(req,{params:Promise.resolve({id:pageId})});};
 expect((await operation(guest.capability,'different')).status).toBe(410);
 expect((await makeGrant({checkSession:true})).status).toBe(403);
 const approved=await makeGrant({authorizePrivate:true});expect(approved.status).toBe(200);const account=await approved.json();expect(account.role).toBe('owner');
 expect((await operation(account.capability)).status).toBe(200);
 const stop=request('/api/local-connection',{method:'DELETE'});stop.headers.set('X-Af-Local-Capability',account.capability);expect((await revoke(stop)).status).toBe(200);expect((await operation(account.capability)).status).toBe(410);
 await (await harness.db()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[id,'private']);
 expect((await operation(guest.capability)).status).toBe(401);
});
it('rejects cross-origin grants and mismatched or stale source identity',async()=>{
 const bad=request('/api/local-connection',{method:'POST',json:{identity:{}}});bad.headers.set('origin','https://untrusted.example');expect((await grant(bad)).status).toBe(403);
 const owner=await mintAccountToken('local-stale');const created=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head></head><body>Current</body></html>'}}));const {id}=await created.json();
 const stale=await grant(request('/api/local-connection',{method:'POST',token:owner.token,json:{authorizePrivate:true,identity:{platformOrigin:'http://localhost:3000',artifactId:id,baseRevision:'1',sourceDigest:'0'.repeat(64)}}}));expect(stale.status).toBe(409);
});
