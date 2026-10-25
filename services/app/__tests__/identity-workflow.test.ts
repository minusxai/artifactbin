/** Durable HTTP identity allocation, replay and account namespace isolation. Retired CLI workspace cases are removed. */
import {it,expect,vi} from 'vitest';
import {useAppHarness,request,createGuestOwner,mintAccountToken as mintToken} from './harness';
import {nativeHtml} from './native-html-fixture';
import {identityForUser,mergeGuestUsers,createUser} from '@/lib/accounts';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {reserveIds} from '@/lib/artifacts';
import {POST as reserve} from '@/app/api/artifacts/reservations/route';
import * as identifiers from '@/lib/platform/ids';
import {getDb} from '@/lib/platform';
useAppHarness();
it('replays concurrent requests for one batch as the same complete canonical pool',async()=>{
 const token=await mintToken('synthetic_concurrent_reservations'),actor=identityForUser(token.userId,token.id);
 const [first,second]=await Promise.all([reserveIds(actor,'batch_concurrent_0001'),reserveIds(actor,'batch_concurrent_0001')]);
 expect(first).toHaveLength(100);expect(new Set(first).size).toBe(100);expect(second).toEqual(first);
 const rows=(await(await getDb()).query<{id:string;ordinal:number}>('SELECT id,ordinal FROM artifact_id_registry WHERE owner=$1 AND batch=$2 ORDER BY ordinal',[token.userId,'batch_concurrent_0001'])).rows;
 expect(rows.map(row=>row.ordinal)).toEqual(Array.from({length:100},(_,i)=>i));expect(rows.map(row=>row.id)).toEqual(first);
});
it('reserves an invisible batch and publishes the exact identity with durable replay',async()=>{
 const token=await mintToken('mxmx_test_reservations');const actor=identityForUser(token.userId, token.id);
 const ids=await reserveIds(actor,'batch_000000000001');expect(ids).toHaveLength(100);expect(new Set(ids).size).toBe(100);
 expect(await reserveIds(actor,'batch_000000000001')).toEqual(ids);
 const id=ids[0];const ctx={params:Promise.resolve({id})};expect((await read(request('/api/artifacts/'+id,{token:token.token}),ctx)).status).toBe(404);
 const req=()=>request('/api/artifacts',{method:'POST',token:token.token,headers:{'Idempotency-Key':'create_000000000001'},json:{reserved_id:id,html:nativeHtml('<p>Reserved document</p>')}});
 const first=await create(req());expect(first.status).toBe(201);const published=await first.json();expect(published.id).toBe(id);expect(published.version).toBe(1);
 const replay=await create(req());expect(replay.status).toBe(201);expect((await replay.json()).id).toBe(id);
 expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toHaveLength(1);
 await remove(request('/api/artifacts/'+id,{method:'DELETE',token:token.token}),ctx);
 expect((await create(req())).status).toBe(410);
 const fresh=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'Idempotency-Key':'create_000000000002'},json:{reserved_id:id,html:nativeHtml('<p>Resurrect</p>')}}));expect(fresh.status).toBe(409);
});

it('rejects foreign reservations and racing creates; invalid content does not consume an identity',async()=>{
 const token=await mintToken('mxmx_test_reservation_owner'),other=await mintToken('mxmx_test_reservation_other');
 const [id]=await reserveIds(identityForUser(token.userId, token.id),'batch_000000000002');
 const post=(credential:string,html:string,key:string)=>create(request('/api/artifacts',{method:'POST',token:credential,headers:{'Idempotency-Key':key},json:{reserved_id:id,html}}));
 expect((await post(other.token,nativeHtml('<p>Steal</p>'),'create_000000000003')).status).toBe(403);
 expect((await post(token.token,'','create_000000000004')).status).toBe(400);
 const results=await Promise.all([post(token.token,nativeHtml('<p>A</p>'),'create_000000000005'),post(token.token,nativeHtml('<p>B</p>'),'create_000000000006')]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
});

it('keeps dataset reference ids unchanged and refuses unuploaded data dependencies',async()=>{
 const token=await mintToken('mxmx_test_reserved_graph');const ids=await reserveIds(identityForUser(token.userId, token.id),'batch_000000000003');
 const html=`<!doctype html><html><head><link rel="af-dataset" data-af-name="sales_data" href="ref:${ids[0]}" data-af-mode="live"></head><body><p>Sales</p></body></html>`;
 const post=(body:Record<string,unknown>)=>create(request('/api/artifacts',{method:'POST',token:token.token,json:body}));
 expect((await post({reserved_id:ids[1],html})).status).not.toBe(201);
 const data=await post({reserved_id:ids[0],dataset:[{amount:42}]});expect(data.status).toBe(201);expect((await data.json()).id).toBe(ids[0]);
 const doc=await post({reserved_id:ids[1],html});expect(doc.status).toBe(201);expect((await doc.json()).html).toContain(`ref:${ids[0]}`);
});


it('authenticated reservations survive account token rotation and isolate independent email account namespaces',async()=>{
 const user=await createUser({email:'mxmx_test_ids@example.test'}),otherUser=await createUser({email:'mxmx_test_other_ids@example.test'});
 const first=await mintToken('first',user.id),rotated=await mintToken('rotated',user.id),other=await mintToken('other',otherUser.id),independent=await mintToken('independent'),otherIndependent=await mintToken('other-independent'),legacy=await mintToken('legacy',null);
 const call=(token?:string)=>reserve(request('/api/artifacts/reservations',{method:'POST',token,headers:{'Idempotency-Key':'batch_account_000001'}}));
 expect((await call()).status).toBe(401);expect((await call(legacy.token)).status).toBe(401);
 const independentResponse=await call(independent.token);expect(independentResponse.status).toBe(200);const independentBatch=await independentResponse.json();expect(independentBatch.ids).toHaveLength(100);expect(await(await call(independent.token)).json()).toEqual(independentBatch);
 const secondIndependent=await(await call(otherIndependent.token)).json();expect(secondIndependent.ids.some((id:string)=>independentBatch.ids.includes(id))).toBe(false);
 const response=await call(first.token);expect(response.status).toBe(200);const batch=await response.json();
 expect(batch.ids).toHaveLength(100);expect(await(await call(rotated.token)).json()).toEqual(batch);expect(independentBatch.ids.some((id:string)=>batch.ids.includes(id))).toBe(false);
 const foreign=await(await call(other.token)).json();expect(foreign.ids.some((id:string)=>batch.ids.includes(id))).toBe(false);
 const publish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:batch.ids[0],html:nativeHtml('<p>Same account</p>')}}));
 expect((await publish(other.token)).status).toBe(403);expect((await publish(independent.token)).status).toBe(403);expect((await publish(rotated.token)).status).toBe(201);
 const independentPublish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:independentBatch.ids[0],html:nativeHtml('<p>Independent account namespace</p>'),visibility:'unlisted'}}));
 expect((await independentPublish(otherIndependent.token)).status).toBe(403);expect((await independentPublish(independent.token)).status).toBe(201);
});

it('ordinary creates skip reserved identities and reservation allocation skips existing artifacts',async()=>{
 const token=await mintToken('mxmx_test_id_collision'),actor=identityForUser(token.userId, token.id);
 const ids=await reserveIds(actor,'batch_collision_0001');
 const spy=vi.spyOn(identifiers,'generateFileId');
 try{
  spy.mockReturnValueOnce(ids[0]!);
  const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p>Ordinary</p>')}}));
  expect(response.status).toBe(201);const ordinary=await response.json();expect(ids).not.toContain(ordinary.id);
  spy.mockReturnValueOnce(ordinary.id).mockReturnValueOnce(ids[1]!);
  const next=await reserveIds(actor,'batch_collision_0002');expect(next).toHaveLength(100);expect(next).not.toContain(ordinary.id);expect(next.some(id=>ids.includes(id))).toBe(false);
 }finally{spy.mockRestore();}
});


it('guest adoption preserves reservation replay and unused IDs despite an account batch with the same nonce',async()=>{
 const guest=await createGuestOwner({name:'mxmx_test_reserved_adoption'}),guestToken=await mintToken('guest-reserved',guest.userId);
 const account=await createUser({email:'mxmx_test_reserved_adopted@example.test'}),accountToken=await mintToken('account-reserved',account.id),other=await mintToken('foreign-reserved',(await createUser({email:'mxmx_test_reserved_foreign@example.test'})).id);
 const batch='batch_shared_adoption_001';
 const allocate=(token:string,pin?:string)=>reserve(request('/api/artifacts/reservations',{method:'POST',token,headers:{'Idempotency-Key':batch,...(pin?{'X-Artifactbin-Account':pin}:{})}}));
 const guestIds=await reserveIds(identityForUser(guest.userId, guestToken.id),batch),accountIds=(await(await allocate(accountToken.token)).json()).ids;
 expect(guestIds.some((id:string)=>accountIds.includes(id))).toBe(false);
 await mergeGuestUsers(account.id,[guest.tokenId]);
 expect((await(await allocate(accountToken.token,guest.userId)).json()).ids).toEqual(guestIds);
 expect((await(await allocate(accountToken.token)).json()).ids).toEqual(accountIds);
 const publish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:guestIds[0],html:nativeHtml('<p>After adoption</p>')}}));
 expect((await publish(other.token)).status).toBe(403);expect((await publish(accountToken.token)).status).toBe(201);expect((await publish(accountToken.token)).status).toBe(409);
 expect((await(await allocate(accountToken.token,guest.userId)).json()).ids).toEqual(guestIds);
});

