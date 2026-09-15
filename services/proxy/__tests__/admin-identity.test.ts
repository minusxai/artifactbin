import {beforeEach,expect,it} from 'vitest';
import {assemble} from '@artifactbin/utils';
import type {Actor} from '@artifactbin/contracts';
import {proxyParts} from '../src/parts';
import {mintTestToken,resetTestDb,testDb,testProxyOptions} from './helpers';
beforeEach(resetTestDb);
it('looks up current verified identity only for explicit admin bearer calls, without trusting supplied claims',async()=>{
 let identity={userId:'usr_admin',email:'admin@example.com',emailVerified:true};let calls=0;let seen:Actor|undefined;
 const token=await mintTestToken({id:'tok_admin',userId:'usr_admin',query:testDb().query});
 const app=assemble(proxyParts(await testProxyOptions({sessions:{resolve:async()=>null,identity:async()=>{calls++;return identity;}},upstream:async(_r,actor)=>{seen=actor;return Response.json({ok:true});}})));
 const headers={authorization:`Bearer ${token}`,'X-Artifactbin-Admin':'1','x-admin-email':'forged@example.com'};
 await app.request('/api/artifacts',{headers});expect(calls).toBe(0);expect(seen?.email).toBeUndefined();
 await app.request('/api/admin/documents',{headers});expect(seen).toMatchObject(identity);expect(calls).toBe(1);
 identity={...identity,email:'changed@example.com',emailVerified:false};
 await app.request('/api/admin/documents',{headers});expect(seen).toMatchObject(identity);expect(calls).toBe(2);
 identity={...identity,userId:'someone_else',emailVerified:true};
 await app.request('/api/admin/documents',{headers});expect(seen?.email).toBeUndefined();
});
