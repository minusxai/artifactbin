/**
 * THE IDENTITY MODULE OVER HTTP behaves as it does in process: the app's group and account functions run against
 * `services().identity` = utils `identityClient` → the auth host's `sessionAuthority` (`IDENTITY_CALL_PATH`) → the
 * identity store on this test's database. Refusals round-trip as the same IdentityError (code, status, retry-after),
 * the service secret is required, and an auth host without a transactional database answers 503, never a guess.
 */
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {IDENTITY_CALL_PATH,IdentityError,SERVICE_AUTH_HEADER,type TransactionalQueryable} from '@artifactbin/contracts';
import {identityClient} from '@artifactbin/utils';
import {createAuthHost} from '@artifactbin/auth';
import {useAppHarness} from '@/__tests__/harness';
import {createUser,mintToken,revokeToken,setUsername} from '@/lib/accounts';
import {getDb,setServices} from '@/lib/platform';
import {acceptGroupInvitations,createGroup,deleteGroup,getGroupRole,inviteGroupMember,removeGroupMember,setGroupParent} from '..';

useAppHarness();
const secret='identity-transport-secret';
const appDb:TransactionalQueryable={query:async(sql,params)=>(await getDb()).query(sql,params),transaction:async fn=>(await getDb()).transaction(fn)};
const host=(identityDb?:TransactionalQueryable|{query:TransactionalQueryable['query']})=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret},cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},upstream:async()=>new Response('app'),appSchema:'public',...(identityDb?{identityDb}:{})});
let calls=0;
beforeEach(()=>{const app=host(appDb);calls=0;setServices({identity:identityClient('http://auth.invalid',{serviceSecret:secret,fetch:async request=>{calls++;return app.fetch(request);}})});});
afterEach(()=>setServices({identity:undefined}));
const account=(name:string)=>createUser({email:`mxmx_test_${name}@example.com`});

describe('the identity module over HTTP',()=>{
 it('runs the group lifecycle through the auth host, with refusals intact', async()=>{
  const owner=await account('http_owner'),member=await account('http_member');
  expect(calls).toBe(2);
  const finance=await createGroup(owner.id,{handle:'http_finance',name:'Finance'});
  const retail=await createGroup(owner.id,{handle:'http_retail',name:'Retail',parent_id:finance.id});
  expect(retail).toMatchObject({handle:'http_retail',role:'editor',parent_id:finance.id});
  await expect(createGroup(owner.id,{handle:'http_finance',name:'Again'})).rejects.toMatchObject({code:'handle_taken',status:409});
  await expect(createGroup(owner.id,{handle:'http_finance',name:'Again'})).rejects.toBeInstanceOf(IdentityError);
  await inviteGroupMember(owner.id,retail.id,member.email,'viewer');
  expect(await acceptGroupInvitations(member.id,member.email)).toEqual([retail.id]);
  expect(await getGroupRole(member.id,retail.id)).toBe('viewer');
  await expect(deleteGroup(owner.id,finance.id,finance.handle)).rejects.toMatchObject({code:'group_has_children',status:409});
  expect(await setGroupParent(owner.id,retail.id,null,finance.id)).toMatchObject({changed:true,parent_id:null});
  await removeGroupMember(owner.id,retail.id,member.id);
  expect(await getGroupRole(member.id,retail.id)).toBeNull();
  // The app's half ran after each call: its audit rows carry the identity change ids.
  expect(Number((await (await getDb()).query<{n:string}>("SELECT count(*) AS n FROM group_audit WHERE group_id=$1",[retail.id])).rows[0]!.n)).toBeGreaterThan(3);
 });

 it('accounts and tokens too: handles answer taken, a minted token is revoked once', async()=>{
  const a=await account('http_a'),b=await account('http_b');
  expect(await setUsername(a.id,'http_held')).toEqual({ok:true,username:'http_held'});
  expect(await setUsername(b.id,'http_held')).toEqual({error:'taken'});
  const minted=await mintToken('http-token',a.id);
  expect(minted.token).toMatch(/^mx_/);
  expect(await revokeToken(minted.id)).toBe(true);
  expect(await revokeToken(minted.id)).toBe(false);
 });

 it('requires the service secret, a known method and a transactional database', async()=>{
  const call=(app:ReturnType<typeof host>,body:unknown,key=secret)=>app.request(IDENTITY_CALL_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:key,'content-type':'application/json'},body:JSON.stringify(body)});
  const app=host(appDb);
  expect((await call(app,{method:'createUser',input:{email:'x@example.com'}},'wrong')).status).toBe(401);
  expect((await call(app,{method:'dropEverything',input:{}})).status).toBe(400);
  expect((await call(host({query:appDb.query}),{method:'createUser',input:{email:'x@example.com'}})).status).toBe(503);
  const down=identityClient('http://auth.invalid',{serviceSecret:secret,fetch:async()=>new Response('',{status:503})});
  await expect(down.createUser({email:'y@example.com'})).rejects.toThrow('identity_unavailable');
  expect(()=>identityClient('http://auth.invalid',{serviceSecret:''})).toThrow();
 });
});
