/**
 * EXCHANGED SERVICE TOKENS (src/identity/service-tokens.ts): bound to one person, one configured audience and the
 * credential they were exchanged for, five minutes, and never a credential at this installation's own API (the bearer
 * read refuses the shape before touching the database). Introspection's answer for them is pinned in
 * session-authority.test.ts.
 */
import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {SERVICE_TOKEN_TTL_SECONDS,type TransactionalQueryable} from '@artifactbin/contracts';
import {createBearerReader} from '../src/identity/bearer';
import {serviceTokenKey,signServiceToken,verifyServiceToken} from '../src/identity/service-tokens';

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
