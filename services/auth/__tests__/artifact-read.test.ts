/** Purpose-only delegated reads exercise the real auth handler and parent fence. */
import {describe,it,expect,vi} from 'vitest';
import {delegatedService,audiencesOf,noTokens} from './helpers';
import {ARTIFACT_READ_GRANT_PATH,ARTIFACT_READ_PATH,SERVICE_AUTH_HEADER,SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts';
import {createAuthHost} from '../src/parts';
import {artifactReadKey,signArtifactReadGrant} from '../src/identity/artifact-read-grants';
import {serviceTokenKey,signServiceToken} from '../src/identity/service-tokens';

describe('delegated artifact reads',()=>{
 it('binds a grant to the service/person/parent and exposes only a fixed read operation',async()=>{
  let active=true,live=true,accessible=true,revokeDuringRead=false,oversized=false;const requests:Request[]=[];
  const service=delegatedService('warehouse','https://warehouse.example','service-secret');
  const app=createAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:audiencesOf(service)},cookieSecret:'test',tokens:noTokens,sessions:{resolve:async()=>null},identityDb:{query:async<T>(sql:string)=>({rows:[sql.includes('users')?{active}:{live}] as T[]})},upstream:async(request,actor)=>{requests.push(request);if(revokeDuringRead)live=false;expect(actor.userId).toBe('usr_1');return Response.json(accessible?{id:'abc',html:oversized?'x'.repeat(SERVICE_PAYLOAD_LIMIT):'<p>Hi</p>'}:{error:'not_found'},{status:accessible?200:404});}});
  const call=(path:string,body:unknown,secret='service-secret')=>app.request(path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body)});
  const token=signServiceToken(serviceTokenKey('test'),service,{userId:'usr_1',parent:{kind:'session',id:'ses_1'}}).token;
  expect((await call(ARTIFACT_READ_GRANT_PATH,{token},'wrong')).status).toBe(401);
  expect((await call(ARTIFACT_READ_GRANT_PATH,{token,userId:'usr_2'})).status).toBe(400);
  const issued=await(await call(ARTIFACT_READ_GRANT_PATH,{token})).json();
  expect(issued).toMatchObject({user_id:'usr_1',audience:service.origin,grant:expect.stringMatching(/^arg_/)});
  expect(Date.parse(issued.expires_at)-Date.now()).toBeGreaterThan(3500000);
  const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now+301000);
  expect((await call(ARTIFACT_READ_PATH,{grant:issued.grant,artifact_id:'abc'})).status).toBe(200);
  expect((await call(ARTIFACT_READ_GRANT_PATH,{token})).status).toBe(401);
  clock.mockRestore();requests.length=0;
  const read=()=>call(ARTIFACT_READ_PATH,{grant:issued.grant,artifact_id:'abc'});
  expect(await(await read()).json()).toEqual({id:'abc',html:'<p>Hi</p>'});
  expect(requests).toHaveLength(2);for(const request of requests){expect(request.method).toBe('GET');expect(new URL(request.url).pathname).toBe('/api/internal/artifact-read');expect([...request.headers]).toEqual([]);}
  for(const extra of [{path:'/api/tokens'},{method:'DELETE'},{userId:'usr_2'}])expect((await call(ARTIFACT_READ_PATH,{grant:issued.grant,artifact_id:'abc',...extra})).status).toBe(400);
  expect((await call(ARTIFACT_READ_PATH,{grant:issued.grant+'x',artifact_id:'abc'})).status).toBe(401);
  const expired=signArtifactReadGrant(artifactReadKey('test'),service,{userId:'usr_1',parent:{kind:'session',id:'ses_1'}},Date.now()-3601000).token;
  expect((await call(ARTIFACT_READ_PATH,{grant:expired,artifact_id:'abc'})).status).toBe(401);
  const wrongAudience=signServiceToken(serviceTokenKey('test'),{...service,id:'other',origin:'https://other.example'},{userId:'usr_1',parent:{kind:'session',id:'ses_1'}}).token;
  expect((await call(ARTIFACT_READ_GRANT_PATH,{token:wrongAudience})).status).toBe(401);
  oversized=true;expect((await read()).status).toBe(413);oversized=false;
  revokeDuringRead=true;expect((await read()).status).toBe(401);revokeDuringRead=false;live=true;
  accessible=false;expect((await read()).status).toBe(404);accessible=true;
  live=false;expect((await read()).status).toBe(401);live=true;
  active=false;expect((await read()).status).toBe(401);
 });
});
