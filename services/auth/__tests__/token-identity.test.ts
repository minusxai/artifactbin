import {beforeEach,expect,it} from 'vitest';
import {createAuthHost} from '../src/parts';
import {createBearerReader} from '../src/identity/bearer';
import type {Actor} from '@artifactbin/contracts';
import {mintTestToken,resetTestDb,testDb,testAuthOptions} from './helpers';
beforeEach(async()=>{await resetTestDb();await testDb().query('DELETE FROM auth."user"');});
it('resolves fresh identity for ordinary bearer requests and never accepts a mismatched account',async()=>{
 await testDb().query(`INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES('usr_admin','Admin','admin@example.com',true)`);
 let seen:Actor|undefined;
 const token=await mintTestToken({id:'tok_admin',userId:'usr_admin',query:testDb().query});
 const proxy=createAuthHost(await testAuthOptions({sessions:{resolve:async()=>null,identity:async()=>{throw new Error('bearer identity is read in the token statement');}},upstream:async(_request,actor)=>{seen=actor;return Response.json({ok:true});}}));
 const headers={authorization:`Bearer ${token}`,'x-admin-email':'forged@example.com'};
 await proxy.request('/api/artifacts/abc123',{headers});expect(seen).toMatchObject({userId:'usr_admin',email:'admin@example.com',emailVerified:true});
 await testDb().query(`UPDATE auth."user" SET "emailVerified"=false WHERE id='usr_admin'`);
 await proxy.request('/api/artifacts/abc123',{headers});expect(seen?.emailVerified).toBe(false);
 await testDb().query(`UPDATE auth."user" SET id='usr_different',"emailVerified"=true WHERE id='usr_admin'`);
 await proxy.request('/api/artifacts/abc123',{headers});expect(seen).toEqual({credential:'bearer',tokenId:'tok_admin',userId:'usr_admin'});
});
it('answers 503, never anonymous, when the bearer read is unavailable',async()=>{
 const token=await mintTestToken({id:'tok_reader',userId:'usr_reader',query:testDb().query});let calls=0;
 const proxy=createAuthHost(await testAuthOptions({tokens:createBearerReader({db:{query:async()=>{throw new Error('unavailable');}}}),upstream:async()=>{calls++;return Response.json({ok:true});}}));
 const response=await proxy.request('/api/artifacts/abc123',{headers:{authorization:`Bearer ${token}`}});
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'session_unavailable'});expect(calls).toBe(0);
});
