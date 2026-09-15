import {beforeEach,expect,it} from 'vitest';
import {createProxy} from '../src/parts';
import type {Actor} from '@artifactbin/contracts';
import {mintTestToken,resetTestDb,testDb,testProxyOptions} from './helpers';
beforeEach(resetTestDb);
it('resolves fresh identity for ordinary bearer requests and never accepts a mismatched account',async()=>{
 let identity={userId:'usr_admin',email:'admin@example.com',emailVerified:true};
 let seen:Actor|undefined;let calls=0;
 const token=await mintTestToken({id:'tok_admin',userId:identity.userId,query:testDb().query});
 const proxy=createProxy(await testProxyOptions({sessions:{resolve:async()=>null,identity:async()=>{calls++;return identity;}},upstream:async(_request,actor)=>{seen=actor;return Response.json({ok:true});}}));
 const headers={authorization:`Bearer ${token}`,'x-admin-email':'forged@example.com'};
 await proxy.request('/api/artifacts/abc123',{headers});expect(seen).toMatchObject(identity);expect(calls).toBe(1);
 identity={...identity,emailVerified:false};await proxy.request('/api/artifacts/abc123',{headers});expect(seen?.emailVerified).toBe(false);
 identity={...identity,userId:'usr_different',emailVerified:true};await proxy.request('/api/artifacts/abc123',{headers});expect(seen?.email).toBeUndefined();
});
it('preserves ordinary token access when the identity lookup is unavailable',async()=>{
 const token=await mintTestToken({id:'tok_reader',userId:'usr_reader',query:testDb().query});let seen:Actor|undefined;
 const proxy=createProxy(await testProxyOptions({sessions:{resolve:async()=>null,identity:async()=>{throw new Error('unavailable');}},upstream:async(_request,actor)=>{seen=actor;return Response.json({ok:true});}}));
 expect((await proxy.request('/api/artifacts/abc123',{headers:{authorization:`Bearer ${token}`}})).status).toBe(200);
 expect(seen).toEqual({credential:'bearer',tokenId:'tok_reader',userId:'usr_reader'});
});
