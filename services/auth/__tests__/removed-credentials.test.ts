/**
 * WHAT THIS INSTALLATION NO LONGER HAS, AT THE IDENTITY HOST: artifact read grants (`arg_`), page workloads and page
 * evidence. A configured service whose entry still carries a removed key starts, told once at boot without its value;
 * the old internal paths are unknown paths, forwarding nothing; an `arg_` token is no credential to introspection or a
 * run sign-in; a signed actor naming a workload is no one.
 */
import {createHmac,hkdfSync} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {CHART_IMAGE_PATH, IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {RUN_SIGN_IN_PATH} from '@artifactbin/contracts/service-audiences';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {signActor,verifyActor} from '@artifactbin/utils';
import {delegatedService,serviceAuthHost,serviceAudiences} from './helpers';

const CALLBACK_SECRET='synthetic-callback-secret-value';
const ENTRY={...delegatedService('warehouse','https://warehouse.example','service-secret'),artifact_reads:true,run_sign_ins:true,
 artifact_workloads:{authorization_url:'https://worker.example/authorize',authorization_secret:CALLBACK_SECRET}};
const OLD_PATHS=['/api/internal/identity/artifact-read-grant','/api/internal/identity/artifact-read','/api/internal/identity/artifact-image',
 '/api/internal/identity/page-evidence','/api/internal/identity/artifact-workload','/api/internal/artifact-read','/api/internal/artifact-image',
 '/api/internal/page-evidence','/api/internal/artifact-workload'];
afterEach(()=>{vi.restoreAllMocks();});

/** An artifact read grant exactly as it was signed (its own prefix and key, for the host's secret `test`). */
function oldGrant(){
 const key=Buffer.from(hkdfSync('sha256',Buffer.from('test','utf8'),Buffer.from('identity-artifact-read-grant'),Buffer.from('v1'),32));
 const now=Math.floor(Date.now()/1000),claims=Buffer.from(JSON.stringify({sub:'usr_bob',aud:'https://warehouse.example',svc:'warehouse',iat:now,exp:now+3600,jti:'vtk_1',par:{kind:'token',id:'tok_1'}})).toString('base64url');
 return `arg_${claims}.${createHmac('sha256',key).update('arg_'+claims).digest('base64url')}`;
}

it('starts with an entry that still carries a removed key, says so in one line without its value, and keeps the entry\'s other opt-ins',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const forwarded:string[]=[];
 const app=serviceAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:serviceAudiences(ENTRY),INTERNAL__SERVICE_SECRET:'internal-test-secret'},
  upstream:async request=>{forwarded.push(new URL(request.url).pathname);return Response.json({mime:'image/png',width:1,height:1,bytes:1,data:'AA=='});}});
 const lines=warn.mock.calls.map(call=>call.map(String).join(' ')).filter(line=>line.includes('IDENTITY__SERVICE_AUDIENCES'));
 expect(lines).toHaveLength(1);
 expect(lines[0]).toContain('"warehouse"');expect(lines[0]).toContain('artifact_workloads');
 expect(warn.mock.calls.flat().map(String).join('\n')).not.toContain(CALLBACK_SECRET);
 // The kept relay drawing still answers under `artifact_reads`.
 const chart=await app.request(CHART_IMAGE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:'service-secret'},body:JSON.stringify({chart:{type:'bar'},rows:[]})});
 expect(chart.status).toBe(200);expect(forwarded).toEqual(['/api/internal/chart-image']);
 // The removed routes are unknown paths, with the service's own secret or the installation's: nothing reaches the app.
 for(const path of OLD_PATHS)for(const secret of ['service-secret','internal-test-secret']){
  const answer=await app.request(path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret,'content-type':'application/json'},body:JSON.stringify({token:oldGrant(),grant:oldGrant(),artifact_id:'PAGE12'})});
  expect(answer.status,`${path} ${secret}`).toBe(404);
 }
 expect(forwarded).toEqual(['/api/internal/chart-image']);
});

it('reads an old artifact read grant as no credential: inactive to introspection, unauthorized to a run sign-in',async()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const app=serviceAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:serviceAudiences(ENTRY),INTERNAL__SERVICE_SECRET:'internal-test-secret'},upstream:async()=>{throw new Error('nothing is forwarded');}});
 const post=(path:string,body:unknown,secret:string)=>app.request(path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body)});
 for(const secret of ['internal-test-secret','service-secret']){
  const answer=await post(IDENTITY_INTROSPECT_PATH,{token:oldGrant()},secret);
  expect([answer.status,await answer.json()]).toEqual([200,{active:false}]);
 }
 const run=await post(RUN_SIGN_IN_PATH,{token:oldGrant()},'service-secret');
 expect([run.status,await run.json()]).toEqual([401,{error:'unauthorized'}]);
});

it('reads a signed actor naming a workload as no one, and a person\'s or a group\'s as before',()=>{
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 const signed=(claims:Record<string,unknown>)=>signActor(claims as unknown as Parameters<typeof signActor>[0],'internal-test-secret');
 expect(verifyActor(signed({credential:'workload',serviceWorkload:true,workload:principal}),'internal-test-secret')).toBeNull();
 expect(verifyActor(signed({credential:'bearer',userId:'usr_1',tokenId:'tok_1',workload:principal}),'internal-test-secret')).toBeNull();
 expect(verifyActor(signed({credential:'session',userId:'usr_1',serviceWorkload:true}),'internal-test-secret')).toBeNull();
 expect(verifyActor(signed({credential:'bearer',userId:'usr_1',tokenId:'tok_1'}),'internal-test-secret')).toEqual({credential:'bearer',userId:'usr_1',tokenId:'tok_1'});
 const group={credential:'bearer',principal:'group',principalGroupId:'grp_1',principalGroupRole:'member',tokenId:'tok_2',issuedBy:'usr_1'};
 expect(verifyActor(signed(group),'internal-test-secret')).toEqual(group);
});
