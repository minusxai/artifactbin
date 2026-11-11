/**
 * VIEWER TOKENS (src/identity/service-tokens.ts) as the identity store issues them: bound to one viewer and one
 * configured audience, 60 seconds, naming the page and function that asked, writing nothing, and never a credential
 * at this installation's own API (the bearer read refuses the shape before touching the database). Introspection's
 * answer for them is pinned in session-authority.test.ts.
 */
import {describe,expect,it} from 'vitest';
import {IdentityError,VIEWER_TOKEN_TTL_SECONDS,type TransactionalQueryable} from '@artifactbin/contracts';
import {createIdentityStore} from '../src/identity-store';
import {createBearerReader} from '../src/identity/bearer';
import {verifyViewerToken,viewerTokenKey} from '../src/identity/service-tokens';

const WAREHOUSE={id:'warehouse',origin:'https://warehouse.example',introspectionSecretSha256:null};
const CRM={id:'crm',origin:'https://crm.example',introspectionSecretSha256:null};
const queries:string[]=[];
const db:TransactionalQueryable={query:async sql=>{queries.push(sql);throw Error('a viewer token touches no table');},transaction:async()=>{throw Error('no transaction');}};
const store=(secret:string|null='host-secret')=>createIdentityStore({db,serviceTokens:{secret:secret??undefined,audiences:[WAREHOUSE,CRM]}});

describe('issueViewerToken',()=>{
 it('signs a token for that viewer, that audience and the asker, for 60 seconds, writing nothing',async()=>{
  queries.length=0;
  const before=Date.now();
  const issued=await store().issueViewerToken({userId:'usr_bob',service:'warehouse',artifactId:'pg_1',function:'revenue'});
  expect(issued.audience).toBe(WAREHOUSE.origin);
  expect(Date.parse(issued.expiresAt)-before).toBeGreaterThan((VIEWER_TOKEN_TTL_SECONDS-2)*1000);
  expect(Date.parse(issued.expiresAt)-before).toBeLessThanOrEqual(VIEWER_TOKEN_TTL_SECONDS*1000);
  const claims=verifyViewerToken(viewerTokenKey('host-secret'),[WAREHOUSE,CRM],issued.token)!;
  expect(claims).toMatchObject({sub:'usr_bob',aud:WAREHOUSE.origin,svc:'warehouse',act:{artifact_id:'pg_1',function:'revenue'}});
  expect(claims.exp-claims.iat).toBe(VIEWER_TOKEN_TTL_SECONDS);
  expect(queries).toEqual([]);
 });
 it('is bound to its audience: it verifies for no other configured service, and not once that service is gone',async()=>{
  const {token}=await store().issueViewerToken({userId:'usr_bob',service:'crm'});
  const claims=verifyViewerToken(viewerTokenKey('host-secret'),[WAREHOUSE,CRM],token)!;
  expect(claims.aud).toBe(CRM.origin);
  expect(verifyViewerToken(viewerTokenKey('host-secret'),[WAREHOUSE],token)).toBeNull();
  // The same id moved to another origin is another audience.
  expect(verifyViewerToken(viewerTokenKey('host-secret'),[{...CRM,origin:'https://crm2.example'}],token)).toBeNull();
 });
 it('expires: refused from its expiry on, and a token from the future is refused too',async()=>{
  const {token}=await store().issueViewerToken({userId:'usr_bob',service:'warehouse'});
  const key=viewerTokenKey('host-secret'),now=Date.now();
  expect(verifyViewerToken(key,[WAREHOUSE],token,now+(VIEWER_TOKEN_TTL_SECONDS-2)*1000)).not.toBeNull();
  expect(verifyViewerToken(key,[WAREHOUSE],token,now+(VIEWER_TOKEN_TTL_SECONDS+1)*1000)).toBeNull();
  expect(verifyViewerToken(key,[WAREHOUSE],token,now-60_000)).toBeNull();
 });
 it('refuses an unknown service, a host without a key, and a malformed asker',async()=>{
  await expect(store().issueViewerToken({userId:'usr_bob',service:'payroll'})).rejects.toEqual(new IdentityError('unknown_service',404));
  await expect(store(null).issueViewerToken({userId:'usr_bob',service:'warehouse'})).rejects.toEqual(new IdentityError('service_tokens_unavailable',503));
  await expect(store().issueViewerToken({userId:'usr bob',service:'warehouse'})).rejects.toEqual(new IdentityError('invalid_request',400));
  await expect(store().issueViewerToken({userId:'usr_bob',service:'warehouse',function:'not a name'})).rejects.toEqual(new IdentityError('invalid_request',400));
 });
 it('an exchanged token (a parent credential, no asker) lives five minutes; a viewer token may not, and a parent with an asker is refused',async()=>{
  const {signViewerToken}=await import('../src/identity/service-tokens');
  const key=viewerTokenKey('host-secret'),now=Date.now();
  const exchanged=signViewerToken(key,WAREHOUSE,{userId:'usr_bob',parent:{kind:'session',id:'ses_1'}},now).token;
  expect(verifyViewerToken(key,[WAREHOUSE],exchanged,now+290_000)).toMatchObject({sub:'usr_bob',par:{kind:'session',id:'ses_1'},act:{artifact_id:null,function:null}});
  expect(verifyViewerToken(key,[WAREHOUSE],exchanged,now+301_000)).toBeNull();
  expect(verifyViewerToken(key,[WAREHOUSE],signViewerToken(key,WAREHOUSE,{userId:'usr_bob'},now).token,now+61_000)).toBeNull();
  for(const input of [{parent:{kind:'session' as const,id:'ses_1'},actor:{artifactId:'pg_1'}},{parent:{kind:'group' as never,id:'g_1'}},{parent:{kind:'token' as const,id:'not an id'}}])
   expect(()=>signViewerToken(key,WAREHOUSE,{userId:'usr_bob',...input}),JSON.stringify(input)).toThrow(/invalid_parent/);
 });
 it('is no credential at this installation\'s API: the bearer read refuses it before hashing or reading anything',async()=>{
  const {token}=await store().issueViewerToken({userId:'usr_bob',service:'warehouse'});
  queries.length=0;
  expect(await createBearerReader({db}).byToken(token)).toBeNull();
  expect(queries).toEqual([]);
 });
});
