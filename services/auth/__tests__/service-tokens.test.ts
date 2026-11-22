/**
 * EXCHANGED SERVICE TOKENS (src/identity/service-tokens.ts): bound to one person, one configured audience and the
 * credential they were exchanged for, five minutes, and never a credential at this installation's own API (the bearer
 * read refuses the shape before touching the database). Introspection's answer for them is pinned in
 * session-authority.test.ts. A GROUP's service token is its own kind (`vgt_`, its own key, no person in it): every
 * verifier of a person's refuses it, and it verifies only for a service that opts in to group principals.
 */
import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {createBearerReader} from '../src/identity/bearer';
import {groupServiceTokenKey,isGroupServiceToken,isServiceToken,serviceTokenKey,signGroupServiceToken,signServiceToken,verifyGroupServiceToken,verifyServiceToken} from '../src/identity/service-tokens';
import { SERVICE_TOKEN_TTL_SECONDS } from '../src/identity/service-tokens';

import {admitGroupMember,useAppHarness} from '../../app/__tests__/harness';
import {composed,origin,page,useGroupPrincipalHost,world} from '../../app/__tests__/group-principal-fixture';

const WAREHOUSE={id:'warehouse',origin:'https://warehouse.example',introspectionSecretSha256:null};
const CRM={id:'crm',origin:'https://crm.example',introspectionSecretSha256:null};
const queries:string[]=[];
const db:TransactionalQueryable={query:async sql=>{queries.push(sql);throw Error('a service token touches no table');},transaction:async()=>{throw Error('no transaction');}};
const key=serviceTokenKey('host-secret'),parent={kind:'session' as const,id:'ses_1'};
const sign=(service=WAREHOUSE,now=Date.now())=>signServiceToken(key,service,{userId:'usr_bob',parent},now);

describe('service tokens',()=>{
 it('sign a token for that person, that audience and that parent credential, for five minutes',()=>{
  const before=Date.now();
  const issued=sign();
  expect(issued.audience).toBe(WAREHOUSE.origin);
  expect(Date.parse(issued.expiresAt)-before).toBeGreaterThan((SERVICE_TOKEN_TTL_SECONDS-2)*1000);
  expect(Date.parse(issued.expiresAt)-before).toBeLessThanOrEqual(SERVICE_TOKEN_TTL_SECONDS*1000);
  const claims=verifyServiceToken(key,[WAREHOUSE,CRM],issued.token)!;
  expect(claims).toEqual({sub:'usr_bob',aud:WAREHOUSE.origin,svc:'warehouse',iat:expect.any(Number),exp:expect.any(Number),jti:expect.stringMatching(/^vtk_/),par:parent});
  expect(claims.exp-claims.iat).toBe(SERVICE_TOKEN_TTL_SECONDS);
 });
 it('are bound to their audience: one verifies for no other configured service, and not once that service is gone',()=>{
  const {token}=sign(CRM);
  expect(verifyServiceToken(key,[WAREHOUSE,CRM],token)!.aud).toBe(CRM.origin);
  expect(verifyServiceToken(key,[WAREHOUSE],token)).toBeNull();
  // The same id moved to another origin is another audience.
  expect(verifyServiceToken(key,[{...CRM,origin:'https://crm2.example'}],token)).toBeNull();
 });
 it('expire: refused from the expiry on, and a token from the future is refused too',()=>{
  const now=Date.now(),{token}=sign(WAREHOUSE,now);
  expect(verifyServiceToken(key,[WAREHOUSE],token,now+290_000)).not.toBeNull();
  expect(verifyServiceToken(key,[WAREHOUSE],token,now+301_000)).toBeNull();
  expect(verifyServiceToken(key,[WAREHOUSE],token,now-60_000)).toBeNull();
 });
 it('need a parent credential of a known kind and a valid id, and refuse a token signed without one',()=>{
  for(const input of [{parent:undefined as never},{parent:{kind:'group' as never,id:'g_1'}},{parent:{kind:'token' as const,id:'not an id'}}])
   expect(()=>signServiceToken(key,WAREHOUSE,{userId:'usr_bob',...input}),JSON.stringify(input)).toThrow(/invalid_parent/);
  // A token whose claims carry no parent (the signature valid) is no service token.
  const body=Buffer.from(JSON.stringify({sub:'usr_bob',aud:WAREHOUSE.origin,svc:'warehouse',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,jti:'vtk_x'})).toString('base64url');
  const orphan=`vwt_${body}.${createHmac('sha256',key).update('vwt_'+body).digest('base64url')}`;
  expect(verifyServiceToken(key,[WAREHOUSE],orphan)).toBeNull();
 });
 it('are no credential at this installation\'s API: the bearer read refuses one before hashing or reading anything',async()=>{
  const {token}=sign();
  queries.length=0;
  expect(await createBearerReader({db}).byToken(token)).toBeNull();
  expect(queries).toEqual([]);
 });
});

describe('a group\'s service tokens',()=>{
 const groupKey=groupServiceTokenKey('host-secret');
 const OPTED={...WAREHOUSE,introspectionSecretSha256:'a'.repeat(64),groupPrincipals:true};
 const input={group:{id:'grp_team',role:'editor' as const,issuedBy:'usr_ada'},parent:{kind:'token' as const,id:'tok_group'},notAfter:null};
 const signGroup=(now=Date.now(),notAfter:number|null=null)=>signGroupServiceToken(groupKey,OPTED,{...input,notAfter},now);
 it('carry the group, its level, who issued its sign-in and that sign-in, and no person, for five minutes',()=>{
  const issued=signGroup();
  expect(issued.token).toMatch(/^vgt_[\w-]+\.[\w-]+$/);
  const claims=verifyGroupServiceToken(groupKey,[OPTED],issued.token)!;
  expect(claims).toEqual({grp:'grp_team',rol:'editor',isb:'usr_ada',aud:WAREHOUSE.origin,svc:'warehouse',iat:expect.any(Number),exp:expect.any(Number),jti:expect.stringMatching(/^vtk_/),par:{kind:'token',id:'tok_group'}});
  expect(claims).not.toHaveProperty('sub');
  expect(claims.exp-claims.iat).toBe(SERVICE_TOKEN_TTL_SECONDS);
 });
 it('never outlive the group sign-in they were exchanged from, and are not issued for one about to end',()=>{
  const now=Date.UTC(2026,10,19,12),parentEnds=now+90_000;
  const issued=signGroup(now,parentEnds);
  expect(issued.expiresAt).toBe(new Date(parentEnds).toISOString());
  expect(verifyGroupServiceToken(groupKey,[OPTED],issued.token,now+89_000)).not.toBeNull();
  expect(verifyGroupServiceToken(groupKey,[OPTED],issued.token,now+90_000)).toBeNull();
  for(const ends of [now,now+500,now-1000])expect(()=>signGroup(now,ends),String(ends-now)).toThrow('parent_expiring');
 });
 it('verify only for a service that still opts in, at its origin, and for no other',()=>{
  const {token}=signGroup();
  expect(verifyGroupServiceToken(groupKey,[{...OPTED,groupPrincipals:false}],token)).toBeNull();
  expect(verifyGroupServiceToken(groupKey,[WAREHOUSE],token)).toBeNull();
  expect(verifyGroupServiceToken(groupKey,[{...OPTED,origin:'https://warehouse2.example'}],token)).toBeNull();
  expect(verifyGroupServiceToken(groupKey,[{...CRM,introspectionSecretSha256:'b'.repeat(64),groupPrincipals:true}],token)).toBeNull();
 });
 it('need a group at a supported level, an issuer, and a group sign-in (a token) as parent',()=>{
  for(const change of [{group:{...input.group,role:'owner' as never}},{group:{...input.group,id:'not an id'}},{group:{...input.group,issuedBy:''}},{parent:{kind:'session' as never,id:'ses_1'}},{parent:{kind:'token' as const,id:'not an id'}}])
   expect(()=>signGroupServiceToken(groupKey,OPTED,{...input,...change}),JSON.stringify(change)).toThrow(/invalid_group|invalid_parent/);
 });
 it('are never read as a person\'s: no person verifier, older or current, accepts one, nor the bearer read',async()=>{
  const {token}=signGroup();
  // What a verifier that knows only person tokens does with one: not its prefix, so no service token and no bearer.
  expect(isServiceToken(token)).toBe(false);
  expect(verifyServiceToken(key,[OPTED],token)).toBeNull();
  queries.length=0;
  expect(await createBearerReader({db}).byToken(token)).toBeNull();
  expect(queries).toEqual([]);
  // Its claims signed as a person's token, under the person kind's own key: refused for want of a person.
  const body=token.slice(4).split('.')[0]!;
  const asPerson=`vwt_${body}.${createHmac('sha256',key).update('vwt_'+body).digest('base64url')}`;
  expect(verifyServiceToken(key,[OPTED],asPerson)).toBeNull();
  // Re-prefixed, its signature fails; under the group key but the person prefix, the person kind's key differs.
  expect(verifyServiceToken(key,[OPTED],'vwt_'+token.slice(4))).toBeNull();
  expect(verifyServiceToken(groupKey,[OPTED],'vwt_'+token.slice(4))).toBeNull();
 });
 it('leave a person\'s token as it was: it verifies as before and never as a group\'s',()=>{
  const {token}=signServiceToken(key,OPTED,{userId:'usr_bob',parent},Date.now());
  expect(isGroupServiceToken(token)).toBe(false);
  expect(verifyServiceToken(key,[OPTED],token)).toMatchObject({sub:'usr_bob',par:parent});
  expect(verifyGroupServiceToken(groupKey,[OPTED],token)).toBeNull();
  expect(verifyGroupServiceToken(groupKey,[OPTED],'vgt_'+token.slice(4))).toBeNull();
  // A person's claims under the group kind's key and prefix: refused, a group's carries no person.
  const body=token.slice(4).split('.')[0]!;
  expect(verifyGroupServiceToken(groupKey,[OPTED],`vgt_${body}.${createHmac('sha256',groupKey).update('vgt_'+body).digest('base64url')}`)).toBeNull();
 });
});

describe('a verified session signing in an agent as one group',()=>{
 useAppHarness();
 useGroupPrincipalHost();

 it('uses only the requested membership and level when the agent acts',async()=>{
  const host=await composed();
  const {ada,eve,team,squad}=await world(host,false,'member');
  // Eve is a direct Member of Team and Squad.
  await admitGroupMember(ada.userId,squad.id,eve.userId,'member');
  const publish=(token:string,id:string)=>host.call('POST','/api/artifacts',token,{
   title:'Group notes',html:page('Group notes'),visibility:'private',destination:{type:'group',id},
  });
  const teamPage=await publish(eve.token,team.id);
  const squadPage=await publish(ada.token,squad.id);
  expect(teamPage.status).toBe(201);
  expect(squadPage.status).toBe(201);

  const requestGrant=(group_id:string,group_role:string)=>host.fetch(new Request(origin+'/api/authentication/token',{
   method:'POST',headers:{origin,cookie:eve.cookie,'content-type':'application/json'},
   body:JSON.stringify({group_id,group_role}),
  }));
  const issued=await requestGrant(team.id,'member');
  expect(issued.status).toBe(201);
  const grant=await issued.json();
  expect(grant).toMatchObject({group_id:team.id,group_role:'member',token_type:'Bearer',access_token:expect.any(String)});

  const read=(token:string,id:unknown)=>host.call('GET',`/api/artifacts/${id}`,token);
  expect((await read(grant.access_token,teamPage.body!.id)).status).toBe(200);
  expect((await publish(grant.access_token,team.id)).status).toBe(403);
  expect((await read(eve.token,squadPage.body!.id)).status).toBe(200);
  expect((await read(grant.access_token,squadPage.body!.id)).status).toBe(404);

  for(const [role,status,error] of [['editor',403,'group_level_not_held'],['admin',400,'invalid_group_sign_in']] as const){
   const refused=await requestGrant(squad.id,role);
   expect(refused.status).toBe(status);
   expect(await refused.json()).toMatchObject({error});
  }
 });
});
